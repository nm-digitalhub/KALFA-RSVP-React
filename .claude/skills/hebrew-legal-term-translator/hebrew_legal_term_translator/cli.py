"""Command-line interface for the Hebrew legal-term translator."""

from __future__ import annotations

import json
import os
from enum import Enum
from typing import Optional

import typer

from .client import HebrewLegalTermTranslator, result_to_markdown


class Environment(str, Enum):
    """Supported local execution environments."""

    sandbox = "sandbox"
    production = "production"


app = typer.Typer(help="Explain Israeli Hebrew legal terms for small businesses, freelancers, and consumers.")


def _environment_value(value: Environment) -> str:
    return value.value if isinstance(value, Environment) else str(value)


def _client() -> HebrewLegalTermTranslator:
    return HebrewLegalTermTranslator()


@app.command()
def lookup(
    term: str = typer.Argument(..., help="Hebrew, English, alias, or term key."),
    language: str = typer.Option(os.getenv("HEBREW_LEGAL_TRANSLATOR_LANG", "en"), "--language", "-l", help="Output language: en or he."),
    env: Environment = typer.Option(Environment(os.getenv("HEBREW_LEGAL_TRANSLATOR_ENV", "sandbox")), "--env", help="Execution environment label."),
    json_output: bool = typer.Option(False, "--json", help="Print machine-readable JSON."),
) -> None:
    """Explain one legal term."""
    translator = _client()
    result = translator.explain(term, language=language)
    if json_output:
        payload = result.to_dict()
        payload["environment"] = _environment_value(env)
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    typer.echo(result_to_markdown(result))


@app.command()
def search(
    query: str = typer.Argument(..., help="Search text."),
    area: Optional[str] = typer.Option(None, "--area", "-a", help="Optional area filter."),
    limit: int = typer.Option(10, "--limit", min=1, max=50, help="Maximum results."),
    env: Environment = typer.Option(Environment(os.getenv("HEBREW_LEGAL_TRANSLATOR_ENV", "sandbox")), "--env", help="Execution environment label."),
    json_output: bool = typer.Option(False, "--json", help="Print machine-readable JSON."),
) -> None:
    """Search glossary entries."""
    translator = _client()
    results = translator.search(query, area=area, limit=limit)
    if json_output:
        typer.echo(json.dumps({"environment": _environment_value(env), "results": results}, ensure_ascii=False, indent=2))
        return
    for item in results:
        typer.echo(f"{item['hebrew']} — {item['english']} [{item['area']}, {item['risk_level']}]")


@app.command("explain-text")
def explain_text(
    text: str = typer.Argument(..., help="Text containing Hebrew legal terms."),
    max_terms: int = typer.Option(10, "--max-terms", min=1, max=50),
    language: str = typer.Option(os.getenv("HEBREW_LEGAL_TRANSLATOR_LANG", "en"), "--language", "-l"),
    env: Environment = typer.Option(Environment(os.getenv("HEBREW_LEGAL_TRANSLATOR_ENV", "sandbox")), "--env", help="Execution environment label."),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    """Detect and explain terms inside a sentence, clause, notice, or invoice note."""
    translator = _client()
    results = translator.explain_text(text, max_terms=max_terms, language=language)
    if json_output:
        payload = {"environment": _environment_value(env), "results": [item.to_dict() for item in results]}
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    if not results:
        typer.echo("No glossary terms detected.")
        return
    for result in results:
        typer.echo(result_to_markdown(result))
        typer.echo("")


@app.command("list-terms")
def list_terms(
    area: Optional[str] = typer.Option(None, "--area", "-a", help="Optional area filter."),
    env: Environment = typer.Option(Environment(os.getenv("HEBREW_LEGAL_TRANSLATOR_ENV", "sandbox")), "--env", help="Execution environment label."),
    json_output: bool = typer.Option(False, "--json"),
) -> None:
    """List available glossary entries."""
    translator = _client()
    terms = translator.list_terms(area=area)
    if json_output:
        typer.echo(json.dumps({"environment": _environment_value(env), "terms": terms}, ensure_ascii=False, indent=2))
        return
    for item in terms:
        typer.echo(f"{item['key']}: {item['hebrew']} — {item['english']}")


@app.command()
def sources(
    env: Environment = typer.Option(Environment(os.getenv("HEBREW_LEGAL_TRANSLATOR_ENV", "sandbox")), "--env", help="Execution environment label."),
) -> None:
    """Print the legal-source catalog."""
    translator = _client()
    typer.echo(json.dumps({"environment": _environment_value(env), "sources": translator.source_index()}, ensure_ascii=False, indent=2))


def main() -> None:
    """Run the Typer application."""
    app()


if __name__ == "__main__":
    main()
