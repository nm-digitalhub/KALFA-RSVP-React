"""Public package interface for the Hebrew legal-term translator."""

from .client import (
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
