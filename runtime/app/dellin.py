from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx


AUTH_PATH = "/v3/auth/login.json"
CALCULATOR_PATH = "/v2/calculator.json"


class DellinError(RuntimeError):
    """Безопасная ошибка API без учётных данных и идентификатора сессии."""


def _text(value: Any, title: str, limit: int = 500) -> str:
    result = str(value or "").strip()
    if not result:
        raise ValueError(f"Поле «{title}» обязательно")
    if len(result) > limit:
        raise ValueError(f"Поле «{title}» длиннее {limit} символов")
    return result


def _positive(value: Any, title: str) -> Decimal:
    try:
        result = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Поле «{title}» должно быть числом") from exc
    if not result.is_finite() or result <= 0:
        raise ValueError(f"Поле «{title}» должно быть больше нуля")
    return result


def _nonnegative(value: Any, title: str) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    try:
        result = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Поле «{title}» должно быть числом") from exc
    if not result.is_finite() or result < 0:
        raise ValueError(f"Поле «{title}» не может быть отрицательным")
    return result


@dataclass(frozen=True)
class DellinInput:
    pickup_address: str
    delivery_address: str
    cargo_places: int
    weight_kg: str
    volume_m3: str
    length_m: str
    width_m: str
    height_m: str
    stated_value: str = "0"

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "DellinInput":
        pickup = _text(payload.get("pickup_address"), "Адрес отправления")
        delivery = _text(payload.get("delivery_address"), "Адрес получения")
        try:
            places = int(str(payload.get("cargo_places", "")).strip())
        except ValueError as exc:
            raise ValueError("Поле «Количество мест» должно быть целым числом") from exc
        if places <= 0 or places > 10000:
            raise ValueError("Поле «Количество мест» должно быть от 1 до 10000")
        values = {
            "weight_kg": _positive(payload.get("weight_kg"), "Общий вес, кг"),
            "volume_m3": _positive(payload.get("volume_m3"), "Общий объём, м³"),
            "length_m": _positive(payload.get("length_m"), "Длина места, м"),
            "width_m": _positive(payload.get("width_m"), "Ширина места, м"),
            "height_m": _positive(payload.get("height_m"), "Высота места, м"),
            "stated_value": _nonnegative(payload.get("stated_value"), "Объявленная стоимость, ₽"),
        }
        return cls(pickup, delivery, places, **{key: format(value, "f") for key, value in values.items()})

    def request_payload(self, appkey: str, session_id: str) -> dict[str, Any]:
        return {
            "appkey": appkey,
            "sessionID": session_id,
            "delivery": {
                "deliveryType": {"type": "auto"},
                "derival": {"variant": "address", "address": {"search": self.pickup_address}},
                "arrival": {"variant": "address", "address": {"search": self.delivery_address}},
            },
            "cargo": {
                "quantity": self.cargo_places,
                "length": float(Decimal(self.length_m)),
                "width": float(Decimal(self.width_m)),
                "height": float(Decimal(self.height_m)),
                "volume": float(Decimal(self.volume_m3)),
                "weight": float(Decimal(self.weight_kg)),
                "totalVolume": float(Decimal(self.volume_m3)),
                "totalWeight": float(Decimal(self.weight_kg)),
                "oversizedVolume": 0,
                "oversizedWeight": 0,
                "statedValue": float(Decimal(self.stated_value)),
            },
        }

    def public_dict(self) -> dict[str, Any]:
        return {
            "pickup_address": self.pickup_address,
            "delivery_address": self.delivery_address,
            "cargo_places": self.cargo_places,
            "weight_kg": self.weight_kg,
            "volume_m3": self.volume_m3,
            "length_m": self.length_m,
            "width_m": self.width_m,
            "height_m": self.height_m,
            "stated_value": self.stated_value,
        }


class DellinCalculator:
    def __init__(self, appkey: str, login: str, password: str, *, transport: httpx.BaseTransport | None = None):
        if not all(str(value).strip() for value in (appkey, login, password)):
            raise ValueError("Не настроены учётные данные Деловых Линий")
        self.appkey = appkey.strip()
        self.login = login.strip()
        self.password = password
        self.transport = transport

    def _post(self, client: httpx.Client, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = client.post(path, json=body)
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise DellinError("Сервис Деловых Линий временно недоступен") from exc
        if response.status_code >= 400:
            errors = data.get("errors") if isinstance(data, dict) else None
            message = ""
            if isinstance(errors, list):
                message = "; ".join(str(item.get("title") or item.get("detail") or "Ошибка расчёта") for item in errors if isinstance(item, dict))
            raise DellinError(message[:500] or f"Деловые Линии вернули ошибку {response.status_code}")
        if not isinstance(data, dict):
            raise DellinError("Деловые Линии вернули ответ неизвестного формата")
        return data

    def calculate(self, request: DellinInput) -> dict[str, Any]:
        with httpx.Client(base_url="https://api.dellin.ru", timeout=45, transport=self.transport, headers={"Accept": "application/json", "User-Agent": "okan-logistics-panel/0.6"}) as client:
            auth = self._post(client, AUTH_PATH, {"appkey": self.appkey, "login": self.login, "password": self.password})
            session_id = ((auth.get("data") or {}).get("sessionID") if isinstance(auth.get("data"), dict) else None)
            if not session_id:
                raise DellinError("Деловые Линии не вернули идентификатор сессии")
            return self._calculate_with_client(client, session_id, request)

    def calculate_many(self, requests: list[DellinInput]) -> list[dict[str, Any]]:
        if not requests or len(requests) > 12:
            raise ValueError("Количество отправок Деловых Линий должно быть от 1 до 12")
        with httpx.Client(base_url="https://api.dellin.ru", timeout=45, transport=self.transport, headers={"Accept": "application/json", "User-Agent": "okan-logistics-panel/0.6"}) as client:
            auth = self._post(client, AUTH_PATH, {"appkey": self.appkey, "login": self.login, "password": self.password})
            session_id = ((auth.get("data") or {}).get("sessionID") if isinstance(auth.get("data"), dict) else None)
            if not session_id:
                raise DellinError("Деловые Линии не вернули идентификатор сессии")
            return [self._calculate_with_client(client, session_id, request) for request in requests]

    def _calculate_with_client(self, client: httpx.Client, session_id: str, request: DellinInput) -> dict[str, Any]:
        response = self._post(client, CALCULATOR_PATH, request.request_payload(self.appkey, session_id))
        data = response.get("data")
        if not isinstance(data, dict) or data.get("price") is None:
            raise DellinError("В ответе Деловых Линий отсутствует итоговая стоимость")
        try:
            price = Decimal(str(data["price"]))
        except (InvalidOperation, ValueError) as exc:
            raise DellinError("Деловые Линии вернули некорректную стоимость") from exc
        if not price.is_finite() or price <= 0:
            raise DellinError("Деловые Линии вернули некорректную стоимость")
        information = data.get("information")
        return {
            "provider": "dellin",
            "status": "calculated",
            "price": f"{price:.2f}",
            "currency": "RUB",
            "delivery_term_days": data.get("deliveryTerm"),
            "information": [str(item)[:300] for item in information] if isinstance(information, list) else [],
            "source": "Деловые Линии /v2/calculator.json",
        }
