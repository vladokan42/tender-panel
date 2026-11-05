"""Approved read-only search with an isolated, lossless panel read-model."""
from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


class RefreshError(Exception):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def lines_fingerprint(lines: list) -> str:
    if not isinstance(lines, list) or not lines or any(
        not isinstance(line, dict) or not isinstance(line.get('line_id'), str) or not line['line_id']
        or not isinstance(line.get('name'), str) or not line['name'].strip() for line in lines
    ) or len({line['line_id'] for line in lines}) != len(lines):
        raise RefreshError('Нет полного набора строк ТЗ с уникальными идентификаторами и названиями')
    return fingerprint(lines)


class CanonicalSearch:
    """Deployment-only argv: no HTTP input controls paths, supplier filters or limits."""
    def __init__(self, command: tuple[str, ...], source_db: Path | None=None):
        self.command,self.source_db = command,source_db

    def _call(self, args: list[str]) -> dict:
        if not self.command:
            raise RefreshError('Штатный поиск прайсов не подключён к этому экземпляру панели')
        env = {'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8',
               'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1'}
        try:
            with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
                # A fresh interpreter avoids thread-unsafe preexec_fn; limit BOTH files.
                limit = 'import os,resource,sys;resource.setrlimit(resource.RLIMIT_FSIZE,(104857600,104857600));os.execvp(sys.argv[1],sys.argv[1:])'
                proc = subprocess.Popen([sys.executable,'-c',limit,*self.command,*args],stdout=out,stderr=err,
                                        env=env,start_new_session=True)
                try:
                    code = proc.wait(timeout=120)
                except subprocess.TimeoutExpired:
                    raise RefreshError('Превышено время ожидания штатного поиска') from None
                finally:
                    try: os.killpg(proc.pid,signal.SIGKILL)
                    except ProcessLookupError: pass
                    proc.wait()
                if out.tell()>=104857600 or err.tell()>=104857600:
                    raise RefreshError('Ответ поиска слишком велик; прежние данные сохранены')
                out.seek(0)
                data=json.load(out)
        except RefreshError: raise
        except (OSError,ValueError):
            raise RefreshError('Штатный поиск недоступен или вернул некорректный ответ') from None
        if code!=0 or not isinstance(data,dict) or data.get('status')!='PASS':
            raise RefreshError('Поиск не завершён. Data Agent должен проверить индекс и запрос после ручных изменений; прежние предложения сохранены')
        return data

    def status(self) -> dict:
        data=self._call(['--status','--json'])
        if self.source_db is not None:
            version=[]
            for path in (self.source_db,Path(str(self.source_db)+'-wal')):
                try:
                    stat=path.stat();version.append((stat.st_ino,stat.st_size,stat.st_mtime_ns))
                except FileNotFoundError:
                    if path == self.source_db:
                        raise RefreshError('Штатный каталог поиска не подключён к этому экземпляру панели') from None
                    version.append(None)
            data['catalog_file_version']=version
        return data

    def search(self, query: str) -> dict:
        if len(' '.join(query.split())) > 200:
            raise RefreshError('Название строки длиннее 200 символов: штатный поиск пока не принимает его целиком. Требуется доработка входа Data Agent; строка и прежние предложения сохранены')
        return self._call([query,'--all','--json'])


def validate_health(value: dict) -> None:
    counts=value.get('db_counts') or {}
    if value.get('status')!='PASS' or not value.get('run_id') or type(counts.get('price_registry_rows')) is not int or counts['price_registry_rows']!=counts.get('price_search_rows'):
        raise RefreshError('Поисковый индекс не готов; прежние предложения сохранены')


def validate_results(value: dict, health: dict) -> list:
    validate_health(value)
    rows=value.get('results')
    if value['run_id']!=health['run_id'] or value['db_counts']!=health['db_counts']:
        raise RefreshError('Каталог изменился во время поиска. Повтори обновление')
    if value.get('completeness')!='ALL_SCORED_RESULTS' or not isinstance(rows,list) or type(value.get('returned')) is not int or value['returned']!=len(rows):
        raise RefreshError('Штатный поиск вернул неполный результат; прежние предложения сохранены')
    if any(not isinstance(row,dict) or type(row.get('price_registry_id')) is not int or row['price_registry_id']<=0 for row in rows) or len({row['price_registry_id'] for row in rows})!=len(rows):
        raise RefreshError('Некорректные идентификаторы предложений; прежние предложения сохранены')
    if any(row.get('warnings') is not None and (not isinstance(row['warnings'],list) or any(not isinstance(w,str) for w in row['warnings'])) for row in rows):
        raise RefreshError('Некорректные предупреждения поиска; прежние предложения сохранены')
    try: json.dumps(rows,allow_nan=False)
    except (TypeError,ValueError):
        raise RefreshError('Некорректные значения поиска; прежние предложения сохранены') from None
    return rows


def merge_known(old,new):
    if isinstance(old,dict) and isinstance(new,dict):
        return {key:merge_known(old.get(key),new[key]) if key in new else copy.deepcopy(old[key]) for key in dict.fromkeys([*old,*new])}
    if isinstance(old,list) and isinstance(new,list):
        return copy.deepcopy(old)+[copy.deepcopy(item) for item in new if item not in old]
    return copy.deepcopy(old if new is None or new=='' else new)


def preserve_version(old:dict,new:dict,preserve_status:bool=True) -> dict:
    value=merge_known(old,new)
    assert isinstance(value,dict)
    if preserve_status:
        for key in ('fit_status','fit_reason','match_status'):
            if old.get(key): value[key]=old[key]
    snapshots=copy.deepcopy(old.get('previous_versions') or [])
    snapshots.extend(v for v in (new.get('previous_versions') or []) if v not in snapshots)
    historical={k:copy.deepcopy(v) for k,v in old.items() if k not in {'previous_versions','searched_at','refresh_status'}}
    if historical and historical not in snapshots: snapshots.append(historical)
    value['previous_versions']=snapshots
    return value


def combine_sources(*sources:list) -> list:
    offers=[]; keys={}
    for source in sources:
        for row in source if isinstance(source,list) else []:
            if not isinstance(row,dict):
                if row not in offers: offers.append(copy.deepcopy(row))
                continue
            key=(row.get('line_id') or row.get('tender_line_id'),row.get('price_registry_id'))
            if key[1] is None:
                if row not in offers: offers.append(copy.deepcopy(row))
            elif key in keys: offers[keys[key]]=preserve_version(offers[keys[key]],row,preserve_status=False)
            else: keys[key]=len(offers);offers.append(copy.deepcopy(row))
    return offers


class OfferRefreshStore:
    def __init__(self,path:Path,search):
        self.path,self.search,self._lease=path,search,None
        self._gate=threading.RLock()
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS offers_refresh_jobs (
                    seq INTEGER PRIMARY KEY,job_id TEXT UNIQUE NOT NULL,request_id TEXT UNIQUE NOT NULL,
                    tender_id TEXT NOT NULL,actor TEXT NOT NULL,fingerprint TEXT NOT NULL,lines TEXT NOT NULL,
                    status TEXT NOT NULL,total_lines INTEGER NOT NULL,completed_lines INTEGER NOT NULL DEFAULT 0,
                    failed_lines INTEGER NOT NULL DEFAULT 0,result_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,finished_at TEXT,output TEXT NOT NULL DEFAULT '[]');
                CREATE UNIQUE INDEX IF NOT EXISTS offers_refresh_one_active
                    ON offers_refresh_jobs ((1)) WHERE status IN ('queued','running');
                CREATE TABLE IF NOT EXISTS offers_refresh_results (
                    tender_id TEXT NOT NULL,line_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
                    results TEXT NOT NULL,searched_at TEXT NOT NULL,run_id TEXT NOT NULL,
                    PRIMARY KEY(tender_id,line_id));
            ''')
            for table,columns in {'offers_refresh_jobs':{'source_revision':"TEXT NOT NULL DEFAULT ''",'worker_token':'TEXT','line_errors':"TEXT NOT NULL DEFAULT '[]'"},
                                  'offers_refresh_results':{'source_revision':"TEXT NOT NULL DEFAULT ''"}}.items():
                present={row[1] for row in db.execute(f'PRAGMA table_info({table})')}
                for column,declaration in columns.items():
                    if column not in present: db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {declaration}')
        path.chmod(0o600)

    @contextmanager
    def db(self):
        db=sqlite3.connect(self.path,timeout=20);db.row_factory=sqlite3.Row
        try:
            with db: yield db
        finally: db.close()

    def acquire(self):
        if self._lease is not None: return True
        fd=os.open(str(self.path)+'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: os.close(fd);return False
        self._lease=(fd,str(uuid.uuid4()));return True

    def close(self,lease=None):
        with self._gate:
            if self._lease is not None and (lease is None or self._lease is lease):
                os.close(self._lease[0]);self._lease=None

    @staticmethod
    def public(row):
        if row is None: raise RefreshError('Не удалось прочитать сохранённую задачу')
        result={key:row[key] for key in ('job_id','status','total_lines','completed_lines','failed_lines',
                                        'result_count','error','created_at','finished_at')}
        message=result['error']
        result['error_code']='INDEX_NOT_READY' if 'индекс' in message else 'SEARCH_NOT_CONNECTED' if 'не подключён' in message else 'SOURCE_CHANGED' if 'измени' in message else 'SEARCH_FAILED' if message else None
        result['line_errors']=json.loads(row['line_errors'])
        return result

    def latest(self,tender_id):
        with self.db() as db:
            row=db.execute('SELECT * FROM offers_refresh_jobs WHERE tender_id=? ORDER BY seq DESC LIMIT 1',(tender_id,)).fetchone()
            return self.public(row) if row is not None else None

    def recover_interrupted(self):
        with self._gate:
            if self._lease is not None or not self.acquire(): return
            lease=self._lease
            try:
                with self.db() as db:
                    db.execute("UPDATE offers_refresh_jobs SET status='failed',error=?,finished_at=? WHERE status IN ('queued','running')",
                               ('Обновление прервано. Прежние предложения сохранены; запусти снова',utc_now()))
            finally: self.close(lease)

    def start(self,tender_id,lines,request_id,actor,source_revision=''):
        with self._gate:
            if self._lease is None:
                self.recover_interrupted()
            return self._start(tender_id,lines,request_id,actor,source_revision)

    def _start(self,tender_id,lines,request_id,actor,source_revision=''):
        digest=lines_fingerprint(lines)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            duplicate=db.execute('SELECT * FROM offers_refresh_jobs WHERE request_id=?',(request_id,)).fetchone()
            if duplicate:
                if duplicate['tender_id']!=tender_id or duplicate['actor']!=actor or duplicate['fingerprint']!=digest or duplicate['source_revision']!=source_revision:
                    raise RefreshError('Идентификатор запроса уже использован для другого действия или редакции')
                return self.public(duplicate),False
            active=db.execute("SELECT * FROM offers_refresh_jobs WHERE status IN ('queued','running')").fetchone()
            if active:
                if active['tender_id']==tender_id and active['fingerprint']==digest and active['source_revision']==source_revision:
                    return self.public(active),False
                raise RefreshError('Сейчас обновляется другой тендер или редакция. Дождись завершения')
            if not self.acquire(): raise RefreshError('Другой процесс завершает обновление. Повтори позже')
            job_id=str(uuid.uuid4())
            db.execute('INSERT INTO offers_refresh_jobs(job_id,request_id,tender_id,actor,fingerprint,lines,status,total_lines,created_at,source_revision) VALUES(?,?,?,?,?,?,\'queued\',?,?,?)',
                       (job_id,request_id,tender_id,actor,digest,json.dumps(lines,ensure_ascii=False,allow_nan=False),len(lines),utc_now(),source_revision))
            return self.public(db.execute('SELECT * FROM offers_refresh_jobs WHERE job_id=?',(job_id,)).fetchone()),True

    def run(self,job_id,current_lines:Callable[[],list],current_revision:Callable[[],str]=lambda:''):
        token=str(uuid.uuid4())
        with self._gate, self.db() as db:
            owned=self._lease
            if not self.acquire(): return
            db.execute('BEGIN IMMEDIATE')
            if db.execute("UPDATE offers_refresh_jobs SET status='running',worker_token=? WHERE job_id=? AND status='queued'",(token,job_id)).rowcount!=1:
                if owned is None: self.close()
                return
            job=db.execute('SELECT * FROM offers_refresh_jobs WHERE job_id=?',(job_id,)).fetchone()
            lease=self._lease
        staged=[];failed=0;error='';line_errors=[]
        try:
            if lines_fingerprint(current_lines())!=job['fingerprint'] or current_revision()!=job['source_revision']:
                self.finish(job_id,'stale','Исходная карточка изменилась. Запусти поиск снова',token);return
            health=self.search.status();validate_health(health)
            for index,line in enumerate(json.loads(job['lines']),1):
                try:
                    rows=validate_results(self.search.search(line['name']),health)
                    rows=[dict(row,line_id=line['line_id'],tender_line_id=line['line_id'],fit_status='REVIEW',
                               fit_reason='Кандидат штатного поиска; соответствие ТЗ и наличие не подтверждены.',
                               refresh_status='CURRENT',searched_at=utc_now()) for row in rows]
                    staged.append({'line_id':line['line_id'],'fingerprint':lines_fingerprint([line]),
                                   'results':rows,'searched_at':utc_now(),'run_id':health['run_id']})
                except RefreshError as exc:
                    failed+=1;error=str(exc)
                    line_errors.append({'line_id':line['line_id'],'error':error,
                                        'error_code':'QUERY_TOO_LONG' if '200 символов' in error else 'SEARCH_FAILED'})
                with self.db() as db:
                    db.execute("UPDATE offers_refresh_jobs SET completed_lines=?,failed_lines=?,result_count=?,line_errors=? WHERE job_id=? AND status='running' AND worker_token=?",
                               (index,failed,sum(len(item['results']) for item in staged),json.dumps(line_errors,ensure_ascii=False),job_id,token))
            final=self.search.status();validate_health(final)
            if final['run_id']!=health['run_id'] or final['db_counts']!=health['db_counts'] or final.get('catalog_file_version')!=health.get('catalog_file_version'):
                raise RefreshError('Каталог изменился во время поиска. Прежние данные сохранены; повтори обновление')
            if lines_fingerprint(current_lines())!=job['fingerprint'] or current_revision()!=job['source_revision']:
                self.finish(job_id,'stale','Исходная карточка изменилась во время поиска. Прежние данные сохранены',token);return
            with self._gate, self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                if not db.execute("SELECT 1 FROM offers_refresh_jobs WHERE job_id=? AND status='running' AND worker_token=?",(job_id,token)).fetchone(): return
                for item in staged:
                    previous=db.execute('SELECT * FROM offers_refresh_results WHERE tender_id=? AND line_id=?',(job['tender_id'],item['line_id'])).fetchone()
                    retained=[]
                    if previous:
                        previous_rows=json.loads(previous['results']);old_by_id={r['price_registry_id']:r for r in previous_rows}
                        new_ids={r['price_registry_id'] for r in item['results']}
                        changed=previous['fingerprint']!=item['fingerprint'] or previous['source_revision']!=job['source_revision']
                        for row in previous_rows:
                            if row['price_registry_id'] not in new_ids:
                                row['refresh_status']='STALE' if changed or row.get('refresh_status')=='STALE' else 'NOT_RETURNED'
                                row['warnings']=list(dict.fromkeys([*(row.get('warnings') or []),'Сохранённый вариант не вернулся в последнем поиске; требуется повторная проверка']))
                                retained.append(row)
                        item['results']=[preserve_version(old_by_id[r['price_registry_id']],r) if r['price_registry_id'] in old_by_id else r for r in item['results']]
                    db.execute('INSERT INTO offers_refresh_results(tender_id,line_id,fingerprint,results,searched_at,run_id,source_revision) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tender_id,line_id) DO UPDATE SET fingerprint=excluded.fingerprint,results=excluded.results,searched_at=excluded.searched_at,run_id=excluded.run_id,source_revision=excluded.source_revision',
                               (job['tender_id'],item['line_id'],item['fingerprint'],json.dumps(item['results']+retained,ensure_ascii=False,allow_nan=False),item['searched_at'],item['run_id'],job['source_revision']))
                status='partial' if failed and staged else 'failed' if failed else 'completed'
                db.execute('UPDATE offers_refresh_jobs SET status=?,error=?,finished_at=?,output=? WHERE job_id=?',
                           (status,error,utc_now(),json.dumps(staged,ensure_ascii=False,allow_nan=False),job_id))
                db.commit()
                self.close(lease)
        except RefreshError as exc: self.finish(job_id,'failed',str(exc),token)
        except Exception: self.finish(job_id,'failed','Не удалось завершить обновление. Прежние данные сохранены',token)
        finally: self.close(lease)

    def finish(self,job_id,status,error,token):
        with self._gate, self.db() as db:
            changed=db.execute("UPDATE offers_refresh_jobs SET status=?,error=?,finished_at=? WHERE job_id=? AND status='running' AND worker_token=?",
                               (status,error,utc_now(),job_id,token)).rowcount
            db.commit()
            if changed: self.close()

    def merge(self,tender_id,lines,source,source_revision=''):
        offers=copy.deepcopy(source);warnings=[]
        with self.db() as db: saved=db.execute('SELECT * FROM offers_refresh_results WHERE tender_id=?',(tender_id,)).fetchall()
        if not saved: return offers,warnings
        lookup={(str(o.get('line_id') or o.get('tender_line_id')),o.get('price_registry_id')):i for i,o in enumerate(offers) if isinstance(o,dict)}
        fingerprints={}
        for line in lines if isinstance(lines,list) else []:
            try: fingerprints[line['line_id']]=lines_fingerprint([line])
            except (RefreshError,KeyError,TypeError,ValueError): pass
        for item in saved:
            rows=json.loads(item['results'])
            stale=fingerprints.get(item['line_id'])!=item['fingerprint'] or item['source_revision']!=source_revision
            keys={(item['line_id'],r['price_registry_id']) for r in rows if r.get('refresh_status')=='CURRENT'}
            if not stale:
                for offer in offers:
                    if isinstance(offer,dict) and str(offer.get('line_id') or offer.get('tender_line_id'))==item['line_id'] and (item['line_id'],offer.get('price_registry_id')) not in keys:
                        offer['refresh_status']='NOT_RETURNED'
                        offer['warnings']=[*(offer.get('warnings') or []),'Сохранённый вариант не вернулся в последнем поиске; требуется повторная проверка']
            for row in rows:
                key=(item['line_id'],row['price_registry_id'])
                if stale:
                    row['refresh_status']='STALE'
                    row['warnings']=[*(row.get('warnings') or []),'Исходная карточка изменилась после этого поиска; предложение сохранено для проверки']
                    if key in lookup:
                        offers[lookup[key]]=preserve_version(row,offers[lookup[key]],preserve_status=False)
                        offers[lookup[key]]['refresh_status']='STALE'
                        continue
                if key in lookup: offers[lookup[key]]=preserve_version(offers[lookup[key]],row)
                else: lookup[key]=len(offers);offers.append(row)
            if stale: warnings.append({'code':'OFFERS_REFRESH_STALE','message':'Исходная карточка изменилась после повторного поиска. Сохранённые результаты требуют проверки','blocks_visibility':False})
        latest=self.latest(tender_id)
        if latest and latest['status'] in {'failed','partial','stale'}:
            warnings.append({'code':'OFFERS_REFRESH_INCOMPLETE','message':latest['error'],'blocks_visibility':False})
        return offers,warnings
