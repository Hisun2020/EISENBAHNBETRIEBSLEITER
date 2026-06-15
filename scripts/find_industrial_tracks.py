#!/usr/bin/env python3
"""
Sucht über die Overpass-API alle aktiven Industriegleise in einem deutschen Bundesland.

Verwendung:
    python scripts/find_industrial_tracks.py "Nordrhein-Westfalen"

Optional:
    python scripts/find_industrial_tracks.py "Nordrhein-Westfalen" --output ergebnisse.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

FEDERAL_STATE_AREA_IDS = {
    "baden-württemberg": "3600062427",
    "badenwuerttemberg": "3600062427",
    "baden-wuerttemberg": "3600062427",
    "bayern": "3600062428",
    "berlin": "3600062422",
    "brandenburg": "3600062429",
    "bremen": "3600062431",
    "hamburg": "3600062421",
    "hessen": "3600062419",
    "mecklenburg-vorpommern": "3600062430",
    "niedersachsen": "3600062432",
    "nrw": "3600062417",
    "nordrhein-westfalen": "3600062417",
    "rheinland-pfalz": "3600062418",
    "saarland": "3600062420",
    "sachsen": "3600062424",
    "sachsen-anhalt": "3600062423",
    "schleswig-holstein": "3600062425",
    "thueringen": "3600062426",
    "thüringen": "3600062426",
}

FILTER_WORDS = (
    "anschlussgleis",
    "industriegleis",
    "gleisanschluss",
    "anschlussbahn",
    "hafenbahn",
    "werksbahn",
    "rangiergleis",
    "ladegleis",
    "verlade",
    "industrie",
    "industrial",
    "werk",
    "güterverkehr",
    "gueterverkehr",
    "container",
    "logistik",
    "terminal",
)

IGNORE_NAME_PARTS = (
    "deutsche bahn",
    "db netz",
    "db infra",
    "db station&service",
    "db regio",
    "s-bahn",
    "straßenbahn",
    "stadtbahn",
    "tram",
    "u-bahn",
)

IGNORE_RAILWAY_NAMES = (
    "anhalter bahn",
    "berliner stadtbahn",
    "berliner außenring",
    "berliner ringbahn",
    "kreuzbahn",
    "goerlitzer bahn",
    "hamburger bahn",
    "lehrter bahn",
    "wetzlarer bahn",
)


def normalize_state(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    normalized = normalized.replace("ü", "ue")
    normalized = normalized.replace("ä", "ae")
    normalized = normalized.replace("ö", "oe")
    return normalized


def get_state_id(state: str) -> str:
    normalized = normalize_state(state)

    if normalized not in FEDERAL_STATE_AREA_IDS:
        available = ", ".join(sorted(set(FEDERAL_STATE_AREA_IDS)))
        raise ValueError(
            f"Unbekanntes Bundesland: {state}\n"
            f"Verfügbare Werte: {available}"
        )

    return FEDERAL_STATE_AREA_IDS[normalized]


def build_overpass_query(state_id: str) -> str:
    return f"""
        [out:json][timeout:180];
        area({state_id})->.state;

        (
          way["railway"~"^(service|industrial|yard)$"](area.state);
          way["railway"="rail"]["usage"="industrial"](area.state);
          relation["railway"~"^(service|industrial|yard)$"](area.state);
          relation["railway"="rail"]["usage"="industrial"](area.state);
        );

        out center tags geom;
    """


def query_overpass(query: str) -> dict[str, Any]:
    headers = {"User-Agent": "eisenbahnbetriebsleiter-industrial-tracks/1.0"}
    last_error: requests.RequestException | None = None

    for attempt in range(3):
        try:
            response = requests.post(
                OVERPASS_URL,
                data={"data": query},
                timeout=240,
                headers=headers,
            )

            if response.status_code in {429, 502, 503, 504}:
                time.sleep(5 * (attempt + 1))
                continue

            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(5 * (attempt + 1))

    if last_error:
        raise last_error

    raise requests.RequestException("Overpass-API konnte keine gültige Antwort liefern.")


def normalize_text(value: str | None) -> str:
    if not value:
        return ""

    text = value.strip()
    text = re.sub(r"\s+", " ", text)
    return text


def has_lifecycle_tag(tags: dict[str, str]) -> bool:
    lifecycle_keys = (
        "disused",
        "abandoned",
        "dismantled",
        "demolished",
        "razed",
        "proposed",
        "construction",
        "preserved",
        "heritage",
    )

    for key, value in tags.items():
        normalized_key = key.lower()
        normalized_value = value.lower()

        if normalized_key in lifecycle_keys or normalized_key.startswith("disused:") or normalized_key.startswith("abandoned:"):
            return True

        if normalized_value in lifecycle_keys:
            return True

    return False


def looks_like_industrial_track(tags: dict[str, str]) -> bool:
    if has_lifecycle_tag(tags):
        return False

    railway = tags.get("railway", "").lower()
    service = tags.get("service", "").lower()
    usage = tags.get("usage", "").lower()
    operator = normalize_text(tags.get("operator")).lower()
    name = normalize_text(tags.get("name")).lower()
    description = normalize_text(tags.get("description")).lower()
    industrial = normalize_text(tags.get("industrial")).lower()

    haystack = " ".join([railway, service, usage, operator, name, description, industrial])

    if any(ignore in name for ignore in IGNORE_RAILWAY_NAMES):
        return False

    if railway == "rail" and usage == "main":
        return False

    if operator and any(ignore in operator for ignore in IGNORE_NAME_PARTS) and not any(word in haystack for word in FILTER_WORDS):
        return False

    if railway == "industrial":
        return True

    if "industrial" in usage or "industrial" in service or "industrial" in industrial:
        return True

    if railway == "service" and service in {"spur", "siding", "yard"}:
        return True

    if any(word in haystack for word in FILTER_WORDS):
        return True

    return False


def extract_company_name(tags: dict[str, str]) -> str:
    preferred_keys = (
        "name",
        "operator",
        "brand",
        "owner",
        "addr:street",
        "industrial",
    )

    for key in preferred_keys:
        value = normalize_text(tags.get(key))
        if value and not value.lower().startswith(IGNORE_NAME_PARTS):
            return value

    return ""


def extract_results(overpass_data: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []

    for element in overpass_data.get("elements", []):
        tags = element.get("tags", {})

        if not looks_like_industrial_track(tags):
            continue

        company_name = extract_company_name(tags)

        if not company_name:
            continue

        results.append(
            {
                "company_name": company_name,
                "railway": tags.get("railway", ""),
                "service": tags.get("service", ""),
                "usage": tags.get("usage", ""),
                "operator": tags.get("operator", ""),
                "name": tags.get("name", ""),
                "id": element.get("id"),
                "type": element.get("type"),
                "center": element.get("center"),
                "geometry": element.get("geometry"),
                "tags": tags,
            }
        )

    results.sort(key=lambda item: item["company_name"].lower())

    unique_results: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    for item in results:
        key = item["company_name"].lower()

        if key in seen_names:
            continue

        seen_names.add(key)
        unique_results.append(item)

    return unique_results


def write_output(results: list[dict[str, Any]], output_path: str | None) -> None:
    if not output_path:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sucht aktive Industriegleise in einem deutschen Bundesland über die Overpass-API."
    )
    parser.add_argument("bundesland", help="Bundesland, z. B. Nordrhein-Westfalen")
    parser.add_argument("--output", help="Pfad zur JSON-Ausgabedatei")
    args = parser.parse_args()

    try:
        state_id = get_state_id(args.bundesland)
    except ValueError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 2

    query = build_overpass_query(state_id)

    try:
        overpass_data = query_overpass(query)
    except requests.RequestException as exc:
        print(f"Overpass-API-Fehler: {exc}", file=sys.stderr)
        return 1

    time.sleep(1)

    results = extract_results(overpass_data)

    write_output(results, args.output)

    print(f"\nGefunden: {len(results)} Firmen mit Industriegleisen in {args.bundesland}.", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())