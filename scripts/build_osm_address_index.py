#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import defaultdict
import json
from math import cos, radians
from pathlib import Path
import re
import sqlite3
import time

import osmium


def clean(value: str) -> str:
    return " ".join(str(value or "").replace("ё", "е").casefold().split())


def format_house(value: str) -> str:
    result = " ".join(str(value or "").split())
    result = re.sub(r"(?iu)(?<=\d)[сc](?=\d)", " стр. ", result)
    result = re.sub(r"(?iu)(?<=\d)к(?=\d)", " корп. ", result)
    result = re.sub(r"(?iu)(?<!\w)(?:[сc]|стр[.]?)(?=\d)", "стр. ", result)
    result = re.sub(r"(?iu)(?<!\w)(?:к|корп[.]?)(?=\d)", "корп. ", result)
    return result


def search_text(street: str, house: str, city: str) -> str:
    value = f"{street} {house} {city}"
    value = re.sub(r"(?iu)(?<=\d)[сc](?=\d)", " строение ", value)
    value = re.sub(r"(?iu)(?<=\d)к(?=\d)", " корпус ", value)
    value = re.sub(r"(?iu)(?<!\w)стр(?:оение)?[.]?(?=\s|$)", " строение ", value)
    value = re.sub(r"(?iu)(?<!\w)(?:к|корп(?:ус)?)[.]?(?=\s|$)", " корпус ", value)
    value = re.sub(r"(?iu)(?<!\w)(?:ул(?:ица)?|пр(?:оспект|-т)?|пер(?:еулок)?|ш(?:оссе)?|бул(?:ьвар)?|наб(?:ережная)?)[.]?(?=\s|$)", " ", value)
    return " ".join(re.sub(r"(?u)[^\wа-яё-]+", " ", clean(value)).split())


def point_city(lat: float, lon: float, settlements: dict[tuple[int, int], list[tuple[float, float, str]]]) -> str:
    if 55.48 <= lat <= 56.02 and 36.75 <= lon <= 38.05:
        return "Москва"
    if 59.62 <= lat <= 60.27 and 29.35 <= lon <= 30.85:
        return "Санкт-Петербург"
    gy, gx = int(lat), int(lon)
    best = None
    for radius in (0, 1, 2):
        for y in range(gy - radius, gy + radius + 1):
            for x in range(gx - radius, gx + radius + 1):
                for sy, sx, name in settlements.get((y, x), ()):
                    distance = (lat - sy) ** 2 + ((lon - sx) * cos(radians(lat))) ** 2
                    if best is None or distance < best[0]:
                        best = (distance, name)
        if best is not None:
            break
    return best[1] if best else ""


class AddressHandler(osmium.SimpleHandler):
    def __init__(self, db: sqlite3.Connection, region: str):
        super().__init__()
        self.db = db
        self.region = region
        self.settlements: dict[tuple[int, int], list[tuple[float, float, str]]] = defaultdict(list)
        self.pending: list[tuple] = []
        self.count = 0

    def flush(self) -> None:
        if not self.pending:
            return
        self.db.executemany("INSERT OR IGNORE INTO raw_addresses VALUES (?,?,?,?,?,?,?,?,?)", self.pending)
        self.db.commit()
        self.pending.clear()

    def add(self, kind: str, oid: int, street: str, house: str, city: str, lat: float, lon: float) -> None:
        street = " ".join(street.split())
        house = format_house(house)
        city = " ".join(city.split())
        if not street or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return
        display = f"{street}{' ' + house if house else ''}{', ' + city if city else ''}"
        self.pending.append((f"{self.region}:{kind}:{oid}", street, house, city, display, search_text(street, house, city), lat, lon, self.region))
        self.count += 1
        if len(self.pending) >= 5000:
            self.flush()

    def node(self, node) -> None:
        place = node.tags.get("place")
        name = node.tags.get("name")
        if place in {"city", "town", "village", "hamlet"} and name and node.location.valid():
            self.settlements[(int(node.location.lat), int(node.location.lon))].append((node.location.lat, node.location.lon, name))
        street = node.tags.get("addr:street") or ""
        house = node.tags.get("addr:housenumber") or ""
        if street and node.location.valid():
            city = node.tags.get("addr:city") or node.tags.get("addr:place") or ""
            self.add("n", node.id, street, house, city, node.location.lat, node.location.lon)

    def way(self, way) -> None:
        street = way.tags.get("addr:street") or ""
        house = way.tags.get("addr:housenumber") or ""
        is_street = bool(way.tags.get("highway") and way.tags.get("name"))
        if not street and is_street:
            street = way.tags.get("name") or ""
        if not street:
            return
        points = [(node.location.lat, node.location.lon) for node in way.nodes if node.location.valid()]
        if not points:
            return
        lat = sum(point[0] for point in points) / len(points)
        lon = sum(point[1] for point in points) / len(points)
        city = way.tags.get("addr:city") or way.tags.get("addr:place") or ""
        self.add("w", way.id, street, house, city, lat, lon)


def prepare_output(output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + ".partial")
    partial.unlink(missing_ok=True)
    return partial


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--source", action="append", nargs=2, metavar=("REGION", "PBF"), required=True)
    args = parser.parse_args()
    output = Path(args.output)
    partial = prepare_output(output)
    db = sqlite3.connect(partial)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.execute("CREATE TABLE raw_addresses (id TEXT PRIMARY KEY, street TEXT, house TEXT, city TEXT, display_name TEXT, search_text TEXT, lat REAL, lon REAL, source_region TEXT)")
    source_manifest = []
    for region, filename in args.source:
        started = time.time()
        handler = AddressHandler(db, region)
        cache = f"sparse_file_array,/tmp/okan-address-{region}.idx"
        Path(f"/tmp/okan-address-{region}.idx").unlink(missing_ok=True)
        handler.apply_file(filename, locations=True, idx=cache)
        handler.flush()
        cursor = db.execute("SELECT id,lat,lon FROM raw_addresses WHERE source_region=? AND city=''", (region,))
        city_cache: dict[tuple[int, int], str] = {}
        while rows := cursor.fetchmany(10000):
            updates = []
            for oid, lat, lon in rows:
                cache_key = (round(float(lat) * 50), round(float(lon) * 50))
                if cache_key not in city_cache:
                    city_cache[cache_key] = point_city(float(lat), float(lon), handler.settlements)
                if city_cache[cache_key]:
                    updates.append((city_cache[cache_key], oid))
            db.executemany("UPDATE raw_addresses SET city=? WHERE id=?", updates)
        db.execute("UPDATE raw_addresses SET display_name=street || CASE WHEN house='' THEN '' ELSE ' '||house END || CASE WHEN city='' THEN '' ELSE ', '||city END WHERE source_region=?", (region,))
        db.execute("UPDATE raw_addresses SET search_text=trim(search_text || ' ' || lower(city)) WHERE source_region=?", (region,))
        db.commit()
        source_manifest.append({"region": region, "path": str(Path(filename).resolve()), "raw_rows": handler.count, "seconds": round(time.time()-started, 1)})
        Path(f"/tmp/okan-address-{region}.idx").unlink(missing_ok=True)
        print(json.dumps(source_manifest[-1], ensure_ascii=False), flush=True)
    db.executescript("""
    CREATE TABLE addresses (
      id TEXT PRIMARY KEY, street TEXT NOT NULL, house TEXT NOT NULL,
      city TEXT NOT NULL, display_name TEXT NOT NULL, search_text TEXT NOT NULL,
      lat REAL NOT NULL, lon REAL NOT NULL, source_region TEXT NOT NULL
    );
    INSERT INTO addresses
    SELECT min(id), street, house, city, display_name, min(search_text), avg(lat), avg(lon), min(source_region)
    FROM raw_addresses WHERE city<>'' GROUP BY lower(display_name);
    DROP TABLE raw_addresses;
    CREATE INDEX addresses_city ON addresses(city);
    CREATE VIRTUAL TABLE address_fts USING fts5(search_text, content='addresses', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    INSERT INTO address_fts(rowid, search_text) SELECT rowid, search_text FROM addresses;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    db.execute("INSERT INTO metadata VALUES ('sources', ?)", (json.dumps(source_manifest, ensure_ascii=False),))
    db.execute("INSERT INTO metadata VALUES ('built_at', datetime('now'))")
    db.execute("INSERT INTO metadata VALUES ('address_count', (SELECT count(*) FROM addresses))")
    db.execute("ANALYZE")
    db.commit()
    db.execute("VACUUM")
    assert db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    count = db.execute("SELECT count(*) FROM addresses").fetchone()[0]
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.execute("PRAGMA journal_mode=DELETE")
    db.close()
    partial.replace(output)
    print(json.dumps({"output": str(output), "addresses": count, "sources": source_manifest}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
