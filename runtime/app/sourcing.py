"""Supplier discovery projection and isolated operational state (no canonical IO).

Parent interface::

    categories = build_categories(records)  # full source, not lazy summaries
    store = SourcingStore(operational_path)
    view = store.state(categories, capabilities=server_capabilities)
    result = store.command(categories, payload, authenticated_actor)

Records contain exact string tender_id, source_revision and flat lines/offers/
line_results lists. Scores are score/match_score, joined by exact line_id (offers
also accept tender_line_id). UNMATCHED status/match_status in line_results means
an explicitly successful current result; do not adapt MISSING/errors to UNMATCHED.
refresh_results is a list of decoded successful OfferRefreshStore result rows:
{line_id, source_revision, run_id, results: list}. No job-level empty inference.

Public payloads follow docs/SUPPLIER-DISCOVERY-DEMO.md. add_candidate optionally
accepts source_revisions={opaque_line_key: revision} from the displayed snapshot;
if supplied it must match exactly. Without it the new case binds the current
server snapshot. Existing cases always compare their persisted source revisions.
assign_category requires displayed source_revisions and exact current line_keys;
its per-line category overrides live only in this operational state.
SourcingError.status_code is the HTTP status. Internal calls MUST come from verified server adapters, never
from a client-provided flag. Their extra payloads are:
research_results: candidates=[add_candidate fields + sources=[{url,text,checked_at}]];
import_receipt: receipt={receipt_id: owner-issued string, status: 'PASS', ...};
rematched: result={status:'completed', receipt_id, line_keys: request.line_keys,
source_revisions: {opaque_line_key: current_revision}}. The caller verifies real
finished refresh lineage and receipt linkage before setting verified=True. The
store additionally requires current HAS_CANDIDATE on every requested line.

Commands return a persisted replayable state with capabilities disabled by
default; the router may annotate capabilities from its current server config.
Stale candidates retain their history and cannot transition; create a new case
for changed source. No sending, research, import or matching is performed here.
"""
import copy
import hashlib
import json
import math
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


def _key(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def _score(row):
    value = row.get('match_score', row.get('score'))
    if isinstance(value, bool) or value is None:
        return None
    try:
        value = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    return value if math.isfinite(value) and 0 <= value <= 100 else None


def build_categories(records):
    categories = {}
    for record in records:
        tender_id = record['tender_id']
        for line in record.get('lines', []):
            line_id = line.get('line_id')
            if not isinstance(tender_id, str) or not tender_id or not isinstance(line_id, str) or not line_id:
                continue
            classifier = line.get('classifier')
            name = line.get('product_group_name') or (classifier.get('category') if isinstance(classifier, dict) else None)
            name = name if isinstance(name, str) and name.strip() else 'Категория не определена'
            category = categories.setdefault(name, dict(id=_key(name), name=name, lines=[], candidates=[]))
            revision = record['source_revision']
            repeated = [row for row in record.get('refresh_results', []) if row.get('line_id') == line_id
                        and row.get('source_revision') == revision and row.get('run_id') and not row.get('error')
                        and row.get('status', 'completed') in ('completed', 'PASS')]
            applicable = repeated[-1]['results'] if repeated else record.get('offers', []) + record.get('line_results', [])
            scores = [_score(row) for row in applicable if row.get('line_id', row.get('tender_line_id', line_id if repeated else None)) == line_id
                      and row.get('refresh_status') not in ('STALE', 'NOT_RETURNED')
                      and row.get('source_revision', revision) == revision]
            best = max((score for score in scores if score is not None), default=None)
            empty = any(row.get('line_id') == line_id and row.get('status', row.get('match_status')) == 'UNMATCHED'
                        and row.get('source_revision', revision) == revision and not row.get('error')
                        and row.get('success', True) is True
                        and row.get('refresh_status') not in ('STALE', 'NOT_RETURNED')
                        for row in record.get('line_results', []))
            if repeated:
                empty = not any(row.get('refresh_status', 'CURRENT') == 'CURRENT' for row in applicable)
            category['lines'].append(dict(key=_key(tender_id, line_id), tender_id=tender_id,
                line_id=line_id, source_revision=record['source_revision'], name=line.get('name', ''),
                characteristics=line.get('characteristics', ''), quantity=line.get('quantity'),
                unit=line.get('unit', ''), region=record.get('region', ''), deadline=record.get('deadline'),
                state=('HAS_CANDIDATE' if best >= 50 else 'NEEDS_SEARCH') if best is not None else ('NO_OFFERS' if empty else 'UNCHECKED'),
                best_score=best))
    return list(categories.values())


class SourcingError(ValueError):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


def _text(value, label, limit=2000, required=False):
    if not isinstance(value, str) or len(value) > limit or '\x00' in value or (required and not value.strip()):
        raise SourcingError('Некорректное поле: ' + label)
    return value


def _dump(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError):
        raise SourcingError('Ожидается конечный JSON') from None


def _https(value):
    value = _text(value, 'url')
    try:
        url = urlsplit(value)
        valid = url.scheme == 'https' and url.hostname and not url.username and not url.password
        url.port
    except ValueError:
        valid = False
    if not valid or any(char.isspace() for char in value):
        raise SourcingError('Нужен HTTPS-сайт поставщика')
    return value


def _sources(rows):
    if not isinstance(rows, list) or len(rows) > 20:
        raise SourcingError('Некорректные источники')
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise SourcingError('Некорректный источник')
        checked = _text(row.get('checked_at'), 'checked_at', 100, True)
        try:
            if datetime.fromisoformat(checked).tzinfo is None:
                raise ValueError
        except ValueError:
            raise SourcingError('Нужна дата проверки источника с часовым поясом') from None
        result.append(dict(url=_https(row.get('url')), text=_text(row.get('text'), 'text', 4000, True), checked_at=checked))
    return result


class SourcingStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self._db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sourcing_state (
                    id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);
                INSERT OR IGNORE INTO sourcing_state VALUES(1, 0, '{"candidates":[],"journal":[]}');
                CREATE TABLE IF NOT EXISTS sourcing_requests (
                    request_id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
            ''')
        self.path.chmod(0o600)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=20)
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _state(categories, revision, data, capabilities=None):
        lookup = {}
        source_ids = {source['name']: source['id'] for source in categories}
        for source in copy.deepcopy(categories):
            for line in source['lines']:
                name = data.get('category_overrides', {}).get(line['key'], source['name'])
                cid = source_ids.get(name, _key(name))
                category = lookup.setdefault(cid, dict(id=cid, name=name, lines=[], candidates=[]))
                category['lines'].append(line)
        categories = list(lookup.values())
        for saved in data['candidates']:
            category = lookup.get(saved['_category_id'])
            if category is None:
                category = dict(id=saved['_category_id'], name=saved['_category_name'], lines=[], candidates=[])
                lookup[category['id']] = category
                categories.append(category)
            refs = {line['key']: line['source_revision'] for line in category['lines']}
            candidate = {key: copy.deepcopy(value) for key, value in saved.items() if not key.startswith('_')}
            candidate['stale'] = saved.get('_category_stale', False) or any(
                key not in refs or refs[key] != revision for key, revision in saved['_refs'].items())
            category['candidates'].append(candidate)
        return dict(name='Поиск поставщиков · DEMO', revision=revision, categories=categories,
                    journal=copy.deepcopy(data['journal']),
                    capabilities={key: bool((capabilities or {}).get(key, False)) for key in ('research', 'import')})

    def state(self, categories, capabilities=None):
        with self._db() as db:
            revision, data = db.execute('SELECT revision,data FROM sourcing_state WHERE id=1').fetchone()
        return self._state(categories, revision, json.loads(data), capabilities)

    @staticmethod
    def _line_keys(category, keys):
        current = {line['key']: line['source_revision'] for line in category['lines']}
        if not isinstance(keys, list) or not keys or any(not isinstance(key, str) or key not in current for key in keys) or len(set(keys)) != len(keys):
            raise SourcingError('Нужны точные самостоятельные строки текущей категории')
        if any(not current[key] for key in keys):
            raise SourcingError('Нет редакции исходных данных', 409)
        return {key: current[key] for key in keys}

    def _add(self, data, category, payload):
        refs = self._line_keys(category, payload.get('line_keys'))
        if 'source_revisions' in payload and payload['source_revisions'] != refs:
            raise SourcingError('Исходная редакция изменилась; обнови страницу', 409)
        name = _text(payload.get('name'), 'name', 300, True)
        site = _https(payload.get('site'))
        candidate = dict(id=str(uuid.uuid4()), name=name, site=site,
            email=_text(payload.get('email', ''), 'email', 320),
            phone=_text(payload.get('phone', ''), 'phone', 100),
            delivery=_text(payload.get('delivery', ''), 'delivery', 2000),
            line_keys=list(refs), sources=[], stage=0, rejected=False, reason='',
            request=None, response=None, import_receipt=None, stale=False,
            _refs=refs, _category_id=category['id'], _category_name=category['name'],
            _lines=copy.deepcopy([line for line in category['lines'] if line['key'] in refs]))
        if candidate['email'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', candidate['email']):
            raise SourcingError('Некорректный email')
        data['candidates'].append(candidate)
        return candidate

    def _transition(self, data, category, payload):
        candidate = next((c for c in data['candidates'] if c['id'] == payload.get('candidate_id')
                          and c['_category_id'] == category['id']), None)
        if candidate is None:
            raise SourcingError('Кандидат не найден', 404)
        current = {line['key']: line['source_revision'] for line in category['lines']}
        if candidate.get('_category_stale') or any(key not in current or current[key] != revision for key, revision in candidate['_refs'].items()):
            raise SourcingError('Строки, редакция или категория изменились; история сохранена', 409)
        refs = self._line_keys(category, candidate['line_keys'])
        action = payload.get('action')
        if candidate['rejected'] and action != 'restore':
            raise SourcingError('Кандидат отклонён')
        stage = candidate['stage']
        if action == 'prepare':
            if stage not in (0, 1) or not (candidate['email'].strip() or candidate['phone'].strip()):
                raise SourcingError('Запрос требует контакта и этапа кандидата')
            if payload.get('kind') not in ('quote', 'price'):
                raise SourcingError('Неизвестный вид запроса')
            keys = self._line_keys(category, payload.get('line_keys'))
            if not set(keys).issubset(candidate['line_keys']):
                raise SourcingError('Строки запроса не принадлежат кандидату')
            candidate['request'] = dict(kind=payload['kind'], text=_text(payload.get('text'), 'text', 20000, True),
                                        line_keys=list(keys), sent=False)
            candidate['stage'] = 1
        elif action == 'sent':
            if stage != 1 or payload.get('confirmed') is not True:
                raise SourcingError('Нужно явное подтверждение отправки подготовленного запроса')
            candidate['request']['sent'] = True
            candidate['stage'] = 2
        elif action == 'response':
            if stage != 2:
                raise SourcingError('Ответ возможен после подтверждённой отправки')
            candidate['response'] = dict(text=_text(payload.get('text'), 'text', 20000, True),
                                         received_at=datetime.now(timezone.utc).isoformat())
            candidate['stage'] = 3
        elif action == 'import_receipt':
            receipt = payload.get('receipt')
            if stage != 3 or not isinstance(receipt, dict) or receipt.get('status') != 'PASS':
                raise SourcingError('Нужен проверенный успешный receipt владельца после ответа')
            _text(receipt.get('receipt_id'), 'receipt_id', 300, True)
            if candidate['import_receipt'] is not None:
                raise SourcingError('Receipt уже сохранён', 409)
            candidate['import_receipt'] = copy.deepcopy(receipt)
        elif action == 'rematched':
            result = payload.get('result')
            request_keys = candidate['request']['line_keys'] if candidate['request'] else []
            current = {line['key']: line for line in category['lines']}
            if (stage != 3 or not candidate['import_receipt'] or not isinstance(result, dict)
                or result.get('status') != 'completed'
                or result.get('receipt_id') != candidate['import_receipt']['receipt_id']
                or result.get('line_keys') != request_keys
                or result.get('source_revisions') != {key: refs[key] for key in request_keys}
                or not all(current[key]['state'] == 'HAS_CANDIDATE' for key in request_keys)):
                raise SourcingError('Нет полного текущего сопоставления после импорта')
            candidate['stage'] = 4
        elif action == 'reject':
            candidate['reason'] = _text(payload.get('reason'), 'reason', 2000, True)
            candidate['rejected'] = True
        elif action == 'restore':
            if not candidate['rejected']:
                raise SourcingError('Кандидат не отклонён')
            candidate['rejected'] = False
        else:
            raise SourcingError('Неизвестная команда')
        return candidate

    def command(self, categories, payload, actor, verified=False):
        if not isinstance(payload, dict):
            raise SourcingError('Нужна команда JSON')
        actor = _text(actor, 'actor', 300, True)
        if payload.get('action') in ('research_results', 'import_receipt', 'rematched') and verified is not True:
            raise SourcingError('Команда разрешена только проверенному серверному обработчику', 403)
        request_id = _text(payload.get('request_id'), 'request_id', 200, True)
        encoded = _dump(dict(payload=payload, actor=actor, verified=verified))
        with self._db() as db:
            # ponytail: one operational writer; split by account only if throughput requires it.
            db.execute('BEGIN IMMEDIATE')
            duplicate = db.execute('SELECT payload,result FROM sourcing_requests WHERE request_id=?', (request_id,)).fetchone()
            if duplicate:
                if duplicate[0] != encoded:
                    raise SourcingError('request_id уже использован другой командой', 409)
                return json.loads(duplicate[1])
            revision, raw = db.execute('SELECT revision,data FROM sourcing_state WHERE id=1').fetchone()
            if type(payload.get('revision')) is not int or payload['revision'] != revision:
                raise SourcingError('Состояние изменилось; обнови страницу', 409)
            data = json.loads(raw)
            category = next((c for c in self._state(categories, revision, data)['categories']
                             if c['id'] == payload.get('category_id')), None)
            if category is None:
                raise SourcingError('Категория не найдена', 409)
            previous = next((copy.deepcopy(c) for c in data['candidates'] if c['id'] == payload.get('candidate_id')
                             and c['_category_id'] == category['id']), None)
            journal_fields = {}
            if payload.get('action') == 'assign_category':
                refs = self._line_keys(category, payload.get('line_keys'))
                if payload.get('source_revisions') != refs:
                    raise SourcingError('Исходная редакция изменилась; обнови страницу', 409)
                name = _text(payload.get('name'), 'name', 300, True).strip()
                target_id = next((c['id'] for c in categories if c['name'] == name), _key(name))
                data.setdefault('category_overrides', {}).update({key: name for key in refs})
                for saved in data['candidates']:
                    if (saved['_category_id'] == category['id'] and target_id != category['id']
                        and set(saved['_refs']).intersection(refs)):
                        saved['_category_stale'] = True
                candidate = None
                previous = None
                journal_fields = dict(source_revisions=refs,
                    source_lines=copy.deepcopy([line for line in category['lines'] if line['key'] in refs]),
                    target_category_id=target_id,
                    text=f'Категория строк изменена вручную: «{category["name"]}» → «{name}»')
            elif payload.get('action') == 'research_results':
                rows = payload.get('candidates')
                if not isinstance(rows, list) or len(rows) > 50 or any(not isinstance(row, dict) for row in rows):
                    raise SourcingError('Некорректный пакет кандидатов')
                candidate = None
                for row in rows:
                    sources = _sources(row.get('sources'))
                    if not sources:
                        raise SourcingError('Нужен проверенный источник кандидата')
                    candidate = self._add(data, category, row)
                    candidate['sources'] = sources
            else:
                candidate = self._add(data, category, payload) if payload.get('action') == 'add_candidate' else self._transition(data, category, payload)
            entry = dict(id=str(uuid.uuid4()), action=payload['action'], actor=actor,
                category_id=category['id'], candidate_id=candidate['id'] if candidate else None,
                previous={key: value for key, value in previous.items() if not key.startswith('_')} if previous else None,
                source_revisions=copy.deepcopy(candidate['_refs']) if candidate else {},
                source_lines=copy.deepcopy(candidate['_lines']) if candidate else [],
                text='Сохранено: ' + payload['action'], created_at=datetime.now(timezone.utc).isoformat())
            entry.update(journal_fields)
            data['journal'].append(entry)
            response = dict(state=self._state(categories, revision + 1, data), message='Сохранено')
            db.execute('UPDATE sourcing_state SET revision=?,data=? WHERE id=1', (revision + 1, _dump(data)))
            db.execute('INSERT INTO sourcing_requests VALUES(?,?,?)', (request_id, encoded, _dump(response)))
            return response
