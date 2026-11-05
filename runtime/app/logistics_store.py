from __future__ import annotations

import json
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from .logistics_calculation import PRELIMINARY_CARGO, cargo_volume_m3, preliminary_manual_tariff_price, positive_decimal


ALLOWED_CARRIER_STATUSES = {"ACTIVE", "PAUSED", "DRAFT"}
ALLOWED_CHANNELS = {"MANUAL", "API", "HYBRID"}
ALLOWED_API_STATUSES = {"NOT_CONNECTED", "READY", "ERROR", "NOT_APPLICABLE"}
ALLOWED_AVAILABILITY = {"AVAILABLE", "LIMITED", "UNAVAILABLE", "UNKNOWN"}

STANDARD_PICKUP_BY_REGION = {
    "cfd": {"address": "Склад ЦФО (демо)", "lon": "37.500000", "lat": "55.700000"},
    "nwfd": {"address": "Склад СЗФО (демо)", "lon": "30.300000", "lat": "59.900000"},
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def money(value: Any, *, allow_empty: bool = True) -> str:
    if value in (None, "") and allow_empty:
        return ""
    try:
        number = Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Укажи корректную сумму") from exc
    if not number.is_finite() or number < 0:
        raise ValueError("Сумма должна быть неотрицательной")
    return str(number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def limited(value: Any, length: int, field: str, *, required: bool = False) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"Поле «{field}» обязательно")
    if len(text) > length:
        raise ValueError(f"Поле «{field}» длиннее {length} символов")
    return text


def enum_value(value: Any, allowed: set[str], field: str) -> str:
    text = str(value or "").strip().upper()
    if text not in allowed:
        raise ValueError(f"Недопустимое значение поля «{field}»")
    return text


def enabled_value(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    text = str(value or "").strip().casefold()
    if text in {"1", "true", "on", "yes", "да"}:
        return 1
    if text in {"0", "false", "off", "no", "нет", ""}:
        return 0
    raise ValueError("Поле «Тариф включён» должно быть да или нет")


def safe_id(value: Any, field: str = "Идентификатор") -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", text):
        raise ValueError(f"Некорректное поле «{field}»")
    return text


def rowdict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


class LogisticsStore:
    """Отдельная изменяемая БД логистики. Не пишет в tender.db."""

    def __init__(self, path: Path, *, seed_demo: bool = True):
        self.path = path
        self.seed_demo = seed_demo
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA journal_mode=WAL")
        return con

    def initialize(self) -> None:
        with closing(self.connect()) as con:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS carriers (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  status TEXT NOT NULL,
                  channel TEXT NOT NULL,
                  service_type TEXT NOT NULL,
                  inn TEXT NOT NULL DEFAULT '',
                  manager_name TEXT NOT NULL DEFAULT '',
                  phone TEXT NOT NULL DEFAULT '',
                  email TEXT NOT NULL DEFAULT '',
                  website TEXT NOT NULL DEFAULT '',
                  regions TEXT NOT NULL DEFAULT '',
                  fleet TEXT NOT NULL DEFAULT '',
                  payment_terms TEXT NOT NULL DEFAULT '',
                  vat_note TEXT NOT NULL DEFAULT '',
                  reliability_note TEXT NOT NULL DEFAULT '',
                  notes TEXT NOT NULL DEFAULT '',
                  api_provider TEXT NOT NULL DEFAULT '',
                  api_status TEXT NOT NULL,
                  api_last_check TEXT NOT NULL DEFAULT '',
                  api_message TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tariffs (
                  id TEXT PRIMARY KEY,
                  carrier_id TEXT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
                  name TEXT NOT NULL,
                  pricing_model TEXT NOT NULL,
                  base_amount TEXT NOT NULL DEFAULT '',
                  per_km TEXT NOT NULL DEFAULT '',
                  per_hour TEXT NOT NULL DEFAULT '',
                  minimum_amount TEXT NOT NULL DEFAULT '',
                  currency TEXT NOT NULL DEFAULT 'RUB',
                  vat_note TEXT NOT NULL DEFAULT '',
                  route_from TEXT NOT NULL DEFAULT '',
                  route_to TEXT NOT NULL DEFAULT '',
                  vehicle_type TEXT NOT NULL DEFAULT '',
                  max_weight_kg TEXT NOT NULL DEFAULT '',
                  max_volume_m3 TEXT NOT NULL DEFAULT '',
                  included_services TEXT NOT NULL DEFAULT '',
                  extra_conditions TEXT NOT NULL DEFAULT '',
                  availability TEXT NOT NULL,
                  source_type TEXT NOT NULL,
                  source_contact TEXT NOT NULL DEFAULT '',
                  confirmed_at TEXT NOT NULL DEFAULT '',
                  valid_until TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS communications (
                  id TEXT PRIMARY KEY,
                  carrier_id TEXT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
                  contacted_at TEXT NOT NULL,
                  contact_name TEXT NOT NULL DEFAULT '',
                  channel TEXT NOT NULL,
                  subject TEXT NOT NULL,
                  result TEXT NOT NULL,
                  next_check_at TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tender_logistics (
                  tender_id TEXT PRIMARY KEY,
                  pickup_address TEXT NOT NULL,
                  delivery_address TEXT NOT NULL,
                  map_region TEXT NOT NULL,
                  pickup_lon TEXT NOT NULL,
                  pickup_lat TEXT NOT NULL,
                  delivery_lon TEXT NOT NULL,
                  delivery_lat TEXT NOT NULL,
                  distance_km TEXT NOT NULL,
                  duration_hours TEXT NOT NULL,
                  cargo_summary TEXT NOT NULL,
                  delivery_window TEXT NOT NULL,
                  access_notes TEXT NOT NULL,
                  selected_carrier_id TEXT REFERENCES carriers(id),
                  selected_tariff_id TEXT REFERENCES tariffs(id),
                  selected_amount TEXT NOT NULL DEFAULT '',
                  selection_status TEXT NOT NULL,
                  selection_note TEXT NOT NULL,
                  calculated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS dellin_quotes (
                  id TEXT PRIMARY KEY,
                  tender_id TEXT NOT NULL,
                  request_id TEXT NOT NULL UNIQUE,
                  input_json TEXT NOT NULL,
                  result_json TEXT NOT NULL,
                  calculated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS simple_calculations (
                  tender_id TEXT PRIMARY KEY,
                  request_id TEXT NOT NULL UNIQUE,
                  input_json TEXT NOT NULL,
                  route_json TEXT NOT NULL,
                  offers_json TEXT NOT NULL,
                  best_offer_json TEXT NOT NULL,
                  calculated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit_log (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  occurred_at TEXT NOT NULL,
                  entity_type TEXT NOT NULL,
                  entity_id TEXT NOT NULL,
                  action TEXT NOT NULL,
                  request_id TEXT NOT NULL UNIQUE,
                  summary TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS tariffs_carrier_idx ON tariffs(carrier_id);
                CREATE INDEX IF NOT EXISTS communications_carrier_idx ON communications(carrier_id, contacted_at DESC);
                CREATE INDEX IF NOT EXISTS dellin_quotes_tender_idx ON dellin_quotes(tender_id, calculated_at DESC);
                """
            )
            if self.seed_demo:
                self._seed(con)
            tariff_columns = {row[1] for row in con.execute("PRAGMA table_info(tariffs)")}
            if "enabled" not in tariff_columns:
                con.execute("ALTER TABLE tariffs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0")
                con.execute("UPDATE tariffs SET enabled=1 WHERE availability='AVAILABLE'")
            con.commit()

    def _seed(self, con: sqlite3.Connection) -> None:
        if con.execute("SELECT COUNT(*) FROM carriers").fetchone()[0]:
            return
        ts = now_iso()
        carriers = [
            ("manual-north", "Перевозчик «Север»", "ACTIVE", "MANUAL", "Выделенный транспорт", "", "Алексей", "", "", "", "Москва, МО, Санкт-Петербург, Ленинградская область", "Газель, 3 т, 5 т", "Оплата по счёту после рейса", "Цена с НДС", "Работа подтверждается звонком перед каждым рейсом", "Демонстрационная карточка ручного перевозчика", "", "NOT_APPLICABLE", "", "API не используется", ts, ts),
            ("manual-vector", "Транспортная служба «Вектор»", "ACTIVE", "MANUAL", "Городская и межгородская доставка", "", "Марина", "", "", "", "ЦФО, СЗФО", "Каблук, Газель, 5 т", "Предоплата 30%, остаток после доставки", "Цена с НДС", "Доступность уточняется по телефону", "Демонстрационная карточка ручного перевозчика", "", "NOT_APPLICABLE", "", "API не используется", ts, ts),
            ("manual-reserve", "Автопарк «Резерв»", "PAUSED", "MANUAL", "Выделенный транспорт", "", "Игорь", "", "", "", "Москва и Московская область", "Газель, 1,5 т", "По факту рейса", "НДС уточняется", "Использовать только после нового подтверждения условий", "Демонстрационная резервная карточка", "", "NOT_APPLICABLE", "", "API не используется", ts, ts),
            ("dellin", "Деловые Линии", "DRAFT", "API", "Сборные грузы и выделенный транспорт", "", "", "", "", "https://www.dellin.ru/", "Россия", "По данным перевозчика", "Не подтверждено", "", "API-карточка подготовлена, реальные тарифы не запрашиваются", "Учётные данные в демо не хранятся", "DELLIN", "NOT_CONNECTED", "", "Авторизация и контракт калькулятора не подтверждены", ts, ts),
            ("yandex-delivery", "Яндекс Доставка", "DRAFT", "API", "Городская и межгородская доставка", "", "", "", "", "https://dostavka.yandex.ru/", "Зоны обслуживания перевозчика", "По данным перевозчика", "Не подтверждено", "", "API-карточка подготовлена, реальные тарифы не запрашиваются", "OAuth-токен в демо не установлен", "YANDEX_DELIVERY", "NOT_CONNECTED", "", "Токен не установлен", ts, ts),
        ]
        con.executemany("INSERT INTO carriers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", carriers)
        tariffs = [
            ("tariff-north-msk-spb", "manual-north", "Москва - Санкт-Петербург, 3 т", "Фиксированная ставка", "58000.00", "", "", "58000.00", "RUB", "С НДС", "Москва", "Санкт-Петербург", "3 т", "3000", "18", "Подача машины, страхование ответственности", "Погрузка и разгрузка отдельно", "AVAILABLE", "PHONE", "Алексей", ts, "2026-09-30", ts, ts),
            ("tariff-north-city", "manual-north", "Москва и МО, Газель", "Подача + километраж", "5500.00", "48.00", "", "7000.00", "RUB", "С НДС", "Москва", "Москва и МО", "Газель", "1500", "12", "Подача машины", "Ожидание свыше 2 часов оплачивается отдельно", "AVAILABLE", "PHONE", "Алексей", ts, "2026-09-30", ts, ts),
            ("tariff-vector-msk-spb", "manual-vector", "Москва - Санкт-Петербург, 3 т", "Фиксированная ставка", "54500.00", "", "", "54500.00", "RUB", "С НДС", "Москва", "Санкт-Петербург", "3 т", "3000", "18", "Подача машины", "Требуется 30% предоплата", "AVAILABLE", "PHONE", "Марина", ts, "2026-09-20", ts, ts),
            ("tariff-vector-city", "manual-vector", "Москва, Газель", "Почасовой тариф", "", "", "1450.00", "5800.00", "RUB", "С НДС", "Москва", "Москва", "Газель", "1500", "12", "4 часа работы", "Платный въезд и простой отдельно", "LIMITED", "PHONE", "Марина", ts, "2026-09-20", ts, ts),
            ("tariff-reserve-city", "manual-reserve", "Москва, Газель", "Фиксированная ставка", "6900.00", "", "", "6900.00", "RUB", "НДС уточняется", "Москва", "Москва", "Газель", "1500", "10", "Подача машины", "Ставка требует нового звонка", "UNKNOWN", "PHONE", "Игорь", ts, "2026-09-12", ts, ts),
        ]
        con.executemany(
            """INSERT INTO tariffs (
                id, carrier_id, name, pricing_model, base_amount, per_km, per_hour,
                minimum_amount, currency, vat_note, route_from, route_to, vehicle_type,
                max_weight_kg, max_volume_m3, included_services, extra_conditions,
                availability, source_type, source_contact, confirmed_at, valid_until,
                created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            tariffs,
        )
        communications = [
            (str(uuid.uuid4()), "manual-north", ts, "Алексей", "PHONE", "Условия межгорода", "Подтверждена демонстрационная ставка до 30.09.2026", "2026-09-29", ts),
            (str(uuid.uuid4()), "manual-vector", ts, "Марина", "PHONE", "Тариф Москва - Санкт-Петербург", "Демонстрационная ставка, доступность машины проверять перед заказом", "2026-09-19", ts),
        ]
        con.executemany("INSERT INTO communications VALUES (?,?,?,?,?,?,?,?,?)", communications)
        con.execute(
            "INSERT INTO tender_logistics VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "SYNTHETIC-RECORD-01", "Синтетическая точка 03", "Синтетическая точка 04", "cfd",
                "37.437496", "55.671778", "37.70", "55.78", "29.60", "0.56",
                "14 040 шт.; масса и объём не подтверждены. Расчёт только для демонстрации интерфейса.",
                "По заявкам в течение 3 рабочих дней; до 30.11.2026",
                "Строение, окно приёмки, пропуск, подъезд и разгрузка требуют подтверждения.",
                "manual-north", "tariff-north-city", "7228.00", "PRELIMINARY_SELECTED",
                "Выбран минимальный действующий доступный тариф для этого направления. Вместимость по массе и объёму не проверена, пока параметры груза не подтверждены. Перед заказом нужен новый звонок перевозчику.", ts,
            ),
        )

    def _audit(self, con: sqlite3.Connection, entity_type: str, entity_id: str, action: str, request_id: str, summary: str) -> None:
        safe_id(request_id, "Идентификатор запроса")
        con.execute(
            "INSERT INTO audit_log(occurred_at,entity_type,entity_id,action,request_id,summary) VALUES(?,?,?,?,?,?)",
            (now_iso(), entity_type, entity_id, action, request_id, summary[:500]),
        )

    def summary(self) -> dict[str, Any]:
        with closing(self.connect()) as con:
            counts = con.execute(
                "SELECT COUNT(*) total, SUM(status='ACTIVE') active, SUM(channel='MANUAL') manual, SUM(api_status='READY') api_ready, SUM(api_status='NOT_CONNECTED') api_unavailable FROM carriers"
            ).fetchone()
            tariffs = con.execute("SELECT COUNT(*) total, SUM(enabled=1) enabled FROM tariffs").fetchone()
            return {"carriers": dict(counts), "tariffs": dict(tariffs), "database": "isolated-demo"}

    def list_carriers(self, query: str = "", status: str = "") -> list[dict[str, Any]]:
        sql = """SELECT c.*, COUNT(t.id) tariff_count,
                 SUM(CASE WHEN t.enabled=1 THEN 1 ELSE 0 END) available_tariff_count
                 FROM carriers c LEFT JOIN tariffs t ON t.carrier_id=c.id"""
        params: list[Any] = []
        where = []
        if query:
            where.append("(lower(c.name) LIKE ? OR lower(c.regions) LIKE ? OR lower(c.service_type) LIKE ?)")
            term = f"%{query.lower()}%"
            params.extend([term, term, term])
        if status:
            where.append("c.status=?")
            params.append(enum_value(status, ALLOWED_CARRIER_STATUSES, "Статус"))
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " GROUP BY c.id ORDER BY CASE c.status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END, lower(c.name)"
        with closing(self.connect()) as con:
            return [dict(row) for row in con.execute(sql, params)]

    def get_carrier(self, carrier_id: str) -> dict[str, Any]:
        carrier_id = safe_id(carrier_id)
        with closing(self.connect()) as con:
            carrier = rowdict(con.execute("SELECT * FROM carriers WHERE id=?", (carrier_id,)).fetchone())
            if not carrier:
                raise KeyError("Перевозчик не найден")
            carrier["tariffs"] = [dict(row) for row in con.execute("SELECT * FROM tariffs WHERE carrier_id=? ORDER BY enabled DESC, name", (carrier_id,))]
            carrier["communications"] = [dict(row) for row in con.execute("SELECT * FROM communications WHERE carrier_id=? ORDER BY contacted_at DESC LIMIT 30", (carrier_id,))]
            return carrier

    def save_carrier(self, payload: dict[str, Any], request_id: str, carrier_id: str | None = None) -> dict[str, Any]:
        carrier_id = safe_id(carrier_id or f"carrier-{uuid.uuid4().hex[:12]}")
        status = enum_value(payload.get("status", "DRAFT"), ALLOWED_CARRIER_STATUSES, "Статус")
        channel = enum_value(payload.get("channel", "MANUAL"), ALLOWED_CHANNELS, "Канал")
        api_status = enum_value(payload.get("api_status", "NOT_APPLICABLE" if channel == "MANUAL" else "NOT_CONNECTED"), ALLOWED_API_STATUSES, "Статус API")
        ts = now_iso()
        values = {
            "name": limited(payload.get("name"), 180, "Название", required=True),
            "service_type": limited(payload.get("service_type"), 180, "Вид услуг", required=True),
            "inn": limited(payload.get("inn"), 20, "ИНН"), "manager_name": limited(payload.get("manager_name"), 120, "Контакт"),
            "phone": limited(payload.get("phone"), 80, "Телефон"), "email": limited(payload.get("email"), 180, "Электронная почта"),
            "website": limited(payload.get("website"), 240, "Сайт"), "regions": limited(payload.get("regions"), 500, "Регионы"),
            "fleet": limited(payload.get("fleet"), 500, "Автопарк"), "payment_terms": limited(payload.get("payment_terms"), 500, "Оплата"),
            "vat_note": limited(payload.get("vat_note"), 120, "НДС"), "reliability_note": limited(payload.get("reliability_note"), 500, "Надёжность"),
            "notes": limited(payload.get("notes"), 2000, "Примечание"), "api_provider": limited(payload.get("api_provider"), 80, "Провайдер API"),
            "api_last_check": limited(payload.get("api_last_check"), 60, "Последняя проверка API"), "api_message": limited(payload.get("api_message"), 500, "Сообщение API"),
        }
        with closing(self.connect()) as con:
            exists = con.execute("SELECT 1 FROM carriers WHERE id=?", (carrier_id,)).fetchone()
            if exists:
                assignments = ",".join(f"{key}=?" for key in values)
                con.execute(f"UPDATE carriers SET {assignments}, status=?, channel=?, api_status=?, updated_at=? WHERE id=?", (*values.values(), status, channel, api_status, ts, carrier_id))
                action = "UPDATE"
            else:
                columns = ["id", *values.keys(), "status", "channel", "api_status", "created_at", "updated_at"]
                con.execute(f"INSERT INTO carriers ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", (carrier_id, *values.values(), status, channel, api_status, ts, ts))
                action = "CREATE"
            self._audit(con, "carrier", carrier_id, action, request_id, values["name"])
            con.commit()
        return self.get_carrier(carrier_id)

    def save_tariff(self, carrier_id: str, payload: dict[str, Any], request_id: str, tariff_id: str | None = None) -> dict[str, Any]:
        carrier_id = safe_id(carrier_id)
        tariff_id = safe_id(tariff_id or f"tariff-{uuid.uuid4().hex[:12]}")
        ts = now_iso()
        values = {
            "name": limited(payload.get("name"), 180, "Название тарифа", required=True),
            "pricing_model": limited(payload.get("pricing_model"), 120, "Модель цены", required=True),
            "base_amount": money(payload.get("base_amount")), "per_km": money(payload.get("per_km")),
            "per_hour": money(payload.get("per_hour")), "minimum_amount": money(payload.get("minimum_amount")),
            "currency": "RUB", "vat_note": limited(payload.get("vat_note"), 120, "НДС"),
            "route_from": limited(payload.get("route_from"), 180, "Откуда"), "route_to": limited(payload.get("route_to"), 180, "Куда"),
            "vehicle_type": limited(payload.get("vehicle_type"), 120, "Машина"), "max_weight_kg": money(payload.get("max_weight_kg")),
            "max_volume_m3": money(payload.get("max_volume_m3")), "included_services": limited(payload.get("included_services"), 500, "Включено"),
            "extra_conditions": limited(payload.get("extra_conditions"), 1000, "Дополнительные условия"),
        }
        if not any(values[key] for key in ("base_amount", "per_km", "per_hour")):
            raise ValueError("Укажи хотя бы одну составляющую цены")
        with closing(self.connect()) as con:
            if not con.execute("SELECT 1 FROM carriers WHERE id=?", (carrier_id,)).fetchone():
                raise KeyError("Перевозчик не найден")
            existing = con.execute("SELECT * FROM tariffs WHERE id=?", (tariff_id,)).fetchone()
            if existing and existing["carrier_id"] != carrier_id:
                raise KeyError("Тариф этого перевозчика не найден")
            if existing:
                assignments = ",".join(f"{key}=?" for key in values)
                enabled = enabled_value(payload.get("enabled", existing["enabled"]))
                availability = "AVAILABLE" if enabled else "UNAVAILABLE"
                con.execute(
                    f"UPDATE tariffs SET {assignments}, enabled=?, availability=?, updated_at=? WHERE id=? AND carrier_id=?",
                    (*values.values(), enabled, availability, ts, tariff_id, carrier_id),
                )
                action = "UPDATE"
            else:
                enabled = enabled_value(payload.get("enabled", True))
                columns = ["id", "carrier_id", *values.keys(), "availability", "source_type", "enabled", "created_at", "updated_at"]
                con.execute(f"INSERT INTO tariffs ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", (tariff_id, carrier_id, *values.values(), "AVAILABLE" if enabled else "UNAVAILABLE", "OTHER", enabled, ts, ts))
                action = "CREATE"
            self._audit(con, "tariff", tariff_id, action, request_id, values["name"])
            con.commit()
            return dict(con.execute("SELECT * FROM tariffs WHERE id=?", (tariff_id,)).fetchone())

    def add_communication(self, carrier_id: str, payload: dict[str, Any], request_id: str) -> dict[str, Any]:
        carrier_id = safe_id(carrier_id)
        item_id = str(uuid.uuid4())
        ts = now_iso()
        values = (
            item_id, carrier_id, limited(payload.get("contacted_at") or ts, 60, "Дата контакта", required=True),
            limited(payload.get("contact_name"), 120, "Контакт"), limited(payload.get("channel") or "PHONE", 40, "Канал"),
            limited(payload.get("subject"), 180, "Тема", required=True), limited(payload.get("result"), 1500, "Результат", required=True),
            limited(payload.get("next_check_at"), 60, "Следующая проверка"), ts,
        )
        with closing(self.connect()) as con:
            if not con.execute("SELECT 1 FROM carriers WHERE id=?", (carrier_id,)).fetchone():
                raise KeyError("Перевозчик не найден")
            con.execute("INSERT INTO communications VALUES (?,?,?,?,?,?,?,?,?)", values)
            self._audit(con, "communication", item_id, "CREATE", request_id, values[5])
            con.commit()
            return dict(con.execute("SELECT * FROM communications WHERE id=?", (item_id,)).fetchone())

    @staticmethod
    def tariff_amount(tariff: sqlite3.Row, distance_km: Decimal, duration_hours: Decimal) -> Decimal | None:
        try:
            return preliminary_manual_tariff_price(
                pricing_model=tariff["pricing_model"], base_amount=tariff["base_amount"], per_km=tariff["per_km"],
                per_hour=tariff["per_hour"], minimum_amount=tariff["minimum_amount"], distance_km=distance_km,
                duration_hours=duration_hours,
            )
        except ValueError:
            return None

    @staticmethod
    def location_matches(pattern: str, address: str) -> bool:
        """Conservative route match for manually entered city/region labels."""
        pattern = str(pattern or "").casefold().replace("ё", "е")
        address = str(address or "").casefold().replace("ё", "е")
        if not pattern:
            return True
        if pattern in address:
            return True
        stop = {"и", "мо", "ло", "рф", "цфо", "сзфо", "область", "район", "город", "по", "согласованию"}
        words = [word for word in re.findall(r"[а-яa-z0-9]+", pattern) if len(word) > 2 and word not in stop]
        return bool(words) and all(word in address for word in words)

    @staticmethod
    def standard_pickup(map_region: str) -> dict[str, str]:
        try:
            return dict(STANDARD_PICKUP_BY_REGION[str(map_region or "cfd").casefold()])
        except KeyError as exc:
            raise ValueError("Для региона не задан стандартный склад") from exc

    def best_tariff(self, con: sqlite3.Connection, route: dict[str, Any]) -> tuple[Decimal, sqlite3.Row] | None:
        rows = con.execute(
            """SELECT t.*, c.name carrier_name FROM tariffs t JOIN carriers c ON c.id=t.carrier_id
               WHERE c.status='ACTIVE' AND t.enabled=1"""
        ).fetchall()
        distance = Decimal(str(route["distance_km"]))
        duration = Decimal(str(route["duration_hours"]))
        candidates = []
        for row in rows:
            if not self.location_matches(row["route_from"], route["pickup_address"]):
                continue
            if not self.location_matches(row["route_to"], route["delivery_address"]):
                continue
            amount = self.tariff_amount(row, distance, duration)
            if amount is not None:
                candidates.append((amount, row))
        candidates.sort(key=lambda item: (item[0], item[1]["carrier_name"], item[1]["name"]))
        return candidates[0] if candidates else None

    def tender_logistics(self, tender_id: str) -> dict[str, Any]:
        tender_id = safe_id(tender_id, "Тендер")
        with closing(self.connect()) as con:
            route = rowdict(con.execute("SELECT * FROM tender_logistics WHERE tender_id=?", (tender_id,)).fetchone())
            if not route:
                route = {
                    "tender_id": tender_id, "pickup_address": STANDARD_PICKUP_BY_REGION["cfd"]["address"], "delivery_address": "",
                    "delivery_address_status": "MISSING", "delivery_address_reason": "Адрес приёмки не подтверждён документами закупки", "delivery_address_source": "MISSING",
                    "map_region": "cfd", "pickup_lon": STANDARD_PICKUP_BY_REGION["cfd"]["lon"], "pickup_lat": STANDARD_PICKUP_BY_REGION["cfd"]["lat"], "delivery_lon": "", "delivery_lat": "", "distance_km": "", "duration_hours": "", "cargo_summary": "Параметры груза не подтверждены",
                    "delivery_window": "Не подтверждено", "access_notes": "До выбора машины проверить пропуск, подъезд и разгрузку",
                    "selected_amount": "", "selection_status": "NEEDS_DATA", "selection_note": "Нужны адрес, масса, объём и срок поставки",
                    "calculated_at": "", "selected_carrier": None, "selected_tariff": None,
                }
                route["dellin_quote"] = self.latest_dellin_quote(con, tender_id)
                return route
            selected = self.best_tariff(con, route)
            if selected:
                amount, tariff = selected
                route["selected_amount"] = str(amount)
                route["selected_carrier_id"] = tariff["carrier_id"]
                route["selected_tariff_id"] = tariff["id"]
                route["selection_status"] = "PRELIMINARY_SELECTED"
                route["selection_note"] = "Выбран минимальный действующий доступный тариф для этого направления. Вместимость по массе и объёму не проверена, пока параметры груза не подтверждены. Перед заказом нужен новый звонок перевозчику."
            else:
                route["selected_amount"] = ""
                route["selected_carrier_id"] = None
                route["selected_tariff_id"] = None
                route["selection_status"] = "NO_AVAILABLE_TARIFF"
                route["selection_note"] = "Для этого направления нет действующего доступного тарифа"
            route["selected_carrier"] = rowdict(con.execute("SELECT * FROM carriers WHERE id=?", (route["selected_carrier_id"],)).fetchone()) if route.get("selected_carrier_id") else None
            route["selected_tariff"] = rowdict(con.execute("SELECT * FROM tariffs WHERE id=?", (route["selected_tariff_id"],)).fetchone()) if route.get("selected_tariff_id") else None
            route.pop("pickup_lon", None); route.pop("pickup_lat", None); route.pop("delivery_lon", None); route.pop("delivery_lat", None)
            route["dellin_quote"] = self.latest_dellin_quote(con, tender_id)
            return route

    @staticmethod
    def latest_dellin_quote(con: sqlite3.Connection, tender_id: str) -> dict[str, Any] | None:
        row = con.execute(
            "SELECT input_json,result_json,calculated_at FROM dellin_quotes WHERE tender_id=? ORDER BY calculated_at DESC,id DESC LIMIT 1",
            (tender_id,),
        ).fetchone()
        if not row:
            return None
        result = json.loads(row["result_json"])
        result["input"] = json.loads(row["input_json"])
        result["calculated_at"] = row["calculated_at"]
        return result

    def save_dellin_quote(self, tender_id: str, request_input: dict[str, Any], result: dict[str, Any], request_id: str) -> dict[str, Any]:
        tender_id = safe_id(tender_id, "Тендер")
        safe_id(request_id, "Идентификатор запроса")
        ts = now_iso()
        with closing(self.connect()) as con:
            con.execute(
                "INSERT INTO dellin_quotes(id,tender_id,request_id,input_json,result_json,calculated_at) VALUES(?,?,?,?,?,?)",
                (str(uuid.uuid4()), tender_id, request_id, json.dumps(request_input, ensure_ascii=False, sort_keys=True), json.dumps(result, ensure_ascii=False, sort_keys=True), ts),
            )
            self._audit(con, "dellin_quote", tender_id, "CALCULATE", request_id + "-audit", f"Предварительная стоимость {result.get('price', '')} ₽")
            con.commit()
            return self.latest_dellin_quote(con, tender_id) or result

    def calculate_tender(self, tender_id: str, payload: dict[str, Any], request_id: str) -> dict[str, Any]:
        tender_id = safe_id(tender_id, "Тендер")
        distance = Decimal(money(payload.get("distance_km"), allow_empty=False))
        duration = Decimal(money(payload.get("duration_hours"), allow_empty=False))
        ts = now_iso()
        with closing(self.connect()) as con:
            map_region = enum_value(payload.get("map_region", "cfd"), {"CFD", "NWFD"}, "Регион карты").lower()
            pickup = self.standard_pickup(map_region)
            route_for_selection = {**payload, "pickup_address": pickup["address"], "pickup_lon": pickup["lon"], "pickup_lat": pickup["lat"], "map_region": map_region, "distance_km": str(distance), "duration_hours": str(duration)}
            selected = self.best_tariff(con, route_for_selection)
            selected_amount = str(selected[0]) if selected else ""
            selected_carrier_id = selected[1]["carrier_id"] if selected else None
            selected_tariff_id = selected[1]["id"] if selected else None
            status = "PRELIMINARY_SELECTED" if selected else "NO_AVAILABLE_TARIFF"
            note = "Предварительно выбран минимальный доступный тариф. Перед заказом нужен новый звонок перевозчику." if selected else "Нет активного доступного тарифа"
            values = (
                tender_id, pickup["address"], limited(payload.get("delivery_address"), 500, "Адрес приёмки", required=True),
                map_region,
                pickup["lon"], pickup["lat"],
                money(payload.get("delivery_lon"), allow_empty=False), money(payload.get("delivery_lat"), allow_empty=False),
                str(distance), str(duration), limited(payload.get("cargo_summary"), 1000, "Груз", required=True),
                limited(payload.get("delivery_window"), 500, "Окно поставки"), limited(payload.get("access_notes"), 1000, "Условия приёмки"),
                selected_carrier_id, selected_tariff_id, selected_amount, status, note, ts,
            )
            con.execute("""INSERT INTO tender_logistics VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(tender_id) DO UPDATE SET pickup_address=excluded.pickup_address,delivery_address=excluded.delivery_address,map_region=excluded.map_region,
                pickup_lon=excluded.pickup_lon,pickup_lat=excluded.pickup_lat,delivery_lon=excluded.delivery_lon,delivery_lat=excluded.delivery_lat,
                distance_km=excluded.distance_km,duration_hours=excluded.duration_hours,cargo_summary=excluded.cargo_summary,delivery_window=excluded.delivery_window,
                access_notes=excluded.access_notes,selected_carrier_id=excluded.selected_carrier_id,selected_tariff_id=excluded.selected_tariff_id,
                selected_amount=excluded.selected_amount,selection_status=excluded.selection_status,selection_note=excluded.selection_note,calculated_at=excluded.calculated_at""", values)
            self._audit(con, "tender_logistics", tender_id, "CALCULATE", request_id, note)
            con.commit()
        return self.tender_logistics(tender_id)

    def route_coordinates(self, tender_id: str) -> dict[str, Any] | None:
        tender_id = safe_id(tender_id, "Тендер")
        with closing(self.connect()) as con:
            simple = con.execute("SELECT route_json FROM simple_calculations WHERE tender_id=?", (tender_id,)).fetchone()
            if simple:
                route = json.loads(simple["route_json"])
                if route.get("stops") or route.get("source_fingerprint"):
                    return route
                return {key: route.get(key) for key in ("pickup_lon", "pickup_lat", "delivery_lon", "delivery_lat", "map_region")}
            row = con.execute("SELECT pickup_lon,pickup_lat,delivery_lon,delivery_lat,map_region FROM tender_logistics WHERE tender_id=?", (tender_id,)).fetchone()
            return dict(row) if row else None

    @staticmethod
    def standard_cargo(delivery_address: str) -> dict[str, Any]:
        """Return the explicit stock assumption with its provenance marker."""
        return {
            "delivery_address": str(delivery_address or "").strip(),
            "cargo_places": PRELIMINARY_CARGO["places"],
            "weight_kg": PRELIMINARY_CARGO["weight_kg"],
            "volume_m3": "",
            "length_m": PRELIMINARY_CARGO["length_m"],
            "width_m": PRELIMINARY_CARGO["width_m"],
            "height_m": PRELIMINARY_CARGO["height_m"],
            "stated_value": PRELIMINARY_CARGO["stated_value"],
            "preliminary_cargo": {
                "enabled": True,
                "distribution": "conditional_equal_by_source_order",
                "note": "Предварительный груз — не из документов. Распределение по адресам условное",
                "warning": "",
            },
        }

    def manual_simple_offers(
        self,
        con: sqlite3.Connection,
        route: dict[str, Any],
        request_input: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Rebuild manual offers from current enabled tariffs without an API call."""
        distance = positive_decimal(route.get("distance_km"), "Расстояние")
        manual_rows = con.execute(
            """SELECT c.id carrier_id,c.name carrier_name,t.id tariff_id,t.name tariff_name,t.*
               FROM carriers c JOIN tariffs t ON t.carrier_id=c.id
               WHERE c.status='ACTIVE' AND c.channel='MANUAL' AND t.enabled=1
               ORDER BY lower(c.name),lower(t.name)"""
        ).fetchall()
        offers: list[dict[str, Any]] = []
        for row in manual_rows:
            stops = route.get("stops") or []
            if not self.location_matches(row["route_from"], route["pickup_address"]):
                continue
            if stops:
                # Fixed one-address tariffs are never silently promoted to a full multi-stop route.
                if "фикс" in str(row["pricing_model"] or "").casefold():
                    continue
                if any(not self.location_matches(row["route_to"], stop.get("delivery_address", "")) for stop in stops):
                    continue
            elif not self.location_matches(row["route_to"], route["delivery_address"]):
                continue
            if row["max_weight_kg"] and Decimal(str(request_input["weight_kg"])) > Decimal(row["max_weight_kg"]):
                continue
            if row["max_volume_m3"] and Decimal(str(request_input["volume_m3"])) > Decimal(row["max_volume_m3"]):
                continue
            amount = self.tariff_amount(row, distance, Decimal(str(route["duration_hours"])))
            if amount is None:
                continue
            offers.append({
                "carrier_id": row["carrier_id"],
                "carrier_name": row["carrier_name"],
                "tariff_id": row["tariff_id"],
                "tariff_name": row["tariff_name"],
                "channel": "MANUAL",
                "method": row["pricing_model"],
                "pricing_model": row["pricing_model"],
                "base_amount": row["base_amount"],
                "per_km": row["per_km"],
                "per_hour": row["per_hour"],
                "minimum_amount": row["minimum_amount"],
                "distance_km": format(distance, "f"),
                "amount": format(amount, "f"),
                "currency": "RUB",
                "vat_note": row["vat_note"] or "Не подтверждено",
                "status": "CALCULATED",
                "scope": "full_route" if stops else "single_address",
                "basis": "Суммарные расстояние и время маршрута; база и минимум применены один раз" if stops else "Один адрес",
                "note": "Предварительная цена: возврат, разгрузка и простой не подтверждены." if stops else "Предварительная цена; перед заказом нужен новый звонок перевозчику.",
            })
        return offers

    @staticmethod
    def stored_api_offers(con: sqlite3.Connection, stored_offers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Keep saved API responses intact; only manual offers are derived again."""
        manual_carrier_ids = {
            row["id"] for row in con.execute("SELECT id FROM carriers WHERE channel='MANUAL'")
        }
        return [offer for offer in stored_offers if offer.get("carrier_id") not in manual_carrier_ids]

    @staticmethod
    def ordered_offers(offers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(
            offers,
            key=lambda item: (Decimal(str(item["amount"])), item.get("carrier_name", ""), item.get("tariff_name", "")),
        )

    def simple_tender_logistics(self, tender_id: str, delivery_address: str) -> dict[str, Any]:
        tender_id = safe_id(tender_id, "Тендер")
        with closing(self.connect()) as con:
            row = con.execute(
                "SELECT input_json,route_json,offers_json,best_offer_json,calculated_at FROM simple_calculations WHERE tender_id=?",
                (tender_id,),
            ).fetchone()
            legacy = con.execute(
                """SELECT l.*, c.name AS carrier_name, t.name AS tariff_name, t.pricing_model
                   FROM tender_logistics l
                   LEFT JOIN carriers c ON c.id=l.selected_carrier_id
                   LEFT JOIN tariffs t ON t.id=l.selected_tariff_id
                   WHERE l.tender_id=?""",
                (tender_id,),
            ).fetchone()
            legacy_quote = self.latest_dellin_quote(con, tender_id)
        if not row:
            if legacy:
                offers: list[dict[str, Any]] = []
                try:
                    amount = positive_decimal(legacy["selected_amount"], "Сохранённая стоимость")
                except ValueError:
                    amount = None
                if amount is not None:
                    offers.append({
                        "carrier_id": legacy["selected_carrier_id"] or "legacy",
                        "carrier_name": legacy["carrier_name"] or legacy["selected_carrier_id"] or "Сохранённый логист",
                        "tariff_id": legacy["selected_tariff_id"] or "legacy",
                        "tariff_name": legacy["tariff_name"] or "Сохранённый тариф",
                        "method": legacy["pricing_model"] or "Сохранённый выбор",
                        "pricing_model": legacy["pricing_model"] or "Сохранённый выбор",
                        "amount": format(amount, "f"),
                        "currency": "RUB",
                        "status": "SAVED_LEGACY",
                    })
                saved_delivery = legacy["delivery_address"] or delivery_address
                return {
                    "tender_id": tender_id,
                    **self.standard_cargo(saved_delivery),
                    "pickup_address": legacy["pickup_address"] or "",
                    "warehouse_code": "",
                    "pickup_lon": legacy["pickup_lon"] or "",
                    "pickup_lat": legacy["pickup_lat"] or "",
                    "delivery_lon": legacy["delivery_lon"] or "",
                    "delivery_lat": legacy["delivery_lat"] or "",
                    "map_region": legacy["map_region"] or "cfd",
                    "distance_km": legacy["distance_km"] or "",
                    "duration_hours": legacy["duration_hours"] or "",
                    "offers": offers,
                    "best_offer": offers[0] if offers else None,
                    "calculated_at": legacy["calculated_at"] or "",
                    "dellin_quote": legacy_quote,
                    "legacy_record": True,
                }
            return {
                "tender_id": tender_id,
                **self.standard_cargo(delivery_address),
                "pickup_address": "",
                "warehouse_code": "",
                "distance_km": "",
                "duration_hours": "",
                "offers": [],
                "best_offer": None,
                "calculated_at": "",
                "dellin_quote": legacy_quote,
                "legacy_record": False,
            }
        request_input = json.loads(row["input_json"])
        route = json.loads(row["route_json"])
        stored_offers = json.loads(row["offers_json"])
        with closing(self.connect()) as con:
            offers = self.ordered_offers(
                self.manual_simple_offers(con, route, request_input)
                + self.stored_api_offers(con, stored_offers)
            )
        best_offer = offers[0] if offers else None
        return {
            "tender_id": tender_id,
            **route,
            **request_input,
            "offers": offers,
            "best_offer": best_offer,
            "calculated_at": row["calculated_at"],
            "dellin_quote": route.get("dellin_quote") or legacy_quote,
            "legacy_record": False,
        }

    def save_simple_calculation(
        self,
        tender_id: str,
        request_input: dict[str, Any],
        route: dict[str, Any],
        dellin_result: dict[str, Any],
        request_id: str,
    ) -> dict[str, Any]:
        tender_id = safe_id(tender_id, "Тендер")
        safe_id(request_id, "Идентификатор запроса")
        try:
            places = int(str(request_input.get("cargo_places", "")).strip())
        except ValueError as exc:
            raise ValueError("Количество мест должно быть целым числом") from exc
        volume = cargo_volume_m3(
            places,
            request_input.get("length_m"),
            request_input.get("width_m"),
            request_input.get("height_m"),
        )
        raw_stops = request_input.get("delivery_stops")
        raw_split = request_input.get("dellin_split")
        if raw_stops is not None and (not isinstance(raw_stops, list) or len(raw_stops) > 12 or any(not isinstance(stop, dict) or not str(stop.get("delivery_address") or "").strip() for stop in raw_stops)):
            raise ValueError("Некорректные данные точек доставки")
        if isinstance(raw_split, list) and len(raw_split) > 12:
            raise ValueError("Слишком много частей груза")
        preliminary = request_input.get("preliminary_cargo")
        if preliminary is None:
            preliminary = {}
        elif not isinstance(preliminary, dict):
            raise ValueError("Поле «preliminary_cargo» должно быть объектом")
        enabled = preliminary.get("enabled", False)
        if not isinstance(enabled, bool):
            raise ValueError("Поле «preliminary_cargo.enabled» должно быть логическим значением")
        clean_input = {
            "delivery_address": limited(request_input.get("delivery_address"), 500, "Точка Б", required=True),
            "delivery_addresses": [limited(value, 500, "Адрес доставки", required=True) for value in request_input.get("delivery_addresses", [request_input.get("delivery_address")])],
            "delivery_stops": [
                {key: stop[key] for key in ("delivery_address", "delivery_lat", "delivery_lon", "resolved_address", "registry_id", "source_index", "source_delivery_address", "needs_review", "route_order") if key in stop}
                for stop in (raw_stops or [])[:12]
            ],
            "dellin_split": [
                {key: split[key] for key in ("places", "weight_kg", "stated_value") if key in split} if isinstance(split, dict) else {}
                for split in (raw_split or [])[:12]
            ] if isinstance(raw_split, list) else [],
            "source_fingerprint": limited(request_input.get("source_fingerprint"), 128, "Отпечаток источника"),
            "preliminary_cargo": {
                "enabled": enabled,
                "distribution": "conditional_equal_by_source_order" if enabled else "",
                "note": "Предварительный груз — не из документов. Распределение по адресам условное" if enabled else "",
                "warning": str(preliminary.get("warning") or "")[:300] if enabled else "",
            },
            "cargo_places": places,
            "weight_kg": format(positive_decimal(request_input.get("weight_kg"), "Общий вес"), "f"),
            "volume_m3": format(volume, "f"),
            "length_m": format(positive_decimal(request_input.get("length_m"), "Длина места"), "f"),
            "width_m": format(positive_decimal(request_input.get("width_m"), "Ширина места"), "f"),
            "height_m": format(positive_decimal(request_input.get("height_m"), "Высота места"), "f"),
            "stated_value": money(request_input.get("stated_value"), allow_empty=False),
        }
        with closing(self.connect()) as con:
            offers = self.manual_simple_offers(con, route, clean_input)
            dellin_amount = positive_decimal(dellin_result.get("price"), "Стоимость Деловых Линий") if dellin_result.get("price") not in (None, "") else None
            if dellin_amount is not None:
                offers.append({
                "carrier_id": "dellin",
                "carrier_name": "Деловые Линии",
                "tariff_id": "dellin-api",
                "tariff_name": "Отдельные отправки по адресам" if route.get("stops") else "Предварительный расчёт",
                "method": "Условия Деловых Линий",
                "pricing_model": "Предложение API",
                "amount": format(dellin_amount.quantize(Decimal("0.01")), "f") if route.get("stops") else format(dellin_amount.quantize(Decimal("1"), rounding=ROUND_CEILING), "f"),
                "currency": "RUB",
                "vat_note": dellin_result.get("vat_note") or "НДС не подтверждён API",
                "delivery_term_days": dellin_result.get("delivery_term_days"),
                "status": "CALCULATED",
                **({
                    "basis": "Сумма отдельных отправок: склад → каждая точка; это не единый последовательный рейс",
                    "breakdown": dellin_result.get("breakdown", []),
                    "note": "Предварительная стоимость: возврат, разгрузка и простой не подтверждены.",
                    "provider": dellin_result.get("provider", "dellin"),
                    "scope": dellin_result.get("scope", "multi_address"),
                } if route.get("stops") else {}),
                })
            offers = self.ordered_offers(offers)
            best_offer = offers[0] if offers else None
            safe_route = {
                key: ({"source_fingerprint": clean_input["source_fingerprint"]}.get(key, route.get(key)))
                for key in (
                    "warehouse_code", "warehouse_city", "pickup_address", "pickup_lat", "pickup_lon",
                    "delivery_address", "resolved_address", "delivery_lat", "delivery_lon", "map_region",
                    "distance_km", "duration_hours", "geometry", "stops", "route_order", "optimization", "source_fingerprint", "dellin_quote",
                )
            }
            ts = now_iso()
            con.execute(
                """INSERT INTO simple_calculations(tender_id,request_id,input_json,route_json,offers_json,best_offer_json,calculated_at)
                   VALUES(?,?,?,?,?,?,?)
                   ON CONFLICT(tender_id) DO UPDATE SET request_id=excluded.request_id,input_json=excluded.input_json,
                   route_json=excluded.route_json,offers_json=excluded.offers_json,best_offer_json=excluded.best_offer_json,
                   calculated_at=excluded.calculated_at""",
                (
                    tender_id,
                    request_id,
                    json.dumps(clean_input, ensure_ascii=False, sort_keys=True),
                    json.dumps(safe_route, ensure_ascii=False, sort_keys=True),
                    json.dumps(offers, ensure_ascii=False, sort_keys=True),
                    json.dumps(best_offer, ensure_ascii=False, sort_keys=True),
                    ts,
                ),
            )
            self._audit(con, "simple_calculation", tender_id, "CALCULATE", f"{request_id[:72]}-audit", f"{best_offer['carrier_name']}, {best_offer['amount']} ₽ с НДС" if best_offer else "Полный маршрут сохранён; подтверждённый тариф развоза отсутствует")
            con.commit()
        return self.simple_tender_logistics(tender_id, clean_input["delivery_address"])
