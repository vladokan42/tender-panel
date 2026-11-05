from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
from math import asin, cos, radians, sin, sqrt
from typing import Any


@dataclass(frozen=True)
class Warehouse:
    code: str
    city: str
    address: str
    latitude: Decimal
    longitude: Decimal
    map_region: str


MOSCOW_WAREHOUSE = Warehouse(
    code="moscow",
    city="Москва",
    address="Никулинская улица, 35с1, Москва, 119361",
    latitude=Decimal("55.672250"),
    longitude=Decimal("37.437280"),
    map_region="cfd",
)
SPB_WAREHOUSE = Warehouse(
    code="saint-petersburg",
    city="Санкт-Петербург",
    address="Автомобильная улица, 6литЗ, Пушкин, Санкт-Петербург",
    latitude=Decimal("59.732878"),
    longitude=Decimal("30.449014"),
    map_region="nwfd",
)
WAREHOUSES = (MOSCOW_WAREHOUSE, SPB_WAREHOUSE)

PRELIMINARY_CARGO = {"places": 10, "weight_kg": "100", "stated_value": "10000", "length_m": "0.283", "width_m": "0.159", "height_m": "0.237"}


def preliminary_missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def preliminary_split_missing(value: Any) -> bool:
    return bool(value is None or value == [] or (isinstance(value, list) and value and all(
        isinstance(item, dict) and all(value in (None, "") or (isinstance(value, str) and not value.strip()) for value in item.values())
        for item in value
    )))


def preliminary_split(points: int, places: int = 10, weight: str = "100", stated_value: str = "10000") -> list[dict[str, str]]:
    if points <= 0 or points > places:
        return []
    base, remainder = divmod(places, points)
    weight_total = Decimal(weight)
    value_total = Decimal(stated_value)
    result = []
    used_weight = Decimal("0")
    used_value = Decimal("0")
    for index in range(points):
        count = base + (1 if index < remainder else 0)
        if index == points - 1:
            part_weight = weight_total - used_weight
            part_value = value_total - used_value
        else:
            part_weight = (weight_total * Decimal(count) / Decimal(places)).quantize(Decimal("0.001"))
            part_value = (value_total * Decimal(count) / Decimal(places)).quantize(Decimal("0.01"))
        used_weight += part_weight
        used_value += part_value
        result.append({"places": str(count), "weight_kg": f"{part_weight:.3f}", "stated_value": f"{part_value:.2f}"})
    return result


def positive_decimal(value: Any, field: str) -> Decimal:
    try:
        number = Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Поле «{field}» должно быть числом") from exc
    if not number.is_finite() or number <= 0:
        raise ValueError(f"Поле «{field}» должно быть больше нуля")
    return number


def nonnegative_decimal(value: Any, field: str) -> Decimal:
    try:
        number = Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Поле «{field}» должно быть числом") from exc
    if not number.is_finite() or number < 0:
        raise ValueError(f"Поле «{field}» должно быть неотрицательным")
    return number


def cargo_volume_m3(places: Any, length_m: Any, width_m: Any, height_m: Any) -> Decimal:
    try:
        count = int(str(places).strip())
    except ValueError as exc:
        raise ValueError("Количество мест должно быть целым числом") from exc
    if count <= 0 or count > 10000:
        raise ValueError("Количество мест должно быть от 1 до 10000")
    volume = Decimal(count)
    for value, field in (
        (length_m, "Длина места"),
        (width_m, "Ширина места"),
        (height_m, "Высота места"),
    ):
        volume *= positive_decimal(value, field)
    return volume.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _distance_km(latitude_a: Decimal, longitude_a: Decimal, latitude_b: Decimal, longitude_b: Decimal) -> float:
    lat_a, lon_a, lat_b, lon_b = map(radians, map(float, (latitude_a, longitude_a, latitude_b, longitude_b)))
    delta_lat = lat_b - lat_a
    delta_lon = lon_b - lon_a
    value = sin(delta_lat / 2) ** 2 + cos(lat_a) * cos(lat_b) * sin(delta_lon / 2) ** 2
    return 6371.0088 * 2 * asin(sqrt(value))


def choose_nearest_warehouse(destination_latitude: Any, destination_longitude: Any) -> Warehouse:
    latitude = positive_decimal(destination_latitude, "Широта точки Б")
    longitude = positive_decimal(destination_longitude, "Долгота точки Б")
    if latitude > 90 or longitude > 180:
        raise ValueError("Координаты точки Б находятся вне допустимого диапазона")
    return min(
        WAREHOUSES,
        key=lambda warehouse: (
            _distance_km(warehouse.latitude, warehouse.longitude, latitude, longitude),
            warehouse.code,
        ),
    )


def manual_price(distance_km: Any, per_km_with_vat: Any) -> Decimal:
    distance = positive_decimal(distance_km, "Расстояние")
    rate = positive_decimal(per_km_with_vat, "Тариф за километр")
    return (distance * rate).quantize(Decimal("1"), rounding=ROUND_CEILING)


def preliminary_manual_tariff_price(
    *,
    pricing_model: Any,
    base_amount: Any,
    per_km: Any,
    per_hour: Any,
    minimum_amount: Any,
    distance_km: Any,
    duration_hours: Any,
) -> Decimal:
    """Предварительная цена: только путь А→Б и время движения."""
    distance = positive_decimal(distance_km, "Расстояние")
    duration = positive_decimal(duration_hours, "Ориентировочное время")

    def component(value: Any) -> Decimal | None:
        if value in (None, ""):
            return None
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0:
            raise ValueError("Тарифная составляющая должна быть неотрицательной")
        return amount

    base = component(base_amount)
    kilometer_rate = component(per_km)
    hour_rate = component(per_hour)
    minimum = component(minimum_amount)
    if "фикс" in str(pricing_model or "").casefold():
        if base is None:
            raise ValueError("Для фиксированного тарифа нужна фиксированная сумма")
        calculated = base
    else:
        parts = [part for part in (base, kilometer_rate * distance if kilometer_rate is not None else None, hour_rate * duration if hour_rate is not None else None) if part is not None]
        if not parts:
            raise ValueError("Укажи базовую сумму, ставку за километр или ставку за час")
        calculated = sum(parts, Decimal("0"))
    return max(calculated, minimum or Decimal("0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
