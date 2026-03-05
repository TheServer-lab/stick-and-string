"""SAS 1.1 Parser — Python port of sas-parser.js"""

from __future__ import annotations
import re
from typing import Any


class SASParseError(Exception):
    """Raised when a SAS document fails to parse."""

    def __init__(self, message: str, line_num: int) -> None:
        super().__init__(f"[Line {line_num}] {message}")
        self.line_num = line_num


class SASParser:
    """Streaming-friendly recursive-descent parser for SAS 1.1 documents."""

    def __init__(self, source: str) -> None:
        self._lines = re.split(r"\r?\n", source)
        self._line_num = 0
        self._stack: list[dict] = []
        self._in_multiline = False
        self._multiline_key: str | None = None
        self._multiline_lines: list[str] = []

    # ── Public API ──────────────────────────────────────────────────────

    def parse(self) -> dict:
        root: dict = {"type": "object", "key": "__root__", "value": {}, "is_anon": False}
        self._stack = [root]

        for i, raw in enumerate(self._lines):
            self._line_num = i + 1
            if self._in_multiline:
                self._process_multiline_line(raw)
                continue
            self._process_line(raw)

        if self._in_multiline:
            raise self._err("E03: Unexpected end of document inside multiline string")
        if len(self._stack) > 1:
            top = self._stack[-1]
            raise SASParseError(
                f"E03: Unexpected end of document — unclosed block \"{top['key']}\"",
                len(self._lines),
            )
        return root["value"]

    # ── Line dispatch ────────────────────────────────────────────────────

    def _process_line(self, raw: str) -> None:
        line = raw.strip()

        if not line:
            return
        if line.startswith("#"):
            return

        # Block closer: ":: key" or ":: -"
        if line.startswith(":: "):
            closer = line[3:]
            if not closer:
                raise self._err('E02: Block closer missing identifier after "::"')
            self._close_block(closer)
            return

        if line == "::":
            raise self._err('E02: Bare "::" not permitted in SAS 1.1; use ":: key" or ":: -"')

        # Anonymous block opener inside array: "- ::"
        if line == "- ::":
            self._open_anon_block()
            return

        # Array item: "- value"
        if line.startswith("- "):
            value = self._parse_value(line[2:])
            self._add_array_item(value)
            return

        # Block opener or key-value pair
        key_match = re.match(r"^([A-Za-z0-9_][A-Za-z0-9_-]*)(.*)", line)
        if not key_match:
            if re.match(r"^-[A-Za-z0-9_]", line):
                raise self._err(f'E13: Key must not begin with "-": "{line.split()[0]}"')
            raise self._err(f'Unexpected token: "{line}"')

        key = key_match.group(1)
        rest = key_match.group(2)

        if rest == " ::":
            self._open_block(key)
            return

        if rest.startswith(" -> "):
            value_str = rest[4:]
            if not value_str:
                raise self._err(f'Missing value for key "{key}"')
            self._check_no_inline_comment(value_str)
            if value_str == '"""':
                self._start_multiline(key)
                return
            value = self._parse_value(value_str)
            self._assign_to_frame(key, value)
            return

        if "->" in rest or "->" in line:
            raise self._err('E08: Missing spaces around "->"; expected " -> "')

        raise self._err(f'Unexpected token after key "{key}": "{rest}"')

    # ── Multiline strings ────────────────────────────────────────────────

    def _process_multiline_line(self, raw: str) -> None:
        if raw.rstrip() == '"""':
            value = "\n".join(self._multiline_lines) + "\n" if self._multiline_lines else ""
            self._assign_to_frame(self._multiline_key, value)  # type: ignore[arg-type]
            self._in_multiline = False
            self._multiline_key = None
            self._multiline_lines = []
        else:
            self._multiline_lines.append(raw)

    def _start_multiline(self, key: str) -> None:
        frame = self._current_frame()
        if frame["type"] == "array":
            raise self._err("E14: Key-value pair inside array block")
        self._check_duplicate_key(frame, key)
        self._in_multiline = True
        self._multiline_key = key
        self._multiline_lines = []

    # ── Block management ─────────────────────────────────────────────────

    def _open_block(self, key: str) -> None:
        parent = self._current_frame()
        if parent["type"] == "array":
            raise self._err(
                f'E14: Named block opener "{key} ::" inside array block; use "- ::" for anonymous elements'
            )
        self._check_duplicate_key(parent, key)
        self._stack.append({"type": "object", "key": key, "value": {}, "is_anon": False})

    def _open_anon_block(self) -> None:
        parent = self._current_frame()
        if parent["type"] == "object" and len(parent["value"]) > 0:
            raise self._err('E14: Anonymous block "- ::" inside object block (mixed block content)')
        if parent["type"] == "object":
            parent["type"] = "array"
            parent["value"] = []
        if parent["type"] != "array":
            raise self._err('E15: Anonymous block opener "- ::" only valid inside array block')
        obj: dict = {}
        parent["value"].append(obj)
        self._stack.append({"type": "object", "key": "-", "value": obj, "is_anon": True})

    def _close_block(self, closer: str) -> None:
        if len(self._stack) <= 1:
            raise self._err(f'E02: Unexpected block closer ":: {closer}" at top level')

        frame = self._stack[-1]

        if closer == "-":
            if not frame["is_anon"]:
                raise self._err(
                    f'E15: Anonymous closer ":: -" used to close named block "{frame["key"]}"'
                )
            self._stack.pop()
            return  # value already in parent array by reference

        if frame["key"] != closer:
            raise self._err(
                f'E02: Block closer ":: {closer}" does not match opener ":: {frame["key"]}"'
            )

        self._stack.pop()
        parent = self._current_frame()
        value = frame["value"]

        if parent["type"] == "array":
            parent["value"].append(value)
        else:
            parent["value"][frame["key"]] = value

    # ── Value assignment ─────────────────────────────────────────────────

    def _assign_to_frame(self, key: str, value: Any) -> None:
        frame = self._current_frame()
        if frame["type"] == "array":
            raise self._err("E14: Key-value pair inside array block")
        self._check_duplicate_key(frame, key)
        frame["value"][key] = value

    def _add_array_item(self, value: Any) -> None:
        frame = self._current_frame()
        if frame["type"] == "object" and len(frame["value"]) > 0:
            raise self._err("E14: Array item inside object block (mixed block content)")
        if frame["type"] == "object":
            frame["type"] = "array"
            frame["value"] = []
        frame["value"].append(value)

    def _check_duplicate_key(self, frame: dict, key: str) -> None:
        if key in frame["value"]:
            raise self._err(f'E01: Duplicate key "{key}"')

    def _current_frame(self) -> dict:
        return self._stack[-1]

    # ── Value parsing ────────────────────────────────────────────────────

    def _parse_value(self, raw: str) -> Any:
        s = raw.strip()

        if s == "null":  return None
        if s == "true":  return True
        if s == "false": return False

        if re.match(r"^(True|TRUE|False|FALSE|Null|NULL)$", s):
            raise self._err(f'E06: Boolean and null must be lowercase; got "{s}"')

        if re.match(r"^[+-]?(NaN|Infinity|inf)$", s, re.IGNORECASE):
            raise self._err("E05: NaN and Infinity are not valid SAS number values")

        if s.startswith("+"):
            raise self._err(f'E05: Numbers must not have a leading "+": "{s}"')

        if s.startswith("["):  return self._parse_inline_array(s)
        if s.startswith("{"):  return self._parse_inline_object(s)
        if s.startswith('"'):  return self._parse_string(s)
        if re.match(r"^-?[0-9]", s): return self._parse_number(s)

        raise self._err(f'Unknown value: "{s}"')

    # ── String parsing ────────────────────────────────────────────────────

    def _parse_string(self, raw: str) -> str:
        if not (raw.startswith('"') and raw.endswith('"') and len(raw) >= 2):
            raise self._err(f"Malformed string: {raw}")
        return self._process_escapes(raw[1:-1])

    def _process_escapes(self, s: str) -> str:
        result: list[str] = []
        i = 0
        while i < len(s):
            ch = s[i]
            if ch == "\\":
                i += 1
                if i >= len(s):
                    raise self._err("E04: Invalid escape sequence at end of string")
                esc = s[i]
                if   esc == '"':  result.append('"')
                elif esc == '\\': result.append('\\')
                elif esc == 'n':  result.append('\n')
                elif esc == 't':  result.append('\t')
                elif esc == 'r':  result.append('\r')
                elif esc == 'u':
                    hex_str = s[i + 1: i + 5]
                    if not re.match(r"^[0-9A-Fa-f]{4}$", hex_str):
                        raise self._err(f'E04: Invalid \\u escape: "\\u{hex_str or "(end)"}"')
                    result.append(chr(int(hex_str, 16)))
                    i += 4
                else:
                    raise self._err(f'E04: Invalid escape sequence "\\{esc}"')
            elif ch == '"':
                raise self._err("E04: Unescaped double-quote inside string")
            else:
                result.append(ch)
            i += 1
        return "".join(result)

    # ── Number parsing ────────────────────────────────────────────────────

    def _parse_number(self, s: str) -> int | float:
        if not re.match(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$", s):
            raise self._err(f'E05: Invalid number format: "{s}"')
        # Integer if no decimal point or exponent
        if "." not in s and "e" not in s.lower():
            return int(s)
        val = float(s)
        import math
        if not math.isfinite(val):
            raise self._err(f'E05: Number out of range: "{s}"')
        return val

    # ── Inline array ──────────────────────────────────────────────────────

    def _parse_inline_array(self, s: str) -> list:
        if not (s.startswith("[") and s.endswith("]")):
            raise self._err(f'Malformed inline array: "{s}"')
        inner = s[1:-1].strip()
        if not inner:
            return []
        if inner.endswith(" |") or inner.endswith("\t|"):
            raise self._err('E10: Trailing "|" in inline array')
        self._check_pipe_syntax(inner, "inline array")
        result = []
        for p in self._split_by_pipe(inner):
            val = self._parse_value(p.strip())
            if isinstance(val, (dict, list)):
                raise self._err("E11: Inline array elements must be scalar (string, number, boolean, null)")
            result.append(val)
        return result

    # ── Inline object ─────────────────────────────────────────────────────

    def _parse_inline_object(self, s: str) -> dict:
        if not (s.startswith("{") and s.endswith("}")):
            raise self._err(f'Malformed inline object: "{s}"')
        inner = s[1:-1].strip()
        if not inner:
            return {}
        if inner.endswith(" |") or inner.endswith("\t|"):
            raise self._err('E10: Trailing "|" in inline object')
        self._check_pipe_syntax(inner, "inline object")
        obj: dict = {}
        for part in self._split_by_pipe(inner):
            m = re.match(r"^([A-Za-z0-9_][A-Za-z0-9_-]*) -> (.+)$", part.strip())
            if not m:
                raise self._err(f'Invalid field in inline object: "{part.strip()}"')
            k, val_str = m.group(1), m.group(2)
            if k in obj:
                raise self._err(f'E01: Duplicate key "{k}" in inline object')
            if val_str.strip().startswith("{"):
                raise self._err("E12: Nested inline objects are not permitted")
            val = self._parse_value(val_str.strip())
            if isinstance(val, (dict, list)):
                raise self._err("E11: Inline object values must be scalar")
            obj[k] = val
        return obj

    # ── Pipe-split utility ────────────────────────────────────────────────

    def _split_by_pipe(self, s: str) -> list[str]:
        parts: list[str] = []
        current: list[str] = []
        in_string = False
        i = 0
        while i < len(s):
            ch = s[i]
            if ch == '"' and not in_string:
                in_string = True
                current.append(ch)
            elif ch == '"' and in_string:
                backslashes = 0
                j = len(current) - 1
                while j >= 0 and current[j] == '\\':
                    backslashes += 1
                    j -= 1
                if backslashes % 2 == 0:
                    in_string = False
                current.append(ch)
            elif not in_string and ch == ' ' and i + 2 < len(s) and s[i + 1] == '|' and s[i + 2] == ' ':
                parts.append("".join(current))
                current = []
                i += 3
                continue
            else:
                current.append(ch)
            i += 1
        if "".join(current).strip():
            parts.append("".join(current))
        return parts

    def _check_pipe_syntax(self, inner: str, context: str) -> None:
        in_str = False
        for i, ch in enumerate(inner):
            if ch == '"' and not in_str:
                in_str = True
                continue
            if ch == '"' and in_str:
                in_str = False
                continue
            if not in_str and ch == '|':
                before = inner[i - 1] if i > 0 else ''
                after  = inner[i + 1] if i + 1 < len(inner) else ''
                if before != ' ' or after != ' ':
                    raise self._err(f'E09: "|" in {context} must be surrounded by single spaces')

    def _check_no_inline_comment(self, value_str: str) -> None:
        in_str = False
        for ch in value_str:
            if ch == '"' and not in_str:
                in_str = True
                continue
            if ch == '"' and in_str:
                in_str = False
                continue
            if not in_str and ch == '#':
                raise self._err("E07: Inline comments are not permitted")

    # ── Error helper ──────────────────────────────────────────────────────

    def _err(self, msg: str) -> SASParseError:
        return SASParseError(msg, self._line_num)


# ── Convenience function ──────────────────────────────────────────────────────

def parse_sas(source: str) -> dict:
    """Parse a SAS 1.1 document string and return a Python dict."""
    return SASParser(source).parse()
