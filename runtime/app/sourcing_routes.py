"""Same-panel sourcing routes. Reuse panel adapters and canonical search only."""
import copy
import fcntl
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from contextlib import contextmanager
from pathlib import Path

from fastapi import BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from .offers_refresh import RefreshError
from .sourcing import SourcingStore, SourcingError, build_categories, _score
from .sourcing_import import attach_import_routes
from .sourcing_research import research, ResearchError


def attach_sourcing_routes(app, config, authenticated, records, refresh_source, html_shell):
    store = SourcingStore(config.sourcing_db or config.offers_refresh_db.with_suffix('.sourcing.sqlite'))
    app.state.sourcing_store = store
    caps = {'research': bool(config.sourcing_search_url), 'import': bool(config.sourcing_import_url)}
    app.state.sourcing_research = research
    leases = {}

    @contextmanager
    def db():
        result = sqlite3.connect(store.path, timeout=20)
        result.row_factory = sqlite3.Row
        try:
            with result:
                yield result
        finally:
            result.close()

    with db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS sourcing_tasks (
            id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL,
            actor TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL)''')
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS sourcing_one_task ON sourcing_tasks ((1)) WHERE status IN ('queued','running')")

    def acquire():
        fd = os.open(str(store.path)+'.tasks.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return None
        return fd

    @app.on_event('startup')
    def recover():
        fd = acquire()
        if fd is None:
            return
        try:
            with db() as conn:
                for row in conn.execute("SELECT * FROM sourcing_tasks WHERE status IN ('queued','running')"):
                    data = json.loads(row['data'])
                    data.update(status='failed', message='Обновление прервано. Проверь результат перед повтором.')
                    conn.execute('UPDATE sourcing_tasks SET status=?,data=? WHERE id=?', ('failed', json.dumps(data, ensure_ascii=False), row['id']))
        finally:
            os.close(fd)

    def categories():
        return build_categories(records())

    def public_task(data):
        return {key: data[key] for key in ('id','status','kind','message','created_at') if key in data}

    def latest_task():
        recover()  # A free OS lease proves a persisted active task has no worker.
        with db() as conn:
            row = conn.execute('SELECT data FROM sourcing_tasks ORDER BY rowid DESC LIMIT 1').fetchone()
        return public_task(json.loads(row[0])) if row else None

    def state():
        result = store.state(categories(), caps)
        result['task'] = latest_task()
        return result

    def guard(request: Request):
        if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
            raise HTTPException(415, 'Требуется JSON')
        if request.headers.get('origin','').rstrip('/') not in config.allowed_origins or request.headers.get('sec-fetch-site') == 'cross-site':
            raise HTTPException(403, 'Недопустимый источник запроса')
        if request.headers.get('X-Tender-Sourcing-Action') != 'sourcing-v1':
            raise HTTPException(403, 'Не подтверждено действие поиска поставщиков')

    @app.exception_handler(SourcingError)
    async def sourcing_error(request, exc):
        return JSONResponse({'detail':str(exc)}, status_code=exc.status_code)

    @app.get('/sourcing')
    def shell(actor: str = Depends(authenticated)):
        return html_shell()

    @app.get('/api/sourcing')
    def get(actor: str = Depends(authenticated)):
        return state()

    @app.post('/api/sourcing/commands', dependencies=[Depends(guard)])
    def command(payload: dict, actor: str = Depends(authenticated)):
        result = store.command(categories(), payload, actor)
        result['state']['capabilities'] = caps
        return result

    def save_task(task):
        with db() as conn:
            conn.execute('UPDATE sourcing_tasks SET status=?,data=? WHERE id=?',
                         (task['status'], json.dumps(task, ensure_ascii=False), task['id']))

    def selected(payload, cats):
        category = next((c for c in cats if c['id'] == payload.get('category_id')), None)
        keys = payload.get('line_keys')
        if category is None or not isinstance(keys,list) or not keys or len(keys)>1000 or any(not isinstance(k,str) for k in keys) or len(set(keys))!=len(keys):
            raise SourcingError('Выбери точные строки категории')
        lines = [l for l in category['lines'] if l['key'] in keys]
        if len(lines)!=len(keys):
            raise SourcingError('Исходные строки изменились',409)
        return category, lines

    def run_task(task, payload, actor):
        try:
            task.update(status='running',message='Проверка текущей редакции')
            save_task(task)
            category, lines = selected(payload, store.state(categories())['categories'])
            if {l['key']:l['source_revision'] for l in lines} != task['refs']:
                raise SourcingError('ТЗ изменилось. Запусти действие для новой редакции',409)
            if task['kind']=='refresh':
                jobs=[]
                for tender_id in dict.fromkeys(l['tender_id'] for l in lines):
                    ids={l['line_id'] for l in lines if l['tender_id']==tender_id}
                    current = lambda tid=tender_id, ids=ids: [l for l in refresh_source(tid)[0] if l.get('line_id') in ids]
                    revision = lambda tid=tender_id: refresh_source(tid)[2]
                    task['message']='Поиск предложений · тендер '+tender_id
                    save_task(task)
                    job, started = app.state.offers_refresh.start(tender_id,current(),task['id']+'-'+tender_id,actor,source_revision=revision())
                    if started:
                        app.state.offers_refresh.run(job['job_id'],current,revision)
                    job=app.state.offers_refresh.latest(tender_id)
                    if job is None or job['status'] not in ('completed','partial'):
                        raise SourcingError((job or {}).get('error') or 'Поиск не завершён; дождись активного обновления',409)
                    jobs.append(job)
                task['jobs']=jobs
                partial=any(j['status']=='partial' for j in jobs)
                task['message']='Повторный поиск завершён'+(' частично; ошибки строк сохранены' if partial else '')
                task['status']='partial' if partial else 'completed'
                if payload.get('candidate_id'):
                    cats=categories(); view=store.state(cats)
                    cat=next(c for c in view['categories'] if c['id']==category['id'])
                    candidate=next(c for c in cat['candidates'] if c['id']==payload['candidate_id'])
                    receipt=candidate['import_receipt']
                    requested=[l for l in cat['lines'] if l['key'] in candidate['request']['line_keys']]
                    supplier=receipt['supplier']
                    actual=records()
                    by_tender={r['tender_id']:r for r in actual}
                    linked=all(any(item.get('line_id')==line['line_id'] and item.get('source_revision')==by_tender[line['tender_id']]['source_revision']
                                   and any((offer.get('supplier') or offer.get('supplier_name'))==supplier
                                           and offer.get('refresh_status','CURRENT')=='CURRENT'
                                           and _score(offer) is not None and _score(offer)>=50 for offer in item['results'])
                                   for item in by_tender[line['tender_id']].get('refresh_results',[])) for line in requested)
                    if not partial and linked and all(l['state']=='HAS_CANDIDATE' for l in requested):
                        store.command(cats, dict(action='rematched',category_id=cat['id'],candidate_id=candidate['id'],
                            revision=view['revision'],request_id='sourcing-rematched:'+task['id'],result=dict(status='completed',
                            receipt_id=receipt['receipt_id'],line_keys=candidate['request']['line_keys'],
                            source_revisions={l['key']:l['source_revision'] for l in requested})),actor,verified=True)
                    else:
                        task.update(status='partial',message='Поиск выполнен. Не по всем строкам подтверждён кандидат импортированного поставщика; потребность остаётся открытой.')
            else:
                research_warnings=[]
                rows=app.state.sourcing_research(lines, config.sourcing_search_url, warnings=research_warnings)
                cats=categories(); view=store.state(cats)
                current_cat,current_lines=selected(payload,view['categories'])
                if {l['key']:l['source_revision'] for l in current_lines}!=task['refs']:
                    raise SourcingError('ТЗ изменилось во время исследования; результат не применён',409)
                existing={c['site'].split('/')[2].removeprefix('www.') for c in view['categories'] if c['id']==category['id'] for c in c['candidates']}
                rows=[dict(row,source_revisions={k:task['refs'][k] for k in row['line_keys']}) for row in rows if row['site'].split('/')[2].removeprefix('www.') not in existing]
                store.command(cats,dict(action='research_results',revision=view['revision'],request_id='sourcing-research:'+task['id'],category_id=category['id'],candidates=rows),actor,verified=True)
                task.update(status='partial' if research_warnings else 'completed',message='Исследование завершено. Новых кандидатов: '+str(len(rows))+'. Наличие и соответствие не подтверждены.' + (' Не удалось проверить страниц: '+str(len(research_warnings))+'. Повтори или добавь кандидата вручную.' if research_warnings else ''))
                task['warnings']=research_warnings
        except (SourcingError,RefreshError,ResearchError) as exc:
            task.update(status='failed',message=str(exc))
        except Exception:
            task.update(status='failed',message='Действие не завершено. Прежние данные сохранены; проверь журнал.')
        finally:
            try:
                save_task(task)
            finally:
                fd=leases.pop(task['id'],None)
                if fd is not None: os.close(fd)

    def start(kind,payload,tasks,actor):
        request_id=payload.get('request_id')
        if not isinstance(request_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}',request_id):
            raise SourcingError('Нужен идентификатор запроса')
        encoded=json.dumps(dict(payload=payload,actor=actor,kind=kind),sort_keys=True,ensure_ascii=False,allow_nan=False)
        with db() as conn:
            old=conn.execute('SELECT * FROM sourcing_tasks WHERE request_id=?',(request_id,)).fetchone()
        if old:
            if old['payload']!=encoded: raise SourcingError('request_id уже использован',409)
            return {'task':public_task(json.loads(old['data']))}
        cats=categories(); view=store.state(cats)
        if payload.get('revision')!=view['revision']: raise SourcingError('Состояние изменилось; обнови страницу',409)
        cat, lines=selected(payload,view['categories'])
        if 'source_revisions' in payload and payload['source_revisions'] != {l['key']:l['source_revision'] for l in lines}:
            raise SourcingError('Исходная редакция изменилась; обнови страницу',409)
        if payload.get('candidate_id'):
            candidate=next((c for c in next(c for c in view['categories'] if c['id']==cat['id'])['candidates'] if c['id']==payload['candidate_id']),None)
            if not candidate or candidate['stale'] or candidate['rejected'] or not candidate['import_receipt'] or candidate['stage']!=3 or set(payload['line_keys'])!=set(candidate['line_keys']):
                raise SourcingError('Для сопоставления нужен текущий ответ и подтверждённый импорт',409)
        if kind=='research':
            if not caps['research']: raise SourcingError('Внешний поиск не подключён',503)
            if len(lines)>10: raise SourcingError('За один запуск исследуется до 10 строк. Выбери меньшую группу.',409)
            if any(l['state'] not in ('NEEDS_SEARCH','NO_OFFERS') for l in lines):
                raise SourcingError('Исследуются только оставшиеся потребности',409)
            source={r['tender_id']:r for r in records()}
            if any(not any(rr['line_id']==l['line_id'] and rr['source_revision']==source[l['tender_id']]['source_revision'] for rr in source[l['tender_id']].get('refresh_results',[])) for l in lines):
                raise SourcingError('Сначала успешно повтори поиск по своим прайсам для этих строк',409)
        fd=acquire()
        if fd is None: raise SourcingError('Уже выполняется задача поиска поставщиков. Дождись завершения.',409)
        task=dict(id=uuid.uuid4().hex,kind=kind,status='queued',message='Задача принята',created_at=datetime.now(timezone.utc).isoformat(),refs={l['key']:l['source_revision'] for l in lines})
        try:
            with db() as conn:
                conn.execute('BEGIN IMMEDIATE')
                # The exclusive OS lease proves these rows have no surviving worker.
                for orphan in conn.execute("SELECT id,data FROM sourcing_tasks WHERE status IN ('queued','running')").fetchall():
                    old_data=json.loads(orphan['data'])
                    old_data.update(status='failed',message='Задача прервана; прежние данные сохранены. Можно повторить.')
                    conn.execute('UPDATE sourcing_tasks SET status=?,data=? WHERE id=?',('failed',json.dumps(old_data,ensure_ascii=False),orphan['id']))
                conn.execute('INSERT INTO sourcing_tasks VALUES(?,?,?,?,?,?,?)',(task['id'],request_id,encoded,actor,'queued',kind,json.dumps(task,ensure_ascii=False)))
            leases[task['id']]=fd
            tasks.add_task(run_task,task,copy.deepcopy(payload),actor)
        except BaseException:
            os.close(fd)
            raise
        return {'task':public_task(task)}

    @app.post('/api/sourcing/refresh',status_code=202,dependencies=[Depends(guard)])
    def refresh(payload:dict,tasks:BackgroundTasks,actor:str=Depends(authenticated)):
        return start('refresh',payload,tasks,actor)

    @app.post('/api/sourcing/research',status_code=202,dependencies=[Depends(guard)])
    def find(payload:dict,tasks:BackgroundTasks,actor:str=Depends(authenticated)):
        return start('research',payload,tasks,actor)

    @app.get('/api/sourcing/tasks/{task_id}')
    def task_status(task_id:str,actor:str=Depends(authenticated)):
        recover()
        with db() as conn:
            row=conn.execute('SELECT data FROM sourcing_tasks WHERE id=?',(task_id,)).fetchone()
        if not row: raise HTTPException(404,'Задача не найдена')
        return {'task':public_task(json.loads(row[0]))}

    attach_import_routes(app,config,authenticated,categories,store)
