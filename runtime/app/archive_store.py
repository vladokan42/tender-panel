from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .repository import safe_text

ACTIONS = {"ARCHIVE", "RESTORE"}
REASONS = {"OUT_OF_ASSORTMENT", "BAD_CATEGORY_OR_COLLECTION", "UNWANTED_TERMS", "DUPLICATE", "OTHER"}


class ArchiveError(Exception):
    pass


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_snapshot(tender: dict[str, Any]) -> dict[str, Any]:
    lines = tender.get("card", {}).get("tender_lines", [])
    safe_lines = []
    if isinstance(lines, list):
        for line in lines[:1000]:
            if not isinstance(line, dict):
                continue
            safe_lines.append({
                "name": safe_text(line.get("name"), limit=500),
                "classifier": safe_text(line.get("classifier"), limit=120),
            })
    return {"title": safe_text(tender.get("title"), limit=1000), "tender_lines": safe_lines}


class ArchiveStore:
    def __init__(self, path: Path):
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path.parent.chmod(0o700)
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _connect_ro(self) -> sqlite3.Connection:
        connection = sqlite3.connect(f"file:{self.path.resolve()}?mode=ro", uri=True, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS archive_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id TEXT NOT NULL UNIQUE,
                    tender_id TEXT NOT NULL,
                    action TEXT NOT NULL CHECK(action IN ('ARCHIVE','RESTORE')),
                    reason_code TEXT NOT NULL CHECK(reason_code IN ('OUT_OF_ASSORTMENT','BAD_CATEGORY_OR_COLLECTION','UNWANTED_TERMS','DUPLICATE','OTHER')),
                    reason_text TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    created_at_utc TEXT NOT NULL,
                    projection_revision TEXT NOT NULL,
                    tender_title TEXT NOT NULL,
                    safe_snapshot_json TEXT NOT NULL,
                    previous_event_id INTEGER REFERENCES archive_events(event_id)
                )"""
            )
            connection.execute("CREATE INDEX IF NOT EXISTS archive_events_tender_event ON archive_events(tender_id, event_id DESC)")
        self.path.chmod(0o600)

    @staticmethod
    def _state(row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            return {"is_archived": False, "event_id": None, "action": None, "reason_code": "", "reason_text": "", "at_utc": ""}
        return {
            "is_archived": row["action"] == "ARCHIVE",
            "event_id": row["event_id"],
            "action": row["action"],
            "reason_code": row["reason_code"],
            "reason_text": row["reason_text"],
            "at_utc": row["created_at_utc"],
        }

    def state(self, tender_id: str) -> dict[str, Any]:
        if not self.path.is_file():
            return self._state(None)
        try:
            with self._connect_ro() as connection:
                row = connection.execute("SELECT * FROM archive_events WHERE tender_id=? ORDER BY event_id DESC LIMIT 1", (tender_id,)).fetchone()
            return self._state(row)
        except (sqlite3.OperationalError, sqlite3.DatabaseError):
            return self._state(None)

    def states(self, tender_ids: list[str]) -> dict[str, dict[str, Any]]:
        result = {tender_id: self._state(None) for tender_id in tender_ids}
        if not tender_ids or not self.path.is_file():
            return result
        placeholders = ",".join("?" for _ in tender_ids)
        try:
            with self._connect_ro() as connection:
                rows = connection.execute(f"SELECT e.* FROM archive_events e JOIN (SELECT tender_id, MAX(event_id) event_id FROM archive_events WHERE tender_id IN ({placeholders}) GROUP BY tender_id) last ON last.event_id=e.event_id", tender_ids).fetchall()
            for row in rows:
                result[row["tender_id"]] = self._state(row)
        except (sqlite3.OperationalError, sqlite3.DatabaseError):
            pass
        return result

    def append(self, *, request_id: str, tender_id: str, action: str, reason_code: str, reason_text: str, actor: str, projection_revision: str, tender: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        if action not in ACTIONS or reason_code not in REASONS:
            raise ArchiveError("Некорректное действие архива")
        snapshot = safe_snapshot(tender)
        encoded = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
        self.initialize()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute("SELECT * FROM archive_events WHERE request_id=?", (request_id,)).fetchone()
            if existing is not None:
                if existing["tender_id"] != tender_id or existing["action"] != action:
                    connection.execute("ROLLBACK")
                    raise ArchiveError("request_id уже относится к другому действию")
                connection.execute("COMMIT")
                return self._state(existing), True
            previous = connection.execute("SELECT * FROM archive_events WHERE tender_id=? ORDER BY event_id DESC LIMIT 1", (tender_id,)).fetchone()
            current = self._state(previous)
            if (action == "ARCHIVE" and current["is_archived"]) or (action == "RESTORE" and not current["is_archived"]):
                connection.execute("COMMIT")
                return current, True
            connection.execute(
                """INSERT INTO archive_events(request_id,tender_id,action,reason_code,reason_text,actor,created_at_utc,projection_revision,tender_title,safe_snapshot_json,previous_event_id)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (request_id, tender_id, action, reason_code, reason_text, actor, utc_now(), projection_revision, snapshot["title"], encoded, previous["event_id"] if previous else None),
            )
            event = connection.execute("SELECT * FROM archive_events WHERE request_id=?", (request_id,)).fetchone()
            connection.execute("COMMIT")
        return self._state(event), False

    def archive_listing(self) -> dict[str, Any]:
        self.initialize()
        with self._connect() as connection:
            rows = connection.execute("""SELECT e.* FROM archive_events e JOIN (SELECT tender_id, MAX(event_id) event_id FROM archive_events GROUP BY tender_id) last ON last.event_id=e.event_id ORDER BY e.event_id DESC""").fetchall()
        states = [{"tender_id": row["tender_id"], **self._state(row)} for row in rows]
        return {"items": states, "counts": {"archived": sum(item["is_archived"] for item in states), "total": len(states)}}

    def export_events(self) -> list[dict[str, Any]]:
        self.initialize()
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM archive_events ORDER BY event_id").fetchall()
        current = self.states(list({row["tender_id"] for row in rows}))
        events = []
        for row in rows:
            snapshot = json.loads(row["safe_snapshot_json"])
            payload = {
                "event_id": row["event_id"], "tender_id": row["tender_id"], "action": row["action"],
                "current_state": "ARCHIVED" if current[row["tender_id"]]["is_archived"] else "RESTORED",
                "reason_code": row["reason_code"], "reason_text": row["reason_text"], "at_utc": row["created_at_utc"],
                "projection_revision": row["projection_revision"], "tender_title": row["tender_title"],
                "tender_lines": snapshot["tender_lines"],
            }
            payload["event_sha256"] = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            events.append(payload)
        return events
