"""Reserve calculation IDs before any external call. Separate Webmaster journal."""
import hashlib,json,sqlite3
from pathlib import Path
from contextlib import closing
from fastapi import HTTPException

class CalculationJournal:
    def __init__(self, path):
        self.path=Path(path)
    def reserve(self,key,payload):
        digest=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with closing(sqlite3.connect(self.path,timeout=2)) as con:
            con.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL, response TEXT)')
            con.execute('BEGIN IMMEDIATE')
            row=con.execute('SELECT digest,state,response FROM requests WHERE id=?',(key,)).fetchone()
            if row:
                con.rollback()
                if row[0]!=digest:raise HTTPException(409,'Этот идентификатор запроса уже использован с другими данными')
                if row[1]=='COMPLETE':return json.loads(row[2])
                raise HTTPException(409,'Расчёт уже выполняется либо требует нового запроса после ошибки')
            con.execute("INSERT INTO requests VALUES (?,?,'PENDING',NULL)",(key,digest));con.commit()
        self.path.chmod(0o600)
        return None
    def finish(self,key,result):
        with closing(sqlite3.connect(self.path,timeout=2)) as con:
            con.execute("UPDATE requests SET state='COMPLETE',response=? WHERE id=?",(json.dumps(result,ensure_ascii=False),key));con.commit()
    def fail(self,key):
        with closing(sqlite3.connect(self.path,timeout=2)) as con:
            con.execute("UPDATE requests SET state='FAILED' WHERE id=? AND state='PENDING'",(key,));con.commit()
