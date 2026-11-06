#!/usr/bin/env python3
"""Compatibility helper that exposes the installable package client."""

from hebrew_legal_term_translator import (
    GLOSSARY,
    OFFICIAL_SOURCES,
    HebrewLegalTermTranslator,
    LegalSource,
    LegalTermEntry,
    TranslationResult,
    normalize_text,
    result_to_markdown,
)

__all__ = [
    "GLOSSARY",
    "OFFICIAL_SOURCES",
    "HebrewLegalTermTranslator",
    "LegalSource",
    "LegalTermEntry",
    "TranslationResult",
    "normalize_text",
    "result_to_markdown",
]
