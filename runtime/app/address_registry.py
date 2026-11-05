from __future__ import annotations

from pathlib import Path
from collections import Counter
import re
import sqlite3
from typing import Any

_STREET_WORDS = re.compile(r"(?iu)\b(?:ул(?:ица)?|пр(?:оспект|-т)?|пер(?:еулок)?|ш(?:оссе)?|бул(?:ьвар)?|наб(?:ережная)?)[.]?(?=[\s,;.-]|\d|$)")
_NON_WORD = re.compile(r"(?u)[^\wа-яё-]+")
_BUILDING_WORDS = re.compile(r"(?iu)\b(?:стр(?:оение)?)[.]?(?=[\s,;.-]|\d|$)")
_CORPUS_WORDS = re.compile(r"(?iu)\b(?:к(?:орп(?:ус)?)?)[.]?(?=[\s,;.-]|\d|$)")
_HOUSE_WORDS = re.compile(r"(?iu)\b(?:д(?:ом)?)[.]?(?=[\s,;.-]|\d|$)")
_LITERA_WORDS = re.compile(r"(?iu)\b(?:лит(?:ера)?)[.]?(?=[\s,;.-]|\d|$)")


def normalize_query(value: str) -> str:
    text = str(value or "").casefold().replace("ё", "е").replace("*", " ")
    text = re.sub(r"\bленинградская\s+(?:обл(?:асть)?\.?)\b", " ", text)
    text = re.sub(r"\b(?:мкр|микрорайон)\.?\s+", "микрорайон ", text)
    text = re.sub(r"\b(?:с|село)\.?\s+(?=[а-яё])", "", text)
    text = re.sub(r"(?<=\d)\s*(?:лит(?:ера)?\.?)\s*([а-яёa-z])", r"\1", text)
    text = re.sub(r"(?<=\d)[сc](?=\d)", " строение ", text)
    text = re.sub(r"(?<=\d)к(?=\d)", " корпус ", text)
    text = _STREET_WORDS.sub(" ", text)
    text = _HOUSE_WORDS.sub(" ", text)
    text = _BUILDING_WORDS.sub(" строение ", text)
    text = _CORPUS_WORDS.sub(" корпус ", text)
    text = _LITERA_WORDS.sub(" ", text)
    return " ".join(_NON_WORD.sub(" ", text).split())


def _fts_prefix(value: str) -> str:
    return " AND ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in normalize_query(value).split())


def _house_key(value: str) -> tuple[int, str]:
    match = re.match(r"\s*(\d+)", value or "")
    return (int(match.group(1)) if match else 10**9, (value or "").casefold())


def _primary_house(value: str) -> str:
    match = re.match(r"\s*(\d+)", value or "")
    return match.group(1) if match else ""


def _requested_house(value: str) -> str:
    """Use an explicit house role; numbers embedded in place names are not houses."""
    text = str(value or "")
    explicit = re.search(r"\b(?:д(?:ом)?|house)\.?\s*(\d+)", text, re.IGNORECASE)
    if explicit:
        return explicit.group(1)
    building_house = re.search(r"(?<![\w-])(\d+)\s*(?:с|стр(?:оение)?|к(?:орпус)?)\.?\b", text, re.IGNORECASE)
    if building_house:
        return building_house.group(1)
    comma_house = re.search(r"(?:^|[,;])\s*(\d+)(?:\s*(?:к(?:орпус)?|стр(?:оение)?)\.?\s*[\w-]+)?\s*(?:[,;]|$)", text, re.IGNORECASE)
    if comma_house:
        return comma_house.group(1)
    trailing_house = re.search(r"(?<![\w-])(\d+)\s*$", text)
    if trailing_house:
        return trailing_house.group(1)
    return ""


class AddressRegistry:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _connect(self) -> sqlite3.Connection:
        if not self.path.is_file():
            raise FileNotFoundError("Локальный адресный реестр не подготовлен")
        connection = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, timeout=2)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _public(row: sqlite3.Row) -> dict[str, str]:
        return {
            "id": str(row["id"]),
            "display_name": str(row["display_name"]),
            "street": str(row["street"]),
            "house": str(row["house"]),
            "city": str(row["city"]),
            "lat": f"{float(row['lat']):.7f}",
            "lon": f"{float(row['lon']):.7f}",
        }

    def suggest(self, query: str, *, city_hint: str = "", limit: int = 12) -> list[dict[str, str]]:
        from .delivery_address import normalize_delivery_address

        raw_query = str(query or "")
        cleaned = normalize_delivery_address(query).address
        if cleaned and len(cleaned) < len(str(query or "")):
            query = cleaned
        if len(str(query or "")) > 160:
            return []
        expression = _fts_prefix(query)
        if not expression:
            return []
        requested = max(1, min(int(limit), 20))
        normalized_query = normalize_query(query)
        requested_house = _requested_house(raw_query)
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT a.* FROM address_fts f
                JOIN addresses a ON a.rowid=f.rowid
                WHERE address_fts MATCH ? AND (?='' OR a.house LIKE ?)
                ORDER BY CASE WHEN a.city=? THEN 0 ELSE 1 END
                LIMIT ?
                """,
                (expression, requested_house, f"{requested_house}%", city_hint.strip(), max(1200, requested * 100)),
            ).fetchall()
        if requested_house and ("строение" in normalized_query or "корпус" in normalized_query):
            rows = [row for row in rows if _primary_house(str(row["house"])) == requested_house]
        if not rows and requested_house and ("строение" in normalized_query or "корпус" in normalized_query):
            simplified = re.sub(r"\b(?:строение|корпус)\s+\w+", "", normalized_query).strip()
            fallback_expr = _fts_prefix(simplified)
            if fallback_expr and fallback_expr != expression:
                with self._connect() as db:
                    rows = db.execute(
                        """
                        SELECT a.* FROM address_fts f
                        JOIN addresses a ON a.rowid=f.rowid
                        WHERE address_fts MATCH ? AND (?='' OR a.house LIKE ?)
                        ORDER BY CASE WHEN a.city=? THEN 0 ELSE 1 END
                        LIMIT ?
                        """,
                        (fallback_expr, requested_house, f"{requested_house}%", city_hint.strip(), max(1200, requested * 100)),
                    ).fetchall()
        hint = normalize_query(city_hint)
        first_token = normalized_query.split()[0]
        popularity = Counter((normalize_query(row["street"]), normalize_query(row["city"])) for row in rows)
        rows = sorted(
            rows,
            key=lambda row: (
                0 if hint and normalize_query(row["city"]) == hint else 1,
                0 if requested_house and _primary_house(str(row["house"])) == requested_house else 1,
                0 if not str(row["house"]).strip() else 1,
                0 if normalize_query(row["street"]).startswith(first_token) else 1,
                -popularity[(normalize_query(row["street"]), normalize_query(row["city"]))],
                normalize_query(row["street"]),
                _house_key(str(row["house"])),
                str(row["display_name"]).casefold(),
            ),
        )
        unique: list[dict[str, str]] = []
        seen: set[str] = set()
        for row in rows:
            key = str(row["display_name"]).casefold()
            if key in seen:
                continue
            seen.add(key)
            unique.append(self._public(row))
            if len(unique) >= requested:
                break
        return unique

    def resolve(self, address_id: str) -> dict[str, str]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM addresses WHERE id=?", (str(address_id),)).fetchone()
        if row is None:
            raise KeyError("Выбранный адрес отсутствует в локальном реестре")
        return self._public(row)

    def geocode(self, query: str, *, city_hint: str = "") -> dict[str, str]:
        cleaned = str(query or "").strip()
        normalized = normalize_query(cleaned)
        candidates = self.suggest(cleaned, city_hint=city_hint, limit=20)
        if candidates:
            requested_tokens = Counter(normalized.split())
            exact = [item for item in candidates if Counter(normalize_query(item["display_name"]).split()) == requested_tokens]
            if len(exact) == 1:
                return exact[0]
            raise ValueError("Точный адрес не подтверждён локальным реестром; выбери адрес вручную")
        raise ValueError("Точный адрес не найден в локальном реестре; выбери адрес вручную")
