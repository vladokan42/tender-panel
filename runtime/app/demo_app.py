from __future__ import annotations

import gzip
import hashlib
import ipaddress
import json
import os
import re
import sqlite3
from contextlib import closing
from dataclasses import replace
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .address_registry import AddressRegistry
from .dellin import DellinCalculator, DellinError, DellinInput
from .delivery_address import collect_delivery_addresses, normalize_delivery_address
from .logistics_calculation import PRELIMINARY_CARGO, cargo_volume_m3, nonnegative_decimal, preliminary_missing, preliminary_split, preliminary_split_missing, positive_decimal
from .logistics_routing import LogisticsRouteError, LogisticsRouteResolver, osrm_route_url
from .logistics_store import LogisticsStore
from .main import create_app, render_panel_html
from .repository import ReleaseError
from .calculation_journal import CalculationJournal
from .document_checklist import DocumentChecklistStore

ROOT = Path(__file__).resolve().parents[2]
SOURCE_PANEL = Path(os.getenv("TENDER_PANEL_SOURCE_PANEL", ROOT / "runtime" / "protected"))
MAP_ROOT = Path(os.getenv("TENDER_PANEL_MAP_ROOT", "./data/map-cache"))
MAPS = {
    "cfd": {
        "archive": MAP_ROOT / "open-map/data/cfd-shortbread.mbtiles",
        "osrm": osrm_route_url("cfd"),
        "coverage": "Центральный федеральный округ",
    },
    "nwfd": {
        "archive": MAP_ROOT / "open-map/data/northwestern-fed-district-shortbread-1.0.mbtiles",
        "osrm": osrm_route_url("nwfd"),
        "coverage": "Северо-Западный федеральный округ",
    },
}
MAP_ASSETS = {
    "maplibre-gl.js": ROOT / "runtime/assets/map/maplibre-gl.js",
    "maplibre-gl.css": ROOT / "runtime/assets/map/maplibre-gl.css",
}
MAP_ASSET_VERSION = "v0.11.26"
def _validated_public_origin(raw_origin: str) -> str:
    origin = raw_origin.rstrip("/")
    parts = urlsplit(origin)
    try:
        parts.port
    except ValueError as exc:
        raise RuntimeError("TENDER_PANEL_PUBLIC_ORIGIN must contain a valid port") from exc
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.path
        or parts.query
        or parts.fragment
        or parts.username
        or parts.password
    ):
        raise RuntimeError("TENDER_PANEL_PUBLIC_ORIGIN must be an http(s) origin without credentials or a path")
    return origin


FONT_ROOT = ROOT / "runtime/assets/map-fonts"
PUBLIC_ORIGIN = _validated_public_origin(
    os.getenv("TENDER_PANEL_PUBLIC_ORIGIN", "https://example.invalid")
)

settings = Settings()
app = create_app(settings)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[
        host.strip()
        for host in os.getenv(
            "TENDER_PANEL_ALLOWED_HOSTS",
            "example.invalid,example.invalid,127.0.0.1,192.0.2.1,192.0.2.1:8000,127.0.0.1:8000,testserver",
        ).split(",")
        if host.strip()
    ],
)
app.state.logistics_store = LogisticsStore(
    Path(os.getenv("TENDER_PANEL_LOGISTICS_DB", ROOT / "data/logistics-demo.sqlite")),
    seed_demo=os.getenv("TENDER_PANEL_LOGISTICS_SEED_DEMO", "").strip() == "1",
)
app.state.logistics_route_resolver = LogisticsRouteResolver()
app.state.address_registry = AddressRegistry(Path(os.getenv(
    "TENDER_PANEL_ADDRESS_INDEX",
    "./data/address-index.sqlite",
)))
app.state.document_checklist = DocumentChecklistStore(
    settings.document_checklist_source,
    settings.document_checklist_db,
    settings.paperless_public_base,
)


def trusted_lan_demo_request(request: Request) -> bool:
    subnet = os.getenv("TENDER_PANEL_DEMO_LAN_SUBNET", "").strip()
    client_host = request.client.host if request.client else ""
    if not subnet or not client_host:
        return False
    try:
        network = ipaddress.ip_network(subnet, strict=True)
        address = ipaddress.ip_address(client_host)
    except ValueError:
        return False
    return network.is_private and address in network


@app.middleware("http")
async def protected_demo_access(request: Request, call_next):
    if request.url.path != "/health":
        actor = request.headers.get(settings.authenticated_header, "")
        if not actor and trusted_lan_demo_request(request):
            request.scope["headers"] = [
                *request.scope.get("headers", []),
                (settings.authenticated_header.lower().encode("ascii"), b"lan-demo"),
            ]
            actor = "lan-demo"
        if not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9._@-]{1,120}", actor):
            return JSONResponse({"detail": "Требуется вход"}, status_code=401)
    response = await call_next(request)
    response.headers["X-Panel-Scope"] = "tender-panel-production"
    if request.url.path.startswith(("/static/", "/map/tiles/", "/map/fonts/")) and response.status_code == 200:
        response.headers["Cache-Control"] = "private, max-age=86400"
        response.headers["Vary"] = "X-Authenticated-User"
        if response.headers.get("etag") and request.headers.get("if-none-match") == response.headers["etag"]:
            return Response(status_code=304, headers={"ETag": response.headers["etag"], "Cache-Control": "private, max-age=86400", "Vary": "X-Authenticated-User"})
    # MapLibre создаёт отдельный локальный Web Worker из blob-адреса.
    # Разрешение не открывает внешние источники.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; "
        "img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; "
        "base-uri 'self'; frame-ancestors 'none'; object-src 'none'"
    )
    return response


def store() -> LogisticsStore:
    return app.state.logistics_store


def tender_delivery_address(tender_id: str) -> str:
    def extract_addr(item: dict) -> str:
        addr = str(item.get("delivery_address") or "").strip()
        if addr:
            return addr
        card = item.get("card", {})
        fields = card.get("fields", {}) if isinstance(card, dict) else {}
        for k, v in fields.items():
            if any(w in str(k).lower() for w in ["адрес поставки", "адреса поставки", "место поставки"]):
                val = v.get("value") if isinstance(v, dict) else (v.get("text") if isinstance(v, dict) else v)
                if val and isinstance(val, str) and len(val.strip()) > 3:
                    return val.strip()
        sections = item.get("sections", {}) if isinstance(item, dict) else {}
        for sec in (sections.values() if isinstance(sections, dict) else ()):
            if isinstance(sec, dict):
                for sub_fields in sec.values():
                    if isinstance(sub_fields, list):
                        for f in sub_fields:
                            if isinstance(f, dict) and any(w in str(f.get("name", "")).lower() for w in ["адрес поставки", "адреса поставки", "место поставки"]):
                                val = str(f.get("value") or "").strip()
                                if val and val != "None":
                                    return val
        return ""

    try:
        item = app.state.repository.snapshot().tenders.get(str(tender_id), {})
        found = extract_addr(item)
        if found:
            return found
    except Exception:
        pass
    try:
        for item in app.state.core_repository.visible_cards():
            if str(item.get("tender_id")) == str(tender_id):
                found = extract_addr(item)
                if found:
                    return found
    except Exception:
        pass
    return ""


def tender_delivery_addresses(tender_id: str) -> list[dict[str, object]]:
    sources = []
    try:
        sources.append(app.state.repository.snapshot().tenders.get(str(tender_id), {}))
    except Exception:
        pass
    try:
        sources.extend(item for item in app.state.core_repository.visible_cards() if str(item.get("tender_id")) == str(tender_id))
    except Exception:
        pass
    # If the existing authorized sources contain no address, use the same
    # card's verified detail projection; never replace a non-empty source.
    detail_source = None
    try:
        if app.state.core_repository.is_visible(tender_id):
            detail_source = app.state.core_repository.projection(tender_id)
    except Exception:
        pass
    result, seen = [], set()
    for source_index, source in enumerate(sources):
        for candidate in collect_delivery_addresses(source):
            if candidate.address in seen:
                continue
            seen.add(candidate.address)
            result.append({"delivery_address": candidate.address, "source_delivery_address": candidate.source_address or candidate.address, "source_locator": f"source[{source_index}].{candidate.source_locator}", "source_locators": list(candidate.source_locators), "status": candidate.status, "warning": candidate.warning, "needs_review": candidate.needs_review})
    detail_candidates = collect_delivery_addresses(detail_source) if detail_source is not None else []
    if not result and len(detail_candidates) > 1:
        for candidate in detail_candidates:
            result.append({"delivery_address": candidate.address, "source_delivery_address": candidate.source_address or candidate.address, "source_locator": f"detail.{candidate.source_locator}", "source_locators": list(candidate.source_locators), "status": candidate.status, "warning": candidate.warning, "needs_review": candidate.needs_review})
    if not result and not sources:
        address = normalize_delivery_address(tender_delivery_address(tender_id))
        if address.address:
            result.append({"delivery_address": address.address, "source_locator": "legacy.delivery_address", "needs_review": address.needs_review})
    return result


def delivery_source_fingerprint(addresses: list[dict[str, object]]) -> str:
    value = [str(item.get("delivery_address") or "") for item in addresses]
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def delivery_address_key(value: object) -> str:
    return normalize_delivery_address(value).address.casefold()


@app.get("/logistics")
def logistics_page() -> Response:
    # Use configured HTML path so V2 routes serve V2 HTML, not v0.9.31 release
    return render_panel_html(settings)

@app.get("/documents")
def documents_page() -> Response:
    return render_panel_html(settings)

@app.get("/api/documents/checklist")
def documents_checklist() -> dict:
    checklist = app.state.document_checklist.checklist()
    app.state.document_checklist.refresh_in_background(settings.paperless_api_base, settings.paperless_token_file)
    return checklist


@app.get("/settings")
def search_settings_page() -> Response:
    return render_panel_html(settings)


@app.get("/static/demo/{asset_name}")
def demo_asset(asset_name: str) -> FileResponse:
    if asset_name not in {"logistics-demo.css", "logistics-demo.js"}:
        raise HTTPException(status_code=404, detail="Ресурс демо не найден")
    path = ROOT / "runtime/assets" / asset_name
    media_type = "text/css" if asset_name.endswith(".css") else "application/javascript"
    return FileResponse(path, media_type=media_type)


@app.get("/static/search-settings.js")
def search_settings_asset() -> FileResponse:
    return FileResponse(ROOT / "runtime/assets/search-settings.js", media_type="application/javascript")


def write_guard(request: Request) -> str:
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="Требуется JSON")
    if request.headers.get("origin", "").rstrip("/") not in settings.allowed_origins:
        raise HTTPException(status_code=403, detail="Недопустимый источник запроса")
    if request.headers.get("X-Logistics-Action") != "manual-logistics-v1":
        raise HTTPException(status_code=403, detail="Не подтверждено ручное действие")
    request_id = request.headers.get("X-Request-ID", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{7,79}", request_id):
        raise HTTPException(status_code=400, detail="Нужен идентификатор запроса")
    return request_id


async def payload(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Некорректный JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Ожидался объект JSON")
    return data


def store_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc).strip("'"))
    if isinstance(exc, sqlite3.IntegrityError) and "request_id" in str(exc):
        return HTTPException(status_code=409, detail="Это действие уже обработано")
    if isinstance(exc, (ValueError, sqlite3.IntegrityError)):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail="Не удалось сохранить данные логистики")


def dellin_calculator() -> DellinCalculator:
    return DellinCalculator(
        os.environ.get("DELLIN_APPKEY", ""),
        os.environ.get("DELLIN_LOGIN", ""),
        os.environ.get("DELLIN_PASSWORD", ""),
    )


def dellin_multi_result(request_data: dict, destinations: list[dict], route: dict) -> dict:
    """Calculate separate warehouse-to-point shipments after an explicit split."""
    raw_split = request_data.get("dellin_split")
    if not isinstance(raw_split, list) or len(raw_split) != len(destinations):
        return {"provider": "dellin", "status": "provider_issue", "reason": "Груз не разбит по всем адресам"}
    try:
        if request_data.get("stated_value") in (None, ""):
            raise ValueError("Объявленная стоимость должна быть указана явно")
        total_input = DellinInput.from_payload({
            "pickup_address": route["pickup_address"], "delivery_address": destinations[0]["delivery_address"],
            "cargo_places": request_data.get("cargo_places"), "weight_kg": request_data.get("weight_kg"),
            "volume_m3": "1", "length_m": request_data.get("length_m"),
            "width_m": request_data.get("width_m"), "height_m": request_data.get("height_m"),
            "stated_value": request_data.get("stated_value"),
        })
        total_places = total_input.cargo_places
        total_weight = Decimal(total_input.weight_kg)
        total_value = Decimal(total_input.stated_value)
        inputs, normalized = [], []
        for index, (point, split) in enumerate(zip(destinations, raw_split)):
            if not isinstance(split, dict):
                raise ValueError(f"Точка {index + 1}: груз не разбит")
            if any(split.get(key) in (None, "") for key in ("places", "weight_kg", "stated_value")):
                raise ValueError(f"Точка {index + 1}: заполните места, вес и стоимость")
            try:
                point_input = DellinInput.from_payload({
                "pickup_address": route["pickup_address"], "delivery_address": point["delivery_address"],
                "cargo_places": split.get("places"), "weight_kg": split.get("weight_kg"), "volume_m3": "1",
                "length_m": request_data.get("length_m"), "width_m": request_data.get("width_m"),
                "height_m": request_data.get("height_m"), "stated_value": split.get("stated_value"),
                })
            except ValueError as exc:
                raise ValueError(f"Точка {index + 1}: {exc}") from exc
            volume = cargo_volume_m3(point_input.cargo_places, point_input.length_m, point_input.width_m, point_input.height_m)
            point_input = replace(point_input, volume_m3=format(volume, "f"))
            inputs.append(point_input)
            normalized.append({"source_index": index, "address": point["delivery_address"], "places": point_input.cargo_places, "weight_kg": point_input.weight_kg, "stated_value": point_input.stated_value, "volume_m3": point_input.volume_m3})
        if sum(item["places"] for item in normalized) != total_places or sum((Decimal(item["weight_kg"]) for item in normalized), Decimal(0)) != total_weight or sum((Decimal(item["stated_value"]) for item in normalized), Decimal(0)) != total_value:
            raise ValueError("Суммы распределения не совпадают с общим грузом")
        results = dellin_calculator().calculate_many(inputs)
        breakdown, total = [], Decimal(0)
        if len(results) != len(destinations):
            raise DellinError("Деловые Линии вернули неполный набор стоимостей")
        for item, result in zip(normalized, results):
            price = Decimal(str(result.get("price", "")))
            if not price.is_finite() or price <= 0:
                raise DellinError("Деловые Линии вернули некорректную стоимость")
            total += price
            breakdown.append({**item, "price": f"{price:.2f}", "provider": "dellin", "method": "склад → отдельная точка"})
        return {"provider": "dellin", "status": "calculated", "price": f"{total:.2f}", "currency": "RUB", "method": "separate_shipments", "scope": "multi_address", "breakdown": breakdown}
    except (KeyError, TypeError, ValueError, InvalidOperation, DellinError) as exc:
        return {"provider": "dellin", "status": "provider_issue", "reason": str(exc)[:300]}


def apply_preliminary_cargo(request_data: dict, point_count: int) -> None:
    metadata = request_data.get("preliminary_cargo")
    if metadata is None or metadata == {}:
        return
    if not isinstance(metadata, dict):
        raise ValueError("Поле «preliminary_cargo» должно быть объектом")
    enabled = metadata.get("enabled", False)
    if not isinstance(enabled, bool):
        raise ValueError("Поле «preliminary_cargo.enabled» должно быть логическим значением")
    if not enabled:
        return
    for field, value in PRELIMINARY_CARGO.items():
        if preliminary_missing(request_data.get(field if field != "places" else "cargo_places")):
            request_data[field if field != "places" else "cargo_places"] = value
    if point_count > 1 and preliminary_split_missing(request_data.get("dellin_split")):
        try:
            places = int(str(request_data["cargo_places"]).strip())
        except (TypeError, ValueError) as exc:
            raise ValueError("Поле «Количество мест» должно быть целым числом") from exc
        weight = positive_decimal(request_data["weight_kg"], "Общий вес")
        stated_value = nonnegative_decimal(request_data["stated_value"], "Стоимость")
        if point_count <= places:
            request_data["dellin_split"] = preliminary_split(point_count, places, format(weight, "f"), format(stated_value, "f"))
        else:
            metadata["warning"] = "Мест меньше адресов: отправки не созданы, укажи больше мест"


def dellin_enabled() -> bool:
    return all(os.environ.get(name, "").strip() for name in ("DELLIN_APPKEY", "DELLIN_LOGIN", "DELLIN_PASSWORD"))


def integration_view(carrier: dict) -> dict:
    if carrier.get("id") == "dellin" and dellin_enabled():
        carrier = dict(carrier)
        carrier.update(
            status="ACTIVE", api_status="READY", api_last_check="При запуске службы",
            api_message="Калькулятор стоимости подключён; заявки и заказы не создаются",
            reliability_note="Стоимость и срок запрашиваются напрямую из API Деловых Линий",
            notes="Учётные данные хранятся только в закрытой настройке сервера и не выдаются в панель",
        )
    return carrier


def format_ru_address(item: dict) -> str:
    addr = item.get("address") if isinstance(item.get("address"), dict) else {}
    road = str(addr.get("road") or addr.get("street") or addr.get("pedestrian") or "").strip()
    house = str(addr.get("house_number") or addr.get("house") or "").strip()
    building = str(addr.get("building") or "").strip()

    city = str(
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("municipality")
        or addr.get("state")
        or ""
    ).strip()

    raw = str(item.get("display_name") or "").strip()

    if not house and raw:
        m = re.match(r"^([0-9]+[а-яА-Яa-zA-Z0-9/-]*),\s*", raw)
        if m:
            house = m.group(1)
            raw_no_house = raw[m.end():]
            if not road:
                road_match = re.match(r"^([^,]+)", raw_no_house)
                if road_match:
                    road = road_match.group(1).strip()

    if not road and raw:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        filtered = [
            p for p in parts
            if not re.search(r"^\d{6}$|Россия|федеральный округ", p, re.IGNORECASE)
        ]
        if len(filtered) >= 2:
            return f"{filtered[0]}, {filtered[1]}"
        elif len(filtered) == 1:
            return filtered[0]

    street_house = f"{road} {house}".strip() if house else road
    if building and building not in street_house:
        street_house = f"{street_house} {building}".strip()

    if city and city.lower() not in street_house.lower():
        return f"{street_house}, {city}"
    return street_house or raw


@app.get("/api/logistics/geocode/suggest")
def suggest_address(q: str = "", tender_id: str = "") -> dict:
    query = str(q or "").strip()
    if len(query) < 2:
        return {"query": query, "suggestions": []}
    try:
        city_hint = ""
        if tender_id:
            source = normalize_delivery_address(tender_delivery_address(tender_id)).address
            city_hint = source.rsplit(",", 1)[-1].strip() if "," in source else ""
        return {"query": query, "suggestions": app.state.address_registry.suggest(query, city_hint=city_hint)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'")) from exc


@app.get("/api/logistics/summary")
def logistics_summary() -> dict:
    result = store().summary()
    if dellin_enabled():
        result["carriers"]["active"] = int(result["carriers"].get("active") or 0) + 1
        result["carriers"]["api_ready"] = int(result["carriers"].get("api_ready") or 0) + 1
        result["carriers"]["api_unavailable"] = max(0, int(result["carriers"].get("api_unavailable") or 0) - 1)
    result["panel_base_version"] = "v0.9.13"
    result["external_calls_enabled"] = dellin_enabled()
    result["notice"] = "Единый предварительный расчёт сравнивает включённые ручные тарифы и предложение Деловых Линий."
    return result


@app.get("/api/logistics/carriers")
def carriers(q: str = "", status: str = "") -> dict:
    try:
        return {"items": [integration_view(item) for item in store().list_carriers(q[:160].strip(), status[:20].strip())]}
    except Exception as exc:
        raise store_error(exc) from exc


@app.get("/api/logistics/carriers/{carrier_id}")
def carrier(carrier_id: str) -> dict:
    try:
        return integration_view(store().get_carrier(carrier_id))
    except Exception as exc:
        raise store_error(exc) from exc


@app.post("/api/logistics/carriers")
async def create_carrier(request: Request) -> dict:
    request_id = write_guard(request)
    try:
        return await run_in_threadpool(store().save_carrier, await payload(request), request_id)
    except Exception as exc:
        raise store_error(exc) from exc


@app.put("/api/logistics/carriers/{carrier_id}")
async def update_carrier(carrier_id: str, request: Request) -> dict:
    request_id = write_guard(request)
    try:
        return await run_in_threadpool(store().save_carrier, await payload(request), request_id, carrier_id)
    except Exception as exc:
        raise store_error(exc) from exc


@app.post("/api/logistics/carriers/{carrier_id}/tariffs")
async def create_tariff(carrier_id: str, request: Request) -> dict:
    request_id = write_guard(request)
    try:
        return await run_in_threadpool(store().save_tariff, carrier_id, await payload(request), request_id)
    except Exception as exc:
        raise store_error(exc) from exc


@app.put("/api/logistics/carriers/{carrier_id}/tariffs/{tariff_id}")
async def update_tariff(carrier_id: str, tariff_id: str, request: Request) -> dict:
    request_id = write_guard(request)
    try:
        return await run_in_threadpool(store().save_tariff, carrier_id, await payload(request), request_id, tariff_id)
    except Exception as exc:
        raise store_error(exc) from exc


@app.post("/api/logistics/carriers/{carrier_id}/communications")
async def create_communication(carrier_id: str, request: Request) -> dict:
    request_id = write_guard(request)
    try:
        return await run_in_threadpool(store().add_communication, carrier_id, await payload(request), request_id)
    except Exception as exc:
        raise store_error(exc) from exc


@app.get("/api/logistics/tenders/{tender_id}")
def tender_logistics(tender_id: str) -> dict:
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", tender_id):
            raise ValueError("Некорректный идентификатор тендера")
        try:
            known = tender_id in app.state.repository.snapshot().tenders
        except ReleaseError:
            known = False
        try:
            known = known or app.state.core_repository.is_visible(tender_id)
        except ReleaseError:
            pass
        if not known:
            raise KeyError("Тендер не найден")
        source_addresses = [
            {**item, "source_index": index}
            for index, item in enumerate(tender_delivery_addresses(tender_id))
        ]
        source_address = normalize_delivery_address(tender_delivery_address(tender_id))
        result = store().simple_tender_logistics(tender_id, str(source_addresses[0]["delivery_address"] if source_addresses else source_address.address))
        saved_addresses = result.get("delivery_addresses") or []
        saved_fingerprint = result.get("source_fingerprint")
        result["source_delivery_addresses"] = source_addresses
        result["source_fingerprint"] = delivery_source_fingerprint(source_addresses)
        result["saved_source_fingerprint"] = saved_fingerprint
        source_count_changed = bool(source_addresses) and (not result.get("delivery_stops") or len(result.get("delivery_stops", [])) != len(source_addresses))
        saved_lineage_missing = bool(result.get("calculated_at") and source_addresses) and (
            not saved_addresses or not saved_fingerprint or not result.get("delivery_stops")
        )
        legacy_address_mismatch = bool(
            result.get("legacy_record")
            and source_addresses
            and (
                len(source_addresses) != 1
                or delivery_address_key(result.get("delivery_address")) != delivery_address_key(source_addresses[0].get("delivery_address"))
            )
        )
        result["delivery_source_status"] = "STALE" if saved_lineage_missing or (saved_addresses and saved_fingerprint and saved_fingerprint != result["source_fingerprint"]) or legacy_address_mismatch or (result.get("legacy_record") and len(source_addresses) > 1) or (saved_addresses and source_count_changed) else "CURRENT"
        if not saved_addresses:
            result["delivery_addresses"] = source_addresses
        if not source_addresses and "приложен" in tender_delivery_address(tender_id).casefold():
            result["delivery_address"] = ""
            result["delivery_addresses"] = []
        displayed_address = normalize_delivery_address(result.get("delivery_address"))
        result["delivery_address"] = displayed_address.address
        result["delivery_address_needs_review"] = source_address.needs_review or displayed_address.needs_review or any(item.get("needs_review") for item in source_addresses)
        if not source_address.address:
            result["delivery_address_status"] = "MISSING"
            result["delivery_address_reason"] = "Адреса указаны только в приложении; требуется извлечение документа" if "приложени" in tender_delivery_address(tender_id).casefold() else "Адрес приёмки не подтверждён документами закупки"
            result["delivery_address_source"] = "MISSING"
        if source_addresses and any(item.get("warning") for item in source_addresses):
            result["delivery_address_warning"] = "; ".join(sorted({item["warning"] for item in source_addresses if item.get("warning")}))
        return result
    except Exception as exc:
        raise store_error(exc) from exc


app.state.preliminary_logistics_reader = tender_logistics


@app.post("/api/logistics/tenders/{tender_id}/calculate")
async def calculate_tender_logistics(tender_id: str, request: Request) -> dict:
    request_id = write_guard(request)
    body = await payload(request)
    journal = CalculationJournal(str(store().path) + ".requests.sqlite")
    previous = await run_in_threadpool(journal.reserve, request_id, {"tender_id": tender_id, "body": body})
    if previous is not None:
        return previous
    try:
        result = await calculate_tender_logistics_impl(tender_id, request)
        await run_in_threadpool(journal.finish, request_id, result)
        return result
    except Exception:
        await run_in_threadpool(journal.fail, request_id)
        raise


async def calculate_tender_logistics_impl(tender_id: str, request: Request) -> dict:
    request_id = write_guard(request)
    try:
        request_data = await payload(request)
        if "delivery_addresses" in request_data:
            raw_addresses = request_data["delivery_addresses"]
        else:
            raw_addresses = [request_data.get("delivery_address") or tender_delivery_address(tender_id)]
        if "address_registry_ids" in request_data:
            registry_ids = request_data["address_registry_ids"]
        else:
            registry_ids = [request_data.get("address_registry_id", "")]
        source_indexes = request_data.get("source_indexes")
        if source_indexes is None:
            source_indexes = list(range(len(raw_addresses))) if isinstance(raw_addresses, list) else []
        if not isinstance(raw_addresses, list) or not raw_addresses or len(raw_addresses) > 12 or not isinstance(registry_ids, list) or len(registry_ids) > 12 or len(registry_ids) > len(raw_addresses) or not isinstance(source_indexes, list) or len(source_indexes) != len(raw_addresses) or len(source_indexes) > 12:
            raise ValueError("Некорректный список адресов доставки")
        source_addresses = [
            {**item, "source_index": index}
            for index, item in enumerate(tender_delivery_addresses(tender_id))
        ]
        source_values = [str(item.get("delivery_address") or "") for item in source_addresses]
        if any(item.get("warning") for item in source_addresses):
            raise ValueError("Полный маршрут заблокирован: источник адресов неполный или требует извлечения документа")
        current_source_fingerprint = delivery_source_fingerprint(source_addresses)
        submitted_source_fingerprint = str(request_data.get("source_fingerprint") or "").strip()
        if source_values and submitted_source_fingerprint and submitted_source_fingerprint != current_source_fingerprint:
            raise ValueError("Источник адресов изменился: обновите список перед расчётом")
        try:
            source_indexes = [
                int(str(value).strip())
                for value in source_indexes
                if re.fullmatch(r"\d{1,2}", str(value).strip())
            ]
        except (TypeError, ValueError) as exc:
            raise ValueError("Некорректная привязка точек доставки к источнику") from exc
        if len(source_indexes) != len(raw_addresses):
            raise ValueError("Некорректная привязка точек доставки к источнику")
        source_by_index={int(item["source_index"]): item for item in source_addresses}
        if source_values and set(source_indexes) != set(source_by_index):
            raise ValueError("Нельзя удалить или скрыть точку из сохранённого списка доставки")
        destinations, clean_addresses = [], []
        for index, raw_address in enumerate(raw_addresses):
            address_info = normalize_delivery_address(raw_address)
            if not address_info.address:
                raise ValueError(f"Точка {index + 1}: адрес требует уточнения")
            registry_id = str(registry_ids[index] if index < len(registry_ids) else "").strip()
            city_hint = address_info.address.rsplit(",", 1)[-1].strip() if "," in address_info.address else ""
            selected = await run_in_threadpool(app.state.address_registry.resolve, registry_id) if registry_id else await run_in_threadpool(app.state.address_registry.geocode, address_info.address, city_hint=city_hint)
            if registry_id and selected["display_name"] != address_info.address:
                raise ValueError(f"Точка {index + 1}: выбранный адрес изменён после выбора из реестра")
            clean_addresses.append(address_info.address)
            destinations.append({"delivery_address": address_info.address, "delivery_lat": selected["lat"], "delivery_lon": selected["lon"], "resolved_address": selected["display_name"], "registry_id": registry_id})
        for index, destination in enumerate(destinations):
            source_index = source_indexes[index] if source_values else None
            source = source_by_index.get(source_index, {}) if source_index is not None else {}
            destination["source_index"] = source_index
            destination["source_delivery_address"] = str(source.get("delivery_address") or "")
        delivery_address = clean_addresses[0]
        apply_preliminary_cargo(request_data, len(destinations))
        request_data["delivery_address"] = delivery_address
        request_data["delivery_addresses"] = clean_addresses
        request_data["delivery_stops"] = destinations
        request_data["source_fingerprint"] = current_source_fingerprint
        request_data["volume_m3"] = format(
            cargo_volume_m3(
                request_data.get("cargo_places"),
                request_data.get("length_m"),
                request_data.get("width_m"),
                request_data.get("height_m"),
            ),
            "f",
        )
        route = await run_in_threadpool(app.state.logistics_route_resolver.resolve_many, destinations)
        dellin_result = {}
        if len(destinations) == 1:
            quote_input = DellinInput.from_payload({**request_data, "pickup_address": route["pickup_address"]})
            try:
                dellin_result = await run_in_threadpool(dellin_calculator().calculate, quote_input)
            except DellinError as exc:
                dellin_result = {"provider": "dellin", "status": "provider_issue", "reason": str(exc)[:300]}
            except ValueError as exc:
                if "учётные данные" not in str(exc).casefold():
                    raise
                dellin_result = {"provider": "dellin", "status": "provider_issue", "reason": str(exc)[:300]}
        elif request_data.get("dellin_split") is not None:
            dellin_result = await run_in_threadpool(dellin_multi_result, request_data, destinations, route)
        else:
            dellin_result = {"provider": "dellin", "status": "provider_issue", "reason": "Груз не разбит по всем адресам"}
        route["dellin_quote"] = dellin_result
        return await run_in_threadpool(store().save_simple_calculation, tender_id, request_data, route, dellin_result, request_id)
    except LogisticsRouteError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except DellinError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise store_error(exc) from exc


@app.post("/api/logistics/tenders/{tender_id}/dellin-quote")
async def calculate_dellin_quote(tender_id: str, request: Request) -> dict:
    request_id = write_guard(request)
    try:
        quote_input = DellinInput.from_payload(await payload(request))
        result = await run_in_threadpool(dellin_calculator().calculate, quote_input)
        return await run_in_threadpool(store().save_dellin_quote, tender_id, quote_input.public_dict(), result, request_id)
    except DellinError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise store_error(exc) from exc


@app.get("/api/logistics/tenders/{tender_id}/route")
def tender_route(tender_id: str) -> dict:
    try:
        route = store().route_coordinates(tender_id)
    except (ValueError, KeyError) as exc:
        raise store_error(exc) from exc
    if not route:
        raise HTTPException(status_code=404, detail="Маршрут для закупки ещё не рассчитан")
    current_source = tender_delivery_addresses(tender_id)
    if route.get("stops") or current_source:
        current_fingerprint = delivery_source_fingerprint(current_source)
        saved_stops = route.get("stops", [])
        if route.get("source_fingerprint") != current_fingerprint or (saved_stops and current_source and len(saved_stops) != len(current_source)):
            raise HTTPException(status_code=409, detail="Источник адресов изменился; маршрут требует полного пересчёта")
    if route.get("geometry", {}).get("type") == "LineString":
        coordinates = route["geometry"].get("coordinates", [])
        if len(coordinates) < 2:
            raise HTTPException(status_code=503, detail="Сохранённая геометрия маршрута неполна")
        return {
            "geometry": route["geometry"], "bounds_points": coordinates,
            "distance_km": round(float(route.get("distance_km") or 0), 1),
            "duration_minutes": max(1, round(float(route.get("duration_hours") or 0) * 60)),
            "map_region": route.get("map_region"), "source": "OpenStreetMap contributors / local OSRM",
            "status": "PRELIMINARY_ROUTE", "stops": route.get("stops", []), "route_order": route.get("route_order", []),
        }
    region = route["map_region"]
    config = MAPS.get(region)
    if not config:
        raise HTTPException(status_code=409, detail="Регион карты не поддерживается")
    coordinates = f"{route['pickup_lon']},{route['pickup_lat']};{route['delivery_lon']},{route['delivery_lat']}"
    url = f"{config['osrm']}{quote(coordinates, safe=';,.')}?overview=full&geometries=geojson&steps=false"
    try:
        response = httpx.get(url, timeout=8)
        response.raise_for_status()
        data = response.json()
        selected = data["routes"][0]
        geometry = selected["geometry"]
        if geometry.get("type") != "LineString":
            raise ValueError("geometry")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Локальный сервис маршрутов временно недоступен") from exc
    return {
        "geometry": geometry,
        "bounds_points": geometry["coordinates"],
        "distance_km": round(float(selected.get("distance") or 0) / 1000, 1),
        "duration_minutes": max(1, round(float(selected.get("duration") or 0) / 60)),
        "map_region": region,
        "source": f"OpenStreetMap contributors / Geofabrik, {config['coverage']}",
        "status": "PRELIMINARY_ROUTE",
    }


@app.get("/map/style.json")
def map_style(region: str = "cfd") -> dict:
    if region not in MAPS:
        raise HTTPException(status_code=404, detail="Регион карты не поддерживается")
    prefix = settings.public_prefix
    return {
        "version": 8,
        "name": "Светлая дорожная карта логистики",
        "glyphs": f"{prefix}/map/fonts/{{fontstack}}/{{range}}.pbf?v={MAP_ASSET_VERSION}",
        "sources": {
            "open": {"type": "vector", "tiles": [f"{prefix}/map/tiles/{region}/{{z}}/{{x}}/{{y}}.pbf?v={MAP_ASSET_VERSION}"], "minzoom": 0, "maxzoom": 14, "attribution": "© OpenStreetMap contributors, Geofabrik"},
        },
        "layers": [
            {"id": "background", "type": "background", "paint": {"background-color": "#f4f1eb"}},
            {"id": "landuse", "type": "fill", "source": "open", "source-layer": "land", "minzoom": 6, "paint": {"fill-color": ["match", ["get", "kind"], ["forest", "wood"], "#d6e8cf", ["park", "garden", "grass", "recreation_ground"], "#dcefd6", ["cemetery"], "#dde8d6", ["industrial"], "#e8e4df", ["residential"], "#f1eee9", "#eeeae4"], "fill-opacity": 0.82}},
            {"id": "water", "type": "fill", "source": "open", "source-layer": "water_polygons", "paint": {"fill-color": "#b9ddf0"}},
            {"id": "water-lines", "type": "line", "source": "open", "source-layer": "water_lines", "minzoom": 7, "paint": {"line-color": "#9fcfe7", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 14, 3]}},
            {"id": "street-polygons", "type": "fill", "source": "open", "source-layer": "street_polygons", "minzoom": 11, "paint": {"fill-color": "#fffdf8", "fill-outline-color": "#ded9d1", "fill-opacity": 0.92}},
            {"id": "admin-boundaries", "type": "line", "source": "open", "source-layer": "boundaries", "paint": {"line-color": "#a7afb6", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.7, 10, 1.4], "line-dasharray": [3, 2]}},
            {"id": "local-road-casing", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 10, "filter": ["in", ["get", "kind"], ["literal", ["residential", "unclassified", "living_street", "service", "pedestrian"]]], "paint": {"line-color": "#d8d4ce", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 5.8]}},
            {"id": "local-roads", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 10, "filter": ["in", ["get", "kind"], ["literal", ["residential", "unclassified", "living_street", "service", "pedestrian"]]], "paint": {"line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 14, 4.2]}},
            {"id": "secondary-road-casing", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 7, "filter": ["in", ["get", "kind"], ["literal", ["secondary", "tertiary"]]], "paint": {"line-color": "#d5d0c8", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.4, 14, 8.8]}},
            {"id": "secondary-roads", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 7, "filter": ["in", ["get", "kind"], ["literal", ["secondary", "tertiary"]]], "paint": {"line-color": "#fffdf8", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.8, 14, 6.6]}},
            {"id": "primary-road-casing", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 5, "filter": ["in", ["get", "kind"], ["literal", ["motorway", "trunk", "primary"]]], "paint": {"line-color": "#d6bd77", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.8, 14, 11.5]}},
            {"id": "primary-roads", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 5, "filter": ["in", ["get", "kind"], ["literal", ["motorway", "trunk", "primary"]]], "paint": {"line-color": ["match", ["get", "kind"], ["motorway", "trunk"], "#ffd36c", "#ffe8a3"], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.1, 14, 8.8]}},
            {"id": "paths", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 13, "filter": ["in", ["get", "kind"], ["literal", ["path", "footway", "cycleway", "steps"]]], "paint": {"line-color": "#d0c9bd", "line-width": 1, "line-dasharray": [2, 1]}},
            {"id": "railways", "type": "line", "source": "open", "source-layer": "streets", "minzoom": 8, "filter": ["in", ["get", "kind"], ["literal", ["rail", "tram", "subway", "monorail"]]], "paint": {"line-color": "#a7a7a7", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 14, 2], "line-dasharray": [4, 2]}},
            {"id": "buildings", "type": "fill", "source": "open", "source-layer": "buildings", "minzoom": 13, "paint": {"fill-color": "#ded9d2", "fill-outline-color": "#cfc8be", "fill-opacity": 0.9}},
            {"id": "water-labels", "type": "symbol", "source": "open", "source-layer": "water_lines_labels", "minzoom": 10, "layout": {"symbol-placement": "line", "text-field": ["coalesce", ["get", "name"], ""], "text-font": ["Open Sans Semibold"], "text-size": 11}, "paint": {"text-color": "#4f91b6", "text-halo-color": "#eaf6fb", "text-halo-width": 1.5}},
            {"id": "street-labels", "type": "symbol", "source": "open", "source-layer": "street_labels", "minzoom": 10, "layout": {"symbol-placement": "line", "text-field": ["coalesce", ["get", "name"], ""], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 12], "text-max-angle": 35, "text-padding": 3}, "paint": {"text-color": "#5d6267", "text-halo-color": "#ffffff", "text-halo-width": 1.6}},
            {"id": "place-labels", "type": "symbol", "source": "open", "source-layer": "place_labels", "minzoom": 3, "layout": {"text-field": ["coalesce", ["get", "name"], ["get", "name_en"], ""], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 8, 12, 12, 15], "text-padding": 4, "text-max-width": 9}, "paint": {"text-color": "#343a40", "text-halo-color": "#fffdf8", "text-halo-width": 2}},
        ],
    }


@app.get("/map/fonts/{font_stack}/{range_name}.pbf")
def map_font(font_stack: str, range_name: str) -> FileResponse:
    if font_stack != "Open Sans Semibold" or not re.fullmatch(r"\d{1,5}-\d{1,5}", range_name):
        raise HTTPException(status_code=404, detail="Шрифт карты не найден")
    path = FONT_ROOT / font_stack / f"{range_name}.pbf"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Диапазон символов карты не найден")
    return FileResponse(path, media_type="application/x-protobuf")


@app.get("/map/tiles/{region}/{zoom}/{x}/{y}.pbf")
def map_tile(region: str, zoom: int, x: int, y: int) -> Response:
    config = MAPS.get(region)
    empty_tile = Response(b"", media_type="application/vnd.mapbox-vector-tile", headers={"Cache-Control": "public, max-age=3600"})
    if not config or zoom < 0 or zoom > 14 or x < 0 or y < 0 or x >= 2**zoom or y >= 2**zoom:
        return empty_tile
    archive = config["archive"]
    if not archive.is_file():
        return empty_tile
    tms_y = (2**zoom - 1) - y
    try:
        with closing(sqlite3.connect(f"file:{archive}?mode=ro", uri=True)) as con:
            row = con.execute("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?", (zoom, x, tms_y)).fetchone()
    except sqlite3.Error:
        return empty_tile
    if not row:
        return empty_tile
    encoding = "gzip" if row[0][:2] == b"\x1f\x8b" else None
    headers = {"Content-Encoding": encoding, "Cache-Control": "public, max-age=3600"} if encoding else {"Cache-Control": "public, max-age=3600"}
    return Response(row[0], media_type="application/vnd.mapbox-vector-tile", headers=headers)


@app.get("/ready")
def readiness() -> JSONResponse:
    resources = {"address_index": app.state.address_registry.path, "logistics": store().path,
                 **{f"map_{name}": config["archive"] for name, config in MAPS.items()}}
    checks = {}
    for name, path in resources.items():
        try:
            with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1)) as con:
                checks[name] = con.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").fetchone() is not None
        except (OSError, sqlite3.Error):
            checks[name] = False
    for name, path in MAP_ASSETS.items():
        checks[name] = path.is_file()
    ready = all(checks.values())
    return JSONResponse({"status": "ready" if ready else "degraded", "components": checks}, status_code=200 if ready else 503)


@app.get("/static/map/{asset_name}")
def map_asset(asset_name: str) -> FileResponse:
    path = MAP_ASSETS.get(asset_name)
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="Ресурс карты не найден")
    media_type = "text/css" if asset_name.endswith(".css") else "application/javascript"
    return FileResponse(path, media_type=media_type)
