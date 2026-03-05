"""SAS → JSON converter."""

from __future__ import annotations
import json
from .parser import parse_sas, SASParseError  # noqa: F401  (re-exported)


def sas_to_json(sas_source: str, indent: int = 2, strip_version: bool = True) -> str:
    """Parse a SAS 1.1 document and return a JSON string.

    Args:
        sas_source:    Raw SAS document text.
        indent:        JSON indentation spaces (default 2). Use 0 for compact.
        strip_version: Remove __sas_version__ from output (default True).

    Returns:
        A JSON string.
    """
    obj = parse_sas(sas_source)
    if strip_version and "__sas_version__" in obj:
        del obj["__sas_version__"]
    return json.dumps(obj, indent=indent or None)


def sas_to_object(sas_source: str) -> dict:
    """Parse a SAS 1.1 document and return a plain Python dict."""
    return parse_sas(sas_source)
