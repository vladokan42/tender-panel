from __future__ import annotations

import hashlib
import json
import datetime as dt
import math
import re
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

INTERNAL_DOCUMENT_NAMES = {
    "download-manifest.json",
    "download_manifest.json",
    "manifest.json",
    "extraction-manifest.json",
    "extraction_manifest.json",
    "core-import-manifest.json",
}


def internal_document_name(value: object) -> bool:
    name = Path(str(value or "")).name.casefold()
    return name in INTERNAL_DOCUMENT_NAMES or name.endswith(".manifest.json")


class ReleaseError(Exception):
    """A closed release or Tenderman projection is invalid or unavailable."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError, TypeError) as exc:
        raise ReleaseError("Данные выпуска недоступны") from exc


def require_relative(value: object, root: Path) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ReleaseError("Некорректный путь выпуска")
    candidate = Path(value)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ReleaseError("Некорректный путь выпуска")
    resolved = (root / candidate).resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ReleaseError("Некорректный путь выпуска") from exc
    return resolved


def verify_manifest(root: Path, required_files: set[str]) -> dict[str, Any]:
    manifest_path = root / "manifest.json"
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), dict):
        raise ReleaseError("Некорректный манифест")
    files = manifest["files"]
    if not required_files.issubset(files):
        raise ReleaseError("В выпуске отсутствуют обязательные данные")
    for name, expected_hash in files.items():
        if not isinstance(name, str) or not isinstance(expected_hash, str):
            raise ReleaseError("Некорректный манифест")
        file_path = require_relative(name, root)
        if not file_path.is_file() or sha256(file_path) != expected_hash:
            raise ReleaseError("Контрольная сумма выпуска не совпала")
    return manifest


def verify_data_release(root: Path, required_files: set[str]) -> dict[str, Any]:
    manifest_path = root / "manifest.json"
    manifest = load_json(manifest_path)
    artifacts = manifest.get("artifacts") if isinstance(manifest, dict) else None
    if not isinstance(artifacts, dict) or not required_files.issubset(artifacts):
        raise ReleaseError("Некорректный манифест закрытого выпуска")
    for name, metadata in artifacts.items():
        if not isinstance(name, str) or not isinstance(metadata, dict):
            raise ReleaseError("Некорректный манифест закрытого выпуска")
        expected_hash = metadata.get("sha256")
        path = require_relative(name, root)
        if not isinstance(expected_hash, str) or not path.is_file() or sha256(path) != expected_hash:
            raise ReleaseError("Контрольная сумма закрытого выпуска не совпала")
    return manifest


def safe_text(value: object, *, limit: int = 500) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def safe_card_scalar(value: object, *, limit: int = 4000) -> str | int | float | bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    return safe_text(value, limit=limit)


def safe_card_link(value: object) -> dict[str, str] | str:
    if not isinstance(value, dict):
        return safe_text(value, limit=4000)
    text = safe_text(value.get("text"), limit=500)
    url = safe_text(value.get("url"), limit=2000)
    result = {"text": text}
    if url.startswith("https://"):
        result["url"] = url
    return result


def sanitize_tender_card(payload: object) -> dict[str, Any]:
    from .visibility import public_business_data
    return public_business_data(payload) if isinstance(payload, dict) else {}


def legacy_sanitize_tender_card(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    result: dict[str, Any] = {}
    raw_fields = payload.get("fields")
    if isinstance(raw_fields, dict):
        fields: dict[str, dict[str, Any]] = {}
        for raw_label, raw in list(raw_fields.items())[:260]:
            label = safe_text(raw_label, limit=180)
            if not label or not isinstance(raw, dict):
                continue
            fields[label] = {
                "value": safe_card_link(raw.get("value")),
                "status": safe_text(raw.get("status"), limit=180),
                "source": safe_text(raw.get("source"), limit=300),
            }
        result["fields"] = fields

    raw_links = payload.get("official_links")
    if isinstance(raw_links, list):
        links = []
        for raw in raw_links[:20]:
            if not isinstance(raw, dict):
                continue
            url = safe_text(raw.get("url"), limit=2000)
            if not url.startswith("https://"):
                continue
            links.append({
                "title": safe_text(raw.get("title"), limit=300),
                "url": url,
                "number": safe_text(raw.get("number"), limit=160),
            })
        result["official_links"] = links

    raw_lines = payload.get("tender_lines")
    line_keys = (
        "line_id", "line_number", "product_group_id", "product_group_name", "name", "characteristics", "classifier", "unit", "okpd2", "ktru",
        "quantity", "unit_price", "amount", "delivery_address", "delivery_period",
        "source", "verification_status",
    )
    if isinstance(raw_lines, list):
        lines = []
        for raw in raw_lines[:1000]:
            if not isinstance(raw, dict):
                continue
            line = {key: safe_card_scalar(raw.get(key)) for key in line_keys}
            raw_requisites = raw.get("requisites")
            if isinstance(raw_requisites, dict):
                line["requisites"] = {
                    safe_text(key, limit=180): safe_card_scalar(value)
                    for key, value in list(raw_requisites.items())[:60]
                    if safe_text(key, limit=180)
                }
            lines.append(line)
        result["tender_lines"] = lines

    raw_offers = payload.get("supplier_offers")
    offer_keys = (
        "price_registry_id", "line_id", "line_number", "tender_product_name", "product_name", "article",
        "brand", "supplier", "package", "required_quantity", "package_quantity",
        "purchase_price", "price_unit", "price_date", "purchase_amount", "volume_status", "fit_status",
        "match_level", "match_score", "match_reason", "warnings", "block_reason",
        "calculation_blockers", "source_price_display", "source_price_display_status",
        "source_price_display_source", "source_price_display_warning",
        "okpd2_code", "okpd2", "okpd2_name",
    )
    if isinstance(raw_offers, list):
        offers = []
        for raw in raw_offers[:5000]:
            if not isinstance(raw, dict):
                continue
            # v0.4.0 preliminary candidates are deliberately price-free in the
            # client projection. The private registry link remains server-side.
            keys = offer_keys
            if "calculation_blockers" in raw:
                keys = tuple(key for key in offer_keys if key not in {"purchase_price", "purchase_amount", "price_date"})
            offers.append({key: safe_card_scalar(raw.get(key)) for key in keys if key in raw})
        result["supplier_offers"] = offers

    raw_deadline = payload.get("deadline")
    if isinstance(raw_deadline, dict):
        result["deadline"] = {
            "iso": safe_text(raw_deadline.get("iso"), limit=40),
            "timezone": safe_text(raw_deadline.get("timezone"), limit=80),
            "confirmed": bool(raw_deadline.get("confirmed")),
        }

    raw_analysis = payload.get("analysis")
    analysis_keys = (
        "evidence_completeness", "extraction", "document_reconciliation",
        "participation_readiness",
    )
    if isinstance(raw_analysis, dict):
        result["analysis"] = {
            key: safe_text(raw_analysis.get(key), limit=120)
            for key in analysis_keys
        }

    raw_economics = payload.get("economics")
    if isinstance(raw_economics, dict):
        state = safe_text(raw_economics.get("state"), limit=80)
        blockers = raw_economics.get("calculation_blockers")
        if state in {"NOT_CALCULATED", "PRELIMINARY_INCOMPLETE_COSTS", "VERIFIED", "LOSS"} and isinstance(blockers, list):
            economics = {
                "state": state,
                "calculation_blockers": [safe_text(item, limit=500) for item in blockers[:30] if safe_text(item, limit=500)],
            }
            for key in (
                "revenue_without_vat",
                "purchase_cost_without_vat",
                "direct_expenses_without_vat",
                "profit_without_vat",
                "margin_percent",
            ):
                value = raw_economics.get(key)
                if value is None or isinstance(value, bool):
                    economics[key] = None
                elif isinstance(value, (int, float)):
                    economics[key] = value
                elif isinstance(value, str) and re.fullmatch(r"-?\d+(?:[.,]\d+)?", value.strip()):
                    economics[key] = value.strip()
            result["economics"] = economics

    # An overlay can contain only product rows. Preserve canonical list-card
    # fields when the overlay does not explicitly provide a replacement.
    if "main_registry_ready" in payload:
        result["main_registry_ready"] = bool(payload.get("main_registry_ready"))
    if "required_parties_status" in payload:
        result["required_parties_status"] = safe_text(payload.get("required_parties_status"), limit=80)
    if "required_parties_block_reason" in payload:
        result["required_parties_block_reason"] = safe_text(payload.get("required_parties_block_reason"), limit=1000)
    return result


def safe_id(value: object) -> str:
    text = safe_text(value, limit=120)
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", text):
        raise ReleaseError("Некорректный идентификатор")
    return text


def public_supplier_key(value: object) -> str:
    text = safe_text(value, limit=500)
    if not text:
        raise ReleaseError("Пустой ключ поставщика")
    return "supplier-" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


@dataclass(frozen=True)
class PanelSnapshot:
    revision: str
    prices: dict[int, dict[str, Any]]
    suppliers: dict[str, dict[str, Any]]
    tenders: dict[str, dict[str, Any]]
    documents: dict[str, dict[str, Any]]
    documents_root: Path
    price_warning: str | None = None


class PanelRepository:
    """Read-only adapter for immutable Data Agent and Tenderman projections."""

    def __init__(self, protected_current: Path, tenderman_projection_root: Path):
        self.protected_current = protected_current
        self.tenderman_projection_root = tenderman_projection_root
        self._cache_stamp: tuple[int, int] | None = None
        self._cache: PanelSnapshot | None = None

    def snapshot(self) -> PanelSnapshot:
        try:
            stamp = (
                self.protected_current.stat().st_mtime_ns,
                (self.tenderman_projection_root / "manifest.json").stat().st_mtime_ns,
            )
        except OSError as exc:
            raise ReleaseError("Указатель выпуска недоступен") from exc
        if stamp == self._cache_stamp and self._cache is not None:
            return self._cache
        current = load_json(self.protected_current)
        if not isinstance(current, dict):
            raise ReleaseError("Некорректный указатель выпуска")
        revision = safe_id(current.get("release_revision"))
        releases_root = self.protected_current.parent / "releases"
        release = require_relative(current.get("release_relative_path"), self.protected_current.parent)
        try:
            release.relative_to(releases_root.resolve())
        except ValueError as exc:
            raise ReleaseError("Выпуск находится вне разрешённого каталога") from exc
        price_warning = None
        try:
            manifest = verify_data_release(release, {"offers.sqlite", "supplier_cards.sqlite"})
            expected_manifest_hash = current.get("manifest_sha256")
            if not isinstance(expected_manifest_hash, str) or sha256(release / "manifest.json") != expected_manifest_hash:
                raise ReleaseError("Контрольная сумма манифеста не совпала")
            if manifest.get("release_revision") != revision:
                raise ReleaseError("Редакция выпуска не совпала")
        except ReleaseError as exc:
            if self._cache is None:
                raise
            price_warning = f"Ценовой срез временно недоступен; использовано проверенное состояние: {exc}"

        tenderman_root = self.tenderman_projection_root.resolve()
        verify_manifest(tenderman_root, {"tenders.json", "documents.json"})
        documents_root = (tenderman_root / "documents").resolve()
        if not documents_root.is_dir():
            try:
                documents_root.mkdir(parents=True, exist_ok=True)
            except OSError:
                pass
        if not documents_root.is_dir():
            raise ReleaseError("Каталог документов недоступен")

        if price_warning:
            cached = self._cache
            if cached is None:
                raise ReleaseError("Проверенный ценовой срез отсутствует")
            prices, suppliers = cached.prices, cached.suppliers
        else:
            prices = self._prices_sqlite(release / "offers.sqlite", revision)
            suppliers = self._suppliers_sqlite(release / "supplier_cards.sqlite")
            if not {item["supplier_key"] for item in prices.values()}.issubset(suppliers):
                raise ReleaseError("В выпуске есть товары без карточки поставщика")
        tenders = self._tenders(load_json(tenderman_root / "tenders.json"))
        documents = self._documents(load_json(tenderman_root / "documents.json"), documents_root, tenders)
        snapshot = PanelSnapshot(revision, prices, suppliers, tenders, documents, documents_root, price_warning)
        self._cache_stamp = stamp
        self._cache = snapshot
        return snapshot

    @staticmethod
    def _connect(path: Path) -> sqlite3.Connection:
        connection = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        return connection

    def _prices_sqlite(self, path: Path, revision: str) -> dict[int, dict[str, Any]]:
        result: dict[int, dict[str, Any]] = {}
        with self._connect(path) as connection:
            rows = connection.execute(
                """SELECT price_registry_id, supplier_key, unit_price_with_vat, price_date
                   FROM offers WHERE release_revision = ?""",
                (revision,),
            )
            for row in rows:
                product_id = int(row["price_registry_id"])
                if product_id in result:
                    raise ReleaseError("Дублирующийся идентификатор товара")
                price = safe_text(row["unit_price_with_vat"], limit=40)
                if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", price):
                    raise ReleaseError("Некорректная закупочная цена")
                result[product_id] = {
                    "supplier_key": public_supplier_key(row["supplier_key"]),
                    "purchase_price": price,
                    "price_unit": "",
                    "price_date": safe_text(row["price_date"], limit=20),
                    "data_status": "CONFIRMED",
                }
        return result

    def _suppliers_sqlite(self, path: Path) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        with self._connect(path) as connection:
            rows = connection.execute(
                """SELECT supplier_key, supplier_name, profile_link_status,
                          address, address_status, manager, manager_status,
                          phone, phone_status, email, email_status,
                          contract, contract_status
                   FROM supplier_cards"""
            )
            for row in rows:
                key = public_supplier_key(row["supplier_key"])
                if key in result:
                    raise ReleaseError("Дублирующийся ключ поставщика")
                result[key] = {
                    "supplier_name": safe_text(row["supplier_name"]),
                    "profile_link_status": safe_text(row["profile_link_status"], limit=40),
                    "address": safe_text(row["address"]),
                    "address_status": safe_text(row["address_status"], limit=40),
                    "manager_name": safe_text(row["manager"]),
                    "manager_status": safe_text(row["manager_status"], limit=40),
                    "manager_phone": safe_text(row["phone"]),
                    "phone_status": safe_text(row["phone_status"], limit=40),
                    "manager_email": safe_text(row["email"]),
                    "email_status": safe_text(row["email_status"], limit=40),
                    "contract_document_id": "",
                    "contract_status": safe_text(row["contract_status"], limit=40),
                    "checked_at": "",
                    "data_status": "BLOCKED" if row["address_status"] == "BLOCKED" or row["contract_status"] == "BLOCKED" else "RECHECK",
                }
        return result

    @staticmethod
    def _items(payload: Any, key: str) -> list[dict[str, Any]]:
        items = payload.get(key) if isinstance(payload, dict) else payload
        if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
            raise ReleaseError("Некорректные данные выпуска")
        return items

    def _prices(self, payload: Any) -> dict[int, dict[str, Any]]:
        result: dict[int, dict[str, Any]] = {}
        for item in self._items(payload, "items"):
            product_id = item.get("product_id")
            if isinstance(product_id, bool) or not isinstance(product_id, int) or product_id <= 0:
                raise ReleaseError("Некорректный идентификатор товара")
            if product_id in result:
                raise ReleaseError("Дублирующийся идентификатор товара")
            status = safe_text(item.get("data_status"), limit=20)
            if status not in {"CONFIRMED", "RECHECK", "BLOCKED"}:
                raise ReleaseError("Некорректный статус данных")
            price = item.get("unit_price_with_vat")
            if status == "CONFIRMED" and (isinstance(price, bool) or not isinstance(price, (int, float))):
                raise ReleaseError("Некорректная закупочная цена")
            result[product_id] = {
                "supplier_key": safe_id(item.get("supplier_key")),
                "purchase_price": price if status == "CONFIRMED" else None,
                "price_unit": safe_text(item.get("price_unit"), limit=80),
                "price_date": safe_text(item.get("date"), limit=20),
                "data_status": status,
            }
        return result

    def _suppliers(self, payload: Any) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        allowed = ("supplier_name", "address", "manager_name", "manager_phone", "manager_email", "contract_document_id", "checked_at", "data_status")
        for item in self._items(payload, "suppliers"):
            key = safe_id(item.get("supplier_key"))
            if key in result:
                raise ReleaseError("Дублирующийся ключ поставщика")
            value = {name: safe_text(item.get(name)) for name in allowed}
            if value["data_status"] not in {"CONFIRMED", "RECHECK", "BLOCKED"}:
                raise ReleaseError("Некорректный статус поставщика")
            result[key] = value
        return result

    def _tenders(self, payload: Any) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        allowed = ("title", "number", "customer", "delivery_address", "procedure", "submission_deadline", "timezone", "official_status", "official_checked_at", "items", "panel_bucket")
        for item in self._items(payload, "tenders"):
            tender_id = safe_id(item.get("tender_id"))
            if tender_id in result:
                raise ReleaseError("Дублирующийся идентификатор тендера")
            from .visibility import public_business_data
            value = public_business_data(item)
            result[tender_id] = value
        return result

    def _documents(self, payload: Any, documents_root: Path, tenders: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        allowed = ("title", "role", "revision", "published_at", "loaded_at", "media_type", "extraction_status")
        for item in self._items(payload, "documents"):
            document_id = safe_id(item.get("document_id"))
            tender_id = safe_id(item.get("tender_id"))
            if document_id in result or tender_id not in tenders:
                raise ReleaseError("Некорректный документ")
            warning = None
            path = None
            expected_hash = item.get("sha256")
            try:
                candidate = require_relative(item.get("relative_path"), documents_root)
                if not candidate.is_file() or not isinstance(expected_hash, str) or sha256(candidate) != expected_hash:
                    raise ReleaseError("Документ недоступен или контрольная сумма не совпала")
                path = candidate
            except (ReleaseError, OSError):
                warning = "Документ недоступен для безопасного скачивания"
            value = {name: safe_text(item.get(name)) for name in allowed}
            value.update({"document_id": document_id, "tender_id": tender_id, "path": path,
                          "sha256": expected_hash, "size_bytes": path.stat().st_size if path else None,
                          "warning": warning})
            result[document_id] = value
        return result


def core_tender_id(value: object) -> int:
    if isinstance(value, bool):
        raise ReleaseError("Некорректный идентификатор основной карточки")
    text = str(value) if isinstance(value, int) else safe_text(value, limit=24)
    if not re.fullmatch(r"[1-9][0-9]{0,17}", text):
        raise ReleaseError("Некорректный идентификатор основной карточки")
    return int(text)


class CoreTenderNotFound(ReleaseError):
    """A tender or a document is not in the visible core registry."""


def sanitize_core_list_card(payload: object, tender_id: int) -> dict[str, Any]:
    """Return only public list-card fields for a visible core tender."""
    if not isinstance(payload, dict):
        raise ReleaseError("Некорректная карточка реестра")
    try:
        payload_tender_id = core_tender_id(payload.get("tender_id"))
    except ReleaseError as exc:
        raise ReleaseError("Некорректная карточка реестра") from exc
    if payload_tender_id != tender_id:
        raise ReleaseError("Карточка реестра не соответствует тендеру")
    allowed = (
        "title", "number", "customer", "delivery_address", "procedure",
        "submission_deadline", "timezone", "official_status", "official_checked_at",
        "items", "panel_bucket",
    )
    from .visibility import public_business_data
    result = public_business_data(payload)
    result["tender_id"] = str(tender_id)
    if "card" in payload:
        result["card"] = sanitize_tender_card(payload.get("card"))
    return {"tender_id": str(tender_id), **result}


class CoreTenderRepository:
    """Read-only adapter for the Tenderman core projection and original blobs."""

    def __init__(self, db_path: Path, overlay_path: Path | None = None):
        self.db_path = db_path
        self.overlay_path = overlay_path
        # The core registry is immutable from the panel's point of view, but
        # it can be promoted by Tenderman/Data Agent. Cache only after all
        # existing integrity checks pass and invalidate on source file change.
        self._cache_stamp: tuple[tuple[int, int, int], tuple[int, int, int] | None, tuple[int, int, int] | None, tuple[int, int, int] | None] | None = None
        self._visible_cards_cache: list[dict[str, Any]] | None = None
        self._card_cache: dict[int, dict[str, Any]] = {}
        self._projection_cache: dict[int, dict[str, Any]] = {}

    def _source_stamp(self) -> tuple[tuple[int, int, int], tuple[int, int, int] | None, tuple[int, int, int] | None, tuple[int, int, int] | None]:
        db_stat = self.db_path.stat()
        db_stamp = (db_stat.st_mtime_ns, db_stat.st_size, getattr(db_stat, "st_ino", 0))
        if self.overlay_path is None:
            overlay_stamp = None
        else:
            try:
                overlay_stat = self.overlay_path.stat()
                overlay_stamp = (overlay_stat.st_mtime_ns, overlay_stat.st_size, getattr(overlay_stat, "st_ino", 0))
            except FileNotFoundError:
                overlay_stamp = None
        wal_path = Path(str(self.db_path) + "-wal")
        try:
            wal_stat = wal_path.stat()
            wal_stamp = (wal_stat.st_mtime_ns, wal_stat.st_size, wal_stat.st_ino)
        except FileNotFoundError:
            wal_stamp = None
        journal_path = Path(str(self.db_path) + "-journal")
        try:
            journal_stat = journal_path.stat()
            journal_stamp = (journal_stat.st_mtime_ns, journal_stat.st_size, journal_stat.st_ino)
        except FileNotFoundError:
            journal_stamp = None
        return db_stamp, overlay_stamp, wal_stamp, journal_stamp

    def _refresh_cache_stamp(self) -> None:
        stamp = self._source_stamp()
        if stamp != self._cache_stamp:
            self._cache_stamp = stamp
            self._visible_cards_cache = None
            self._card_cache = {}
            self._projection_cache = {}
            self._overlay_cache = None

    def _overlay_card(self, tender_id: int) -> dict[str, Any]:
        if self.overlay_path is None:
            return {}
        if getattr(self, "_overlay_cache", None) is None:
            try:
                raw = json.loads(self.overlay_path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    raise ValueError
                self._overlay_cache = raw
            except (OSError, ValueError) as exc:
                raise ReleaseError("Дополнительные строки карточки временно недоступны") from exc
        return sanitize_tender_card(self._overlay_cache.get(str(tender_id)))

    @contextmanager
    def _reader(self):
        before = self._source_stamp()
        wal_present = before[2] is not None
        journal_present = before[3] is not None
        try:
            mode = "mode=ro"
            if not wal_present and not journal_present:
                mode += "&immutable=1"
            uri = self.db_path.resolve().as_uri() + "?" + mode
            connection = sqlite3.connect(uri, uri=True)
        except (OSError, sqlite3.Error) as exc:
            raise ReleaseError("Основная карточка временно недоступна") from exc
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA query_only=ON")
            yield connection
        except sqlite3.Error as exc:
            raise ReleaseError("Основная карточка временно недоступна") from exc
        finally:
            connection.close()
            try:
                after = self._source_stamp()
            except OSError as exc:
                raise ReleaseError("Основная карточка временно недоступна") from exc
            if after != before:
                raise ReleaseError("Основная карточка изменилась во время чтения")

    def _connect(self) -> sqlite3.Connection:
        """Compatibility helper for tests; callers must close the result."""
        before = self._source_stamp()
        mode = "mode=ro"
        if before[2] is None and before[3] is None:
            mode += "&immutable=1"
        try:
            connection = sqlite3.connect(self.db_path.resolve().as_uri() + "?" + mode, uri=True)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only=ON")
            return connection
        except (OSError, sqlite3.Error) as exc:
            raise ReleaseError("Основная карточка временно недоступна") from exc

    def _visible_row(self, tender_id: object) -> tuple[int, sqlite3.Row]:
        tender_key = core_tender_id(tender_id)
        with self._reader() as connection:
            row = connection.execute(
                """SELECT tender_id, list_payload_json, projection_sha256,
                          projection_json, core_version
                   FROM tender_panel_visible_cards
                   WHERE tender_id=?""",
                (tender_key,),
            ).fetchone()
        if row is None:
            raise CoreTenderNotFound("Основная карточка не найдена")
        return tender_key, row

    @staticmethod
    def _projection_from_row(tender_key: int, row: sqlite3.Row) -> dict[str, Any]:
        raw = row["projection_json"]
        expected_digest = row["projection_sha256"]
        if not isinstance(raw, str) or not isinstance(expected_digest, str):
            raise ReleaseError("Основная карточка временно недоступна")
        if hashlib.sha256(raw.encode("utf-8")).hexdigest() != expected_digest:
            raise ReleaseError("Контрольная сумма основной карточки не совпала")
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError) as exc:
            raise ReleaseError("Основная карточка временно недоступна") from exc
        if not isinstance(payload, dict) or payload.get("tender_id") != tender_key:
            raise ReleaseError("Некорректная основная карточка")
        if payload.get("schema_version") != "tender-panel-db-projection-v1":
            raise ReleaseError("Неподдерживаемая версия основной карточки")
        return payload

    @staticmethod
    def _dictionary_from_connection(connection: sqlite3.Connection) -> tuple[str, str, dict[str, dict[str, Any]]]:
        available = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tender_field_semantics'"
        ).fetchone()
        if available is None:
            return "", "", {}
        try:
            rows = connection.execute(
                """SELECT field_key, semantic_key, dictionary_version, definition_json, definition_sha256
                   FROM tender_field_semantics
                   ORDER BY field_key"""
            ).fetchall()
        except sqlite3.Error as exc:
            raise ReleaseError("Словарь реквизитов временно недоступен") from exc
        if len(rows) != 126:
            raise ReleaseError("Словарь реквизитов неполный")

        definitions: dict[str, dict[str, Any]] = {}
        version = ""
        raw_definitions: list[dict[str, Any]] = []
        for row in rows:
            field_key = row["field_key"]
            semantic_key = row["semantic_key"]
            row_version = row["dictionary_version"]
            try:
                definition = json.loads(row["definition_json"])
            except (TypeError, ValueError) as exc:
                raise ReleaseError("Словарь реквизитов повреждён") from exc
            if (
                not isinstance(field_key, str)
                or not isinstance(semantic_key, str)
                or not isinstance(row_version, str)
                or not isinstance(definition, dict)
                or not isinstance(row["definition_sha256"], str)
                or hashlib.sha256(row["definition_json"].encode("utf-8")).hexdigest() != row["definition_sha256"]
                or definition.get("field_key") != field_key
                or definition.get("semantic_key") != semantic_key
                or row_version != "tender-field-dictionary-v2"
                or definition.get("value_type") not in {"TEXT", "INTEGER", "DECIMAL", "BOOLEAN", "DATE", "DATETIME", "JSON"}
            ):
                raise ReleaseError("Словарь реквизитов некорректен")
            if version and version != row_version:
                raise ReleaseError("Версия словаря реквизитов неоднородна")
            version = row_version
            definitions[field_key] = {
                "semantic_key": semantic_key,
                "field_definition": definition,
                "expected_value_type": definition["value_type"],
            }
            raw_definitions.append(definition)
        if len(definitions) != 126 or not version:
            raise ReleaseError("Словарь реквизитов содержит повторения")
        digest = hashlib.sha256(
            json.dumps(raw_definitions, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return version, digest, definitions

    @staticmethod
    def _apply_dictionary(payload: dict[str, Any], version: str, digest: str, definitions: dict[str, dict[str, Any]]) -> dict[str, Any]:
        if not definitions:
            return payload
        result = dict(payload)

        def format_status(value: object, target: str) -> str:
            if value is None or value == "":
                return "NOT_RECORDED"
            valid = False
            if target == "TEXT": valid = isinstance(value, str)
            elif target == "INTEGER": valid = isinstance(value, int) and not isinstance(value, bool)
            elif target == "DECIMAL": valid = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            elif target == "BOOLEAN": valid = isinstance(value, bool)
            elif target == "JSON": valid = isinstance(value, (list, dict))
            elif target in {"DATE", "DATETIME"} and isinstance(value, str):
                try:
                    valid = (bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)) and bool(dt.date.fromisoformat(value))) if target == "DATE" else ("T" in value and dt.datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None)
                except ValueError: valid = False
            return "FORMAT_ONLY" if valid else "LEGACY_REVIEW_REQUIRED"

        def enrich(field: object) -> object:
            if not isinstance(field, dict):
                return field
            field_key = field.get("field_key")
            metadata = definitions.get(field_key) if isinstance(field_key, str) else None
            if metadata is None:
                return field
            value = field.get("value")
            enriched = dict(field)
            enriched["name"] = metadata["field_definition"]["display_name"]
            enriched.update(metadata)
            enriched["value_format_status"] = format_status(value, metadata["expected_value_type"])
            return enriched

        for key in ("main_fields", "technical_fields"):
            values = payload.get(key)
            if isinstance(values, list):
                result[key] = [enrich(value) for value in values]
        sections = payload.get("sections")
        if isinstance(sections, dict):
            result["sections"] = {
                layer: {
                    title: [enrich(value) for value in values] if isinstance(values, list) else values
                    for title, values in groups.items()
                } if isinstance(groups, dict) else groups
                for layer, groups in sections.items()
            }
        result["dictionary_version"] = version
        result["dictionary_sha256"] = digest
        return result

    def _list_card_from_row(self, tender_key: int, row: sqlite3.Row, projection: dict[str, Any] | None = None, *, compact: bool = False) -> dict[str, Any]:
        raw = row["list_payload_json"]
        if not isinstance(raw, str):
            raise ReleaseError("Карточка реестра временно недоступна")
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError) as exc:
            raise ReleaseError("Карточка реестра временно недоступна") from exc
        def compact_card(value):
            def strip_nested(item):
                if isinstance(item, list):
                    return [strip_nested(child) for child in item]
                if not isinstance(item, dict):
                    return item
                return {
                    key: strip_nested(child)
                    for key, child in item.items()
                    if key not in {"line_results", "product_line_results", "candidate_matches", "supplier_offers"}
                }
            value = dict(value) if isinstance(value, dict) else value
            if isinstance(value, dict):
                value.pop('full_data', None)
                value.pop('full_core_payload', None)
                had_supplier_offers = isinstance(value.get('supplier_offers'), list)
                stripped = strip_nested(value)
                if isinstance(stripped, dict):
                    value = stripped
                    if had_supplier_offers:
                        value['supplier_offers'] = []
            return value
        if compact and isinstance(payload, dict):
            payload.pop('full_data', None)
            payload.pop('full_core_payload', None)
            if 'card' in payload:
                payload['card'] = compact_card(payload['card'])
        card = sanitize_core_list_card(payload, tender_key)
        list_card = card.get("card")
        verified_offers_present = (
            isinstance(list_card, dict)
            and isinstance(list_card.get("supplier_offers"), list)
        )
        from .visibility import merge_available
        try:
            overlay_card = self._overlay_card(tender_key)
        except (ReleaseError, OSError, ValueError):
            overlay_card = {"visibility_warnings": [{"code": "OVERLAY_UNAVAILABLE", "message": "Дополнительная проекция недоступна", "blocks_visibility": False}]}
        if compact:
            overlay_card = compact_card(overlay_card)
        card["card"] = merge_available(card.get("card", {}), overlay_card or {})
        candidates = projection.get("product_candidates") if isinstance(projection, dict) else {}
        display_results = candidates.get("display_results", []) if isinstance(candidates, dict) else []
        if not verified_offers_present and isinstance(display_results, list):
            fallback_offers = [offer for offer in display_results if isinstance(offer, dict)]
            card["card"] = merge_available(
                card["card"],
                sanitize_tender_card({"supplier_offers": fallback_offers}),
            )
        return card

    def registry_stamp(self) -> tuple[tuple[int, int, int], tuple[int, int, int] | None, tuple[int, int, int] | None, tuple[int, int, int] | None]:
        """Fingerprint every source that can change a compact registry card."""
        self._refresh_cache_stamp()
        if self._cache_stamp is None:
            raise ReleaseError("Источник реестра временно недоступен")
        return self._cache_stamp

    def visible_cards(self) -> list[dict[str, Any]]:
        """Return compact registry cards without parsing detail projections."""
        self._refresh_cache_stamp()
        if self._visible_cards_cache is not None:
            return self._visible_cards_cache
        with self._reader() as connection:
            rows = connection.execute(
                """SELECT tender_id, list_payload_json
                   FROM tender_panel_visible_cards
                   ORDER BY tender_id"""
            ).fetchall()
        cards = []
        for row in rows:
            tender_key = core_tender_id(row["tender_id"])
            try:
                card = self._list_card_from_row(tender_key, row, compact=True)
            except ReleaseError:
                card = {"tender_id": str(tender_key), "card": {}, "visibility_warnings": [{"code": "LIST_CARD_UNAVAILABLE", "blocks_visibility": False}]}
            cards.append(card)
        self._visible_cards_cache = cards
        return cards

    def card(self, tender_id: object) -> dict[str, Any]:
        """Return one visible card with its verified candidate list on demand."""
        tender_key = core_tender_id(tender_id)
        self._refresh_cache_stamp()
        cached = self._card_cache.get(tender_key)
        if cached is not None:
            return cached
        _, row = self._visible_row(tender_key)
        try:
            projection = self._projection_from_row(tender_key, row)
            card = self._list_card_from_row(tender_key, row, projection)
        except ReleaseError:
            card = self._list_card_from_row(tender_key, row)
            card.setdefault("visibility_warnings", []).append({
                "code": "CORE_PROJECTION_UNAVAILABLE",
                "message": "Подробная проекция недоступна; сохранённая карточка показана",
                "blocks_visibility": False,
            })
        self._card_cache[tender_key] = card
        return card

    def sourcing_cards(self) -> list[dict[str, Any]]:
        """Read product sources without adapting full cards or their dictionary.

        Keep the same projection integrity gate and saved-card fallback as card().
        Only collections consumed by sourcing enter the public sanitizer/merge.
        """
        from .visibility import merge_available
        stamp = self._source_stamp()
        overlay = {}
        if self.overlay_path is not None:
            try:
                overlay = load_json(self.overlay_path)
                if not isinstance(overlay, dict):
                    overlay = {}
            except ReleaseError:
                pass  # Same non-blocking overlay fallback as the full card.
        with self._reader() as connection:
            rows = connection.execute(
                """SELECT tender_id, list_payload_json, projection_sha256, projection_json
                   FROM tender_panel_visible_cards"""
            ).fetchall()
        # Sort references, not half a gigabyte of JSON in SQLite's temp B-tree.
        rows.sort(key=lambda row: core_tender_id(row['tender_id']))
        collections = ('tender_lines', 'supplier_offers', 'product_line_results')

        def source_card(value):
            selected = {key: value[key] for key in collections if key in value}
            # Only classifier evidence is consumed from this fallback. Full
            # matches/history remain in card()/projection(), never lost upstream.
            results = selected.get('product_line_results')
            if isinstance(results, list):
                fields = {'line_id', 'tender_line_id', 'score', 'match_score', 'status',
                          'match_status', 'source_revision', 'error', 'success', 'refresh_status'}
                selected['product_line_results'] = [
                    {key: item for key, item in row.items() if key in fields}
                    for row in results if isinstance(row, dict)]
            return sanitize_tender_card(selected)

        cards = []
        for row in rows:
            tender_key = core_tender_id(row['tender_id'])
            try:
                payload = json.loads(row['list_payload_json'])
            except (TypeError, ValueError) as exc:
                raise ReleaseError('Карточка реестра временно недоступна') from exc
            if not isinstance(payload, dict):
                raise ReleaseError('Некорректная карточка реестра')
            raw_card = payload.get('card')
            raw_card = raw_card if isinstance(raw_card, dict) else {}
            card = sanitize_core_list_card({
                **{key: payload[key] for key in ('tender_id', 'title', 'registry', 'submission_deadline') if key in payload},
            }, tender_key)
            card['card'] = source_card(raw_card)
            verified_offers_present = isinstance(raw_card.get('supplier_offers'), list)
            overlay_card = overlay.get(str(tender_key))
            if isinstance(overlay_card, dict):
                card['card'] = merge_available(card['card'], source_card(overlay_card))
            try:
                projection = self._projection_from_row(tender_key, row)
            except ReleaseError:
                projection = {}
            candidates = projection.get('product_candidates')
            candidates = candidates if isinstance(candidates, dict) else {}
            display = candidates.get('display_results', [])
            if not verified_offers_present and isinstance(display, list):
                card['card'] = merge_available(card['card'], sanitize_tender_card({
                    'supplier_offers': [offer for offer in display if isinstance(offer, dict)]
                }))
            # Projection offers stay identical to projection(): combine_sources
            # retains their raw versions alongside the sanitized/manual card.
            card['product_candidates'] = {key: candidates[key] for key in ('display_results', 'line_results') if key in candidates}
            cards.append(card)
        if self._source_stamp() != stamp:
            raise ReleaseError('Основная карточка изменилась во время чтения')
        return cards

    def registered_tender_ids(self) -> set[int]:
        with self._reader() as connection:
            rows = connection.execute("SELECT tender_id FROM tender_panel_registry").fetchall()
        return {core_tender_id(row["tender_id"]) for row in rows}

    def is_visible(self, tender_id: object) -> bool:
        try:
            tender_key = core_tender_id(tender_id)
        except ReleaseError:
            return False
        try:
            self._visible_row(tender_key)
        except CoreTenderNotFound:
            return False
        return True

    def projection(self, tender_id: object) -> dict[str, Any]:
        tender_key = core_tender_id(tender_id)
        self._refresh_cache_stamp()
        cached = self._projection_cache.get(tender_key)
        if cached is not None:
            return cached
        with self._reader() as connection:
            row = connection.execute(
                """SELECT tender_id, list_payload_json, projection_sha256,
                          projection_json, core_version
                   FROM tender_panel_visible_cards
                   WHERE tender_id=?""",
                (tender_key,),
            ).fetchone()
            if row is None:
                raise CoreTenderNotFound("Основная карточка не найдена")
            payload = self._projection_from_row(tender_key, row)
            try:
                version, digest, definitions = self._dictionary_from_connection(connection)
            except ReleaseError:
                version, digest, definitions = "", "", {}
                payload.setdefault("visibility_warnings", []).append({"code": "DICTIONARY_UNAVAILABLE", "message": "Словарь реквизитов недоступен", "blocks_visibility": False})
        result = self._apply_dictionary(payload, version, digest, definitions)
        self._projection_cache[tender_key] = result
        return result

    def documents(self, tender_id: object, public_prefix: str) -> list[dict[str, Any]]:
        tender_key, _ = self._visible_row(tender_id)
        projection = self.projection(tender_key)
        expected_documents = projection.get("documents")
        if not isinstance(expected_documents, list):
            raise ReleaseError("Некорректный реестр документов основной карточки")
        public_documents = [
            item for item in expected_documents
            if isinstance(item, dict)
            and not internal_document_name(item.get("original_file_name"))
            and not internal_document_name(item.get("title"))
        ]
        expected = {
            item.get("document_id"): item.get("sha256")
            for item in public_documents
            if isinstance(item, dict) and isinstance(item.get("document_id"), int)
        }
        if not expected:
            # A source document can be published before Tenderman assigns its
            # internal numeric ID. Keep it visible, but never invent a download
            # route that could address a different artifact.
            from .visibility import public_business_data
            result = []
            for index, item in enumerate(public_documents, start=1):
                stable_key = item.get("stable_key")
                document_id = stable_key if isinstance(stable_key, str) and stable_key else f"source-document-{tender_key}-{index}"
                public_item = public_business_data(item)
                if not isinstance(public_item, dict):
                    public_item = {}
                result.append({
                    **public_item,
                    "document_id": document_id,
                    "tender_id": str(tender_key),
                    "open_url": None,
                    "warning": "Документ ожидает внутренний ID и недоступен для безопасного скачивания",
                })
            return result
        with self._reader() as connection:
            rows = connection.execute(
                """SELECT d.document_id, d.title, d.original_file_name, d.source_system,
                          d.official_created_at, d.status AS document_status,
                          r.artifact_id, r.sha256, r.byte_size, r.revision_number,
                          a.sha256 AS artifact_sha256, a.byte_size AS artifact_size,
                          a.media_type AS artifact_media_type,
                          COALESCE((SELECT e.status FROM tender_document_extractions e
                                    WHERE e.document_revision_id=r.document_revision_id
                                    ORDER BY e.extraction_id DESC LIMIT 1), 'NOT_AVAILABLE') AS extraction_status
                   FROM tender_documents d
                   LEFT JOIN tender_document_revisions r ON r.document_revision_id=d.current_revision_id
                   LEFT JOIN tender_source_artifacts a ON a.artifact_id=r.artifact_id
                   WHERE d.tender_id=? ORDER BY d.document_id""",
                (tender_key,),
            ).fetchall()
        result = []
        for row in rows:
            document_id = row["document_id"]
            if internal_document_name(row["original_file_name"]) or internal_document_name(row["title"]):
                continue
            available = bool(row["sha256"] and row["artifact_id"] and
                             document_id in expected and row["sha256"] == expected[document_id] and
                             row["sha256"] == row["artifact_sha256"] and row["byte_size"] == row["artifact_size"])
            result.append({
                "document_id": document_id,
                "tender_id": str(tender_key),
                "title": safe_text(row["title"], limit=500),
                "source": safe_text(row["source_system"], limit=180),
                "original_file_name": safe_text(row["original_file_name"], limit=300),
                "revision": row["revision_number"],
                "published_at": safe_text(row["official_created_at"], limit=80),
                "size_bytes": row["byte_size"],
                "media_type": safe_text(row["artifact_media_type"], limit=180) or "application/octet-stream",
                "extraction_status": safe_text(row["extraction_status"], limit=80),
                "document_status": safe_text(row["document_status"], limit=80),
                "open_url": f"{public_prefix}/documents/{document_id}" if available else None,
                "warning": None if available else "Документ недоступен для безопасного скачивания",
            })
        from .visibility import public_business_data
        present = {item["document_id"] for item in result}
        for index, item in enumerate(public_documents, start=1):
            doc_id = item.get("document_id")
            if doc_id not in present:
                stable_key = item.get("stable_key")
                doc_key = doc_id if isinstance(doc_id, (int, str)) and doc_id else (stable_key if isinstance(stable_key, str) and stable_key else f"source-document-{tender_key}-{index}")
                warning = "Документ ожидает внутренний ID и недоступен для безопасного скачивания" if not isinstance(doc_id, int) else "Документ недоступен для безопасного скачивания"
                public_item = public_business_data(item)
                if not isinstance(public_item, dict):
                    public_item = {}
                result.append({**public_item, "document_id": doc_key, "open_url": None, "warning": warning})
        return result

    def document_blob(self, document_id: object) -> tuple[bytes, dict[str, Any]]:
        try:
            document_text = str(document_id)
            if not re.fullmatch(r"[1-9][0-9]{0,17}", document_text):
                raise ValueError
            document_key = int(document_text)
        except (TypeError, ValueError) as exc:
            raise ReleaseError("Документ не найден") from exc
        with self._reader() as connection:
            owner = connection.execute(
                "SELECT tender_id FROM tender_documents WHERE document_id=?",
                (document_key,),
            ).fetchone()
            if owner is None:
                raise CoreTenderNotFound("Документ не найден")
            tender_key, _ = self._visible_row(owner["tender_id"])
            row = connection.execute(
                """SELECT a.content_blob, a.sha256, a.byte_size, a.media_type,
                          r.revision_number, r.sha256 AS revision_sha256, r.byte_size AS revision_size
                   FROM tender_documents d
                   JOIN tender_document_revisions r ON r.document_revision_id=d.current_revision_id
                   JOIN tender_source_artifacts a ON a.artifact_id=r.artifact_id
                   WHERE d.tender_id=? AND d.document_id=?""",
                (tender_key, document_key),
            ).fetchone()
            if row is None or not isinstance(row["content_blob"], bytes):
                raise ReleaseError("Документ временно недоступен")
            blob = row["content_blob"]
            if (len(blob) != row["byte_size"] or
                row["byte_size"] != row["revision_size"] or
                row["sha256"] != row["revision_sha256"] or
                hashlib.sha256(blob).hexdigest() != row["sha256"]):
                raise ReleaseError("Контрольная сумма документа не совпала")
            allowed = {item["document_id"]: item for item in self.documents(tender_key, "")}
            metadata = allowed.get(document_key)
            if metadata is None or not metadata.get("open_url"):
                raise ReleaseError("Документ не найден или недоступен")
            media_type = safe_text(row["media_type"], limit=180)
            metadata["media_type"] = media_type
            return blob, metadata
