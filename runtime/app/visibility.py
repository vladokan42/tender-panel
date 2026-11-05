"""Lossless business JSON boundary for the authenticated tender read-model.
Quality states never select rows. Access exclusions are explicit and auditable.
"""
from __future__ import annotations
import copy
import re
from urllib.parse import urlsplit, parse_qsl

PRIVATE_KEY = re.compile(r"(?:password|passwd|secret|credential|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|connection[_-]?string|(?:^|_)token$|(?:^|_)(?:absolute|local|storage|file|attachment|source)_?path$)", re.I)
PRIVATE_VALUE = re.compile(r"(?:/home/|/etc/|/var/|/srv/|/tmp/|[A-Za-z]:\\|-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+)", re.I)
ACCESS_KEYS = {"sale_price", "selling_price", "content_blob"}
SAFE_SOURCE_LOCATORS = {"price.value", "type"}


def safe_source_locator(key: str, value: object) -> bool:
    """Allow documented JSON locators without weakening filesystem redaction."""
    return key == "source_path" and isinstance(value, str) and value in SAFE_SOURCE_LOCATORS

def public_business_data(payload):
    excluded = []
    def walk(value, path):
        if isinstance(value, dict):
            result = {}
            for key, child in value.items():
                child_path = f"{path}/{key}"
                if (PRIVATE_KEY.search(str(key)) and not safe_source_locator(str(key), child)) or key in ACCESS_KEYS:
                    excluded.append({"path":child_path, "reason":"ACCESS_RESTRICTED"})
                elif isinstance(child, str) and private_string(child):
                    excluded.append({"path":child_path, "reason":"PRIVATE_VALUE"})
                    result[key] = "[скрыто: служебные данные]"
                else:
                    result[key] = walk(child, child_path)
            return result
        if isinstance(value, list):
            return [walk(child, f"{path}/{i}") for i,child in enumerate(value)]
        if isinstance(value, str) and private_string(value):
            excluded.append({"path":path,"reason":"PRIVATE_VALUE"})
            return "[скрыто: служебные данные]"
        return value
    def private_string(value):
        if PRIVATE_VALUE.search(value):
            return True
        if value.startswith(("https://", "http://")):
            try:
                u = urlsplit(value)
                return bool(u.username or u.password or any(PRIVATE_KEY.search(k) for k,v in parse_qsl(u.query)))
            except ValueError:
                return True
        return False
    result = walk(payload, "")
    if excluded and isinstance(result, dict):
        result.setdefault("access_exclusions", []).extend(excluded)
    return result


def merge_available(base, incoming):
    """Retain saved values when a refresh is partial. Explicit false/zero survive.
    Stable-key list union, rather than replacement of a complete saved collection.
    Conflicting source versions remain available through full_data on the API.
    """
    if isinstance(base, dict) and isinstance(incoming, dict):
        result = copy.deepcopy(base)
        for key, value in incoming.items():
            result[key] = merge_available(result[key], value) if key in result else copy.deepcopy(value)
        return result
    if isinstance(base, list) and isinstance(incoming, list):
        result = copy.deepcopy(base)
        def identity(item):
            if isinstance(item,dict):
                if item.get('price_registry_id') is not None:
                    return ('offer',str(item.get('line_id')),str(item['price_registry_id']))
                if 'product_name' in item:
                    return ('offer-name',str(item.get('line_id')),str(item.get('supplier')),str(item.get('article')),str(item['product_name']))
                for key in ('field_key','candidate_id','line_id','document_id'):
                    if item.get(key) is not None: return (key,str(item[key]))
            return None
        for item in incoming:
            ident = identity(item)
            match = next((i for i,v in enumerate(result) if ident is not None and identity(v)==ident),None)
            if match is None and isinstance(item,dict) and item.get('product_name'):
                aliases = [i for i,v in enumerate(result) if isinstance(v,dict)
                    and (v.get('price_registry_id') is None or item.get('price_registry_id') is None)
                    and all(v.get(k)==item.get(k) for k in ('line_id','supplier','article','product_name'))]
                if len(aliases)==1: match=aliases[0]
            if match is not None: result[match] = merge_available(result[match],item)
            elif item not in result: result.append(copy.deepcopy(item))
        return result
    if incoming is None or incoming == "":
        return copy.deepcopy(base)
    return copy.deepcopy(incoming)


def leaf_rows(value, path=""):
    """Typed JSON paths, including empty containers: shared UI/export coverage."""
    if isinstance(value,dict) and value:
        for key,child in value.items():
            key = str(key).replace('~','~0').replace('/','~1')
            yield from leaf_rows(child,f"{path}/{key}")
    elif isinstance(value,list) and value:
        for index,child in enumerate(value): yield from leaf_rows(child,f"{path}/{index}")
    else:
        yield {"path":path or "/", "value":value}
