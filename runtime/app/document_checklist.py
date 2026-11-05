from __future__ import annotations

import json
import re
import sqlite3
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


STATUS_TAG_NAMES = frozenset({
    "Не проверен",
    "Требует актуализации",
    "Архив — не использовать",
})
DEFAULT_PAPERLESS_PUBLIC_BASE = "https://example.invalid/documents"
AGREED_DOCUMENT_NAMES = {101: "Пример документа из регламента (демо)"}


class DocumentChecklistStore:
    """Read-only source projection plus a separate writable review overlay."""

    REFRESH_COOLDOWN_SECONDS = 60

    def __init__(self, source_path: Path, state_path: Path, paperless_public_base: str = DEFAULT_PAPERLESS_PUBLIC_BASE):
        self.source_path, self.state_path = source_path, state_path
        parsed_base = urlsplit(paperless_public_base)
        if parsed_base.scheme not in {"http", "https"} or parsed_base.username or parsed_base.password or not parsed_base.netloc or parsed_base.query or parsed_base.fragment:
            raise ValueError("Некорректный Paperless public base")
        self.paperless_public_base = paperless_public_base.rstrip("/")
        # ponytail: one process-local guard; coordinate per worker only if deployment adds multiple workers.
        self._refresh_guard = threading.Lock()
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.state_path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS document_reviews (item_id TEXT PRIMARY KEY,status TEXT NOT NULL,reviewer TEXT,reviewed_at TEXT,basis TEXT NOT NULL,source_revision TEXT NOT NULL,updated_at TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS document_refresh (id INTEGER PRIMARY KEY CHECK(id=1),checked_at TEXT,status TEXT,error TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS document_metadata_v2 (document_id INTEGER PRIMARY KEY,title TEXT,modified TEXT,metadata TEXT NOT NULL,refreshed_at TEXT NOT NULL)")
            db.commit()

    def _source(self) -> dict[str, Any]:
        with self.source_path.open(encoding="utf-8") as stream:
            value = json.load(stream)
        if not isinstance(value, dict) or not isinstance(value.get("items"), list) or not isinstance(value.get("files", []), list):
            raise ValueError("Некорректная проекция чеклиста")
        return value

    @classmethod
    def _source_document_id(cls, source_file: Any) -> int | None:
        if not isinstance(source_file, dict):
            raise ValueError("Некорректная запись файла в проекции")
        raw_document_id = source_file.get("document_id")
        if raw_document_id is None:
            return None
        document_id = cls._document_id(raw_document_id)
        if document_id is None:
            raise ValueError("Некорректный document_id в проекции")
        return document_id

    def checklist(self) -> dict[str, Any]:
        source = self._source()
        with sqlite3.connect(self.state_path) as db:
            refresh = db.execute("SELECT checked_at,status,error FROM document_refresh WHERE id=1").fetchone()
            metadata = {str(row[0]): json.loads(row[1]) for row in db.execute("SELECT document_id,metadata FROM document_metadata_v2")}
        items = []
        agreed_document_names = AGREED_DOCUMENT_NAMES.copy()
        for item in source["items"]:
            current = dict(item)
            for key in ("review_status", "reviewer", "reviewed_at", "review_basis", "review_stale"):
                current.pop(key, None)
            items.append(current)
        files = []
        for source_file in source.get("files", []):
            document_id = self._source_document_id(source_file)
            current = {
                key: source_file.get(key)
                for key in ("document_id", "name", "item_ids", "state", "text_state", "expires", "review_due", "issues", "source_checked_at")
                if key in source_file
            }
            current.update(self._safe_metadata(metadata.get(str(document_id), {})))
            current["document_id"] = document_id
            if document_id is not None and document_id in agreed_document_names:
                current["name"] = agreed_document_names[document_id]
            if document_id is not None:
                current["preview_url"] = self._document_url(document_id, "preview")
                current["download_url"] = self._document_url(document_id, "download")
            files.append(current)
        for item in items:
            item["file_metadata"] = [
                file for file in files
                if str(file.get("document_id")) in {str(value) for value in item.get("document_ids", [])}
            ]
        refresh_state = None
        if refresh:
            refresh_state = {"checked_at": refresh[0], "status": refresh[1]}
            if refresh[2]:
                refresh_state["error"] = self._safe_error(refresh[2])
        return {"items": items, "files": files, "source_checked_at": source.get("source_checked_at"), "claim_limit": source.get("claim_limit"), "refresh": refresh_state}

    def save_review(self, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        status = payload.get("status")
        if not isinstance(item_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,20}", item_id):
            raise ValueError("Некорректный идентификатор пункта")
        if status not in {"Не проверено", "Нужно обновить", "Проверено", "Не требуется"}:
            raise ValueError("Неизвестный статус проверки")
        reviewer, basis = str(payload.get("reviewer") or "").strip(), str(payload.get("basis") or "").strip()
        if len(reviewer) > 120 or len(basis) > 1000 or (status in {"Проверено", "Не требуется"} and (not reviewer or not basis)):
            raise ValueError("Для этого статуса нужны ответственный и основание")
        source = self._source()
        if not any(str(item.get("id")) == item_id for item in source["items"]):
            raise KeyError(item_id)
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self.state_path) as db:
            db.execute("INSERT INTO document_reviews VALUES(?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET status=excluded.status,reviewer=excluded.reviewer,reviewed_at=excluded.reviewed_at,basis=excluded.basis,source_revision=excluded.source_revision,updated_at=excluded.updated_at", (item_id, status, reviewer or None, now if status != "Не проверено" else None, basis, str(source.get("source_checked_at") or "unknown"), now))
            db.commit()
        return next(item for item in self.checklist()["items"] if str(item["id"]) == item_id)

    @staticmethod
    def _document_id(value: Any) -> int | None:
        if type(value) is int:
            return value if value > 0 else None
        if type(value) is str and re.fullmatch(r"[1-9][0-9]*", value):
            return int(value)
        return None

    @staticmethod
    def _mapping_name(mapping: dict[int, Any], value: Any) -> str | None:
        row_id = DocumentChecklistStore._document_id(value)
        if row_id is None:
            return None
        row = mapping.get(row_id)
        if isinstance(row, dict):
            row = row.get("name")
        return str(row).strip() if row else None

    @classmethod
    def _tag(cls, mapping: dict[int, Any], value: Any) -> dict[str, str] | None:
        tag_id = cls._document_id(value)
        if tag_id is None:
            return None
        row = mapping.get(tag_id)
        if isinstance(row, str):
            return {"name": row}
        if not isinstance(row, dict) or not row.get("name"):
            return None
        result = {"name": str(row["name"])}
        if row.get("color"):
            result["color"] = str(row["color"])
        return result

    @classmethod
    def _tag_ids(cls, value: dict[str, Any]) -> list[int]:
        raw_tags = value.get("tags", [])
        if raw_tags is None:
            raw_tags = []
        if not isinstance(raw_tags, list):
            raise ValueError("Paperless returned invalid tags payload")
        tag_ids = []
        for raw_tag_id in raw_tags:
            tag_id = cls._document_id(raw_tag_id)
            if tag_id is None:
                raise ValueError("Paperless returned invalid tag ID")
            tag_ids.append(tag_id)
        return tag_ids

    @staticmethod
    def _format_mime_type(mime_type: str | None) -> str | None:
        if not mime_type:
            return None
        if mime_type.casefold() == "application/pdf":
            return "PDF"
        subtype = mime_type.partition("/")[2].split(";", 1)[0].strip()
        return subtype.upper() or None

    @staticmethod
    def _date_only(value: Any) -> str | None:
        match = re.match(r"^(\d{4}-\d{2}-\d{2})", str(value or ""))
        return match.group(1) if match else None

    @staticmethod
    def _safe_issues(value: Any) -> str:
        return re.sub(r"(?:/home|/srv|/data|[A-Za-z]:\\|company/eligibility/source/)[^\n ]*", "[внутренний путь скрыт]", str(value or ""))

    @classmethod
    def _safe_metadata(cls, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        result = {key: value[key] for key in ("name", "created", "modified", "expires", "review_due", "mime_type", "format", "correspondent", "text_state") if key in value}
        if "issues" in value:
            result["issues"] = cls._safe_issues(value["issues"])
        for key in ("tags", "status_tags"):
            if isinstance(value.get(key), list):
                result[key] = [
                    {field: str(tag[field]) for field in ("name", "color") if tag.get(field)}
                    for tag in value[key]
                    if isinstance(tag, dict) and tag.get("name")
                ]
        return result

    @staticmethod
    def _safe_error(value: Any) -> str:
        return re.sub(r"(?:/home|/srv|/data|[A-Za-z]:\\)[^\s]*", "[внутренний путь скрыт]", str(value))[:240]

    def _document_url(self, document_id: int, action: str) -> str:
        if self._document_id(document_id) != document_id or action not in {"preview", "download"}:
            raise ValueError("Некорректная ссылка Paperless")
        return f"{self.paperless_public_base}/api/documents/{document_id}/{action}/?original=true"

    @classmethod
    def _metadata(cls, value: dict[str, Any], source_file: dict[str, Any], field_names: dict[int, str] | None = None, tag_names: dict[int, Any] | None = None, cor_names: dict[int, Any] | None = None) -> dict[str, Any]:
        if not isinstance(value, dict) or not isinstance(source_file, dict):
            raise ValueError("Некорректный Paperless document payload")
        actual_document_id = cls._document_id(value.get("id"))
        expected_document_id = cls._document_id(source_file.get("document_id"))
        if actual_document_id is None or expected_document_id is None or actual_document_id != expected_document_id:
            raise ValueError("Paperless вернул другой document_id")
        fields = value.get("custom_fields") or {}
        field_names = field_names or {}
        if tag_names is None:
            tag_names = {}
        cor_names = cor_names or {}
        pairs = fields.items() if isinstance(fields, dict) else ((field_names.get(int(str(x.get("field")))) if str(x.get("field", "")).isdigit() else x.get("name"), x.get("value")) for x in fields if isinstance(x, dict))
        result: dict[str, Any] = {}
        for key, raw in pairs:
            label = str(key or "").strip().casefold()
            text = str(raw or "")
            if label in {"действует до", "expires"}:
                result["expires"] = text
            elif label in {"проверить актуальность до", "review_due"}:
                result["review_due"] = text
            elif label in {"замечания", "issues"}:
                result["issues"] = cls._safe_issues(text)
        tag_ids = cls._tag_ids(value)
        missing_tag_ids = [tag_id for tag_id in tag_ids if tag_id not in tag_names]
        if missing_tag_ids:
            raise ValueError(f"Paperless tag dictionary is incomplete: {missing_tag_ids}")
        tags = [cls._tag(tag_names, tag_id) for tag_id in tag_ids]
        if any(tag is None for tag in tags):
            raise ValueError("Paperless tag dictionary contains invalid entries")
        tags = [tag for tag in tags if tag is not None]
        status_tags = [tag for tag in tags if tag["name"] in STATUS_TAG_NAMES]
        mime_type = str(value.get("mime_type") or "").strip() or None
        correspondent = cls._mapping_name(cor_names, value.get("correspondent"))
        result.update({
            "name": value.get("title"),
            "created": cls._date_only(value.get("created")),
            "correspondent": correspondent,
            "mime_type": mime_type,
            "format": cls._format_mime_type(mime_type),
            "tags": tags,
            "status_tags": status_tags,
            "modified": value.get("modified"),
            "text_state": "Есть" if value.get("content") else "Не подтверждено",
        })
        return result

    @staticmethod
    def _fetch_rows(api_base: str, token: str, endpoint: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for page in range(1, 101):
            request = urllib.request.Request(
                f"{api_base.rstrip('/')}/{endpoint.strip('/')}/?page_size=1000&page={page}",
                headers={"Authorization": f"Token {token}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = json.loads(response.read())
            batch = payload.get("results", payload) if isinstance(payload, dict) else payload
            if not isinstance(batch, list):
                raise ValueError(f"Paperless returned invalid {endpoint} payload")
            if any(not isinstance(row, dict) for row in batch):
                raise ValueError(f"Paperless returned invalid {endpoint} row")
            rows.extend(batch)
            if not isinstance(payload, dict) or not payload.get("next") or not batch:
                return rows
        raise ValueError(f"Paperless {endpoint} pagination limit exceeded")

    @classmethod
    def _fetch_mapping(cls, api_base: str, token: str, endpoint: str) -> dict[int, dict[str, str]]:
        mapping = {}
        for row in cls._fetch_rows(api_base, token, endpoint):
            row_id = cls._document_id(row.get("id"))
            if row_id is not None and row.get("name"):
                mapping[row_id] = {key: str(row[key]) for key in ("name", "color") if row.get(key)}
        return mapping

    def _refresh_needed(self) -> bool:
        return self._cooldown_elapsed()

    def _cooldown_elapsed(self) -> bool:
        with sqlite3.connect(self.state_path) as db:
            row = db.execute("SELECT checked_at FROM document_refresh WHERE id=1").fetchone()
        if not row or not row[0]:
            return True
        try:
            elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(row[0])).total_seconds()
        except ValueError:
            return True
        return elapsed >= self.REFRESH_COOLDOWN_SECONDS

    def _set_refresh_state(self, status: str, error: str | None = None) -> None:
        checked_at = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self.state_path) as db:
            db.execute(
                "INSERT INTO document_refresh VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,error=excluded.error",
                (checked_at, status, error),
            )
            db.commit()

    def _run_refresh(self, api_base: str, token_file: Path) -> None:
        try:
            self.refresh(api_base, token_file)
        except (OSError, ValueError, json.JSONDecodeError, urllib.error.URLError) as exc:
            try:
                self._set_refresh_state("unavailable", str(exc)[:240])
            except Exception:
                pass
        except Exception as exc:
            try:
                self._set_refresh_state("error", str(exc)[:240])
            except Exception:
                pass
        finally:
            self._refresh_guard.release()

    def refresh_in_background(self, api_base: str, token_file: Path) -> bool:
        if not self._refresh_needed():
            return False
        if not self._refresh_guard.acquire(blocking=False):
            return False
        try:
            if not self._refresh_needed():
                self._refresh_guard.release()
                return False
            self._set_refresh_state("running")
            threading.Thread(target=self._run_refresh, args=(api_base, token_file), daemon=True).start()
            return True
        except Exception:
            try:
                self._set_refresh_state("unavailable", "Не удалось запустить обновление Paperless")
            finally:
                self._refresh_guard.release()
            return False

    def refresh(self, api_base: str, token_file: Path) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        source = self._source()
        try:
            files = []
            for source_file in source.get("files", []):
                document_id = self._source_document_id(source_file)
                if document_id is not None:
                    files.append(source_file)
            token = token_file.read_text(encoding="utf-8").strip()
            if not token:
                raise ValueError("Paperless reader token is empty")
            
            tag_names = self._fetch_mapping(api_base, token, "tags")
            cor_names = {}
            field_names = {
                int(row["id"]): str(row["name"])
                for row in self._fetch_rows(api_base, token, "custom_fields")
                if row.get("id") is not None and row.get("name")
            }
            rows = []
            for source_file in files:
                document_id = self._source_document_id(source_file)
                if document_id is None:
                    raise ValueError("Некорректный document_id в проекции")
                request = urllib.request.Request(f"{api_base.rstrip('/')}/documents/{document_id}/", headers={"Authorization": f"Token {token}", "Accept": "application/json"})
                with urllib.request.urlopen(request, timeout=10) as response:
                    value = json.loads(response.read())
                rows.append((document_id, json.dumps(self._metadata(value, source_file, field_names, tag_names, cor_names), ensure_ascii=False)))
            with sqlite3.connect(self.state_path) as db:
                db.executemany("INSERT INTO document_metadata_v2(document_id,title,modified,metadata,refreshed_at) VALUES(?,?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET title=excluded.title,modified=excluded.modified,metadata=excluded.metadata,refreshed_at=excluded.refreshed_at", [(doc_id, json.loads(metadata).get("name"), json.loads(metadata).get("modified"), metadata, now) for doc_id, metadata in rows])
                db.execute("INSERT INTO document_refresh VALUES(1,?,? ,NULL) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,error=NULL", (now, "ok"))
                db.commit()
            return {"status": "ok", "checked_at": now, "documents": len(rows), "data_preserved": True}
        except (OSError, ValueError, json.JSONDecodeError, urllib.error.URLError) as exc:
            error = str(exc)[:240]
            with sqlite3.connect(self.state_path) as db:
                db.execute("INSERT INTO document_refresh VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,error=excluded.error", (now, "unavailable", error))
                db.commit()
            return {"status": "unavailable", "checked_at": now, "error": error, "data_preserved": True}
