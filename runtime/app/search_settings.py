from __future__ import annotations

import copy
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


DEFAULT_SETTINGS: dict[str, Any] = {
    "types": {"small": False, "commercial": False, "research": False, "proposals": False},
    "statuses": {"cancelled": False, "completed": False},
    "lots": {"mode": None, "shareEnabled": False, "share": 50, "excludeUnsuitable": False},
    "price": {
        "minEnabled": False,
        "min": None,
        "maxEnabled": False,
        "max": None,
        "missingEnabled": False,
        "missingAction": "MANUAL_REVIEW",
    },
    "participation": {"msp": False, "smp": False},
    "delivery": {"one": False, "periodic": False, "security": False},
    "regions": {"moscow": False, "spb": False, "mo": False, "lo": False, "all": False},
}


class SearchSettingsError(Exception):
    pass


class SearchSettingsVersionNotFound(SearchSettingsError):
    pass


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def default_settings() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_SETTINGS)


class SearchSettingsStore:
    """Versioned server-side settings isolated from Tenderman's canonical database."""

    def __init__(self, path: Path):
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path.parent.chmod(0o700)
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        return connection

    def _connect_ro(self) -> sqlite3.Connection:
        connection = sqlite3.connect(f"file:{self.path.resolve()}?mode=ro", uri=True, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS search_settings_versions (
                    version INTEGER PRIMARY KEY,
                    created_at_utc TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    comment TEXT NOT NULL,
                    settings_json TEXT NOT NULL
                )"""
            )
        self.path.chmod(0o600)

    @staticmethod
    def _record(row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            return {
                "version": 0,
                "created_at_utc": None,
                "actor": None,
                "comment": "",
                "settings": default_settings(),
            }
        return {
            "version": row["version"],
            "created_at_utc": row["created_at_utc"],
            "actor": row["actor"],
            "comment": row["comment"],
            "settings": json.loads(row["settings_json"]),
        }

    def current(self) -> dict[str, Any]:
        if not self.path.is_file():
            return self._record(None)
        try:
            with self._connect_ro() as connection:
                row = connection.execute(
                    "SELECT * FROM search_settings_versions ORDER BY version DESC LIMIT 1"
                ).fetchone()
            return self._record(row)
        except (sqlite3.OperationalError, sqlite3.DatabaseError):
            return self._record(None)

    def history(self) -> list[dict[str, Any]]:
        if not self.path.is_file():
            return []
        try:
            with self._connect_ro() as connection:
                rows = connection.execute(
                    "SELECT version, created_at_utc, actor, comment FROM search_settings_versions "
                    "ORDER BY version DESC LIMIT 100"
                ).fetchall()
            return [dict(row) for row in rows]
        except (sqlite3.OperationalError, sqlite3.DatabaseError):
            return []

    def save(self, settings: dict[str, Any], *, actor: str, comment: str) -> dict[str, Any]:
        encoded = json.dumps(settings, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self.initialize()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            version = int(connection.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM search_settings_versions"
            ).fetchone()[0])
            connection.execute(
                "INSERT INTO search_settings_versions(version, created_at_utc, actor, comment, settings_json) "
                "VALUES (?, ?, ?, ?, ?)",
                (version, utc_now(), actor, comment, encoded),
            )
            row = connection.execute(
                "SELECT * FROM search_settings_versions WHERE version=?", (version,)
            ).fetchone()
            connection.execute("COMMIT")
        return self._record(row)

    def restore(self, version: int, *, actor: str) -> dict[str, Any]:
        self.initialize()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM search_settings_versions WHERE version=?", (version,)
            ).fetchone()
        if row is None:
            raise SearchSettingsVersionNotFound("Версия настроек не найдена")
        return self.save(
            json.loads(row["settings_json"]),
            actor=actor,
            comment=f"Восстановлена версия v{version}",
        )

    def reset(self, *, actor: str) -> dict[str, Any]:
        return self.save(default_settings(), actor=actor, comment="Полный сброс фильтров")
