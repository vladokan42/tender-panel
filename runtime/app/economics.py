from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any

from .preliminary_earnings import calculate_preliminary_earnings

ZERO = Decimal("0")


@dataclass(frozen=True)
class EconomicsResult:
    state: str
    revenue_without_vat: Decimal | None
    purchase_cost_without_vat: Decimal | None
    direct_expenses_without_vat: Decimal | None
    profit_without_vat: Decimal | None
    margin_percent: Decimal | None
    blockers: tuple[str, ...]
    preliminary_spread_before_unconfirmed_costs: Decimal | None = None
    missing_expenses: tuple[str, ...] = ()


def decimal_value(value: object, field: str, *, positive: bool = False) -> tuple[Decimal | None, str | None]:
    if isinstance(value, bool) or value is None or (isinstance(value, str) and not value.strip()):
        return None, f"Не подтверждено поле: {field}."
    try:
        result = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None, f"Некорректное число: {field}."
    if not result.is_finite() or (positive and result <= ZERO) or (not positive and result < ZERO):
        return None, f"Недопустимое значение: {field}."
    return result, None


def choose_candidate(candidates: list[dict[str, Any]], plan_date: str) -> dict[str, Any] | None:
    valid = [
        item for item in candidates
        if item.get("fit_status") in {"SPEC_MATCH", "STRICT_SPEC_MATCH"}
        and not item.get("calculation_blockers")
        and item.get("price_valid_until", "") >= plan_date
        and item.get("volume_confirmed") is True
    ]
    return min(valid, key=lambda item: (-Decimal(str(item.get("match_score", 0))), str(item.get("offer_id", "")))) if valid else None


def calculate_line(line: dict[str, Any], candidate: dict[str, Any] | None) -> dict[str, Any]:
    blockers: list[str] = []
    sale, error = decimal_value(line.get("unit_price_without_vat"), "цена заказчика без НДС", positive=True); blockers += [error] if error else []
    qty, error = decimal_value(line.get("quantity"), "количество", positive=True); blockers += [error] if error else []
    if not line.get("quantity_unit_confirmed"): blockers.append("Не подтверждена единица количества.")
    if not line.get("customer_price_unit_confirmed"): blockers.append("Не подтверждена единица цены заказчика.")
    if candidate is None: blockers.append("Нет выбранного подтверждённого кандидата.")
    if candidate:
        if candidate.get("fit_status") != "SPEC_MATCH":
            blockers.append("Выбранный кандидат не имеет статуса SPEC_MATCH.")
        if candidate.get("calculation_blockers"):
            blockers.append("У выбранного кандидата есть блокирующие причины расчёта.")
        for key, label in (("supplier_unit_confirmed", "единица цены поставщика"), ("package_factor_confirmed", "коэффициент фасовки"), ("rounding_confirmed", "кратность и правило округления"), ("volume_confirmed", "доступный объём"), ("price_valid_until", "срок действия цены")):
            if not candidate.get(key): blockers.append(f"Не подтверждено: {label}.")
        buy, error = decimal_value(candidate.get("unit_price_without_vat"), "цена поставщика без НДС", positive=True); blockers += [error] if error else []
        factor, error = decimal_value(candidate.get("package_factor"), "коэффициент фасовки", positive=True); blockers += [error] if error else []
    else:
        buy = factor = None
    if blockers:
        return {
            "line_revenue_without_vat": None,
            "line_purchase_cost_without_vat": None,
            "line_margin_rub": None,
            "line_margin_percent": None,
            "line_profit_rub": None,
            "packages_required": None,
            "calculation_blockers": blockers,
        }
    # package_factor is the confirmed number of requested units in one supplier
    # package. Supplier price is always the price of one package. We buy an
    # integral package count, rounded up so the requested quantity is covered.
    # Decimal division is context-bound.  Ceiling via integer ratios preserves
    # every significant digit of both operands, including values beyond the
    # default Decimal context precision.
    qty_num, qty_den = qty.as_integer_ratio()
    factor_num, factor_den = factor.as_integer_ratio()
    numerator = qty_num * factor_den
    denominator = qty_den * factor_num
    packages = Decimal((numerator + denominator - 1) // denominator)
    purchase = packages * buy
    revenue = qty * sale
    profit = revenue - purchase
    return {
        "line_revenue_without_vat": revenue,
        "line_purchase_cost_without_vat": purchase,
        "line_margin_rub": profit,
        "line_margin_percent": profit / revenue * Decimal("100"),
        "line_profit_rub": profit,
        "packages_required": packages,
        "calculation_blockers": [],
    }


def calculate_direct_expenses(components: object) -> tuple[Decimal | None, tuple[str, ...]]:
    if not isinstance(components, list) or not components:
        return None, ("Не передан полный проверяемый список компонентов расходов FIN-13.",)

    expense_ids: set[str] = set()
    total = ZERO
    blockers: list[str] = []
    for index, component in enumerate(components, start=1):
        if not isinstance(component, dict):
            blockers.append(f"Некорректный компонент прямых расходов № {index}.")
            continue
        expense_id = str(component.get("expense_id") or "").strip()
        if not expense_id or expense_id in expense_ids:
            blockers.append("Повторный или пустой expense_id прямых расходов.")
        else:
            expense_ids.add(expense_id)
        amount, error = decimal_value(component.get("amount_without_vat"), f"сумма прямых расходов {expense_id or index}")
        if error:
            blockers.append(error)
        else:
            total += amount
        if component.get("confirmed") is not True:
            blockers.append(f"Не подтверждён компонент расходов {expense_id or index}.")
        if str(component.get("source") or "").strip() not in {"TENDERMAN", "OFFICIAL_DOCUMENT", "USER_CONFIRMED"}:
            blockers.append(f"Неизвестный источник компонента расходов {expense_id or index}.")
        if str(component.get("expense_kind") or "").strip() not in {"DIRECT", "GENERAL"}:
            blockers.append(f"Не указан вид компонента расходов {expense_id or index}.")
    return (None, tuple(sorted(set(blockers)))) if blockers else (total, ())


def calculate_tender(lines: list[dict[str, Any]], direct_expenses: object = None) -> EconomicsResult:
    if not lines:
        return EconomicsResult(
            "NOT_CALCULATED", None, None, None, None, None,
            ("В тендере нет товарных строк для расчёта.",),
        )
    line_ids: set[str] = set()
    offer_ids: set[str] = set()
    line_offer_pairs: set[tuple[str, str]] = set()
    for line in lines:
        line_id = str(line.get("line_id") or "").strip()
        if not line_id or line_id in line_ids:
            return EconomicsResult("NOT_CALCULATED", None, None, None, None, None, ("Повторный или пустой line_id.",))
        line_ids.add(line_id)
        candidate = line.get("selected_candidate")
        if not isinstance(candidate, dict):
            continue
        offer_id = str(candidate.get("offer_id") or "").strip()
        pair = (line_id, offer_id)
        if not offer_id or offer_id in offer_ids or pair in line_offer_pairs:
            return EconomicsResult("NOT_CALCULATED", None, None, None, None, None, ("Повторный или пустой offer_id.",))
        offer_ids.add(offer_id)
        line_offer_pairs.add(pair)
    results = [calculate_line(line, line.get("selected_candidate")) for line in lines]
    blockers = tuple(sorted({reason for result in results for reason in result["calculation_blockers"]}))
    if blockers:
        return EconomicsResult("NOT_CALCULATED", None, None, None, None, None, blockers)
    revenue = sum((result["line_revenue_without_vat"] for result in results), ZERO)
    purchase = sum((result["line_purchase_cost_without_vat"] for result in results), ZERO)
    expense, expense_blockers = calculate_direct_expenses(direct_expenses)
    if expense_blockers:
        preliminary_profit = revenue - purchase
        return EconomicsResult(
            "PRELIMINARY_INCOMPLETE_COSTS", revenue, purchase, None, None, None,
            expense_blockers, preliminary_profit, expense_blockers,
        )
    profit = revenue - purchase - expense
    state = "LOSS" if profit < ZERO else "VERIFIED"
    return EconomicsResult(state, revenue, purchase, expense, profit, profit / revenue * Decimal("100"), ())
