"""JSON → SAS 1.1 converter."""

from __future__ import annotations
import json
import math
import re
import sys
from typing import Any

INLINE_ARRAY_MAX_LEN = 120
INLINE_OBJECT_MAX_FIELDS = 4

_VALID_KEY_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]*$")
_FORBIDDEN_CHARS_RE = re.compile(r"[^A-Za-z0-9_-]")


class JSONToSASError(Exception):
    """Raised when a Python object cannot be serialized to SAS 1.1."""

    def __init__(self, message: str, path: str | None = None) -> None:
        super().__init__(f'At "{path}": {message}' if path else message)
        self.path = path


def json_to_sas(
    input_data: dict | str,
    version_header: bool = True,
    indent: str = "    ",
) -> str:
    """Convert a Python dict (or JSON string) to a SAS 1.1 document.

    Args:
        input_data:     A Python dict or a raw JSON string.
        version_header: Emit ``__sas_version__ -> "1.1"`` header (default True).
        indent:         Indentation string (default 4 spaces).

    Returns:
        A SAS 1.1 document string.
    """
    obj = json.loads(input_data) if isinstance(input_data, str) else input_data

    if obj is None or not isinstance(obj, dict):
        raise JSONToSASError("Top-level value must be a JSON object")

    lines: list[str] = []

    if version_header:
        lines.append('__sas_version__ -> "1.1"')
        lines.append("")

    _serialize_object_body(obj, lines, "", indent, "__root__")

    while lines and lines[-1] == "":
        lines.pop()

    return "\n".join(lines) + "\n"


# ── Object body ───────────────────────────────────────────────────────────────

def _serialize_object_body(
    obj: dict, lines: list[str], current_indent: str, indent_unit: str, path: str
) -> None:
    for raw_key, value in obj.items():
        key = _sanitize_key(raw_key, path)
        _serialize_kv(key, value, lines, current_indent, indent_unit, f"{path}.{key}")


def _serialize_kv(
    key: str, value: Any, lines: list[str], indent: str, indent_unit: str, path: str
) -> None:
    if value is None:
        lines.append(f"{indent}{key} -> null")
        return

    # bool MUST come before int (bool is subclass of int in Python)
    if isinstance(value, bool):
        lines.append(f"{indent}{key} -> {'true' if value else 'false'}")
        return

    if isinstance(value, (int, float)):
        lines.append(f"{indent}{key} -> {_serialize_number(value, path)}")
        return

    if isinstance(value, str):
        if "\n" in value and '"""' not in value:
            lines.append(f'{indent}{key} -> """')
            content = value[:-1] if value.endswith("\n") else value
            for line in content.split("\n"):
                lines.append(line)
            lines.append('"""')
        else:
            lines.append(f"{indent}{key} -> {_serialize_string(value)}")
        return

    if isinstance(value, list):
        _serialize_array(key, value, lines, indent, indent_unit, path)
        return

    if isinstance(value, dict):
        _serialize_object(key, value, lines, indent, indent_unit, path)
        return

    raise JSONToSASError(f"Unsupported value type: {type(value).__name__}", path)


# ── Object serialization ──────────────────────────────────────────────────────

def _serialize_object(
    key: str, obj: dict, lines: list[str], indent: str, indent_unit: str, path: str
) -> None:
    entries = list(obj.items())

    if (
        entries
        and len(entries) <= INLINE_OBJECT_MAX_FIELDS
        and all(_is_scalar(v) for _, v in entries)
    ):
        fields = " | ".join(
            f"{_sanitize_key(k, path)} -> {_serialize_scalar(v, path)}"
            for k, v in entries
        )
        candidate = f"{indent}{key} -> {{ {fields} }}"
        if len(candidate) <= INLINE_ARRAY_MAX_LEN:
            lines.append(candidate)
            return

    lines.append(f"{indent}{key} ::")
    _serialize_object_body(obj, lines, indent + indent_unit, indent_unit, path)
    lines.append(f"{indent}:: {key}")
    lines.append("")


# ── Array serialization ───────────────────────────────────────────────────────

def _serialize_array(
    key: str, arr: list, lines: list[str], indent: str, indent_unit: str, path: str
) -> None:
    if not arr:
        lines.append(f"{indent}{key} -> []")
        return

    if all(_is_scalar(v) for v in arr):
        parts = [_serialize_scalar(v, path) for v in arr]
        candidate = f"{indent}{key} -> [{' | '.join(parts)}]"
        if len(candidate) <= INLINE_ARRAY_MAX_LEN:
            lines.append(candidate)
            return

    lines.append(f"{indent}{key} ::")
    for i, item in enumerate(arr):
        item_path = f"{path}[{i}]"
        if item is None or not isinstance(item, (dict, list)):
            lines.append(f"{indent + indent_unit}- {_serialize_scalar(item, item_path)}")
        elif isinstance(item, list):
            lines.append(f"{indent + indent_unit}- ::")
            _serialize_array("items", item, lines, indent + indent_unit + indent_unit, indent_unit, item_path)
            lines.append(f"{indent + indent_unit}:: -")
        else:
            lines.append(f"{indent + indent_unit}- ::")
            _serialize_object_body(item, lines, indent + indent_unit + indent_unit, indent_unit, item_path)
            lines.append(f"{indent + indent_unit}:: -")
    lines.append(f"{indent}:: {key}")
    lines.append("")


# ── Scalar helpers ────────────────────────────────────────────────────────────

def _serialize_scalar(value: Any, path: str) -> str:
    if value is None:            return "null"
    if isinstance(value, bool):  return "true" if value else "false"
    if isinstance(value, (int, float)): return _serialize_number(value, path)
    if isinstance(value, str):   return _serialize_string(value)
    raise JSONToSASError(f"Expected scalar, got {type(value).__name__}", path)


def _serialize_string(s: str) -> str:
    s = s.replace("\\", "\\\\")
    s = s.replace('"',  '\\"')
    s = s.replace("\n", "\\n")
    s = s.replace("\t", "\\t")
    s = s.replace("\r", "\\r")
    return f'"{s}"'


def _serialize_number(n: int | float, path: str) -> str:
    if isinstance(n, float) and (math.isnan(n) or math.isinf(n)):
        raise JSONToSASError("SAS does not support NaN or Infinity", path)
    # json.dumps gives clean representation (e.g. no trailing .0 for ints-as-float)
    return json.dumps(n)


# ── Key sanitization ──────────────────────────────────────────────────────────

def _sanitize_key(raw_key: str, path: str) -> str:
    if _VALID_KEY_RE.match(raw_key):
        return raw_key

    sanitized = _FORBIDDEN_CHARS_RE.sub("_", raw_key)
    if sanitized.startswith("-"):
        sanitized = "_" + sanitized[1:]
    if not sanitized:
        sanitized = "_key"

    if sanitized != raw_key:
        print(
            f'[json-to-sas] Warning: key "{raw_key}" at "{path}" '
            f'contains invalid characters; sanitized to "{sanitized}"',
            file=sys.stderr,
        )
    return sanitized


def _is_scalar(v: Any) -> bool:
    # bool before int because bool is a subclass of int
    return v is None or isinstance(v, (bool, str, int, float))
