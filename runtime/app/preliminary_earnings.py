from __future__ import annotations

import math
import re
import decimal
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from typing import Any

ZERO = Decimal("0")
TWO_PLACES = Decimal("0.01")


def to_decimal(val: Any) -> Decimal | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        d = Decimal(str(val).strip().replace(" ", "").replace(",", "."))
        return d if d.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def format_currency(val: Decimal | None) -> str | None:
    if val is None:
        return None
    return format(val.quantize(TWO_PLACES, rounding=ROUND_HALF_UP), "f")


# Unit normalization mapping per section 3.4
CANONICAL_UNITS: dict[str, str] = {
    # Weight
    "кг": "кг",
    "kg": "кг",
    "килограмм": "кг",
    "килограммы": "кг",
    "kilogram": "кг",
    "kilograms": "кг",
    "т": "т",
    "тонна": "т",
    "ton": "т",
    "г": "г",
    "g": "г",
    "грамм": "г",
    "gram": "г",
    "grams": "г",
    # Volume
    "л": "л",
    "l": "л",
    "литр": "л",
    "литры": "л",
    "liter": "л",
    "liters": "л",
    "litre": "л",
    "мл": "мл",
    "ml": "мл",
    "миллилитр": "мл",
    "milliliter": "мл",
    "milliliters": "мл",
    # Pieces
    "шт": "шт",
    "шт.": "шт",
    "штука": "шт",
    "штуки": "шт",
    "item": "шт",
    "items": "шт",
    "piece": "шт",
    "pieces": "шт",
    "pc": "шт",
    "pcs": "шт",
    # Length
    "м": "м",
    "метр": "м",
    "meter": "м",
    "погонный метр": "м",
    "пог. м": "м",
    "пог.м": "м",
    # Packaging (deliberately distinct from pieces)
    "упак": "упак",
    "упак.": "упак",
    "упаковка": "упак",
    "упаковки": "упак",
    "package": "упак",
    "pack": "упак",
    "коробка": "коробка",
    "кор.": "коробка",
    "пачка": "пачка",
}


def normalize_unit(unit_str: Any) -> str | None:
    if not unit_str or not isinstance(unit_str, str):
        return None
    raw = unit_str.strip().casefold().rstrip(".")
    first = raw.split(";", 1)[0].strip()
    return CANONICAL_UNITS.get(raw) or CANONICAL_UNITS.get(first)


class EligibilityResult(tuple):
    def __new__(
        cls,
        eligible: bool,
        price: Decimal | None,
        reason: str | None,
        source: str | None = None,
        unit: str | None = None,
    ):
        return super().__new__(cls, (eligible, price, reason))

    def __init__(
        self,
        eligible: bool,
        price: Decimal | None,
        reason: str | None,
        source: str | None = None,
        unit: str | None = None,
    ):
        self.eligible = eligible
        self.price = price
        self.reason = reason
        self.source = source
        self.unit = unit


class BestOfferResult(tuple):
    def __new__(
        cls,
        offer: dict[str, Any] | None,
        price: Decimal | None,
        reason: str,
        source: str | None = None,
        unit: str | None = None,
    ):
        return super().__new__(cls, (offer, price, reason))

    def __init__(
        self,
        offer: dict[str, Any] | None,
        price: Decimal | None,
        reason: str,
        source: str | None = None,
        unit: str | None = None,
    ):
        self.offer = offer
        self.price = price
        self.reason = reason
        self.source = source
        self.unit = unit


def is_candidate_eligible(offer: dict[str, Any], target_unit: str | None) -> EligibilityResult:
    """Check if offer is eligible for monetary calculation per section 3.3 and 3.4."""
    # price_registry_id must be a positive integer
    pid = offer.get("price_registry_id")
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        return EligibilityResult(False, None, "Отсутствует корректный идентификатор price_registry_id")

    # has_explicit_conflict must be strictly False (not None, not missing, not True)
    if offer.get("has_explicit_conflict") is not False:
        return EligibilityResult(False, None, "Флаг has_explicit_conflict не равен False")

    # Other conflict flags on offer
    if offer.get("conflict") is True or offer.get("conflicting") is True or offer.get("is_conflicting") is True:
        return EligibilityResult(False, None, "В предложении обнаружен конфликт")

    # Stale status / refresh_status
    if str(offer.get("refresh_status") or "").strip().upper() == "STALE":
        return EligibilityResult(False, None, "Предложение поставщика устарело (refresh_status=STALE)")
    if str(offer.get("status") or "").strip().upper() == "STALE":
        return EligibilityResult(False, None, "Предложение поставщика устарело (status=STALE)")

    price_info = offer.get("price")
    if not isinstance(price_info, dict):
        return EligibilityResult(False, None, "Отсутствует блок цены")

    if price_info.get("has_explicit_conflict") is True or price_info.get("conflict") is True or price_info.get("conflicting") is True:
        return EligibilityResult(False, None, "В блоке цены обнаружен конфликт")

    fit_status = str(offer.get("fit_status") or "").upper()
    if fit_status in {"MISMATCH", "STALE"}:
        return EligibilityResult(False, None, f"Недопустимый статус соответствия: {fit_status}")

    attr_cmp = offer.get("attribute_comparison")
    if isinstance(attr_cmp, dict) and attr_cmp.get("mismatched"):
        return EligibilityResult(False, None, "Несоответствие атрибутов (attribute_comparison.mismatched)")

    target = normalize_unit(target_unit)
    if not target:
        return EligibilityResult(False, None, f"Не определена целевая единица ({target_unit})")

    # Price equivalents vs legacy normalized price
    if "equivalents" in price_info:
        key = {"кг": "KILOGRAM", "л": "LITER", "шт": "ITEM"}.get(target)
        if not key:
            return EligibilityResult(False, None, f"Целевая единица не поддерживается в эквивалентах ({target})")

        equivalents = price_info.get("equivalents")
        value = equivalents.get(key) if key and isinstance(equivalents, dict) else None
        if not isinstance(value, dict) or value.get("unit") != key or value.get("comparison_allowed") is not True:
            return EligibilityResult(False, None, f"Отсутствует или не разрешён эквивалент {key}")

        raw = value.get("amount_with_vat")
        if not isinstance(raw, str) or isinstance(raw, bool) or not re.fullmatch(r"[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", raw.strip()):
            return EligibilityResult(False, None, f"Некорректная сумма эквивалента {key}")

        try:
            with decimal.localcontext() as ctx:
                ctx.prec = 40
                price_dec = Decimal(raw.strip())
            if not price_dec.is_finite() or price_dec <= ZERO:
                return EligibilityResult(False, None, "Цена эквивалента не является положительным конечным числом")
        except (InvalidOperation, ValueError, TypeError):
            return EligibilityResult(False, None, "Ошибка преобразования суммы эквивалента в Decimal")

        return EligibilityResult(True, price_dec, None, source=f"price.equivalents.{key}", unit=key)

    # Legacy contract: only when equivalents key is absent
    if price_info.get("comparison_allowed") is not True:
        return EligibilityResult(False, None, "Запрещено денежное сравнение (comparison_allowed != True)")

    raw_amount = price_info.get("normalized_with_vat")
    if isinstance(raw_amount, bool) or not isinstance(raw_amount, (int, float, Decimal)):
        return EligibilityResult(False, None, "normalized_with_vat должен быть числом int, float или Decimal")

    if isinstance(raw_amount, Decimal):
        if not raw_amount.is_finite() or raw_amount <= ZERO:
            return EligibilityResult(False, None, "Цена не является положительным конечным числом")
        price_dec = raw_amount
    else:
        if not math.isfinite(raw_amount) or raw_amount <= 0:
            return EligibilityResult(False, None, "Цена не является положительным конечным числом")
        with decimal.localcontext() as ctx:
            ctx.prec = 40
            price_dec = Decimal(str(raw_amount))

    offer_unit_raw = price_info.get("normalized_unit")
    if not offer_unit_raw or not isinstance(offer_unit_raw, str):
        return EligibilityResult(False, None, "В блоке цены отсутствует normalized_unit")

    offer_unit = normalize_unit(offer_unit_raw)
    if not offer_unit or offer_unit != target:
        return EligibilityResult(False, None, f"Единицы измерения не сопоставимы ({offer_unit_raw} != {target})")

    return EligibilityResult(True, price_dec, None, source="price.normalized_with_vat", unit=offer_unit_raw)


def select_best_offer_for_line(
    line_id: str,
    target_unit: str | None,
    offers_for_line: list[dict[str, Any]],
    saved_selection: dict[str, Any] | None,
) -> BestOfferResult:
    """Select automatic minimum offer within top-20 for line per section 3.5."""
    top20 = offers_for_line[:20]

    eligible_offers: list[tuple[dict[str, Any], Decimal, str | None, str | None]] = []
    for off in top20:
        res = is_candidate_eligible(off, target_unit)
        if res.eligible and res.price is not None:
            eligible_offers.append((off, res.price, res.source, res.unit))

    if not eligible_offers:
        return BestOfferResult(None, None, "Нет сопоставимых цен среди топ-20 кандидатов")

    min_price = min(price for _, price, _, _ in eligible_offers)

    saved_cheapest_id = (saved_selection or {}).get("cheapest_price_registry_id")
    if saved_cheapest_id is not None:
        for off, dec_price, src, u in eligible_offers:
            if off.get("price_registry_id") == saved_cheapest_id and dec_price == min_price:
                return BestOfferResult(off, dec_price, "Сохранённый минимальный кандидат среди топ-20", src, u)

    for off, dec_price, src, u in eligible_offers:
        if dec_price == min_price:
            return BestOfferResult(off, dec_price, "Автоматический минимум среди текущих топ-20", src, u)

    return BestOfferResult(eligible_offers[0][0], eligible_offers[0][1], "Автоматический минимум среди текущих топ-20", eligible_offers[0][2], eligible_offers[0][3])


def extract_schedule_text(field_val: Any) -> str:
    """Extract plain schedule text from string, dict, or list representation."""
    if isinstance(field_val, str):
        return field_val
    if isinstance(field_val, dict):
        for k in ("schedule_text", "text", "value"):
            v = field_val.get(k)
            if isinstance(v, str):
                return v
            if isinstance(v, (dict, list)):
                res = extract_schedule_text(v)
                if res:
                    return res
    if isinstance(field_val, list):
        parts = [extract_schedule_text(item) for item in field_val]
        return " ".join(filter(None, parts))
    return ""


def is_on_request_condition(text: str) -> bool:
    """Check if delivery condition explicitly specifies 'on request'."""
    text_lower = text.casefold()
    # Check negation first: e.g. "не по заявкам", "не со дня заявки", "не на основании заявки", "без заявок"
    if re.search(r"\bне\s+(?:по\s+)?заявк", text_lower) or re.search(r"\bне\s+со\s+дня\s+заявк", text_lower) or re.search(r"\bбез\s+заяв[а-я]*\b", text_lower):
        return False

    # Check payment-only phrases without delivery context
    if re.search(r"оплат[а-я]*\s+по\s+заявк|расчет[а-я]*\s+по\s+заявк|расчёт[а-я]*\s+по\s+заявк", text_lower):
        if not re.search(r"поставк[а-я]*|парти[а-я]*|доставк[а-я]*|отгрузк[а-я]*", text_lower):
            return False

    if re.search(r"на участие|тендерн[а-я]* заявк|срок[а-я]* подачи заявк", text_lower):
        if not re.search(r"поставк[а-я]* по заявк|партиями по заявк|товара по заявк|с момента подачи заявк", text_lower):
            return False

    on_request_patterns = [
        r"\bпо заявк",
        r"\bсо дня заявк",
        r"\bс момента подачи.*заявк",
        r"\bна основании заявк",
    ]
    return any(re.search(pat, text_lower) for pat in on_request_patterns)


def has_different_routes_condition(text: str) -> bool:
    """Detect delivery conditions with multiple different routes, cargo, or tariffs without groups."""
    t = text.casefold()
    patterns = [
        r"различн[а-я]*\s+маршрут",
        r"разн[а-я]*\s+маршрут",
        r"разн[а-я]*\s+груз",
        r"разн[а-я]*\s+тариф",
        r"разны[а-я]*\s+постав[а-я]*",
        r"разных\s+поставок",
        r"отдельн[а-я]*\s+маршрут",
        r"отдельны[а-я]*\s+постав[а-я]*",
        r"по\s+различным\s+маршрутам",
        r"с\s+разным\s+грузом",
        r"разными\s+тарифами",
    ]
    return any(re.search(pat, t) for pat in patterns)


def has_frequency_condition(text: str) -> bool:
    """Detect calendar/periodic frequency conditions without full calendar."""
    text_lower = text.casefold()
    freq_patterns = [
        r"ежемесячн",
        r"еженедельн",
        r"ежедневн",
        r"ежеквартальн",
        r"кажд[а-я]* месяц",
        r"кажд[а-я]* недел",
        r"кажд[а-я]* день",
        r"кажд[а-я]* кварт",
        r"периодическ",
    ]
    return any(re.search(pat, text_lower) for pat in freq_patterns)


def has_bound_condition(text: str) -> bool:
    """Detect lower/upper bounds or approximate delivery counts."""
    text_lower = text.casefold()
    bound_patterns = [
        r"не менее",
        r"не более",
        r"не реже",
        r"не чаще",
        r"\bот\s+\d+",
        r"\bдо\s+\d+",
        r"ориентировочн",
        r"примерн",
    ]
    return any(re.search(pat, text_lower) for pat in bound_patterns)


def is_one_time_condition(text: str) -> bool:
    text_lower = text.casefold()
    if "многоразов" in text_lower or "неоднократн" in text_lower:
        return False
    one_time_patterns = [
        r"\bразов[а-я]*\b",
        r"\bединовременн[а-я]*\b",
        r"\bв один этап\b",
        r"\bоднократн[а-я]*\b",
        r"\bодной парти[а-я]*\b",
    ]
    return any(re.search(pat, text_lower) for pat in one_time_patterns)


def extract_batch_counts(text: str) -> set[int]:
    """Extract explicit delivery/batch count integers from text."""
    counts: set[int] = set()
    matches = re.finditer(r"(\d+)\s*(?:парти[а-я]*|постав[а-я]*|рейс[а-я]*)", text.casefold())
    for m in matches:
        try:
            val = int(m.group(1))
            if val > 0:
                counts.add(val)
        except (ValueError, TypeError):
            pass
    word_to_num = {
        "одна": 1, "одну": 1, "одной": 1,
        "две": 2, "двумя": 2, "двух": 2,
        "три": 3, "тремя": 3, "трех": 3, "трёх": 3,
        "четыре": 4, "четырьмя": 4, "четырех": 4, "четырёх": 4,
        "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9, "десять": 10,
    }
    for word, num in word_to_num.items():
        if re.search(rf"\b{word}\s+(?:одинаков[а-я]*\s+)?(?:парти[а-я]*|постав[а-я]*|рейс[а-я]*)", text.casefold()):
            counts.add(num)
    return counts


ALLOWED_SCHEDULE_FIELD_KEYS = {"field_041", "field_094", "field_033"}
ALLOWED_SCHEDULE_ALIASES = {
    "field_041",
    "график поставок товаров",
    "график поставок",
    "график поставки",
    "условия поставки",
    "field_033",
    "этапы поставки товаров",
    "этапы поставки",
    "delivery_schedule",
}


def is_actual_fact_scope(scope_val: Any) -> bool:
    if not scope_val or not isinstance(scope_val, str):
        return False
    s = scope_val.casefold()
    return any(w in s for w in ["факт", "исполнен", "выполнен"]) and not any(w in s for w in ["весь", "план"])


def is_non_delivery_scope(scope_val: Any) -> bool:
    if not scope_val or not isinstance(scope_val, str):
        return False
    s = scope_val.casefold()
    if is_actual_fact_scope(s):
        return True
    return any(w in s for w in ["оплат", "расчет", "расчёт", "тендер", "участи"])


def determine_delivery_count(card: dict[str, Any]) -> tuple[int | None, str, str]:
    """Determine delivery count, basis, and note from schedule conditions per 4.4-4.8.
    Direct rule 4.5: On-request assumption has DIRECT priority = 1 delivery.
    """
    fields = card.get("fields") or {}

    # Find schedule fields specifically (do not inspect arbitrary fields like payment or tender bid)
    candidate_schedule_texts: list[str] = []
    candidate_raw_values: list[Any] = []
    for k, v in fields.items():
        norm_k = k.strip().casefold()
        is_sched = norm_k in ALLOWED_SCHEDULE_ALIASES
        if not is_sched and isinstance(v, dict):
            fk = str(v.get("field_key") or "").strip().casefold()
            if fk in {"field_041", "field_033"}:
                is_sched = True
        if is_sched:
            scope = v.get("scope") if isinstance(v, dict) else None
            if is_non_delivery_scope(scope):
                continue
            raw_v = v.get("value") if isinstance(v, dict) else v
            if isinstance(raw_v, dict):
                if is_non_delivery_scope(raw_v.get("scope")):
                    continue
                txt = extract_schedule_text(raw_v)
                if txt:
                    candidate_schedule_texts.append(txt)
                    candidate_raw_values.append(raw_v)
            elif isinstance(raw_v, list):
                valid_items = [
                    item for item in raw_v
                    if not (isinstance(item, dict) and is_non_delivery_scope(item.get("scope")))
                ]
                if valid_items:
                    candidate_raw_values.append(valid_items)
                    for item in valid_items:
                        txt = extract_schedule_text(item)
                        if txt:
                            candidate_schedule_texts.append(txt)
            else:
                txt = extract_schedule_text(raw_v)
                if txt:
                    candidate_schedule_texts.append(txt)
                    candidate_raw_values.append(raw_v)

    # 1. On-request has DIRECT priority over everything else!
    if any(is_on_request_condition(t) for t in candidate_schedule_texts):
        return 1, "ON_REQUEST_ASSUMPTION", "По заявкам: в расчёте заработка учитывается одна доставка"

    # 2. Check for different routes / shipments without explicit delivery groups
    if any(has_different_routes_condition(t) for t in candidate_schedule_texts):
        return None, "UNKNOWN", "Не определена стоимость отдельных поставок (разные маршруты/тарифы)"

    # 3. Check for frequency or inexact bound or multi-delivery condition without exact total
    if any(has_frequency_condition(t) for t in candidate_schedule_texts):
        return None, "UNKNOWN", "Периодическая частота без полного календаря"

    if any(has_bound_condition(t) for t in candidate_schedule_texts):
        return None, "UNKNOWN", "Неточное число доставок (указан диапазон или ограничение)"

    if any("многоразов" in t.casefold() for t in candidate_schedule_texts):
        return None, "UNKNOWN", "Многоразовая поставка без точного числа"

    schedule_counts: set[int] = set()

    # 4. Check for explicit one-time delivery
    if any(is_one_time_condition(t) for t in candidate_schedule_texts):
        schedule_counts.add(1)

    # 5. Check for dated delivery events (section 4.6)
    for raw_item in candidate_raw_values:
        if isinstance(raw_item, list) and len(raw_item) > 0:
            dates = {
                str(item["date"]).strip()
                for item in raw_item
                if isinstance(item, dict) and item.get("date") and not is_non_delivery_scope(item.get("scope"))
            }
            if len(dates) > 0 and all(
                isinstance(item, dict) and item.get("date") and not is_non_delivery_scope(item.get("scope"))
                for item in raw_item
            ):
                schedule_counts.add(len(dates))

    # 6. Extract schedule text batch counts
    for raw_item in candidate_raw_values:
        if isinstance(raw_item, list):
            for sub in raw_item:
                if isinstance(sub, dict) and is_non_delivery_scope(sub.get("scope")):
                    continue
                sub_txt = extract_schedule_text(sub)
                if has_bound_condition(sub_txt) or has_frequency_condition(sub_txt) or "многоразов" in sub_txt.casefold():
                    return None, "UNKNOWN", "Неопределённое условие в графике поставок"
                schedule_counts.update(extract_batch_counts(sub_txt))
        else:
            txt = extract_schedule_text(raw_item)
            schedule_counts.update(extract_batch_counts(txt))

    # 7. Check field_094 (exact number of shipments/batches)
    field_094_counts: set[int] = set()
    for k, v in fields.items():
        norm_k = k.strip().casefold()
        is_f094 = norm_k in {"field_094", "количество партий поставки", "количество партий"}
        if not is_f094 and isinstance(v, dict):
            fk = str(v.get("field_key") or "").strip().casefold()
            if fk == "field_094":
                is_f094 = True
        if is_f094:
            scope = v.get("scope") if isinstance(v, dict) else None
            if is_non_delivery_scope(scope):
                continue
            raw_val = v.get("value") if isinstance(v, dict) else v
            if isinstance(raw_val, dict):
                if is_non_delivery_scope(raw_val.get("scope")):
                    continue
                raw_val = raw_val.get("value") or raw_val.get("text")
            if raw_val is not None and not isinstance(raw_val, bool):
                try:
                    num = int(str(raw_val).strip())
                    if num > 0:
                        field_094_counts.add(num)
                except (ValueError, TypeError):
                    pass

    # Conflicting field_094 counts
    if len(field_094_counts) > 1:
        return None, "UNKNOWN", f"Противоречие между значениями количества партий: {sorted(field_094_counts)}"

    # If there are multiple different delivery counts mentioned in schedule, it's a conflict!
    if len(schedule_counts) > 1:
        return None, "UNKNOWN", f"Противоречие в графике: указано несколько вариантов ({sorted(schedule_counts)})"

    sched_count = next(iter(schedule_counts)) if len(schedule_counts) == 1 else None
    field_094_count = next(iter(field_094_counts)) if len(field_094_counts) == 1 else None

    # Compare schedule count and field_094 count
    if sched_count is not None and field_094_count is not None:
        if sched_count != field_094_count:
            return None, "UNKNOWN", f"Противоречие между графиком ({sched_count}) и числом партий ({field_094_count})"
        return sched_count, "DOCUMENT", f"Число поставок: {sched_count}"

    if sched_count is not None:
        if sched_count == 1 and any(is_one_time_condition(t) for t in candidate_schedule_texts):
            return 1, "DOCUMENT", "Разовая поставка"
        return sched_count, "DOCUMENT", f"Число поставок по графику: {sched_count}"

    if field_094_count is not None:
        return field_094_count, "DOCUMENT", f"Число партий по документам: {field_094_count}"

    return None, "UNKNOWN", "Не определено число доставок"


def select_manual_logistics_offer(logistics: dict[str, Any] | None) -> tuple[dict[str, Any] | None, Decimal | None, str | None]:
    """Select minimum active positive offer among manual carrier tariffs per 4.2-4.3."""
    if not logistics or not isinstance(logistics, dict):
        return None, None, "Расчёт логистики не передан"

    # Must have calculated_at
    if not logistics.get("calculated_at"):
        return None, None, "Отсутствует сохранённый расчёт логистики (нет calculated_at)"

    if logistics.get("delivery_source_status") != "CURRENT":
        return None, None, f"Расчёт логистики не актуален ({logistics.get('delivery_source_status')})"

    offers = logistics.get("offers")
    if not isinstance(offers, list) or not offers:
        return None, None, "Отсутствуют предложения логистики"

    manual_offers: list[tuple[dict[str, Any], Decimal]] = []
    for off in offers:
        if not isinstance(off, dict):
            continue
        # Channel must be MANUAL
        if off.get("channel") != "MANUAL":
            continue
        # Status must be strictly CALCULATED
        if off.get("status") != "CALCULATED":
            continue
        # Currency must be strictly RUB
        raw_curr = off.get("currency")
        if not raw_curr or not isinstance(raw_curr, str) or raw_curr.strip().upper() != "RUB":
            continue
        # Amount must be strictly positive (> 0)
        amt_raw = off.get("amount")
        amt_dec = to_decimal(amt_raw)
        if amt_dec is not None and amt_dec > ZERO:
            manual_offers.append((off, amt_dec))

    if not manual_offers:
        return None, None, "Нет применимого ручного тарифа логистов"

    # Min price, tie-break: carrier_name, tariff_name, tariff_id
    manual_offers.sort(key=lambda item: (
        item[1],
        str(item[0].get("carrier_name") or ""),
        str(item[0].get("tariff_name") or ""),
        str(item[0].get("tariff_id") or ""),
    ))

    best_off, best_amount = manual_offers[0]
    return best_off, best_amount, None


def calculate_preliminary_earnings(
    card: dict[str, Any],
    offers: list[dict[str, Any]],
    logistics: dict[str, Any] | None,
) -> dict[str, Any]:
    """Single server-side Decimal preliminary earnings calculator per specification sections 3-5."""
    card_id = str(card.get("tender_id") or "")
    lines = card.get("tender_lines") or []
    candidate_selection = card.get("candidate_selection") or {}

    result_lines: list[dict[str, Any]] = []
    blockers: list[str] = []

    if not lines:
        blockers.append("В карточке тендера отсутствуют товарные строки")

    # Map offers by line_id
    offers_by_line: dict[str, list[dict[str, Any]]] = {}
    for off in offers:
        lid = str(off.get("line_id") or off.get("tender_line_id") or "")
        if lid:
            offers_by_line.setdefault(lid, []).append(off)

    seen_line_ids: set[str] = set()
    has_line_id_duplicates = False
    all_lines_complete = True

    total_revenue = ZERO
    total_goods_spread = ZERO
    known_goods_spread = ZERO
    has_any_spread = False

    for line in lines:
        line_id = str(line.get("line_id") or "")
        if not line_id or line_id in seen_line_ids:
            has_line_id_duplicates = True
            blockers.append(f"Повторяющийся или пустой line_id: {line_id}")
            all_lines_complete = False
            continue
        seen_line_ids.add(line_id)

        line_blockers: list[str] = []
        target_unit = normalize_unit(line.get("unit"))

        # Customer price and quantity: must be valid numeric
        raw_up = line.get("unit_price")
        unit_price_dec = to_decimal(raw_up)
        if unit_price_dec is None or unit_price_dec < ZERO:
            line_blockers.append("Не подтверждена цена заказчика")

        raw_qty = line.get("quantity")
        qty_dec = to_decimal(raw_qty)
        if qty_dec is None or qty_dec < ZERO:
            line_blockers.append("Не подтверждено количество товара")

        # Candidate selection
        saved_sel = candidate_selection.get(line_id)
        line_offers = offers_by_line.get(line_id, [])
        best_res = select_best_offer_for_line(
            line_id, target_unit, line_offers, saved_sel
        )
        selected_offer = best_res.offer
        purchase_price_dec = best_res.price
        selection_reason = best_res.reason
        purchase_price_source = best_res.source
        purchase_price_unit = best_res.unit

        selected_pid = selected_offer.get("price_registry_id") if selected_offer else None
        if selected_offer is None or purchase_price_dec is None:
            line_blockers.append(selection_reason)

        unit_margin_dec: Decimal | None = None
        line_spread_dec: Decimal | None = None

        if not line_blockers and unit_price_dec is not None and qty_dec is not None and purchase_price_dec is not None:
            with decimal.localcontext() as ctx:
                ctx.prec = 40
                line_revenue = unit_price_dec * qty_dec
                total_revenue += line_revenue
                unit_margin_dec = unit_price_dec - purchase_price_dec
                line_spread_dec = unit_margin_dec * qty_dec
                total_goods_spread += line_spread_dec
                known_goods_spread += line_spread_dec
                has_any_spread = True
        else:
            all_lines_complete = False

        line_result: dict[str, Any] = {
            "line_id": line_id,
            "selected_price_registry_id": selected_pid,
            "purchase_price": format_currency(purchase_price_dec),
            "quantity": format(qty_dec, "f") if qty_dec is not None else None,
            "unit_margin": format_currency(unit_margin_dec),
            "goods_spread": format_currency(line_spread_dec),
            "selection_reason": selection_reason,
            "blockers": line_blockers,
        }
        if purchase_price_source is not None:
            line_result["purchase_price_source"] = purchase_price_source
        if purchase_price_unit is not None:
            line_result["purchase_price_unit"] = purchase_price_unit

        result_lines.append(line_result)
        blockers.extend(line_blockers)

    if has_line_id_duplicates or not lines:
        all_lines_complete = False

    # Logistics calculation
    logistics_total_dec: Decimal | None = None
    delivery_count: int | None = None
    delivery_count_basis: str = "UNKNOWN"
    delivery_note: str = ""
    logistics_source: dict[str, Any] | None = None
    logistics_groups_out: list[dict[str, Any]] | None = None

    # Check delivery groups first (section 4.7)
    deliv_groups = (logistics or {}).get("delivery_groups") if isinstance(logistics, dict) else None
    if isinstance(deliv_groups, list) and deliv_groups:
        groups_total = ZERO
        groups_count = 0
        groups_valid = True
        formatted_groups: list[dict[str, Any]] = []

        if not logistics or not isinstance(logistics, dict) or not logistics.get("calculated_at") or logistics.get("delivery_source_status") != "CURRENT":
            groups_valid = False
        else:
            for g in deliv_groups:
                if not isinstance(g, dict):
                    groups_valid = False
                    break
                if g.get("delivery_source_status") != "CURRENT":
                    groups_valid = False
                    break
                if g.get("channel") != "MANUAL":
                    groups_valid = False
                    break
                if g.get("status") != "CALCULATED":
                    groups_valid = False
                    break
                raw_curr = g.get("currency")
                if not raw_curr or not isinstance(raw_curr, str) or raw_curr.strip().upper() != "RUB":
                    groups_valid = False
                    break

                amt = to_decimal(g.get("amount"))
                if amt is None or amt <= ZERO:
                    groups_valid = False
                    break

                cnt = g.get("delivery_count")
                # Must be exact positive int (not float, not bool)
                if isinstance(cnt, bool) or not isinstance(cnt, int) or cnt <= 0:
                    groups_valid = False
                    break

                subtot = amt * Decimal(cnt)
                groups_total += subtot
                groups_count += cnt
                formatted_groups.append({
                    "carrier_id": g.get("carrier_id"),
                    "tariff_id": g.get("tariff_id"),
                    "amount": format_currency(amt),
                    "delivery_count": cnt,
                    "subtotal": format_currency(subtot),
                })

        if groups_valid:
            logistics_total_dec = groups_total
            delivery_count = groups_count
            delivery_count_basis = "GROUPS"
            delivery_note = f"Расчёт по группам поставок ({len(formatted_groups)} групп)"
            logistics_groups_out = formatted_groups
        else:
            blockers.append("Не определена стоимость отдельных поставок")
    else:
        # Standard delivery evaluation
        delivery_count, delivery_count_basis, delivery_note = determine_delivery_count(card)
        best_log_offer, single_deliv_amount, log_reason = select_manual_logistics_offer(logistics)

        if log_reason:
            blockers.append(log_reason)
        elif delivery_count is None:
            blockers.append("Не определено число доставок")
        elif single_deliv_amount is not None and best_log_offer is not None:
            logistics_total_dec = single_deliv_amount * Decimal(delivery_count)
            logistics_source = {
                "carrier_id": best_log_offer.get("carrier_id"),
                "carrier_name": best_log_offer.get("carrier_name"),
                "tariff_id": best_log_offer.get("tariff_id"),
                "tariff_name": best_log_offer.get("tariff_name"),
                "channel": "MANUAL",
            }

    # Final state and profit
    profit_dec: Decimal | None = None
    margin_pct_dec: Decimal | None = None

    if all_lines_complete and logistics_total_dec is not None:
        state = "CALCULATED"
        profit_dec = total_goods_spread - logistics_total_dec
        if total_revenue > ZERO:
            margin_pct_dec = (profit_dec / total_revenue) * Decimal("100")
        else:
            margin_pct_dec = None
    else:
        state = "INCOMPLETE"

    # Deduplicate blockers preserving order
    seen_b = set()
    unique_blockers = []
    for b in blockers:
        if b not in seen_b:
            seen_b.add(b)
            unique_blockers.append(b)

    return {
        "tender_id": card_id,
        "calculation_kind": "AUTOMATIC_PRELIMINARY",
        "state": state,
        "revenue": format_currency(total_revenue) if all_lines_complete else None,
        "goods_spread": format_currency(total_goods_spread) if all_lines_complete else None,
        "known_goods_spread": format_currency(known_goods_spread) if has_any_spread else None,
        "logistics_total": format_currency(logistics_total_dec),
        "profit": format_currency(profit_dec),
        "margin_percent": format(margin_pct_dec.quantize(TWO_PLACES, rounding=ROUND_HALF_UP), "f") if margin_pct_dec is not None else None,
        "delivery_count": delivery_count,
        "delivery_count_basis": delivery_count_basis,
        "delivery_note": delivery_note,
        "lines": result_lines,
        "blockers": unique_blockers,
        "logistics_source": logistics_source,
        "logistics_groups": logistics_groups_out,
        "preliminary_note": "Предварительный расчёт. Соответствие товаров и окончательная стоимость исполнения не подтверждены.",
    }
