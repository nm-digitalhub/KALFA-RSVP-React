from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from hebrew_legal_term_translator import HebrewLegalTermTranslator, normalize_text, result_to_markdown

ROOT = Path(__file__).resolve().parents[1]
CLI_PATH = ROOT / "scripts" / "hebrew-legal-term-translator-cli.py"


def subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}{os.pathsep}{existing}"
    return env


@pytest.fixture()
def client() -> HebrewLegalTermTranslator:
    return HebrewLegalTermTranslator()


def test_exact_hebrew_lookup(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("חשבונית מס")
    assert result.matched_key == "cheshbonit_mas"
    assert "VAT" in result.english


def test_lookup_by_key(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("cheshbonit_mas")
    assert result.matched_hebrew == "חשבונית מס"


def test_osek_patur_alias(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("vat exempt")
    assert result.matched_hebrew == "עוסק פטור"


def test_osek_murshe_lookup(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("עוסק מורשה")
    assert result.area == "tax"


def test_company_limited_lookup(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("חברה בעמ")
    assert result.matched_key == "chevra_baam"


def test_normalizes_niqqud() -> None:
    assert normalize_text("מַעֲ״מ") == normalize_text("מעמ")


def test_normalizes_smart_quotes() -> None:
    assert normalize_text("בע״מ") == normalize_text("בעמ")


def test_search_consumer(client: HebrewLegalTermTranslator) -> None:
    results = client.search("refund online")
    assert any(item["key"] in {"iska_meker_rachok", "bitul_iska"} for item in results)


def test_area_filter(client: HebrewLegalTermTranslator) -> None:
    results = client.search("notice", area="employment")
    assert results
    assert all(item["area"] == "employment" for item in results)


def test_unknown_term_suggestions(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("חשבונית קבלה מס")
    assert result.matched_key in {"cheshbonit_mas_kabala", "cheshbonit_mas", "kabala"} or result.suggestions


def test_explain_text_detects_multiple_terms(client: HebrewLegalTermTranslator) -> None:
    text = "קיבלתי חשבונית מס וקבלה, ויש גם ניכוי מס במקור."
    results = client.explain_text(text)
    keys = {item.matched_key for item in results}
    assert {"cheshbonit_mas", "kabala", "nikui_mas_bamakor"} <= keys


def test_explain_text_respects_limit(client: HebrewLegalTermTranslator) -> None:
    text = "חשבונית מס קבלה עוסק מורשה ניכוי מס במקור"
    results = client.explain_text(text, max_terms=2)
    assert len(results) == 2


def test_batch_explain_preserves_order(client: HebrewLegalTermTranslator) -> None:
    results = client.batch_explain(["קבלה", "עוסק פטור"])
    assert [item.matched_key for item in results] == ["kabala", "osek_patur"]


@pytest.mark.asyncio
async def test_async_explain(client: HebrewLegalTermTranslator) -> None:
    result = await client.async_explain("תביעה קטנה")
    assert result.matched_key == "tvia_ktana"


@pytest.mark.asyncio
async def test_async_search(client: HebrewLegalTermTranslator) -> None:
    results = await client.async_search("privacy database")
    assert any(item["key"] == "maagar_meida" for item in results)


@pytest.mark.asyncio
async def test_async_batch(client: HebrewLegalTermTranslator) -> None:
    results = await client.async_batch_explain(["כתב הגנה", "ערבות אישית"])
    assert [item.risk_level for item in results] == ["critical", "critical"]


@pytest.mark.asyncio
async def test_async_explain_text(client: HebrewLegalTermTranslator) -> None:
    results = await client.async_explain_text("מאגר מידע מחייב בדיקה של הסכמה")
    assert {item.matched_key for item in results} == {"maagar_meida", "heskama"}


def test_payload_validation_success(client: HebrewLegalTermTranslator) -> None:
    payload = {"query": "שעות נוספות", "language": "he", "context": "employment"}
    assert client.validate_payload(payload)["valid"] is True


def test_payload_validation_errors(client: HebrewLegalTermTranslator) -> None:
    payload = {"query": "", "language": "fr", "context": "unknown"}
    result = client.validate_payload(payload)
    assert result["valid"] is False
    assert len(result["errors"]) == 3


def test_explain_payload(client: HebrewLegalTermTranslator) -> None:
    result = client.explain_payload({"query": "לשון הרע", "language": "en"})
    assert result.area == "civil"


def test_list_terms_area(client: HebrewLegalTermTranslator) -> None:
    tax_terms = client.list_terms(area="tax")
    assert tax_terms
    assert all(item["area"] == "tax" for item in tax_terms)


def test_source_index_contains_official_sources(client: HebrewLegalTermTranslator) -> None:
    sources = client.source_index()
    assert "vat_law" in sources
    assert sources["vat_law"]["url"].startswith("https://")


def test_markdown_renderer(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("פיצוי מוסכם")
    markdown = result_to_markdown(result)
    assert "פיצוי מוסכם" in markdown
    assert "Verify against" in markdown


def test_hebrew_language_result(client: HebrewLegalTermTranslator) -> None:
    result = client.explain("הודעה מוקדמת", language="he")
    markdown = client.render_markdown(result)
    assert "הודעה" in result.plain_hebrew
    assert "Request ID" in markdown


def test_empty_query_rejected(client: HebrewLegalTermTranslator) -> None:
    with pytest.raises(ValueError):
        client.explain("")


def test_invalid_language_rejected(client: HebrewLegalTermTranslator) -> None:
    with pytest.raises(ValueError):
        client.explain("קבלה", language="fr")


def test_limit_rejected(client: HebrewLegalTermTranslator) -> None:
    with pytest.raises(ValueError):
        client.search("tax", limit=0)


def test_cli_lookup_json() -> None:
    completed = subprocess.run(
        [sys.executable, str(CLI_PATH), "lookup", "חשבונית מס", "--json", "--env", "sandbox"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
        env=subprocess_env(),
    )
    payload = json.loads(completed.stdout)
    assert payload["matched_key"] == "cheshbonit_mas"
    assert payload["environment"] == "sandbox"


def test_cli_search_json() -> None:
    completed = subprocess.run(
        [sys.executable, str(CLI_PATH), "search", "consumer refund", "--json"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
        env=subprocess_env(),
    )
    payload = json.loads(completed.stdout)
    assert payload["results"]


def test_example_script_json() -> None:
    example = ROOT / "scripts" / "examples" / "invoice_review.py"
    completed = subprocess.run(
        [sys.executable, str(example), "--env", "sandbox"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
        env=subprocess_env(),
    )
    payload = json.loads(completed.stdout)
    assert payload["scenario"] == "invoice_review"
    assert payload["results"][0]["matched_key"] == "cheshbonit_mas"


def test_no_hyphenated_client_file() -> None:
    assert not (ROOT / "scripts" / "hebrew-legal-term-translator-client.py").exists()
    assert (ROOT / "scripts" / "hebrew_legal_term_translator_client.py").exists()
