"""Same-origin bridge to the existing uploader; no parser or canonical DB writes.

Parent calls attach_import_routes(app, config, authenticated, categories, store).
config.sourcing_import_url is a fixed internal origin (never browser input).
Tests may inject app.state.sourcing_import_client = httpx.Client(transport=...).
Operational associations live in store.path, not the owner's data database.
POST preview: multipart category_id/candidate_id/file/supplier/date (incremental).
POST selection: {import_ref, choices:[{index, option_index:int|null}]}.
POST start: {import_ref, confirmed:true, request_id}; GET jobs/{import_ref}.
GET suppliers is the canonical owner name list. POSTs require allowed same-origin
Origin and X-Tender-Sourcing-Action:sourcing-v1. Unknown submissions stay blocked
for manual owner review; this module deliberately has no retry/recovery-write API.
"""
import datetime as dt
import hashlib
import io
import json
import re
import sqlite3
import uuid
import zipfile
from contextlib import contextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from .sourcing import SourcingError

MAX_BYTES = 50 * 1024 * 1024
SUMMARY_KEYS = ('accepted', 'rejected', 'skipped', 'not_selected', 'total_source_rows')


def attach_import_routes(app, config, authenticated, categories, store):
    origin = getattr(config, 'sourcing_import_url', '').rstrip('/')
    if not origin:
        return
    parsed = urlsplit(origin)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('sourcing_import_url must be a fixed internal HTTP origin')

    @contextmanager
    def database():
        db = sqlite3.connect(store.path, timeout=20)
        try:
            with db:
                yield db
        finally:
            db.close()

    with database() as db:
        db.execute('CREATE TABLE IF NOT EXISTS sourcing_imports (ref TEXT PRIMARY KEY, request_id TEXT UNIQUE, data TEXT NOT NULL)')

    def save(db, ref, data):
        db.execute('UPDATE sourcing_imports SET data=? WHERE ref=?', (json.dumps(data, ensure_ascii=False), ref))

    def association(ref):
        if not isinstance(ref, str) or not re.fullmatch(r'[0-9a-f]{32}', ref):
            raise HTTPException(404, 'Импорт не найден')
        with database() as db:
            row = db.execute('SELECT data FROM sourcing_imports WHERE ref=?', (ref,)).fetchone()
        if not row:
            raise HTTPException(404, 'Импорт не найден')
        return json.loads(row[0])

    def current(category_id, candidate_id, refs=None):
        cats = categories()
        state = store.state(cats)
        category = next((c for c in state['categories'] if c['id'] == category_id), None)
        candidate = next((c for c in (category or {}).get('candidates', []) if c['id'] == candidate_id), None)
        if not candidate:
            raise HTTPException(404, 'Кандидат не найден')
        if candidate['stage'] != 3 or candidate['stale'] or candidate['rejected']:
            raise HTTPException(409, 'Нужен текущий кандидат на этапе «Ответ получен»')
        snapshot = {line['key']: line['source_revision'] for line in category['lines'] if line['key'] in candidate['line_keys']}
        if not snapshot or (refs is not None and snapshot != refs):
            raise HTTPException(409, 'Исходные строки изменились; импорт остановлен')
        return cats, state, candidate, snapshot

    def owner(method, path, **kwargs):
        try:
            client = getattr(app.state, 'sourcing_import_client', None)
            if client is None:
                with httpx.Client(timeout=120, trust_env=False, follow_redirects=False) as client:
                    response = client.request(method, origin + path, **kwargs)
            else:
                response = client.request(method, origin + path, follow_redirects=False, **kwargs)
            if response.status_code >= 300:
                raise HTTPException(409 if response.status_code == 409 else 502, 'Загрузчик не подтвердил действие; проверьте его состояние')
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError()
            return body
        except (httpx.HTTPError, ValueError):
            raise HTTPException(502, 'Ответ загрузчика не получен; проверьте состояние, не повторяйте импорт вслепую') from None

    def guard(request: Request):
        supplied_origin = request.headers.get('origin', '').rstrip('/')
        if supplied_origin not in config.allowed_origins or supplied_origin != f'{request.url.scheme}://{request.url.netloc}' or request.headers.get('sec-fetch-site') == 'cross-site':
            raise HTTPException(403, 'Недопустимый источник запроса')
        if request.headers.get('X-Tender-Sourcing-Action') != 'sourcing-v1':
            raise HTTPException(403, 'Не подтверждено действие поиска поставщиков')
        expected = 'multipart/form-data' if request.url.path.endswith('/preview') else 'application/json'
        if request.headers.get('content-type', '').split(';')[0].strip().lower() != expected:
            raise HTTPException(415, 'Неверный формат запроса')

    def summary(result):
        value = result.get('normalized_preview', {}).get('summary', {})
        return {key: value[key] for key in SUMMARY_KEYS if type(value.get(key)) is int and value[key] >= 0}

    def public_preview(ref, data):
        result = data['preview']
        preview = result.get('normalized_preview') or {}
        # Never forward loader_result, source paths, exception strings, or filesystem receipts.
        warnings = [s for s in result.get('issues', []) if isinstance(s, str) and re.fullmatch(r'[A-Za-z0-9_:.-]{1,200}', s)]
        columns = [{key: column[key] for key in ('key', 'label') if key in column} for column in preview.get('columns', [])]
        return dict(import_ref=ref, supplier=data['supplier'], date=data['date'],
            can_apply=result.get('can_apply') is True, summary=summary(result),
            columns=columns, rows=[dict(source_sheet=row.get('source_sheet'), source_row=row.get('source_row'),
                values={column['key']: row.get('values', {}).get(column['key']) for column in columns},
                extra_fields=row.get('extra_fields', {})) for row in preview.get('rows', [])[:100]], warnings=warnings,
            selection_options=[dict(index=s['index'], name=s['name'], state=s.get('state'),
                options=[{key: option[key] for key in ('option_index', 'header_start_row_1based', 'header_end_row_1based', 'mapping', 'columns') if key in option}
                         for option in s.get('options', [])]) for s in result.get('selection_options', [])])

    router = APIRouter(prefix='/api/sourcing/import', dependencies=[Depends(authenticated)])

    @router.get('/suppliers')
    def suppliers():
        result = owner('GET', '/api/suppliers')
        return {'suppliers': [name for name in result.get('suppliers', []) if isinstance(name, str)]}

    @router.get('/active')
    def active_import(category_id: str, candidate_id: str):
        current(category_id, candidate_id)
        with database() as db:
            rows = db.execute('SELECT ref,data FROM sourcing_imports ORDER BY rowid DESC').fetchall()
        for ref, raw in rows:
            data = json.loads(raw)
            if data['category_id'] == category_id and data['candidate_id'] == candidate_id and data['phase'] in ('SUBMITTING','SUBMITTED','UNKNOWN'):
                return {'import_ref': ref, 'phase': data['phase']}
        return {'import_ref': None, 'phase': None}

    @router.post('/preview', dependencies=[Depends(guard)])
    def preview(category_id: str = Form(...), candidate_id: str = Form(...), file: UploadFile = File(...),
                supplier: str = Form(...), date: str = Form(...)):
        _, _, candidate, refs = current(category_id, candidate_id)
        if candidate['import_receipt']:
            raise HTTPException(409, 'Импорт уже подтверждён')
        supplier = supplier.strip()
        if not supplier or len(supplier) > 200 or any(ord(c) < 32 for c in supplier):
            raise HTTPException(400, 'Укажите поставщика, до 200 символов')
        try:
            if dt.date.fromisoformat(date).isoformat() != date:
                raise ValueError()
        except ValueError:
            raise HTTPException(400, 'Укажите действительную дату ГГГГ-ММ-ДД') from None
        name = file.filename or ''
        suffix = name.rsplit('.', 1)[-1].lower()
        if suffix not in ('xls', 'xlsx', 'xlsm') or any(c in name for c in ('/', '\\')) or len(name.encode()) > 255 or any(ord(c) < 32 for c in name):
            raise HTTPException(400, 'Нужен Excel XLS, XLSX или XLSM с безопасным именем')
        try:
            content = file.file.read(MAX_BYTES + 1)
        finally:
            file.file.close()
        if len(content) > MAX_BYTES:
            raise HTTPException(413, 'Файл больше 50 МБ')
        valid = content.startswith(bytes.fromhex('d0cf11e0a1b11ae1')) if suffix == 'xls' else False
        if suffix != 'xls':
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    valid = {'[Content_Types].xml', 'xl/workbook.xml'}.issubset(archive.namelist())
            except zipfile.BadZipFile:
                pass
        if not valid:
            raise HTTPException(400, 'Файл не является поддерживаемым Excel')
        result = owner('POST', '/api/preview', data=dict(supplier=supplier, date=date, mode='incremental'),
            files={'file': (name, content, file.content_type or 'application/octet-stream')})
        upload_id = result.get('upload_id')
        loader = result.get('loader_result')
        if not isinstance(upload_id, str) or not re.fullmatch(r'[0-9a-f]{32}', upload_id) or not isinstance(loader, dict):
            raise HTTPException(502, 'Загрузчик не вернул подтверждённый предпросмотр')
        if any(loader.get(key) != value for key, value in [('supplier', supplier), ('date', date), ('mode', 'incremental')]):
            raise HTTPException(502, 'Параметры предпросмотра не совпали')
        current(category_id, candidate_id, refs)
        ref = uuid.uuid4().hex
        data = dict(category_id=category_id, candidate_id=candidate_id, refs=refs, upload_id=upload_id,
            supplier=supplier, date=date, mode='incremental', sha256=hashlib.sha256(content).hexdigest(),
            preview=loader, phase='PREVIEW', job_id=None)
        with database() as db:
            db.execute('INSERT INTO sourcing_imports VALUES(?,NULL,?)', (ref, json.dumps(data, ensure_ascii=False)))
        return public_preview(ref, data)

    @router.post('/selection', dependencies=[Depends(guard)])
    def selection(payload: dict):
        ref = payload.get('import_ref')
        data = association(ref)
        current(data['category_id'], data['candidate_id'], data['refs'])
        choices = payload.get('choices')
        options = data['preview'].get('selection_options', [])
        if not isinstance(choices, list) or len(choices) != len(options) or any(not isinstance(c, dict) or type(c.get('index')) is not int for c in choices):
            raise HTTPException(400, 'Нужен явный выбор для каждого листа')
        by_index = {c['index']: c for c in choices}
        if len(by_index) != len(options) or set(by_index) != {s['index'] for s in options}:
            raise HTTPException(400, 'Выбор не относится к листам файла')
        sheets = []
        for sheet in options:
            chosen = by_index[sheet['index']].get('option_index')
            entry = dict(index=sheet['index'], name=sheet['name'], selected=chosen is not None,
                explicit_exclusion=chosen is None)
            if chosen is not None:
                option = next((o for o in sheet.get('options', []) if type(chosen) is int and o['option_index'] == chosen), None)
                if option is None or sheet.get('state') != 'visible':
                    raise HTTPException(400, 'Выберите действительный вариант загрузчика')
                entry.update({key: option[key] for key in ('mapping', 'header_start_row_1based', 'header_end_row_1based')})
                entry['confirmed'] = True
            sheets.append(entry)
        selected = {'receipt_id': data['preview'].get('selection', {}).get('receipt_id'), 'sheets': sheets}
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            live = json.loads(db.execute('SELECT data FROM sourcing_imports WHERE ref=?', (ref,)).fetchone()[0])
            if live['phase'] != 'PREVIEW':
                raise HTTPException(409, 'После запуска выбор не меняется')
            data['phase'] = 'SELECTING'
            data['preview']['can_apply'] = False
            save(db, ref, data)
        try:
            response = owner('POST', '/api/selection', json={'upload_id': data['upload_id'], 'selection': selected})
            loader = response.get('loader_result')
            if response.get('upload_id') != data['upload_id'] or not isinstance(loader, dict) or any(loader.get(key) != data[key] for key in ('supplier', 'date', 'mode')):
                raise HTTPException(502, 'Загрузчик не подтвердил выбор для этого файла')
            data['preview'] = loader
        finally:
            data['phase'] = 'PREVIEW'
            with database() as db:
                save(db, ref, data)
        return public_preview(ref, data)

    @router.post('/start', dependencies=[Depends(guard)])
    def start(payload: dict):
        ref = payload.get('import_ref')
        data = association(ref)
        if payload.get('confirmed') is not True:
            raise HTTPException(400, 'Нужно явное подтверждение загрузки в рабочую БД')
        request_id = payload.get('request_id')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,200}', request_id):
            raise HTTPException(400, 'Нужен request_id')
        _, _, candidate, _ = current(data['category_id'], data['candidate_id'], data['refs'])
        with database() as db:
            # ponytail: one operational writer; database reservation prevents duplicate HTTP submissions.
            db.execute('BEGIN IMMEDIATE')
            duplicate = db.execute('SELECT ref FROM sourcing_imports WHERE request_id=?', (request_id,)).fetchone()
            if duplicate and duplicate[0] != ref:
                raise HTTPException(409, 'request_id уже связан с другим импортом')
            data = json.loads(db.execute('SELECT data FROM sourcing_imports WHERE ref=?', (ref,)).fetchone()[0])
            if data['job_id']:
                return {'import_ref': ref, 'status': 'SUBMITTED'}
            if data['phase'] != 'PREVIEW':
                raise HTTPException(409, 'Результат отправки неизвестен. Нужна ручная проверка загрузчика; повтор запрещён')
            if candidate['import_receipt']:
                raise HTTPException(409, 'Импорт уже подтверждён')
            counts = summary(data['preview'])
            if (data['preview'].get('can_apply') is not True or len(counts) != len(SUMMARY_KEYS)
                    or sum(counts[key] for key in SUMMARY_KEYS[:-1]) != counts['total_source_rows']
                    or not counts.get('accepted') or not data['preview'].get('normalized_preview', {}).get('rows')):
                raise HTTPException(409, 'Нет подтверждённых нормализованных строк для импорта')
            others = db.execute('SELECT data FROM sourcing_imports WHERE ref<>?', (ref,)).fetchall()
            if any((other := json.loads(row[0]))['candidate_id'] == data['candidate_id'] and other['phase'] in ('SUBMITTING', 'UNKNOWN', 'SUBMITTED') for row in others):
                raise HTTPException(409, 'Для кандидата уже был запуск; проверьте его результат вручную')
            data['phase'] = 'SUBMITTING'
            db.execute('UPDATE sourcing_imports SET request_id=? WHERE ref=?', (request_id, ref))
            save(db, ref, data)
        try:
            result = owner('POST', '/api/jobs/import', data={key: data[key] for key in ('supplier', 'date', 'mode')} | {'file_path': data['upload_id']})
            job_id = result.get('job_id')
            if not isinstance(job_id, str) or not re.fullmatch(r'job-[0-9a-f]{32}', job_id):
                raise HTTPException(502, 'Загрузчик не вернул идентификатор задачи; нужна ручная проверка')
        except HTTPException:
            data['phase'] = 'UNKNOWN'
            with database() as db:
                save(db, ref, data)
            raise
        data.update(job_id=job_id, phase='SUBMITTED')
        with database() as db:
            save(db, ref, data)
        return {'import_ref': ref, 'status': 'SUBMITTED'}

    @router.get('/jobs/{import_ref}')
    def job(import_ref: str):
        data = association(import_ref)
        cats, state, candidate, _ = current(data['category_id'], data['candidate_id'], data['refs'])
        if not data['job_id']:
            return dict(import_ref=import_ref, status=data['phase'], verified=False, done=True,
                stage='Результат отправки не подтверждён; нужна ручная проверка', manual_check=True)
        result = owner('GET', '/api/jobs/' + data['job_id'])
        if any(result.get(key) != value for key, value in [('id', data['job_id']), ('upload_id', data['upload_id']),
                ('supplier', data['supplier']), ('date', data['date']), ('mode', data['mode']), ('action', 'import')]):
            raise HTTPException(502, 'Задача загрузчика не относится к этому импорту')
        status = result.get('status')
        done = status not in ('QUEUED', 'RUNNING')
        receipt = result.get('result') or {}
        checks = receipt.get('post_checks') or {}
        counts = receipt.get('source_summary') or {}
        expected_counts = summary(data['preview'])
        verified = (status == 'PUBLISHED' and receipt.get('status') in ('PASS', 'REVIEW')
            and receipt.get('published') is True and isinstance(receipt.get('publication'), str) and bool(receipt['publication'])
            and receipt.get('request_id') == data['job_id'] and receipt.get('supplier') == data['supplier']
            and receipt.get('loaded_date') == data['date'] and (receipt.get('file') or {}).get('sha256') == data['sha256']
            and checks.get('integrity_check') == 'ok' and type(checks.get('foreign_key_check_rows')) is int
            and checks['foreign_key_check_rows'] == 0 and len(expected_counts) == len(SUMMARY_KEYS)
            and all(type(counts.get(key)) is int and counts[key] == expected_counts[key] for key in SUMMARY_KEYS))
        partial = verified and (receipt['status'] == 'REVIEW' or counts['rejected'] > 0 or counts['not_selected'] > 0)
        if verified:
            data['owner_job'] = result
            with database() as db:
                save(db, import_ref, data)
            cats, state, candidate, _ = current(data['category_id'], data['candidate_id'], data['refs'])
            saved = candidate['import_receipt']
            if saved and saved.get('receipt_id') != data['job_id']:
                raise HTTPException(409, 'У кандидата уже другой receipt импорта')
            if not saved:
                verified_receipt = dict(receipt_id=data['job_id'], status='PASS', supplier=data['supplier'],
                    date=data['date'], upload_id=data['upload_id'], source_sha256=data['sha256'],
                    publication_verified=True, post_checks={key: checks[key] for key in ('integrity_check', 'foreign_key_check_rows')}, source_summary={key: counts[key] for key in SUMMARY_KEYS},
                    owner_status=receipt['status'], partial=bool(partial))
                try:
                    store.command(cats, dict(action='import_receipt', category_id=data['category_id'], candidate_id=data['candidate_id'],
                        request_id='sourcing-import:' + import_ref, revision=state['revision'], receipt=verified_receipt),
                        'sourcing-import', verified=True)
                except SourcingError as error:
                    raise HTTPException(error.status_code, 'Состояние кандидата изменилось; повторите только проверку статуса') from None
        stages = {'QUEUED': 'В очереди загрузчика', 'RUNNING': 'Обработка загрузчиком',
            'PUBLISHED': 'Публикация подтверждена' if verified else 'Публикация не прошла проверку связи и read-back',
            'BLOCKED': 'Загрузчик остановил импорт', 'REVIEW': 'Запись в рабочую БД не подтверждена',
            'INTERRUPTED': 'Задача прервана; нужна ручная проверка'}
        stage = stages.get(status, 'Неизвестный статус; нужна ручная проверка')
        actual_stage = result.get('stage')
        if not done and isinstance(actual_stage, str) and len(actual_stage) <= 300 and not any(c in actual_stage for c in ('/', '\\', '\n', '\r', '\x00')):
            stage = actual_stage
        return dict(import_ref=import_ref, job_id=data['job_id'], status=status if status in stages else 'UNKNOWN',
            stage=stage, done=done,
            verified=bool(verified), partial=bool(partial), summary={key: counts[key] for key in SUMMARY_KEYS if type(counts.get(key)) is int},
            manual_check=done and not verified)

    app.include_router(router)
