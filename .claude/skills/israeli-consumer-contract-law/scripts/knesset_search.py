#!/usr/bin/env python3
"""Knesset legislation search (OData) with a graded fallback chain.

Tier 1: live OData query (knesset.gov.il). Works from unblocked networks;
        from THIS server it is geo-blocked (HTTP 474, measured 2026-07-26).
Tier 2 (on block): prints a READY browser URL for the human operator plus
        pointers to the proven alternative paths (Wayback gazette PDFs via
        fetch_law_pdf.py, Nevo consolidated texts). Exits 0 so the agent
        reads the guidance instead of crashing — the tool never fabricates.

stdlib-only (urllib); no third-party deps.

Usage:
  python3 scripts/knesset_search.py --query "הגנת הצרכן" [--and-query "74"]
      [--knesset 25] [--entity bills|laws] [--limit 5]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE_V4 = "https://knesset.gov.il/OdataV4/ParliamentInfo"
ENTITY_MAP = {"bills": "KNS_Bill", "laws": "KNS_IsraelLaw"}
TIMEOUT = 8


def odata_quote(s: str) -> str:
    """OData string literal: double any single quote / geresh (e.g. מס' 74)."""
    return s.replace("'", "''")


def build_query(entity: str, query: str, and_query: str | None,
                knesset: int | None, limit: int) -> str:
    filters = [f"contains(Name,'{odata_quote(query)}')"]
    if and_query:
        filters.append(f"contains(Name,'{odata_quote(and_query)}')")
    if knesset and entity == "KNS_Bill":
        filters.append(f"KnessetNum eq {knesset}")
    params = {
        "$filter": " and ".join(filters),
        "$orderby": "LastUpdatedDate desc",
        "$top": str(limit),
        "$format": "json",
    }
    return f"{BASE_V4}/{entity}?{urllib.parse.urlencode(params)}"


def main() -> None:
    p = argparse.ArgumentParser(description="Knesset OData search with fallback chain")
    p.add_argument("--query", required=True, help="Hebrew search term (law/bill name part)")
    p.add_argument("--and-query", default=None, help="Additional required term (avoids geresh issues, e.g. '74')")
    p.add_argument("--knesset", type=int, default=None, help="Knesset number filter (bills only)")
    p.add_argument("--entity", choices=list(ENTITY_MAP), default="bills")
    p.add_argument("--limit", type=int, default=5)
    args = p.parse_args()

    url = build_query(ENTITY_MAP[args.entity], args.query, args.and_query,
                      args.knesset, args.limit)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; legal-research)",
        "Accept": "application/json",
    })

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        rows = data.get("value", [])
        if not rows:
            print(f"לא נמצאו תוצאות ב-OData החי עבור: {args.query!r}"
                  + (f" + {args.and_query!r}" if args.and_query else ""))
            return
        print(f"נמצאו {len(rows)} תוצאות (OData חי, {ENTITY_MAP[args.entity]}):")
        for r in rows:
            rid = r.get("BillID") or r.get("IsraelLawID") or r.get("Id")
            print(f"- [{rid}] {r.get('Name')} "
                  f"(כנסת {r.get('KnessetNum', '—')} · עודכן {r.get('LastUpdatedDate', '—')})")
        return
    except urllib.error.HTTPError as e:
        blocked = e.code in (403, 474)
        reason = f"HTTP {e.code}" + (" — חסימת-IP של שרתי הכנסת (ידועה מסביבות ענן)" if blocked else "")
    except Exception as e:  # noqa: BLE001 — any network failure routes to the fallback
        reason = f"{type(e).__name__}: {e}"

    # ---- Tier 2: fallback guidance (exit 0 — the agent must READ this, not crash)
    print(f"⚠️ ה-OData החי אינו נגיש מהמכונה הזו ({reason}).")
    print("שרשרת הגיבוי — אין לנחש ואין להמציא תוצאה:")
    print()
    print("1) הרצה מדפדפן אנושי (IP לא חסום) — פתחו את ה-URL המוכן והדביקו את ה-JSON:")
    print(f"   {url}")
    print()
    print("2) מסמכי רשומות (PDF ס\"ח/ק\"ת) — עוקף החסימה + חילוץ עברית תקין:")
    print("   python3 scripts/fetch_law_pdf.py <fs.knesset.gov.il PDF url>")
    print()
    print("3) נוסח משולב (הצלבה, לא הנוסח המחייב) — נבו, נגיש חי:")
    print(f"   https://www.nevo.co.il/  (חיפוש: {args.query})")
    print("   לרשום את חותמת 'נוסח עדכני נכון ליום' של העמוד.")
    sys.exit(0)


if __name__ == "__main__":
    main()
