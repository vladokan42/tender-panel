from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterable
import re


@dataclass(frozen=True)
class NormalizedDeliveryAddress:
    address: str
    needs_review: bool


@dataclass(frozen=True)
class DeliveryAddressCandidate:
    address: str
    source_locator: str
    needs_review: bool = False
    status: str = "REVIEW"
    source_locators: tuple[str, ...] = ()
    warning: str = ""
    source_address: str = ""


# Service labels describe a procurement field, not a geographic address.
_GENERIC_LABEL = re.compile(
    r"^\s*(?:место|адрес|точка)\s+(?:поставки|доставки|объекта)\s*:\s*",
    re.IGNORECASE,
)
_FACILITY_PREFIX = re.compile(
    r"^\s*\d+\s+(?:пищеблок|объект|адрес|точк)(?:а|и|ов)?\s*:\s*",
    re.IGNORECASE,
)
_CONFLICT_PREFIX = re.compile(
    r"^\s*конфликт\s*:\s*(?:ЕИС|извещение|документация)?\s*[-—:]?\s*",
    re.IGNORECASE,
)
_SOURCE_PREFIX = re.compile(
    r"^\s*(?:ЕИС|ТЗ|техническое задание|проект контракта)\s*[-—:]\s*",
    re.IGNORECASE,
)
_UNCERTAIN_NOTE = re.compile(
    r"\b(?:строение|корпус|дом|адрес|место поставки)\s+(?:требует уточнения|уточнить|не уточн[её]н|будет сообщ[её]н)\b",
    re.IGNORECASE,
)
_NON_ADDRESS_ONLY = re.compile(
    r"^(?:по заявкам? заказчика|по согласованию|точный адрес|адрес будет|место будет|в пределах)[\s,;:].*",
    re.IGNORECASE,
)
_CITY_ONLY = re.compile(
    r"^\s*г\.?\s*[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё -]*\s*$",
    re.IGNORECASE,
)


_COUNTRY_EXACT = re.compile(
    r"^(?:Российская\s+Федерация|Россия|РФ)$",
    re.IGNORECASE,
)
_ADMIN_DISTRICT = re.compile(
    r"\b(?:вн\.?\s*тер\.?\s*г\.?|внутригородск\w*|муниципальн\w*\s+округ)\b",
    re.IGNORECASE,
)
_ORG_OR_FACILITY = re.compile(
    r"^(?:ФКУ|ФГБУ|ГБУЗ|ГБОУ|МАОУ|МБОУ|МБДОУ|ГБДОУ|ФГУП|ГУФСИН|УФСИН|ООО|ЗАО|ПАО|АО|ИП)\b|\b(?:пищеблок|продовольственный\s+склад|продуктовый\s+склад|склад|столовая|помещение\b.*заказчик)\b",
    re.IGNORECASE,
)
_PAREN_FACILITY = re.compile(
    r"\s*\([^)]*(?:пищеблок|склад|столов|отдел|корпус|подраздел|заказчик)[^)]*\)",
    re.IGNORECASE,
)
_FACILITY_ONLY = re.compile(r"^(?:продовольственный|продуктовый)\s+склад(?:\b.*)?$|^склад(?:\b.*)?$|^пищеблок(?:\b.*)?$|^столовая(?:\b.*)?$", re.IGNORECASE)


def _user_address_order(value: str) -> str:
    """Format supported city addresses as `street, house, city`, dropping postcodes and non-geographic facility noise."""
    text = _PAREN_FACILITY.sub("", value)
    text = re.sub(r"\s*[-—–]\s*(?=(?:продовольственный|продуктовый)\s+склад|склад|пищеблок|столовая)", ", ", text, flags=re.IGNORECASE)

    raw_parts = [part.strip() for part in text.split(",") if part.strip()]

    parts: list[str] = []
    cities: list[str] = []
    city_pat = re.compile(r"^(?:(?:г\.|г(?=\s)|город\b)\s*)([А-Яа-яЁё -]+)$|^(Москва|Санкт-Петербург)$", re.IGNORECASE)

    for part in raw_parts:
        if re.fullmatch(r"\d{6}", part):
            continue
        if _COUNTRY_EXACT.fullmatch(part):
            continue
        if _ADMIN_DISTRICT.search(part):
            continue
        if _ORG_OR_FACILITY.search(part) and not _FACILITY_ONLY.fullmatch(part):
            continue
        m_city = city_pat.match(part)
        if m_city:
            c = (m_city.group(1) or m_city.group(2)).strip()
            c_norm = c[0].upper() + c[1:].lower() if len(c) > 1 else c
            if c_norm not in cities:
                cities.append(c_norm)
            continue
        parts.append(part)

    if not cities:
        city_index = next(
            (
                index
                for index, part in enumerate(parts)
                if re.fullmatch(r"(?:г\.?\s*)?(?:Москва|Санкт-Петербург)", part, re.IGNORECASE)
            ),
            None,
        )
        if city_index is not None:
            city = re.sub(r"^г\.?\s*", "", parts.pop(city_index), flags=re.IGNORECASE).strip()
            city = city[0].upper() + city[1:].lower() if len(city) > 1 else city
            return ", ".join([*parts, city])
        return ", ".join(parts)

    for c in cities:
        if not any(c.lower() in p.lower() for p in parts):
            parts.append(c)

    return ", ".join(parts)


def normalize_delivery_address(value: object) -> NormalizedDeliveryAddress:
    """Return only route-safe address data; never alter the canonical source value."""
    address = re.sub(r"\s+", " ", str(value or "")).strip()
    if not address:
        return NormalizedDeliveryAddress(address="", needs_review=True)

    needs_review = False

    # Neutral field labels can be removed without making the address doubtful.
    address = _GENERIC_LABEL.sub("", address, count=1).strip()

    # Counts/facility descriptions imply several destinations and need human choice.
    without_prefix, prefix_count = _FACILITY_PREFIX.subn("", address, count=1)
    if prefix_count:
        address = without_prefix.strip()
        needs_review = True

    # For conflicting sources retain the first concrete candidate, but flag it.
    without_conflict, conflict_count = _CONFLICT_PREFIX.subn("", address, count=1)
    if conflict_count:
        address = without_conflict.strip()
        address = _SOURCE_PREFIX.sub("", address, count=1).strip()
        address = address.split(";", 1)[0].strip()
        needs_review = True

    # Semicolon suffixes such as "building requires clarification" are notes.
    parts = [part.strip() for part in address.split(";") if part.strip()]
    if len(parts) > 1 and any(_UNCERTAIN_NOTE.search(note) for note in parts[1:]):
        address = parts[0]
        needs_review = True

    # Do not send delivery instructions without geographic data to geocoders/APIs.
    if _NON_ADDRESS_ONLY.match(address) or _UNCERTAIN_NOTE.fullmatch(address):
        return NormalizedDeliveryAddress(address="", needs_review=True)

    # A city without a street/house is a hint, not a route-safe delivery point.
    if _CITY_ONLY.fullmatch(address):
        needs_review = True

    return NormalizedDeliveryAddress(
        address=_user_address_order(address.strip(" ,;")),
        needs_review=needs_review,
    )


_SPECIFIC_KEY = re.compile(r"(?:адреса?\s+поставки\s+товаров|адрес\s+поставки|delivery_address)", re.IGNORECASE)
_DELIVERY_KEY = re.compile(r"(?:адрес(?:а|ов)?|место|точк(?:а|и))\s+(?:поставки|доставки|объекта)", re.IGNORECASE)
_LEGAL_KEY = re.compile(r"(?:юридическ|почтов|контакт|местонахожд|адрес регистрации)", re.IGNORECASE)


def _address_values(value: object, locator: str) -> Iterable[tuple[object, str]]:
    if isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            yield from _address_values(child, f"{locator}[{index}]")
        return
    if isinstance(value, dict):
        for key in ("value", "text", "address", "delivery_address", "addresses", "items"):
            if key in value:
                yield from _address_values(value[key], f"{locator}.{key}")
        return
    if isinstance(value, str):
        for index, part in enumerate(re.split(r"[\n]+", value)):
            if part.strip():
                yield part.strip(), f"{locator}[{index}]"


def _split_delivery_text(value: str) -> tuple[list[str], str]:
    text = re.sub(r"\s+", " ", value).strip()
    warning = ""
    if re.search(r"\b(?:и\s+др\.?|и\s+т\.\s*д\.?|проч(?:ее|ие))\b", text, re.IGNORECASE):
        warning = "Список адресов неполный: источник содержит «и др.»"
    match = re.search(r"\(([^()]*)\)", text)
    if match and (";" in match.group(1) or re.search(r"\b(?:ул\.?|улица|проспект|проезд|ш\.?|наб\.?|переулок)\b", match.group(1), re.IGNORECASE)):
        prefix = text[:match.start()].strip(" ,;:")
        locality = re.search(r"\b(?:г\.|г|город)\s+([А-ЯЁ][А-ЯЁа-яё-]+)", prefix, re.IGNORECASE)
        inside = match.group(1)
        pieces = [piece.strip() for piece in re.split(r"[;\n]+", inside) if piece.strip()]
        if len(pieces) == 1 and "," in inside:
            pieces = [piece.strip() for piece in re.split(r",\s*(?=(?:ул\.?|улица|проспект|проезд|ш\.?|наб\.?|переулок|\d+[-–]й))", inside, flags=re.IGNORECASE) if piece.strip()]
        if locality:
            city = f"г. {locality.group(1)}"
            pieces = [piece if re.search(r"\b(?:г\.|г|город)\s+[А-ЯЁ]", piece, re.IGNORECASE) else f"{piece}, {city}" for piece in pieces]
        return pieces, warning
    if re.search(r"прилож\w*\s*№?\s*\d+", text, re.IGNORECASE) and not re.search(r"\b(?:ул\.?|улица|проспект|проезд|ш\.?|наб\.?|д\.)\b", text, re.IGNORECASE):
        return [], "Адреса указаны только в приложении; требуется извлечение документа"
    return [part.strip() for part in re.split(r"[;\n]+", text) if part.strip()], warning


def collect_delivery_addresses(item: object) -> list[DeliveryAddressCandidate]:
    """Choose the most specific delivery field; generic locality fields never add stops."""
    records: list[tuple[int, object, str, str]] = []

    def visit(node: object, locator: str = "root") -> None:
        if isinstance(node, dict):
            named = str(node.get("name") or node.get("label") or node.get("key") or "")
            if _SPECIFIC_KEY.search(named):
                records.append((0, node, f"{locator}.name={named}", str(node.get("status", "REVIEW"))))
                return
            if _DELIVERY_KEY.search(named) and not _SPECIFIC_KEY.search(named):
                records.append((1, node, f"{locator}.name={named}", str(node.get("status", "REVIEW"))))
                return
            for key, value in node.items():
                key_text = str(key)
                if _LEGAL_KEY.search(key_text) and not _DELIVERY_KEY.search(key_text):
                    continue
                if _SPECIFIC_KEY.search(key_text):
                    records.append((0, value, f"{locator}.{key_text}", str(value.get("status", "REVIEW")) if isinstance(value, dict) else "REVIEW"))
                elif _DELIVERY_KEY.search(key_text) and not _SPECIFIC_KEY.search(key_text):
                    records.append((1, value, f"{locator}.{key_text}", str(value.get("status", "REVIEW")) if isinstance(value, dict) else "REVIEW"))
                elif isinstance(value, (dict, list, tuple)):
                    visit(value, f"{locator}.{key_text}")
        elif isinstance(node, (list, tuple)):
            for index, value in enumerate(node):
                visit(value, f"{locator}[{index}]")

    visit(item)
    if not records:
        return []
    best_priority = min(record[0] for record in records)
    selected = [record for record in records if record[0] == best_priority]
    raw_values = [str(value.get("value") or value.get("text") or "") if isinstance(value, dict) else str(value or "") for _, value, _, _ in selected]
    conflict = len({re.sub(r"\s+", " ", raw).strip() for raw in raw_values if raw}) > 1
    found: list[DeliveryAddressCandidate] = []
    selected_for_data = selected[:1]
    selected_locators = tuple(locator for _, _, locator, _ in selected)
    for _, value, locator, status in selected_for_data:
        for raw, raw_locator in _address_values(value, locator):
            address_parts, warning = _split_delivery_text(str(raw))
            for address_text in address_parts:
                normalized = normalize_delivery_address(address_text)
                if not normalized.address:
                    continue
                previous = next((entry for entry in found if entry.address == normalized.address), None)
                if previous:
                    found[found.index(previous)] = DeliveryAddressCandidate(
                        previous.address, previous.source_locator, previous.needs_review, previous.status,
                        (*previous.source_locators, raw_locator), previous.warning or warning,
                        previous.source_address or str(raw),
                    )
                    continue
                found.append(DeliveryAddressCandidate(
                    normalized.address, raw_locator, normalized.needs_review or conflict,
                    "CONFLICT" if conflict else status, (*selected_locators, raw_locator),
                    warning or ("Конфликт источников доставки" if conflict else ""), str(raw),
                ))
    return found
