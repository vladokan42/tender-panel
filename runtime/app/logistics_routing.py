from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from math import cos, radians
import os
import time
from typing import Any
from urllib.parse import quote

import httpx

from .logistics_calculation import WAREHOUSES


class LogisticsRouteError(RuntimeError):
    """Безопасная ошибка определения маршрута без внутренних подробностей."""


DEFAULT_OSRM_BY_REGION = {
    "cfd": "http://127.0.0.1:5000/route/v1/driving/",
    "nwfd": "http://127.0.0.1:5001/route/v1/driving/",
}
OSRM_ENV_BY_REGION = {
    "cfd": "TENDER_PANEL_OSRM_CFD_URL",
    "nwfd": "TENDER_PANEL_OSRM_NWFD_URL",
}
DEFAULT_GLOBAL_OSRM_TABLE = "https://router.project-osrm.org/table/v1/driving/"
DEFAULT_GLOBAL_OSRM_ROUTE = "https://router.project-osrm.org/route/v1/driving/"
MAX_OSRM_SNAP_DISTANCE_M = 5000


def osrm_route_url(region: str) -> str:
    """Return the configured private OSRM route endpoint for a supported region."""
    default = DEFAULT_OSRM_BY_REGION[region]
    return os.getenv(OSRM_ENV_BY_REGION[region], default).rstrip("/") + "/"


class LogisticsRouteResolver:
    def __init__(self, *, transport: httpx.BaseTransport | None = None, allow_public_osrm: bool | None = None):
        self.transport = transport
        if allow_public_osrm is not None:
            self.allow_public_osrm = allow_public_osrm
        else:
            self.allow_public_osrm = os.getenv("TENDER_PANEL_ALLOW_PUBLIC_OSRM", "false").lower() in ("true", "1", "yes")
        self.global_osrm_table = os.getenv("TENDER_PANEL_GLOBAL_OSRM_TABLE", DEFAULT_GLOBAL_OSRM_TABLE if self.allow_public_osrm else "")
        self.global_osrm_route = os.getenv("TENDER_PANEL_GLOBAL_OSRM_ROUTE", DEFAULT_GLOBAL_OSRM_ROUTE if self.allow_public_osrm else "")


    def _road_route(
        self,
        client: httpx.Client,
        warehouse: Any,
        destination: dict[str, str],
        *,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        coordinates = (
            f"{warehouse.longitude},{warehouse.latitude};"
            f"{destination['delivery_lon']},{destination['delivery_lat']}"
        )
        url = f"{base_url or osrm_route_url(warehouse.map_region)}{quote(coordinates, safe=';,.')}"
        try:
            response = client.get(url, params={"overview": "full", "geometries": "geojson", "steps": "false"})
            response.raise_for_status()
            data = response.json()
            selected = data["routes"][0]
            geometry = selected["geometry"]
            if data.get("code") != "Ok" or geometry.get("type") != "LineString":
                raise ValueError("route")
            return {
                "warehouse": warehouse,
                "distance_m": Decimal(str(selected["distance"])),
                "duration_s": Decimal(str(selected["duration"])),
                "geometry": geometry,
            }
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            raise LogisticsRouteError("Не удалось построить автомобильный маршрут") from exc

    @staticmethod
    def optimize_open_route(matrix: dict[int, dict[int, tuple[Decimal, Decimal]]], stop_count: int) -> list[int]:
        """Exact open route: fixed start 0, free last stop; duration then distance."""
        if not isinstance(stop_count, int) or stop_count < 1 or stop_count > 12:
            raise LogisticsRouteError("Точный маршрут поддерживает от 1 до 12 адресов доставки")
        size = stop_count + 1
        for source in range(size):
            if source not in matrix or any(target not in matrix[source] for target in range(size) if target != source):
                raise LogisticsRouteError("Дорожная матрица маршрута неполна")
            for target, value in matrix[source].items():
                if target == source or not isinstance(value, tuple) or len(value) != 2:
                    raise LogisticsRouteError("Некорректная дорожная матрица")
                distance, duration = value
                if not all(isinstance(number, Decimal) and number.is_finite() and number >= 0 for number in (distance, duration)):
                    raise LogisticsRouteError("Дорожная матрица содержит недопустимое значение")
        # ponytail: Held–Karp is O(2^N*N^2); ceiling 12 stops keeps exactness within bounded memory.
        states: dict[tuple[int, int], tuple[Decimal, Decimal, tuple[int, ...]]] = {}
        for last in range(1, size):
            distance, duration = matrix[0][last]
            states[(1 << (last - 1), last)] = (duration, distance, (last,))
        for mask_size in range(1, 1 << stop_count):
            for (mask, last), (duration, distance, path) in list(states.items()):
                if mask != mask_size:
                    continue
                for target in range(1, size):
                    bit = 1 << (target - 1)
                    if mask & bit:
                        continue
                    edge_distance, edge_duration = matrix[last][target]
                    candidate = (duration + edge_duration, distance + edge_distance, (*path, target))
                    key = (mask | bit, target)
                    previous = states.get(key)
                    if previous is None or candidate[:2] < previous[:2] or (candidate[:2] == previous[:2] and candidate[2] < previous[2]):
                        states[key] = candidate
        full = (1 << stop_count) - 1
        best = min((value for (mask, _), value in states.items() if mask == full), key=lambda value: (value[0], value[1], value[2]))
        return [0, *best[2]]

    def resolve_many(self, destinations: list[dict[str, str]]) -> dict[str, Any]:
        if not destinations:
            raise LogisticsRouteError("Нет адресов доставки")
        if len(destinations) == 1:
            return self.resolve(destinations[0].get("delivery_address", ""), destinations[0])
        if len(destinations) > 12:
            raise LogisticsRouteError("Точный маршрут не рассчитан: более 12 адресов требуют отдельного согласования метода")
        with httpx.Client(timeout=20, transport=self.transport, follow_redirects=False) as client:
            candidates = []
            for warehouse in WAREHOUSES:
                try:
                    coordinates = ";".join([f"{warehouse.longitude},{warehouse.latitude}", *(f"{item['delivery_lon']},{item['delivery_lat']}" for item in destinations)])
                    table_url = f"{osrm_route_url(warehouse.map_region).replace('/route/', '/table/')}{quote(coordinates, safe=';,.')}"
                    response = client.get(table_url, params={"annotations": "distance,duration"})
                    response.raise_for_status()
                    data = response.json()
                    if data.get("code") != "Ok":
                        raise ValueError("table")
                    distances, durations = data["distances"], data["durations"]
                    count = len(destinations) + 1
                    if len(distances) != count or any(len(row) != count for row in distances) or len(durations) != count or any(len(row) != count for row in durations):
                        raise ValueError("matrix")
                    sources = data.get("sources") or []
                    if sources and len(sources) != count:
                        raise ValueError("waypoints")
                    for index, source in enumerate(sources):
                        location = source.get("location") if isinstance(source, dict) else None
                        if not isinstance(location, list) or len(location) != 2:
                            raise ValueError("waypoint")
                        if source.get("snap_distance", 0) and Decimal(str(source["snap_distance"])) > MAX_OSRM_SNAP_DISTANCE_M:
                            raise ValueError("unsupported coverage")
                        expected = coordinates.split(";")
                        expected_lon, expected_lat = map(float, expected[index].split(","))
                        if abs(float(location[0]) - expected_lon) * 111000 * max(0.1, cos(radians(expected_lat))) + abs(float(location[1]) - expected_lat) * 111000 > MAX_OSRM_SNAP_DISTANCE_M:
                            raise ValueError("unsupported coverage")
                    matrix = {source: {target: (Decimal(str(distances[source][target])), Decimal(str(durations[source][target]))) for target in range(count) if target != source} for source in range(count)}
                    order = self.optimize_open_route(matrix, len(destinations))
                    total = (sum((matrix[source][target][1] for source, target in zip(order, order[1:])), Decimal(0)), sum((matrix[source][target][0] for source, target in zip(order, order[1:])), Decimal(0)))
                    candidates.append((total, warehouse, order, coordinates.split(";")))
                except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, InvalidOperation, LogisticsRouteError):
                    continue
            if not candidates:
                raise LogisticsRouteError("Не удалось получить полную дорожную матрицу ни для одного склада")
            _, warehouse, order, coordinate_items = min(candidates, key=lambda item: (item[0][0], item[0][1], item[1].code))
            legs = []
            for source, target in zip(order, order[1:]):
                start = {"delivery_lon": coordinate_items[source].split(",")[0], "delivery_lat": coordinate_items[source].split(",")[1]}
                end = destinations[target - 1]
                legs.append(self._road_route(client, warehouse, end) if source == 0 else self._road_route_between(client, start, end, warehouse.map_region))
        coords = []
        for leg in legs:
            points = leg["geometry"]["coordinates"]
            if not isinstance(points, list) or len(points) < 2 or any(not isinstance(point, list) or len(point) != 2 for point in points):
                raise LogisticsRouteError("Маршрутный сервис вернул неполную геометрию")
            coords.extend(points if not coords else points[1:])
        total_distance = sum((leg["distance_m"] for leg in legs), Decimal(0))
        total_duration = sum((leg["duration_s"] for leg in legs), Decimal(0))
        last = destinations[order[-1] - 1]
        return {
            "warehouse_code": warehouse.code, "warehouse_city": warehouse.city, "pickup_address": warehouse.address,
            "pickup_lat": format(warehouse.latitude, "f"), "pickup_lon": format(warehouse.longitude, "f"),
            "delivery_address": last.get("delivery_address", ""), "delivery_lat": last["delivery_lat"], "delivery_lon": last["delivery_lon"],
            "map_region": warehouse.map_region, "distance_km": format((total_distance / Decimal("1000")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP), "f"),
            "duration_hours": format((total_duration / Decimal("3600")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f"),
            "geometry": {"type": "LineString", "coordinates": coords},
            "stops": [{**destinations[index - 1], "route_order": position} for position, index in enumerate(order[1:], 1)],
            "route_order": order,
            "optimization": "held_karp_exact_open_route_duration_distance",
        }

    def _road_route_between(self, client: httpx.Client, start: dict[str, str], destination: dict[str, str], region: str) -> dict[str, Any]:
        coordinates = f"{start['delivery_lon']},{start['delivery_lat']};{destination['delivery_lon']},{destination['delivery_lat']}"
        url = f"{osrm_route_url(region)}{quote(coordinates, safe=';,.')}"
        response = client.get(url, params={"overview": "full", "geometries": "geojson", "steps": "false"})
        response.raise_for_status()
        data = response.json()
        selected = data["routes"][0]
        if data.get("code") != "Ok" or selected["geometry"].get("type") != "LineString":
            raise ValueError("route")
        return {"distance_m": Decimal(str(selected["distance"])), "duration_s": Decimal(str(selected["duration"])), "geometry": selected["geometry"]}

    def _global_road_rank(self, client: httpx.Client, destination: dict[str, str]) -> list[dict[str, Any]]:
        if not self.global_osrm_table:
            raise LogisticsRouteError("Внешний сервис маршрутизации отключён политикой безопасности")
        coordinates = ";".join(
            [
                *(f"{warehouse.longitude},{warehouse.latitude}" for warehouse in WAREHOUSES),
                f"{destination['delivery_lon']},{destination['delivery_lat']}",
            ]
        )
        url = f"{self.global_osrm_table}{quote(coordinates, safe=';,.')}"
        try:
            response = client.get(
                url,
                params={"sources": "0;1", "destinations": "2", "annotations": "distance,duration"},
                headers={"User-Agent": "OKAN-Logistics-Demo/0.7"},
            )
            response.raise_for_status()
            data = response.json()
            if data.get("code") != "Ok":
                raise ValueError("table")
            ranked: list[dict[str, Any]] = []
            for index, warehouse in enumerate(WAREHOUSES):
                distance_m = Decimal(str(data["distances"][index][0]))
                duration_s = Decimal(str(data["durations"][index][0]))
                if distance_m.is_finite() and duration_s.is_finite() and distance_m > 0 and duration_s > 0:
                    ranked.append({"warehouse": warehouse, "distance_m": distance_m, "duration_s": duration_s})
            if not ranked:
                raise ValueError("table")
            return sorted(ranked, key=lambda item: (item["distance_m"], item["warehouse"].code))
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, InvalidOperation) as exc:
            raise LogisticsRouteError("Не удалось сравнить дорожные маршруты складов") from exc

    def resolve(self, delivery_address: str, destination: dict[str, str]) -> dict[str, Any]:
        with httpx.Client(timeout=20, transport=self.transport, follow_redirects=False) as client:
            destination = dict(destination)
            try:
                ranked = self._global_road_rank(client, destination) if self.global_osrm_table else []
            except LogisticsRouteError:
                ranked = []
            if ranked:
                warehouse = ranked[0]["warehouse"]
                try:
                    routes = [self._road_route(client, warehouse, destination)]
                except LogisticsRouteError:
                    if self.global_osrm_route:
                        time.sleep(1.05)
                        routes = [self._road_route(client, warehouse, destination, base_url=self.global_osrm_route)]
                    else:
                        routes = []
            else:
                routes = []
                for warehouse_candidate in WAREHOUSES:
                    try:
                        routes.append(self._road_route(client, warehouse_candidate, destination))
                    except LogisticsRouteError:
                        continue
            if not routes:
                raise LogisticsRouteError("Не удалось построить автомобильный маршрут ни от одного склада")
            selected_route = min(routes, key=lambda item: (item["distance_m"], item["warehouse"].code))
            warehouse = selected_route["warehouse"]
            geometry = selected_route["geometry"]
            distance = (selected_route["distance_m"] / Decimal("1000")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
            duration = (selected_route["duration_s"] / Decimal("3600")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return {
            "warehouse_code": warehouse.code,
            "warehouse_city": warehouse.city,
            "pickup_address": warehouse.address,
            "pickup_lat": format(warehouse.latitude, "f"),
            "pickup_lon": format(warehouse.longitude, "f"),
            "delivery_address": str(delivery_address).strip(),
            **destination,
            "map_region": warehouse.map_region,
            "distance_km": format(distance, "f"),
            "duration_hours": format(duration, "f"),
            "geometry": geometry,
        }
