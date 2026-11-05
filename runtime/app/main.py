from __future__ import annotations

import re
import json
import math
import copy
import sqlite3
import threading
from .visibility import public_business_data, merge_available, leaf_rows
from fastapi.staticfiles import StaticFiles
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.middleware.gzip import GZipMiddleware
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .archive_store import ArchiveError, ArchiveStore, REASONS
from .config import Settings, settings
from .economics import calculate_preliminary_earnings
from .repository import CoreTenderNotFound, CoreTenderRepository, PanelRepository, PanelSnapshot, ReleaseError, core_tender_id, safe_id
from .search_settings import SearchSettingsStore, SearchSettingsVersionNotFound
from .offers_refresh import CanonicalSearch, OfferRefreshStore, RefreshError, combine_sources, fingerprint
from .sourcing_routes import attach_sourcing_routes

MEDIA_TYPE_RE = re.compile(r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$")
FORBIDDEN_PRODUCT_KEYS = {
    "sale_price", "region", "price_type", "arrivals", "arrival_date", "arrival_days",
    "has_contract", "cart", "excel", "source_date", "source_file_name", "purchase_price",
}


def render_panel_html(config: Settings) -> HTMLResponse:
    try:
        body = config.html_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Панель временно недоступна") from exc
    if config.public_prefix:
        for attribute in ("href", "src"):
            for asset_path in ("/static/assets", "/static/map", "/static/demo"):
                body = body.replace(
                    f'{attribute}="{asset_path}',
                    f'{attribute}="{config.public_prefix}{asset_path}',
                )
    return HTMLResponse(body)


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchUnavailable(Exception):
    pass


NMCK_FIELD_LABELS = ("НМЦК", "НМЦК, ₽")
RUB_NUMBER_RE = re.compile(r"^\s*([+-]?[\d\s\u00a0\u202f]+(?:[.,]\d+)?)\s*(?:₽|руб(?:\.|лей|ля|ль)?|rub)?\s*$", re.IGNORECASE)


def field_scalar(value: object, seen: set[int] | None = None) -> str | int | float | None:
    """Read both current ``value`` and legacy ``text`` field envelopes."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (str, int, float)):
        return value
    if not isinstance(value, dict):
        return None
    seen = seen if seen is not None else set()
    marker = id(value)
    if marker in seen:
        return None
    seen.add(marker)
    for key in ("value", "text"):
        if key not in value:
            continue
        candidate = field_scalar(value[key], seen)
        if candidate is None:
            continue
        if isinstance(candidate, str) and not candidate.strip():
            continue
        return candidate
    return None


def rub_number(value: object) -> float | None:
    scalar = field_scalar(value)
    if isinstance(scalar, int):
        return float(scalar) if scalar >= 0 else None
    if isinstance(scalar, float):
        return scalar if math.isfinite(scalar) and scalar >= 0 else None
    if not isinstance(scalar, str):
        return None
    match = RUB_NUMBER_RE.fullmatch(scalar)
    if not match:
        return None
    try:
        result = float(re.sub(r"[\s\u00a0\u202f]", "", match.group(1)).replace(",", "."))
    except ValueError:
        return None
    return result if math.isfinite(result) and result >= 0 else None


def card_nmck_rub(value: object) -> float | None:
    if not isinstance(value, dict):
        return None
    card = value.get("card")
    fields = card.get("fields") if isinstance(card, dict) else None
    if not isinstance(fields, dict):
        return None
    for label in NMCK_FIELD_LABELS:
        result = rub_number(fields.get(label))
        if result is not None:
            return result
    return None


def with_derived_nmck(projection: dict, card: object) -> dict:
    """Fill a missing Core summary NMC from preserved card fields, without writing source data."""
    summary = projection.get("summary")
    summary = summary if isinstance(summary, dict) else {}
    existing = rub_number(summary.get("nmck_rub"))
    if existing is not None:
        return projection
    derived = card_nmck_rub(card)
    if derived is None:
        return projection
    result = dict(projection)
    result["summary"] = {**summary, "nmck_rub": derived}
    return result


def ranked_top20(offers: object, limit: int = 20) -> list[dict]:
    """Shortlist for active screens; equal scores sort by price ascending then source order."""
    rows = [row for row in offers if isinstance(row, dict)] if isinstance(offers, list) else []
    limit = max(0, int(limit))

    def score(row: dict) -> float:
        try:
            return float(str(row.get("match_score", row.get("score"))))
        except (TypeError, ValueError):
            return float("-inf")

    def price(row: dict) -> float:
        for val in (
            row.get("purchase_price"),
            (row.get("price") or {}).get("normalized_with_vat") if isinstance(row.get("price"), dict) else None,
            (row.get("price") or {}).get("source_with_vat") if isinstance(row.get("price"), dict) else None,
            (row.get("price") or {}).get("raw") if isinstance(row.get("price"), dict) else None,
        ):
            if val is not None and val != "":
                try:
                    num = float(str(val).replace(" ", "").replace(",", "."))
                    if num > 0:
                        return num
                except (ValueError, TypeError):
                    pass
        return float("inf")

    groups: dict[str, list[tuple[int, dict]]] = {}
    for index, row in enumerate(rows):
        groups.setdefault(str(row.get("line_id") or row.get("tender_line_id") or ""), []).append((index, row))
    result: list[dict] = []
    for group in groups.values():
        result.extend(row for _, row in sorted(group, key=lambda pair: (-score(pair[1]), price(pair[1]), pair[0]))[:limit])
    return result


def candidate_selection_metadata(source: object, offers: list[dict], all_offers: list[dict] | None = None) -> dict:
    """Expose lossless candidate counts without making a fit decision."""
    source = source if isinstance(source, dict) else {}
    source_rows = source.get("display_results")
    source_count = source.get("all_result_count")
    if type(source_count) is not int or source_count < 0:
        source_count = len(source_rows) if isinstance(source_rows, list) else 0
    full_rows = all_offers if isinstance(all_offers, list) else offers
    display_count = len(offers)
    all_count = max(source_count, len(full_rows))
    statuses = sorted({
        str(row.get("refresh_status") or row.get("fit_status") or row.get("normalization_status"))
        for row in full_rows
        if isinstance(row, dict)
        and (row.get("refresh_status") or row.get("fit_status") or row.get("normalization_status"))
    })
    selection = source.get("candidate_selection")
    selection = selection if isinstance(selection, dict) else {}
    return {
        "all_result_count": all_count,
        "display_result_count": display_count,
        "shown_result_count": display_count,
        "omitted_result_count": max(0, all_count - display_count),
        "source_statuses": statuses,
        "candidate_counts": source.get("candidate_counts") if isinstance(source.get("candidate_counts"), dict) else {},
        "candidate_selection": {
            **selection,
            "mode": selection.get("mode", "ranked_top20_display"),
            "rank_policy": selection.get("rank_policy", "match_score_then_source_order"),
            "fit_decision": selection.get("fit_decision", "NOT_CONFIRMED"),
            "full_response_retained": bool(selection.get("full_response_retained", True)),
        },
    }


def compact_projection_payload(value: object) -> object:
    """Remove duplicated candidate/source trees only from compact network views."""
    if isinstance(value, list):
        return [compact_projection_payload(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: compact_projection_payload(item)
        for key, item in value.items()
        if key not in {"line_results", "product_line_results", "SOURCE"}
    }


def download_media_type(value: object) -> str:
    media_type = str(value or "").split(";", 1)[0].strip().lower()
    return media_type if MEDIA_TYPE_RE.fullmatch(media_type) else "application/octet-stream"


def download_content_disposition(value: object) -> str:
    title = str(value or "document").replace("\\", "/").rsplit("/", 1)[-1]
    title = re.sub(r'[\x00-\x1f\x7f/:*?"<>|]', "_", title).strip().rstrip(". ") or "document"
    suffixes = "".join(Path(title).suffixes[-2:])
    if len(title) > 180:
        keep = max(1, 180 - len(suffixes))
        title = title[: len(title) - len(suffixes)][:keep].rstrip(". ") + suffixes
    fallback = re.sub(r"[^A-Za-z0-9._-]", "_", title) or "document"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(title, safe='')}"


class ArchiveActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: str = Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    reason_code: str
    reason_text: str = Field(max_length=500)

    @field_validator("reason_code")
    @classmethod
    def reason_is_known(cls, value: str) -> str:
        if value not in REASONS:
            raise ValueError("Неизвестная причина")
        return value

    @field_validator("reason_text")
    @classmethod
    def other_has_explanation(cls, value: str, info) -> str:
        if info.data.get("reason_code") == "OTHER" and not value:
            raise ValueError("Для причины «другое» требуется пояснение")
        return value


class SearchSettingsTypes(BaseModel):
    model_config = ConfigDict(extra="forbid")

    small: bool = False
    commercial: bool = False
    research: bool = False
    proposals: bool = False


class SearchSettingsStatuses(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cancelled: bool = False
    completed: bool = False


class SearchSettingsLots(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str | None = None
    shareEnabled: bool = False
    share: int = Field(default=50, ge=0, le=100)
    excludeUnsuitable: bool = False

    @field_validator("mode")
    @classmethod
    def mode_is_known(cls, value: str | None) -> str | None:
        if value not in {None, "ONLY_OUR", "ALLOW_MIXED", "EXCLUDE_MIXED", "MANUAL_REVIEW"}:
            raise ValueError("Неизвестный режим смешанных лотов")
        return value


class SearchSettingsPrice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minEnabled: bool = False
    min: float | None = Field(default=None, ge=0, le=1_000_000_000_000_000)
    maxEnabled: bool = False
    max: float | None = Field(default=None, ge=0, le=1_000_000_000_000_000)
    missingEnabled: bool = False
    missingAction: str = "MANUAL_REVIEW"

    @field_validator("missingAction")
    @classmethod
    def missing_action_is_known(cls, value: str) -> str:
        if value not in {"MANUAL_REVIEW", "EXCLUDE"}:
            raise ValueError("Неизвестное действие для цены без значения")
        return value


class SearchSettingsParticipation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    msp: bool = False
    smp: bool = False


class SearchSettingsDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    one: bool = False
    periodic: bool = False
    security: bool = False


class SearchSettingsRegions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    moscow: bool = False
    spb: bool = False
    mo: bool = False
    lo: bool = False
    all: bool = False


class SearchSettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    types: SearchSettingsTypes = Field(default_factory=SearchSettingsTypes)
    statuses: SearchSettingsStatuses = Field(default_factory=SearchSettingsStatuses)
    lots: SearchSettingsLots = Field(default_factory=SearchSettingsLots)
    price: SearchSettingsPrice = Field(default_factory=SearchSettingsPrice)
    participation: SearchSettingsParticipation = Field(default_factory=SearchSettingsParticipation)
    delivery: SearchSettingsDelivery = Field(default_factory=SearchSettingsDelivery)
    regions: SearchSettingsRegions = Field(default_factory=SearchSettingsRegions)

    @model_validator(mode="after")
    def price_range_is_valid(self) -> "SearchSettingsPayload":
        if self.price.minEnabled and self.price.min is None:
            raise ValueError("Для минимальной НМЦК требуется сумма")
        if self.price.maxEnabled and self.price.max is None:
            raise ValueError("Для максимальной НМЦК требуется сумма")
        if self.price.minEnabled and self.price.maxEnabled and self.price.min > self.price.max:
            raise ValueError("Минимальная НМЦК не может превышать максимальную")
        return self


class SearchSettingsWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    settings: SearchSettingsPayload
    comment: str = Field(default="", max_length=500)


class SearchClient:
    def __init__(self, service_url: str, token: str):
        self.service_url = service_url
        self.token = token

    def search(self, query: str) -> list[dict]:
        if not self.token:
            raise SearchUnavailable()
        try:
            response = httpx.get(
                f"{self.service_url.rstrip('/')}/internal/tender-search",
                params={"q": query},
                headers={"X-Internal-Tender-Token": self.token},
                timeout=4.0,
            )
        except httpx.HTTPError as exc:
            raise SearchUnavailable() from exc
        if response.status_code != 200:
            raise SearchUnavailable()
        payload = response.json()
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            raise SearchUnavailable()
        return [item for item in items if isinstance(item, dict)]


def create_app(config: Settings = settings, search_client: SearchClient | None = None) -> FastAPI:
    app = FastAPI(title="Тендерная панель", docs_url=None, redoc_url=None, openapi_url=None)
    public_prefix = config.public_prefix

    # 3.66 МБ реестра должны сжиматься уже на origin (публичный путь идёт через
    # SSH-туннель на VPS, где encode не настроен; gzip тут даёт ~10x на JSON).
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    @app.middleware("http")
    async def accept_prefixed_direct_requests(request: Request, call_next):
        """Mirror Caddy's strip_prefix for direct loopback consumers."""
        if public_prefix and (request.scope.get("path") or "/").startswith(public_prefix + "/"):
            path = request.scope["path"][len(public_prefix):] or "/"
            request.scope["path"] = path
            request.scope["raw_path"] = path.encode("ascii", "ignore")
        return await call_next(request)

    asset_root = config.html_path.parent
    if not (asset_root / "app.js").is_file():
        asset_root = asset_root / "runtime" / "assets"
    if not (asset_root / "app.js").is_file() or not (asset_root / "styles.css").is_file():
        raise RuntimeError("Не найден полный набор ассетов панели")
    app.mount("/static/assets", StaticFiles(directory=str(asset_root)), name="assets")
    app.state.repository = PanelRepository(config.protected_current, config.tenderman_projection_root)
    app.state.core_repository = CoreTenderRepository(config.core_db_path, config.core_card_overlay_path)
    app.state.search_client = search_client or SearchClient(config.search_service_url, config.internal_search_token)
    app.state.archive_store = ArchiveStore(config.archive_db_path)
    app.state.search_settings_store = SearchSettingsStore(config.search_settings_db_path)
    app.state.offers_refresh = OfferRefreshStore(config.offers_refresh_db, CanonicalSearch(config.offers_search_command,source_db=config.offers_source_db))
    app.state.registry_cache_key = None
    app.state.registry_cache_value = None
    app.state.config = config

    @app.on_event("startup")
    async def warm_core_read_model_cache() -> None:
        app.state.offers_refresh.recover_interrupted()
        try:
            app.state.archive_store.initialize()
        except Exception:
            pass
        try:
            app.state.search_settings_store.initialize()
        except Exception:
            pass
        # Pay the integrity-check/JSON parsing cost once at service start,
        # rather than on the first browser request after every restart.
        try:
            app.state.core_repository.visible_cards()
        except (OSError, ReleaseError):
            # /health keeps reporting the actual failure; startup must remain
            # available for diagnostics and does not alter any source data.
            pass

    @app.middleware("http")
    async def private_headers(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/search-settings"):
            user = request.headers.get(config.authenticated_header, "")
            if not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9._@-]{1,120}", user):
                return JSONResponse({"detail": "Требуется вход"}, status_code=401)
            if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                return JSONResponse({"detail": "Требуется JSON"}, status_code=415)
            if request.headers.get("origin", "").rstrip("/") not in config.allowed_origins:
                return JSONResponse({"detail": "Недопустимый источник запроса"}, status_code=403)
            if request.headers.get("X-Tender-Search-Settings-Action") != "search-settings-v1":
                return JSONResponse({"detail": "Не подтверждено действие настройки поиска"}, status_code=403)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/tenders/"):
            if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                return JSONResponse({"detail": "Требуется JSON"}, status_code=415)
            if request.headers.get("origin", "").rstrip("/") not in config.allowed_origins:
                return JSONResponse({"detail": "Недопустимый источник запроса"}, status_code=403)
            refresh = request.url.path.endswith("/offers-refresh")
            action_header = "X-Tender-Refresh-Action" if refresh else "X-Tender-Archive-Action"
            action_value = "offers-refresh-v1" if refresh else "manual-archive-v1"
            if request.headers.get(action_header) != action_value:
                return JSONResponse({"detail": "Не подтверждено действие обновления" if refresh else "Не подтверждено действие архива"}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
        return response

    def authenticated_proxy(request: Request) -> str:
        user = request.headers.get(config.authenticated_header, "")
        if not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9._@-]{1,120}", user):
            raise HTTPException(status_code=401, detail="Требуется вход")
        return user

    def write_request_guard(request: Request) -> None:
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise HTTPException(status_code=415, detail="Требуется JSON")
        origin = request.headers.get("origin", "").rstrip("/")
        if origin not in config.allowed_origins:
            raise HTTPException(status_code=403, detail="Недопустимый источник запроса")
        if request.headers.get("X-Tender-Archive-Action") != "manual-archive-v1":
            raise HTTPException(status_code=403, detail="Не подтверждено действие архива")

    def search_settings_write_guard(request: Request) -> None:
        if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise HTTPException(status_code=415, detail="Требуется JSON")
        if request.headers.get("origin", "").rstrip("/") not in config.allowed_origins:
            raise HTTPException(status_code=403, detail="Недопустимый источник запроса")
        if request.headers.get("X-Tender-Search-Settings-Action") != "search-settings-v1":
            raise HTTPException(status_code=403, detail="Не подтверждено действие настройки поиска")

    def archive_state(tender_id: str) -> dict:
        return app.state.archive_store.state(tender_id)

    def snapshot() -> PanelSnapshot:
        try:
            return app.state.repository.snapshot()
        except ReleaseError as exc:
            # Core карточки остаются открываемыми, когда независимый ценовой
            # snapshot недоступен; price-dependent views показывают warning.
            return PanelSnapshot(
                revision="core-only",
                prices={},
                suppliers={},
                tenders={},
                documents={},
                documents_root=config.document_checklist_source.parent,
                price_warning=f"Ценовой snapshot временно недоступен: {exc}",
            )

    def core_projection(
        tender_id: str,
        data: PanelSnapshot,
        *,
        already_visible: bool = False,
        compact_for_card_opening: bool = False,
    ) -> dict:
        # 25.10.2026: реестр (список) — только Core; прямой доступ сохраняем лишь
        # для НЕзарегистрированных карточек снимка (legacy). Зарегистрированная,
        # но скрытая пользователем карточка не оживает через прямой URL.
        if not already_visible and tender_id not in merged_tenders(data):
            registered_ids = {str(key) for key in app.state.core_repository.registered_tender_ids()}
            if tender_id in registered_ids or not isinstance(data.tenders.get(tender_id), dict):
                raise HTTPException(status_code=404, detail="Тендер не найден")
        try:
            projection = app.state.core_repository.projection(tender_id)
            if compact_for_card_opening and isinstance(projection, dict):
                candidates = projection.get('product_candidates')
                projection = {key:value for key,value in projection.items()
                              if key not in {'full_core_payload','product_candidates'}}
                if isinstance(candidates,dict):
                    projection['product_candidate_summary'] = {
                        key:candidates[key] for key in ('status','all_result_count','display_result_count','shown_result_count','omitted_result_count','query','source_statuses','candidate_selection','warnings')
                        if key in candidates}
            projection = public_business_data(projection)
            if not isinstance(projection, dict):
                raise ReleaseError("Некорректная подробная проекция")
            projection = copy.deepcopy(projection)
            candidates = projection.get("product_candidates")
            if isinstance(candidates, dict):
                source_candidates = copy.deepcopy(candidates)
                offers, warnings = refreshed_offers(tender_id, data)
                display_offers = ranked_top20(offers) if compact_for_card_opening else offers
                candidates["display_results"] = display_offers
                candidates.update(candidate_selection_metadata(source_candidates, display_offers, offers))
                candidates["refresh"] = {"job": app.state.offers_refresh.latest(tender_id)}
                projection.setdefault("warnings", []).extend(warnings)
            if getattr(data, "price_warning", None):
                projection.setdefault("visibility_warnings", []).append({
                    "code": "PRICE_SNAPSHOT_STALE",
                    "message": data.price_warning,
                    "blocks_visibility": False,
                })
            if compact_for_card_opening:
                # The browser already receives the current candidate list with the
                # detail card.  Do not send the same raw search result again, nor
                # the nested full core payload, when simply opening a card.
                # Both remain available in the explicit full-data export.
                candidates = projection.get("product_candidates")
                projection = {key: value for key, value in projection.items()
                              if key not in {"full_core_payload", "product_candidates"}}
                projection = compact_projection_payload(projection)
                if not isinstance(projection, dict):
                    raise ReleaseError("Некорректная компактная проекция")
            return projection
        except CoreTenderNotFound as exc:
            if tender_id in data.tenders:
                return {
                    "tender_id": tender_id,
                    "core_status": "INCOMPLETE",
                    "status": "Полная карточка не сформирована",
                    "summary": {"title": "Полная карточка не сформирована"},
                    "case": {"work_state": "Полный анализ не завершён"},
                    "sections": {},
                    "main_fields": [],
                    "technical_fields": [],
                    "source_coverage": [],
                    "conflicts": [],
                    "documents": [],
                    "visibility_warnings": [{
                        "code": "PRICE_SNAPSHOT_STALE",
                        "message": data.price_warning,
                        "blocks_visibility": False,
                    }] if getattr(data, "price_warning", None) else [],
                }
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc
        except ReleaseError:
            # Keep the visible card open when historical Core data is
            # incomplete.  A warning is safer than a misleading full card.
            return {
                    "tender_id": tender_id,
                    "core_status": "WARN",
                    "status": "Полная карточка временно недоступна",
                    "summary": {"title": "Полная карточка временно недоступна"},
                    "case": {"work_state": "Полный анализ не завершён"},
                    "sections": {},
                    "main_fields": [],
                    "technical_fields": [],
                    "source_coverage": [],
                    "conflicts": [],
                    "documents": [],
                    "warnings": [{
                        "code": "CORE_HISTORY_UNAVAILABLE",
                        "message": "Историческая полная карточка недоступна; доступные метаданные показаны отдельно",
                        "blocks_visibility": False,
                    }] + ([{
                        "code": "PRICE_SNAPSHOT_STALE",
                        "message": data.price_warning,
                        "blocks_visibility": False,
                    }] if getattr(data, "price_warning", None) else []),
                }

    def merged_tenders(data: PanelSnapshot) -> dict[str, dict]:
        stamp_reader = getattr(app.state.core_repository, "registry_stamp", None)
        core_stamp = stamp_reader() if callable(stamp_reader) else id(app.state.core_repository.visible_cards)
        cache_key = (id(data), core_stamp)
        if app.state.registry_cache_key == cache_key and isinstance(app.state.registry_cache_value, dict):
            return app.state.registry_cache_value
        try:
            core_cards = {
                card["tender_id"]: {key: value for key, value in card.items() if key != "tender_id"}
                for card in app.state.core_repository.visible_cards()
            }
        except ReleaseError:
            try:
                registered = {str(key) for key in app.state.core_repository.registered_tender_ids()}
            except Exception:
                registered = set()
            return {
                key: {**value, "visibility_warnings": [{"code": "CORE_UNAVAILABLE", "message": "Показана сохранённая редакция; Core временно недоступен", "blocks_visibility": False}]}
                for key, value in data.tenders.items()
                if key not in registered
            }
        # A user's explicit hide remains authoritative over an older snapshot.
        # 25.10.2026: реестр Core — единственный источник видимости; карточки
        # замороженного снимка tenders.json (15.09) без регистрации в Core
        # (42 шт.) больше не показываются как живые — только обогащают видимые.
        saved = {key: value for key, value in data.tenders.items() if key in core_cards}
        merged = merge_available(saved, core_cards)
        if getattr(data, "price_warning", None):
            for value in merged.values() if isinstance(merged, dict) else []:
                if isinstance(value, dict):
                    value.setdefault("visibility_warnings", []).append({"code": "PRICE_SNAPSHOT_STALE", "message": data.price_warning, "blocks_visibility": False})
        # Core is the canonical source of actual ТЗ rows. Snapshot rows are retained
        # only when Core has no rows; otherwise a list union can manufacture a
        # phantom aggregate row from an older saved title.
        for tender_id, core_card in core_cards.items():
            canonical_card = core_card.get("card") if isinstance(core_card, dict) else None
            canonical_lines = canonical_card.get("tender_lines") if isinstance(canonical_card, dict) else None
            merged_value = merged.get(tender_id) if isinstance(merged, dict) else None
            merged_card = merged_value.get("card") if isinstance(merged_value, dict) else None
            if isinstance(canonical_lines, list) and canonical_lines and isinstance(merged_card, dict):
                merged_card["tender_lines"] = copy.deepcopy(canonical_lines)
        app.state.registry_cache_key = cache_key
        app.state.registry_cache_value = merged
        return merged

    def merged_tender(data: PanelSnapshot, tender_id: str) -> dict | None:
        """Merge one saved card with one Core card without rebuilding the registry."""
        core_card = None
        core_unavailable = False
        try:
            card_reader = getattr(app.state.core_repository, "card", None)
            if callable(card_reader):
                core_card = card_reader(tender_id)
            else:
                core_card = next(
                    (card for card in app.state.core_repository.visible_cards()
                     if isinstance(card, dict) and str(card.get("tender_id")) == tender_id),
                    None,
                )
        except CoreTenderNotFound:
            core_card = None
        except ReleaseError:
            core_unavailable = True
        registered = {str(key) for key in app.state.core_repository.registered_tender_ids()}
        saved = data.tenders.get(tender_id)
        if tender_id in registered and core_card is None and not core_unavailable:
            return None
        merged = merge_available(
            {tender_id: saved} if isinstance(saved, dict) else {},
            {tender_id: core_card} if isinstance(core_card, dict) else {},
        ).get(tender_id)
        if not isinstance(merged, dict):
            return None
        if core_unavailable:
            merged.setdefault("visibility_warnings", []).append({
                "code": "CORE_UNAVAILABLE",
                "message": "Показана сохранённая редакция; Core временно недоступен",
                "blocks_visibility": False,
            })
        if getattr(data, "price_warning", None):
            merged.setdefault("visibility_warnings", []).append({"code": "PRICE_SNAPSHOT_STALE", "message": data.price_warning, "blocks_visibility": False})
        canonical_card = core_card.get("card") if isinstance(core_card, dict) else None
        canonical_lines = canonical_card.get("tender_lines") if isinstance(canonical_card, dict) else None
        if (not canonical_lines or not isinstance(canonical_lines, list)) and isinstance(core_card, dict):
            try:
                proj_reader = getattr(app.state.core_repository, "projection", None)
                if callable(proj_reader):
                    proj = proj_reader(tender_id)
                    if isinstance(proj, dict) and isinstance(proj.get("tender_lines"), list) and proj["tender_lines"]:
                        canonical_lines = proj["tender_lines"]
            except Exception:
                pass
        merged_card = merged.get("card")
        if isinstance(canonical_lines, list) and canonical_lines and isinstance(merged_card, dict):
            merged_card["tender_lines"] = copy.deepcopy(canonical_lines)
        return merged

    @app.get("/health")
    def health() -> JSONResponse:
        try:
            data = app.state.repository.snapshot()
            app.state.core_repository.visible_cards()
        except ReleaseError:
            return JSONResponse({"ok": False}, status_code=503)
        return JSONResponse({"ok": True, "revision": data.revision, "core": "ready"})

    @app.get("/tender/panel/static/fonts/{font_name}")
    @app.get("/static/fonts/{font_name}")
    def font_file(font_name: str, _: str = Depends(authenticated_proxy)) -> FileResponse:
        if not re.fullmatch(r"[A-Za-z0-9._-]+\.woff2", font_name):
            raise HTTPException(status_code=404, detail="Шрифт не найден")
        font_path = config.html_path.parent / "fonts" / font_name
        if not font_path.is_file():
            raise HTTPException(status_code=404, detail="Шрифт не найден")
        return FileResponse(font_path, media_type="font/woff2")

    def html_shell() -> HTMLResponse:
        return render_panel_html(config)

    @app.get("/", response_class=HTMLResponse)
    def index(_: str = Depends(authenticated_proxy)) -> HTMLResponse:
        return html_shell()

    @app.get("/tenders/{tender_id}", response_class=HTMLResponse)
    def tender_page(
        tender_id: str,
        _: str = Depends(authenticated_proxy),
        data: PanelSnapshot = Depends(snapshot),
    ) -> HTMLResponse:
        try:
            key = safe_id(tender_id)
        except ReleaseError as exc:
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc
        if merged_tender(data, key) is None:
            raise HTTPException(status_code=404, detail="Тендер не найден")
        return html_shell()

    @app.get("/api/products/search")
    def product_search(
        q: str = Query(min_length=1, max_length=160),
        _: str = Depends(authenticated_proxy),
        data: PanelSnapshot = Depends(snapshot),
    ) -> dict:
        query = q.strip()
        if len(query) < 2:
            return {"query": query, "items": []}
        # Сопоставления этой редакции приходят только из переданного закрытого
        # набора. Внешний поиск выключен, чтобы не показать поставщика вне
        # согласованного списка или коммерческие данные.
        return {"query": query, "items": []}

        # Защитный код ниже сохранён для отдельной будущей редакции с новым
        # проверенным выпуском поиска.
        try:
            raw_items = app.state.search_client.search(query)
        except SearchUnavailable as exc:
            raise HTTPException(status_code=503, detail="Поиск временно недоступен") from exc
        items = []
        for raw in raw_items:
            if FORBIDDEN_PRODUCT_KEYS.intersection(raw):
                raise HTTPException(status_code=503, detail="Поиск вернул недопустимые данные")
            product_id = raw.get("product_id")
            if isinstance(product_id, bool) or not isinstance(product_id, int) or product_id <= 0:
                continue
            items.append({
                "product_id": product_id,
                "name": str(raw.get("name") or "")[:500],
                "supplier": str(raw.get("supplier") or "")[:300],
                "article": str(raw.get("article") or "")[:160],
                "supplier_article": str(raw.get("supplier_article") or "")[:160],
                "match_type": str(raw.get("match_type") or "")[:30],
            })
        return {"query": query, "items": items}

    @app.get("/api/tenders")
    def tenders(_: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> dict:
        visible_tenders = merged_tenders(data)
        states = app.state.archive_store.states(list(visible_tenders))
        if not any(value.get("panel_bucket") for value in visible_tenders.values()):
            if getattr(data, "price_warning", None) and not visible_tenders:
                raise HTTPException(status_code=503, detail="Основная и ценовая проекции временно недоступны")
            return {"tenders": [{"tender_id": tender_id, "title": value.get("title", ""), "my_archive": states[tender_id]} for tender_id, value in visible_tenders.items()]}

        def registry_summary(value: dict) -> dict[str, object]:
            card_value = value.get("card")
            card = dict(card_value) if isinstance(card_value, dict) else {}
            fields_value = card.get("fields")
            fields = dict(fields_value) if isinstance(fields_value, dict) else {}
            registry_value = value.get("registry")
            existing_registry = dict(registry_value) if isinstance(registry_value, dict) else {}

            def field_value(label: str) -> str:
                raw = field_scalar(fields.get(label))
                return str(raw).strip() if raw is not None else ""

            def machine_value(key: str, fallback):
                return existing_registry[key] if key in existing_registry else fallback

            def machine_text(key: str, fallback: str) -> str:
                raw = machine_value(key, fallback)
                return str(raw).strip() if raw is not None else ""

            deadline_provenance = existing_registry.get("provenance")
            deadline_provenance = deadline_provenance.get("submission_deadline") if isinstance(deadline_provenance, dict) else {}
            if not isinstance(deadline_provenance, dict):
                deadline_provenance = {}
            deadline_provenance = {
                key: deadline_provenance[key]
                for key in ("source_kind", "source", "source_url", "checked_at", "timezone")
                if key in deadline_provenance
            }
            platform_numbers = existing_registry.get("platform_numbers", [])
            if not isinstance(platform_numbers, list):
                platform_numbers = []

            nmck_raw = machine_value("nmck_rub", existing_registry.get("nmck"))
            nmck_rub = rub_number(nmck_raw)
            if "nmck_rub" not in existing_registry and nmck_rub is None:
                nmck_rub = rub_number(existing_registry.get("nmck"))
            if nmck_rub is None:
                nmck_rub = card_nmck_rub(value)

            return {
                "law": machine_text("law", field_value("Закон")),
                "nmck": machine_text("nmck", field_value("НМЦК") or field_value("НМЦК, ₽")),
                "nmck_rub": nmck_rub,
                "region": machine_text("region", field_value("Регион закупки") or field_value("Регион поставки")),
                "official_status": machine_text("official_status", field_value("Официальный статус") or str(value.get("official_status") or "")),
                "official_checked_at": machine_text("official_checked_at", str(value.get("official_checked_at") or "")),
                "official_status_verification": machine_text("official_status_verification", ""),
                "phase": machine_text("phase", field_value("Этап работы") or field_value("Этап кейса")).replace("PANEL_READY", "") or machine_text("official_status", field_value("Официальный статус") or "Этап не определён"),
                "submission_deadline": machine_text("submission_deadline", str(value.get("submission_deadline") or "")),
                "submission_deadline_verification": machine_text("submission_deadline_verification", ""),
                "provenance": {"submission_deadline": deadline_provenance},
                "platform_numbers": platform_numbers,
                "filter_fields": {label: fields[label] for label in (
                    "График поставок", "Количество партий поставки", "Поставка", "Период исполнения контракта",
                    "Особые условия исполнения", "Требования к участнику", "Ограничения участия", "Преимущества участникам"
                ) if label in fields},
                "blocked": card.get("required_parties_status") == "BLOCKED",
                "block_reason": field_value("Причина остановки") or str(card.get("required_parties_block_reason") or ""),
            }

        fields = ("tender_id", "title", "number", "customer", "submission_deadline", "panel_bucket")
        return {"tenders": [
            {
                **{field: tender_id if field == "tender_id" else value.get(field, "") for field in fields},
                "registry": registry_summary(value),
                "my_archive": states[tender_id],
            }
            for tender_id, value in visible_tenders.items()
        ]}

    @app.get("/api/search-settings")
    def get_search_settings(_: str = Depends(authenticated_proxy)) -> dict:
        return app.state.search_settings_store.current()

    @app.put("/api/search-settings")
    def save_search_settings(
        payload: SearchSettingsWriteRequest,
        request: Request,
        actor: str = Depends(authenticated_proxy),
    ) -> dict:
        search_settings_write_guard(request)
        return app.state.search_settings_store.save(
            payload.settings.model_dump(mode="json"), actor=actor, comment=payload.comment
        )

    @app.get("/api/search-settings/history")
    def search_settings_history(_: str = Depends(authenticated_proxy)) -> dict:
        return {"items": app.state.search_settings_store.history()}

    @app.post("/api/search-settings/restore/{version}")
    def restore_search_settings(
        version: int,
        request: Request,
        actor: str = Depends(authenticated_proxy),
    ) -> dict:
        search_settings_write_guard(request)
        try:
            return app.state.search_settings_store.restore(version, actor=actor)
        except SearchSettingsVersionNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/search-settings/reset")
    def reset_search_settings(request: Request, actor: str = Depends(authenticated_proxy)) -> dict:
        search_settings_write_guard(request)
        return app.state.search_settings_store.reset(actor=actor)

    @app.get("/api/tenders/{tender_id}")
    def tender(tender_id: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot), view: str | None = Query(default=None)) -> dict:
        try:
            key = safe_id(tender_id)
        except ReleaseError as exc:
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc
        value = merged_tender(data, key)
        if value is None:
            raise HTTPException(status_code=404, detail="Тендер не найден")
        if view in {"screen", "bundle"} and isinstance(value.get("card"), dict) and app.state.offers_refresh.latest(key) is not None:
            value = copy.deepcopy(value)
            card = value["card"]
            offers, warnings = refreshed_offers(key, data)
            display_offers = public_business_data(ranked_top20(offers) if view == "screen" else offers)
            card["supplier_offers"] = display_offers
            try:
                source_projection = app.state.core_repository.projection(key)
                source_candidates = source_projection.get("product_candidates") if isinstance(source_projection, dict) else {}
                source_candidates = source_candidates if isinstance(source_candidates, dict) else {}
            except (CoreTenderNotFound, ReleaseError):
                source_candidates = {}
            card.update(candidate_selection_metadata(source_candidates, display_offers, offers))
            existing_warnings = value.get("warnings")
            value = {
                **value,
                "warnings": [*(existing_warnings if isinstance(existing_warnings, list) else []), *warnings],
            }
        if view == "summary":
            card = value.get("card") if isinstance(value, dict) else None
            if isinstance(card, dict) and isinstance(card.get("supplier_offers"), list):
                value = {**value, "card": {
                    key: item for key, item in card.items()
                    if key != "product_line_results"
                }}
                value["card"]["supplier_offers"] = []
            compacted = compact_projection_payload(value)
            value = compacted if isinstance(compacted, dict) else value
        return {"tender_id": key, **value, "my_archive": archive_state(key)}

    @app.get("/api/tenders/{tender_id}/candidates")
    def tender_candidates(tender_id: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot), view: str | None = Query(default=None)) -> dict:
        try:
            key = safe_id(tender_id)
            if key not in data.tenders and not app.state.core_repository.is_visible(key):
                raise HTTPException(status_code=404, detail="Тендер не найден")
            if view is None:
                # The default endpoint is the exact saved source combination.
                # Refresh history is exposed only by explicit screen/bundle views.
                offers = refresh_source(key, data)[1]
                warnings = []
            else:
                offers, warnings = refreshed_offers(key, data)
            public_offers_raw = public_business_data(ranked_top20(offers) if view == "screen" else offers)
            public_offers: list[dict] = [row for row in public_offers_raw if isinstance(row, dict)] if isinstance(public_offers_raw, list) else []
            try:
                projection = app.state.core_repository.projection(key)
                source_candidates = projection.get("product_candidates") if isinstance(projection, dict) else {}
            except (CoreTenderNotFound, ReleaseError):
                source_candidates = {}
            return {"supplier_offers": public_offers,
                    **candidate_selection_metadata(source_candidates, public_offers, offers),
                    "warnings": warnings,
                    "refresh": {"job": app.state.offers_refresh.latest(key)}}
        except CoreTenderNotFound as exc:
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc
        except ReleaseError as exc:
            raise HTTPException(status_code=503, detail="Сопоставления временно недоступны") from exc

    @app.get("/api/tenders/{tender_id}/earnings")
    def tender_earnings(
        tender_id: str,
        _: str = Depends(authenticated_proxy),
        data: PanelSnapshot = Depends(snapshot),
    ) -> dict:
        try:
            key = safe_id(tender_id)
        except ReleaseError as exc:
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc

        value = merged_tender(data, key)
        if value is None:
            raise HTTPException(status_code=404, detail="Тендер не найден")

        card = copy.deepcopy(value.get("card") or {})
        card["tender_id"] = key
        if "fields" in value and "fields" not in card:
            card["fields"] = value["fields"]

        try:
            projection = app.state.core_repository.projection(key)
            source_candidates = projection.get("product_candidates") if isinstance(projection, dict) else {}
        except (CoreTenderNotFound, ReleaseError):
            source_candidates = {}

        card_selection = card.get("candidate_selection")
        if not isinstance(card_selection, dict) or not card_selection:
            card["candidate_selection"] = source_candidates.get("candidate_selection") if isinstance(source_candidates, dict) else {}

        offers, refresh_warnings = refreshed_offers(key, data)
        public_offers_raw = public_business_data(ranked_top20(offers))
        public_offers: list[dict] = [row for row in public_offers_raw if isinstance(row, dict)] if isinstance(public_offers_raw, list) else []

        logistics_reader = getattr(app.state, "preliminary_logistics_reader", None)
        logistics_data: dict[str, object] | None = None
        logistics_error: str | None = None
        if callable(logistics_reader):
            try:
                res = logistics_reader(key)
                if isinstance(res, dict):
                    logistics_data = res
            except Exception as exc:
                logistics_error = f"Ошибка чтения логистики: {type(exc).__name__}"
                logistics_data = None
        else:
            logistics_error = "Калькулятор логистики не подключён"

        result = calculate_preliminary_earnings(card, public_offers, logistics_data)
        if logistics_error and not logistics_data and logistics_error not in result.get("blockers", []):
            result.setdefault("blockers", []).append(logistics_error)
        return result

    def refresh_source(tender_id: str, data: PanelSnapshot | None = None) -> tuple[list,list,str]:
        data = data or app.state.repository.snapshot()
        value = merged_tender(data, tender_id)
        if value is None:
            raise HTTPException(status_code=404, detail="Тендер не найден")
        lines = copy.deepcopy(value.get("card", {}).get("tender_lines", []))
        try:
            projection_reader = getattr(app.state.core_repository,'projection',None)
            projection = projection_reader(tender_id) if callable(projection_reader) else {}
        except (CoreTenderNotFound,ReleaseError):
            projection = {}
        candidates = projection.get('product_candidates') or {}
        core_offers = candidates.get('display_results',[]) if isinstance(candidates,dict) else []
        source = combine_sources(core_offers, value.get('card',{}).get('supplier_offers',[]))
        return lines, source, fingerprint({'lines':lines,'offers':source})

    def refreshed_offers(tender_id: str, data: PanelSnapshot) -> tuple[list,list]:
        lines, source, revision = refresh_source(tender_id, data)
        return app.state.offers_refresh.merge(tender_id,lines,source,source_revision=revision)

    def build_sourcing_records():
        data = app.state.repository.snapshot()
        core, refresh = app.state.core_repository, app.state.offers_refresh
        stamp_reader = getattr(core, 'registry_stamp', None)

        def source_stamp():
            # Include SQLite sidecars: a committed refresh can live only in WAL.
            files = []
            for suffix in ('', '-wal', '-journal'):
                try:
                    stat = Path(str(refresh.path) + suffix).stat()
                    # SQLite readers can change WAL ctime without changing data.
                    files.append((stat.st_ino, stat.st_size, stat.st_mtime_ns))
                except FileNotFoundError:
                    files.append(None)
            return (app.state.repository, data, core, stamp_reader(), refresh, tuple(files))

        # Unknown adapters cannot promise invalidation; never cache them by id.
        stamp = source_stamp() if callable(stamp_reader) else None
        cached = getattr(app.state, 'sourcing_records_cache', None)
        if stamp is not None and cached is not None and cached[0] == stamp:
            return cached[1]
        narrow_reader = getattr(core, 'sourcing_cards', None)
        products = None
        if callable(narrow_reader):
            narrow_cards = narrow_reader()
            products = {row['tender_id']: row.get('product_candidates', {}) for row in narrow_cards}
            core_cards = {row['tender_id']: {key: value for key, value in row.items()
                          if key not in ('tender_id', 'product_candidates')} for row in narrow_cards}
            registered = {str(key) for key in core.registered_tender_ids()}
            saved = {}
            for key, value in data.tenders.items():
                if key in registered and key not in core_cards:
                    continue
                saved_card = value.get('card') or {}
                saved[key] = {**{field: value[field] for field in ('title', 'registry', 'submission_deadline') if field in value},
                              'card': {field: saved_card[field] for field in ('tender_lines', 'supplier_offers', 'product_line_results') if field in saved_card}}
            values = merge_available(saved, core_cards)
            for key, value in core_cards.items():
                lines = value.get('card', {}).get('tender_lines')
                if isinstance(lines, list) and lines:
                    values[key]['card']['tender_lines'] = lines
        else:
            values = merged_tenders(data)  # Compatibility with older/test adapters.
        result = []
        for key, value in values.items():
            card = value.get('card', {})
            if not card.get('tender_lines'):
                continue
            try:
                reader = getattr(core, 'card', None)
                full = reader(key) if products is None and callable(reader) else value
            except (CoreTenderNotFound, ReleaseError):
                full = value
            full_card = full.get('card', {})
            lines = full_card.get('tender_lines') or card.get('tender_lines', [])
            # Merge only the source collections this view consumes, not full_data,
            # fields, issues and nested copies of every historical candidate.
            saved_card = data.tenders.get(key, {}).get('card', {})
            saved_offers = saved_card.get('supplier_offers', [])
            full_offers = full_card.get('supplier_offers', [])
            source_offers = (full_offers if products is not None else
                            merge_available(saved_offers, full_offers) if saved_offers and full_offers
                             else full_offers or saved_offers)
            try:
                projection = core.projection(key) if products is None else {'product_candidates': products.get(key, {})}
            except (CoreTenderNotFound, ReleaseError):
                projection = {}
            product = projection.get('product_candidates') or {}
            core_offers = product.get('display_results', []) if isinstance(product, dict) else []
            source = combine_sources(core_offers, source_offers)
            search_revision = fingerprint({'lines': lines, 'offers': source})
            source_revision = fingerprint(lines)
            with refresh.db() as connection:
                saved = connection.execute('SELECT * FROM offers_refresh_results WHERE tender_id=?', (key,)).fetchall()
            # combine_sources already owns this list. With no saved refresh there
            # is nothing to overlay and no reason to deepcopy all histories again.
            offers = refresh.merge(key, lines, source, source_revision=search_revision)[0] if saved else source
            line_results = product.get('line_results', []) if isinstance(product, dict) else []
            if not line_results:
                line_results = card.get('product_line_results', [])
            refreshed = [dict(line_id=row['line_id'], source_revision=source_revision,
                              run_id=row['run_id'], results=json.loads(row['results']))
                         for row in saved if row['source_revision'] == search_revision]
            registry = value.get('registry') or {}
            region = registry.get('region', '') if isinstance(registry, dict) else ''
            result.append(dict(tender_id=key, title=value.get('title', ''), region=region if isinstance(region, str) else '',
                deadline=value.get('submission_deadline'), source_revision=source_revision, lines=lines,
                offers=offers, line_results=line_results if isinstance(line_results, list) else [],
                refresh_results=refreshed))
        if stamp is not None:
            if source_stamp() != stamp:
                raise HTTPException(status_code=503, detail='Исходные данные изменились во время чтения; повтори запрос', headers={'Retry-After': '1'})
            app.state.sourcing_records_cache = (stamp, result)
        return result

    # ponytail: one build per process; separate workers keep their own caches.
    sourcing_records_lock = threading.Lock()

    def sourcing_records():
        with sourcing_records_lock:
            try:
                return build_sourcing_records()
            except (ReleaseError, OSError, sqlite3.Error) as exc:
                raise HTTPException(status_code=503, detail='Исходные данные временно недоступны; повтори запрос',
                                    headers={'Retry-After': '1'}) from exc

    attach_sourcing_routes(app, config, authenticated_proxy, sourcing_records, refresh_source, html_shell)

    @app.get("/api/tenders/{tender_id}/offers-refresh")
    def offers_refresh_status(tender_id: str, _: str = Depends(authenticated_proxy)) -> dict:
        try: key = safe_id(tender_id)
        except ReleaseError: raise HTTPException(status_code=404,detail="Тендер не найден") from None
        refresh_source(key)
        return {"job": app.state.offers_refresh.latest(key)}

    @app.post("/api/tenders/{tender_id}/offers-refresh", status_code=202)
    def offers_refresh(tender_id: str, payload: RefreshRequest, request: Request,
                       tasks: BackgroundTasks, actor: str = Depends(authenticated_proxy)) -> dict:
        request_id = request.headers.get("X-Request-ID", "")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{7,79}", request_id):
            raise HTTPException(status_code=400, detail="Нужен идентификатор запроса")
        try: key = safe_id(tender_id)
        except ReleaseError: raise HTTPException(status_code=404,detail="Тендер не найден") from None
        try:
            lines, _, revision = refresh_source(key)
            job, started = app.state.offers_refresh.start(key, lines, request_id, actor, source_revision=revision)
        except RefreshError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if started:
            tasks.add_task(app.state.offers_refresh.run, job["job_id"], lambda: refresh_source(key)[0], lambda: refresh_source(key)[2])
        return {"job": job}

    @app.get("/api/tenders/{tender_id}/core")
    def tender_core(tender_id: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> dict:
        try:
            key = safe_id(tender_id)
        except ReleaseError as exc:
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc
        return with_derived_nmck(
            core_projection(key, data, compact_for_card_opening=True),
            merged_tenders(data).get(key),
        )

    def full_bundle(tender_id: str, data: PanelSnapshot) -> dict:
        detail = tender(tender_id, _="bundle", data=data, view="bundle")
        warnings = []
        try:
            core_data = core_projection(tender_id, data, already_visible=True)
        except HTTPException:
            core_data = None
            warnings.append({"code":"CORE_UNAVAILABLE", "blocks_visibility":False})
        try:
            docs = tender_documents(tender_id, "bundle", data)["documents"]
        except (HTTPException, ReleaseError):
            docs = (core_data or {}).get("documents", [])
            warnings.append({"code":"DOCUMENT_LIST_UNAVAILABLE", "blocks_visibility":False})
        for source in (detail, detail.get("card", {}), core_data or {}):
            for key in ("visibility_warnings", "warnings"):
                for warning in source.get(key, []) if isinstance(source.get(key), list) else []:
                    if isinstance(warning, dict): warnings.append({**warning, "blocks_visibility":False})
        for offer in detail.get("card", {}).get("supplier_offers", []):
            status = offer.get("normalization_status") or offer.get("fit_status")
            if status in {"BLOCKED", "REVIEW", "STALE", "PARTIAL", "CONFLICT"} or offer.get("calculation_blockers"):
                warnings.append({"code":"SUPPLIER_OFFER_REVIEW", "source_status":status,
                    "message":f"Предложение «{offer.get('product_name') or offer.get('price_registry_id') or 'без названия'}»: требуется проверка; исходная цена показана без подтверждения пригодности для расчёта.",
                    "blocks_visibility":False})
        for doc in docs:
            if doc.get("warning") or not doc.get("open_url"):
                warnings.append({"code":"DOCUMENT_UNAVAILABLE", "entity_id":doc.get("document_id"),
                    "message":f"Документ «{doc.get('title') or doc.get('document_id')}»: {doc.get('warning') or 'оригинал недоступен'}", "blocks_visibility":False})
        warnings = public_business_data({"items":warnings})["items"]
        values = public_business_data({"detail":detail, "core":core_data, "documents":docs})
        paths = [row["path"] for row in leaf_rows(values)]
        return {"policy_id":"tender-data-visibility-v1", "tender_id":tender_id,
                "data":values, "warnings":warnings,
                "coverage":{"source":None, "stored":None, "completeness":"UNKNOWN",
                            "api_paths":paths, "publication_decision":"PUBLISH_WITH_WARNINGS"}}

    @app.get("/api/tenders/{tender_id}/full-data.json")
    def full_data_json(tender_id: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> JSONResponse:
        bundle = full_bundle(tender_id, data)
        return JSONResponse(bundle, headers={"Content-Disposition":f'attachment; filename="tender-{safe_id(tender_id)}-full.json"'})

    @app.get("/api/tenders/{tender_id}/full-data.xlsx")
    def full_data_xlsx(tender_id: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> Response:
        bundle = full_bundle(tender_id, data)
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Все полученные данные"
        sheet.append(["Путь JSON", "Часть", "Значение JSON"])
        row_number = 1
        for row in leaf_rows(bundle["data"]):
            value = json.dumps(row["value"], ensure_ascii=False)
            for index in range(0, len(value), 30000):
                if row_number >= 1048575:
                    sheet = workbook.create_sheet()
                    sheet.append(["Путь JSON", "Часть", "Значение JSON"])
                    row_number = 1
                row_number += 1
                for column, text in enumerate([row["path"], str(index // 30000 + 1), value[index:index+30000]], 1):
                    cell = sheet.cell(row_number, column, text)
                    cell.data_type = "s"
        for ws in workbook:
            ws.freeze_panes = "A2"
            ws.column_dimensions["A"].width = 65
            ws.column_dimensions["C"].width = 100
        meta = workbook.create_sheet("Полнота и предупреждения")
        meta_row = 0
        for k,v in {"coverage":bundle["coverage"],"warnings":bundle["warnings"]}.items():
            for row in leaf_rows(v,k):
                meta_row += 1
                for column,text in enumerate([row["path"], json.dumps(row["value"],ensure_ascii=False)],1):
                    cell = meta.cell(meta_row,column,text)
                    cell.data_type = "s"
        stream=BytesIO(); workbook.save(stream)
        return Response(stream.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition":f'attachment; filename="tender-{safe_id(tender_id)}-full.xlsx"'})

    @app.get("/api/tenders/{tender_id}/technical-fields.xlsx")
    def technical_fields_xlsx(
        tender_id: str,
        _: str = Depends(authenticated_proxy),
        data: PanelSnapshot = Depends(snapshot),
    ) -> Response:
        """Export technical fields and source identifiers of a visible Core tender."""
        try:
            key = safe_id(tender_id)
        except ReleaseError as exc:
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc
        projection = core_projection(key, data)
        technical_fields = projection.get("technical_fields")
        source_sections = projection.get("sections", {}).get("SOURCE", {}) if isinstance(projection.get("sections"), dict) else {}
        if not isinstance(technical_fields, list) or not isinstance(source_sections, dict):
            raise HTTPException(status_code=503, detail="Технические данные временно недоступны")

        normalized: list[tuple[str, str, str, str, str, str]] = []
        fields = [*sorted(technical_fields, key=lambda item: item.get("sort_order", 0) if isinstance(item, dict) else 0)]
        for items in source_sections.values():
            if not isinstance(items, list):
                raise HTTPException(status_code=503, detail="Технические данные временно недоступны")
            fields.extend(items)
        for field in fields:
            if not isinstance(field, dict):
                raise HTTPException(status_code=503, detail="Технические данные временно недоступны")
            name = str(field.get("name") or "").strip()
            if not name:
                raise HTTPException(status_code=503, detail="Технические данные временно недоступны")
            value = field.get("value")
            if isinstance(value, (dict, list)):
                value_text = json.dumps(value, ensure_ascii=False)
            else:
                value_text = "НЕ ПРОВЕРЕНО" if value is None or str(value).strip() == "" else str(value)
            definition = field.get("field_definition") if isinstance(field.get("field_definition"), dict) else {}
            code = str(field.get("field_key") or field.get("semantic_code") or definition.get("code") or "НЕ УКАЗАН")
            semantic = str(field.get("semantic_key") or definition.get("semantic_key") or "НЕ УКАЗАН")
            section = str(field.get("section") or field.get("layer") or field.get("group") or "TECHNICAL")
            status_source = " · ".join(str(item) for item in (
                field.get("status"),
                f"Источник: {field['source']}" if field.get("source") else None,
                f"Сбор: {field['collection_state']}" if field.get("collection_state") else None,
                f"Подтверждение: {field['verification_status']}" if field.get("verification_status") else None,
            ) if item)
            normalized.append((name, code, semantic, section, value_text, status_source or "НЕ УКАЗАН") )

        workbook = Workbook()
        worksheet = workbook.active
        if worksheet is None:
            raise HTTPException(status_code=503, detail="Экспорт технических данных недоступен")
        worksheet.title = "Технические данные"
        worksheet.append(["Название реквизита", "Код", "Семантический ключ", "Раздел", "Данные", "Статус / источник"])
        for row in normalized:
            worksheet.append(list(row))
        for row in worksheet.iter_rows():
            for cell in row:
                cell.font = Font(name="Arial")
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                cell.data_type = "s"
        for cell in worksheet[1]:
            cell.font = Font(name="Arial", bold=True)
        worksheet.freeze_panes = "A2"
        worksheet.auto_filter.ref = f"A1:F{len(normalized) + 1}"
        worksheet.column_dimensions["A"].width = 42
        worksheet.column_dimensions["B"].width = 24
        worksheet.column_dimensions["C"].width = 34
        worksheet.column_dimensions["D"].width = 18
        worksheet.column_dimensions["E"].width = 100
        worksheet.column_dimensions["F"].width = 42
        stream = BytesIO()
        workbook.save(stream)
        filename = f"tender-{key}-technical-fields.xlsx"
        return Response(
            stream.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/api/archive")
    def archive(_: str = Depends(authenticated_proxy)) -> dict:
        return app.state.archive_store.archive_listing()

    def apply_archive_action(tender_id: str, action: str, payload: ArchiveActionRequest, request: Request, actor: str, data: PanelSnapshot) -> dict:
        write_request_guard(request)
        try:
            key = safe_id(tender_id)
        except ReleaseError as exc:
            raise HTTPException(status_code=404, detail="Тендер не найден") from exc
        tender_value = merged_tenders(data).get(key)
        if tender_value is None:
            raise HTTPException(status_code=404, detail="Тендер не найден")
        try:
            actual, replay = app.state.archive_store.append(
                request_id=payload.request_id, tender_id=key, action=action,
                reason_code=payload.reason_code, reason_text=payload.reason_text,
                actor=actor, projection_revision=data.revision, tender=tender_value,
            )
        except ArchiveError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"tender_id": key, "archive": actual, "idempotent_replay": replay}

    @app.post("/api/tenders/{tender_id}/archive")
    def archive_tender(tender_id: str, payload: ArchiveActionRequest, request: Request, actor: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> dict:
        return apply_archive_action(tender_id, "ARCHIVE", payload, request, actor, data)

    @app.post("/api/tenders/{tender_id}/restore")
    def restore_tender(tender_id: str, payload: ArchiveActionRequest, request: Request, actor: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> dict:
        return apply_archive_action(tender_id, "RESTORE", payload, request, actor, data)

    @app.get("/api/tenders/{tender_id}/documents")
    def tender_documents(tender_id: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> dict:
        safe_tender_id = safe_id(tender_id)
        try:
            is_visible_core = app.state.core_repository.is_visible(safe_tender_id)
        except ReleaseError:
            if safe_tender_id in data.tenders:
                return {"documents": [], "warnings": [{
                    "code": "DOCUMENT_HISTORY_UNAVAILABLE",
                    "message": "Исторические документы недоступны; доступные метаданные сохранены в карточке",
                    "blocks_visibility": False,
                }]}
            raise HTTPException(status_code=503, detail="Документы временно недоступны")
        if is_visible_core:
            try:
                docs = app.state.core_repository.documents(safe_tender_id, config.public_prefix)
                doc_warnings = [
                    {"code": "DOCUMENT_WARNING", "message": f"{doc.get('title', doc.get('document_id'))}: {doc['warning']}", "blocks_visibility": False}
                    for doc in docs if isinstance(doc, dict) and doc.get("warning")
                ]
                return {"documents": docs, "warnings": doc_warnings}
            except ReleaseError:
                return {"documents": [], "warnings": [{
                    "code": "DOCUMENT_HISTORY_UNAVAILABLE",
                    "message": "Исторические документы недоступны; метаданные документа не подтверждены",
                    "blocks_visibility": False,
                }]}
        if safe_tender_id not in merged_tenders(data):
            raise HTTPException(status_code=404, detail="Тендер не найден")
        documents = []
        for document in data.documents.values():
            if document["tender_id"] == safe_tender_id:
                documents.append({
                    "document_id": document["document_id"],
                    "tender_id": safe_tender_id,
                    "title": document["title"],
                    "role": document["role"],
                    "revision": document["revision"],
                    "published_at": document["published_at"],
                    "loaded_at": document["loaded_at"],
                    "size_bytes": document["size_bytes"],
                    "media_type": document["media_type"],
                    "extraction_status": document["extraction_status"],
                    "open_url": f"{config.public_prefix}/documents/{document['document_id']}" if document.get("path") else None,
                    "warning": document.get("warning", ""),
                })
        return {"documents": documents}

    @app.get("/documents/{document_id}")
    def document(document_id: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> Response:
        if document_id.isdecimal():
            try:
                blob, item = app.state.core_repository.document_blob(document_id)
            except ReleaseError as exc:
                raise HTTPException(status_code=404, detail="Документ не найден") from exc
            media_type = download_media_type(item["media_type"])
            title = item["original_file_name"] or item["title"]
            content_disposition = download_content_disposition(title)
            return Response(blob, media_type=media_type, headers={"Content-Disposition": content_disposition})
        document_item = data.documents.get(safe_id(document_id))
        if document_item is None or not document_item.get("path") or document_item["tender_id"] not in merged_tenders(data):
            raise HTTPException(status_code=404, detail="Документ не найден")
        path = Path(document_item["path"]).resolve()
        try:
            path.relative_to(data.documents_root)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail="Документ временно недоступен") from exc
        from .repository import sha256
        if not path.is_file() or sha256(path) != document_item["sha256"]:
            raise HTTPException(status_code=409, detail="Документ временно недоступен")
        media_type = download_media_type(document_item["media_type"])
        content_disposition = download_content_disposition(document_item["title"])
        return FileResponse(path, media_type=media_type, headers={"Content-Disposition": content_disposition})

    @app.get("/api/suppliers/{supplier_key}")
    def supplier(supplier_key: str, _: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> dict:
        key = safe_id(supplier_key)
        if not any(value.get("panel_bucket") for value in data.tenders.values()):
            value = data.suppliers.get(key)
            if value is None:
                raise HTTPException(status_code=404, detail="Поставщик не найден")
            contract_id = value["contract_document_id"]
            return {"supplier_key": key, **value, "contract_open_url": f"{config.public_prefix}/documents/{contract_id}" if contract_id in data.documents else ""}
        from .repository import public_supplier_key
        allowed = sorted({
            str(offer.get("supplier") or "")
            for tender in data.tenders.values()
            for offer in tender.get("card", {}).get("supplier_offers", [])
            if str(offer.get("supplier") or "")
        })
        name = next((item for item in allowed if public_supplier_key(item) == key), None)
        if name is None:
            raise HTTPException(status_code=404, detail="Поставщик не найден")
        return {
            "supplier_key": key,
            "supplier_name": name,
            "data_status": "RECHECK",
        }

    @app.get("/api/suppliers")
    def suppliers(_: str = Depends(authenticated_proxy), data: PanelSnapshot = Depends(snapshot)) -> dict:
        if not any(value.get("panel_bucket") for value in data.tenders.values()):
            return {"suppliers": [{"supplier_key": key, "supplier_name": value["supplier_name"], "data_status": value["data_status"]} for key, value in sorted(data.suppliers.items(), key=lambda item: item[1]["supplier_name"].casefold())]}
        from .repository import public_supplier_key
        allowed = sorted({
            str(offer.get("supplier") or "")
            for tender in data.tenders.values()
            for offer in tender.get("card", {}).get("supplier_offers", [])
            if str(offer.get("supplier") or "")
        }, key=str.casefold)
        return {
            "suppliers": [
                {
                    "supplier_key": public_supplier_key(name),
                    "supplier_name": name,
                    "data_status": "RECHECK",
                }
                for name in allowed
            ]
        }

    return app


app = create_app()
