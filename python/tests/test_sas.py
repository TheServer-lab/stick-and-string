"""SAS 1.1 Python test suite — mirrors test.js exactly."""

import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sas_tools import parse_sas, sas_to_json, json_to_sas, SASParseError, JSONToSASError


def parse(s):
    return parse_sas(s)


# ── §5 Comments ───────────────────────────────────────────────────────────────

def test_full_line_comment():
    assert parse("# comment\nkey -> \"val\"\n") == {"key": "val"}

def test_indented_comment():
    assert parse("    # indented\nkey -> \"val\"\n") == {"key": "val"}

def test_inline_comment_rejected():
    with pytest.raises(SASParseError, match="E07"):
        parse("key -> \"val\" # comment\n")

def test_blank_lines_ignored():
    assert parse("\n\nkey -> \"val\"\n\n") == {"key": "val"}


# ── §6 Whitespace ─────────────────────────────────────────────────────────────

def test_e08_missing_spaces_around_arrow():
    with pytest.raises(SASParseError, match="E08"):
        parse('key->"val"\n')

def test_leading_whitespace_allowed():
    assert parse('    key -> "val"\n') == {"key": "val"}


# ── §8 Keys ───────────────────────────────────────────────────────────────────

def test_alphanumeric_key():
    assert parse("abc123 -> 1\n") == {"abc123": 1}

def test_underscore_key():
    assert parse('__sas_version__ -> "1.1"\n') == {"__sas_version__": "1.1"}

def test_hyphen_in_key():
    assert parse("my-key -> 1\n") == {"my-key": 1}

def test_e01_duplicate_key():
    with pytest.raises(SASParseError, match="E01"):
        parse("a -> 1\na -> 2\n")

def test_e13_key_starts_with_dash():
    with pytest.raises(SASParseError, match="E13"):
        parse("-bad -> 1\n")


# ── §10 Objects ───────────────────────────────────────────────────────────────

def test_simple_block_object():
    assert parse('server ::\n    host -> "localhost"\n    port -> 8080\n:: server\n') == {
        "server": {"host": "localhost", "port": 8080}
    }

def test_e02_mismatched_closer():
    with pytest.raises(SASParseError, match="E02"):
        parse('server ::\n    host -> "x"\n:: database\n')

def test_e02_bare_closer():
    with pytest.raises(SASParseError, match="E02"):
        parse('server ::\n    host -> "x"\n::\n')

def test_nested_objects():
    src = "\napp ::\n    db ::\n        host -> \"db.local\"\n    :: db\n:: app\n"
    assert parse(src) == {"app": {"db": {"host": "db.local"}}}

def test_inline_object():
    assert parse("point -> { x -> 1 | y -> 2 }\n") == {"point": {"x": 1, "y": 2}}

def test_e12_nested_inline_object():
    with pytest.raises(SASParseError, match="E12"):
        parse("a -> { x -> { y -> 1 } }\n")

def test_e01_duplicate_key_inline_object():
    with pytest.raises(SASParseError, match="E01"):
        parse("a -> { x -> 1 | x -> 2 }\n")

def test_empty_block_object():
    assert parse("empty ::\n:: empty\n") == {"empty": {}}


# ── §11 Arrays ────────────────────────────────────────────────────────────────

def test_inline_array_of_strings():
    assert parse('tags -> ["a" | "b" | "c"]\n') == {"tags": ["a", "b", "c"]}

def test_inline_array_mixed_scalars():
    assert parse('vals -> [1 | true | null | "x"]\n') == {"vals": [1, True, None, "x"]}

def test_e09_missing_spaces_around_pipe():
    with pytest.raises(SASParseError, match="E09"):
        parse('tags -> ["a"|"b"]\n')

def test_e10_trailing_pipe():
    with pytest.raises(SASParseError, match="E10"):
        parse('tags -> ["a" | "b" |]\n')

def test_e11_object_in_inline_array():
    with pytest.raises(SASParseError, match="E11"):
        parse("a -> [{ x -> 1 }]\n")

def test_block_array_of_strings():
    assert parse('tags ::\n    - "a"\n    - "b"\n:: tags\n') == {"tags": ["a", "b"]}

def test_block_array_of_numbers():
    assert parse("nums ::\n    - 1\n    - 2\n    - 3\n:: nums\n") == {"nums": [1, 2, 3]}

def test_block_array_of_anonymous_objects():
    src = (
        "\nservers ::\n"
        '    - ::\n        host -> "a.local"\n        port -> 8080\n    :: -\n'
        '    - ::\n        host -> "b.local"\n        port -> 9090\n    :: -\n'
        ":: servers\n"
    )
    assert parse(src) == {
        "servers": [
            {"host": "a.local", "port": 8080},
            {"host": "b.local", "port": 9090},
        ]
    }

def test_e14_mixed_block_content():
    with pytest.raises(SASParseError, match="E14"):
        parse('block ::\n    - "a"\n    key -> 1\n:: block\n')

def test_empty_inline_array():
    assert parse("a -> []\n") == {"a": []}

def test_e15_anon_closer_top_level():
    with pytest.raises(SASParseError, match="E02"):
        parse(":: -\n")

def test_e15_anon_block_in_object():
    with pytest.raises(SASParseError, match="E14"):
        parse("obj ::\n    key -> 1\n    - ::\n        x -> 1\n    :: -\n:: obj\n")


# ── §12 Strings ───────────────────────────────────────────────────────────────

def test_basic_string():
    assert parse('s -> "hello"\n') == {"s": "hello"}

def test_escaped_quote():
    assert parse('s -> "say \\"hi\\""\n') == {"s": 'say "hi"'}

def test_escape_sequences():
    assert parse('s -> "a\\nb\\tc"\n') == {"s": "a\nb\tc"}

def test_unicode_escape():
    assert parse('s -> "caf\\u00E9"\n') == {"s": "café"}

def test_e04_invalid_escape():
    with pytest.raises(SASParseError, match="E04"):
        parse('s -> "bad\\q"\n')

def test_multiline_string():
    src = 'text -> """\nLine one\nLine two\n"""\n'
    assert parse(src) == {"text": "Line one\nLine two\n"}

def test_e03_unclosed_multiline():
    with pytest.raises(SASParseError, match="E03"):
        parse('text -> """\nLine one\n')


# ── §13 Numbers ───────────────────────────────────────────────────────────────

def test_integer():     assert parse("n -> 42\n")    == {"n": 42}
def test_negative():    assert parse("n -> -7\n")    == {"n": -7}
def test_zero():        assert parse("n -> 0\n")     == {"n": 0}
def test_decimal():     assert parse("n -> 3.14\n")  == {"n": 3.14}
def test_scientific():  assert parse("n -> 1.2e10\n") == {"n": 1.2e10}
def test_neg_exp():     assert parse("n -> 1e-3\n")  == {"n": 1e-3}

def test_e05_leading_zero():
    with pytest.raises(SASParseError, match="E05"):
        parse("n -> 01\n")

def test_e05_leading_plus():
    with pytest.raises(SASParseError, match="E05"):
        parse("n -> +5\n")

def test_e05_nan():
    with pytest.raises(SASParseError, match="E05"):
        parse("n -> NaN\n")


# ── §14–15 Boolean and Null ───────────────────────────────────────────────────

def test_true():  assert parse("v -> true\n")  == {"v": True}
def test_false(): assert parse("v -> false\n") == {"v": False}
def test_null():  assert parse("v -> null\n")  == {"v": None}

def test_e06_true_caps():
    with pytest.raises(SASParseError, match="E06"):
        parse("v -> True\n")

def test_e06_null_caps():
    with pytest.raises(SASParseError, match="E06"):
        parse("v -> NULL\n")


# ── §17 Version Declaration ───────────────────────────────────────────────────

def test_version_key():
    assert parse('__sas_version__ -> "1.1"\n') == {"__sas_version__": "1.1"}


# ── Error conditions ──────────────────────────────────────────────────────────

def test_e03_unclosed_block():
    with pytest.raises(SASParseError, match="E03"):
        parse('server ::\n    host -> "x"\n')

def test_e02_closer_at_top_level():
    with pytest.raises(SASParseError, match="E02"):
        parse(":: orphan\n")


# ── Full example document ─────────────────────────────────────────────────────

FULL_DOC = """
# SAS 1.1 example document
__sas_version__ -> "1.1"

app ::
    name -> "myservice"
    version -> "2.4.1"
    debug -> false

    db ::
        host -> "db.internal"
        port -> 5432
        credentials -> null
    :: db

    tags -> ["api" | "production" | "v2"]

    origin -> { lat -> 37.77 | lon -> -122.41 }

    allowed_hosts ::
        - "localhost"
        - "127.0.0.1"
        - "myservice.internal"
    :: allowed_hosts

    description -> \"\"\"
This is a multiline description.
It preserves newlines exactly.
\"\"\"
:: app
"""


def test_full_document():
    obj = parse(FULL_DOC)
    assert obj["app"]["name"] == "myservice"
    assert obj["app"]["debug"] is False
    assert obj["app"]["db"]["port"] == 5432
    assert obj["app"]["db"]["credentials"] is None
    assert obj["app"]["tags"] == ["api", "production", "v2"]
    assert obj["app"]["origin"] == {"lat": 37.77, "lon": -122.41}
    assert obj["app"]["allowed_hosts"] == ["localhost", "127.0.0.1", "myservice.internal"]
    assert obj["app"]["description"] == "This is a multiline description.\nIt preserves newlines exactly.\n"


# ── SAS → JSON converter ──────────────────────────────────────────────────────

def test_sas_to_json_valid():
    import json as _json
    sas = 'key -> "value"\nnum -> 42\n'
    obj = _json.loads(sas_to_json(sas))
    assert obj == {"key": "value", "num": 42}

def test_sas_to_json_strips_version_by_default():
    import json as _json
    sas = '__sas_version__ -> "1.1"\nkey -> 1\n'
    obj = _json.loads(sas_to_json(sas))
    assert "__sas_version__" not in obj

def test_sas_to_json_keeps_version_when_asked():
    import json as _json
    sas = '__sas_version__ -> "1.1"\nkey -> 1\n'
    obj = _json.loads(sas_to_json(sas, strip_version=False))
    assert obj["__sas_version__"] == "1.1"


# ── JSON → SAS converter ──────────────────────────────────────────────────────

def test_json_to_sas_scalars():
    sas = json_to_sas({"a": "hello", "b": 42, "c": True, "d": None}, version_header=False)
    assert parse_sas(sas) == {"a": "hello", "b": 42, "c": True, "d": None}

def test_json_to_sas_nested_object():
    data = {"server": {"host": "localhost", "port": 8080}}
    sas = json_to_sas(data, version_header=False)
    assert parse_sas(sas) == data

def test_json_to_sas_scalar_array_inline():
    data = {"tags": ["a", "b", "c"]}
    sas = json_to_sas(data, version_header=False)
    assert parse_sas(sas) == data
    assert '["a" | "b" | "c"]' in sas

def test_json_to_sas_object_array_block():
    data = {"servers": [{"host": "a"}, {"host": "b"}]}
    sas = json_to_sas(data, version_header=False)
    assert parse_sas(sas) == data

def test_json_to_sas_multiline_string():
    data = {"text": "line1\nline2\n"}
    sas = json_to_sas(data, version_header=False)
    assert parse_sas(sas) == data

def test_json_to_sas_empty_array():
    data = {"a": []}
    assert parse_sas(json_to_sas(data, version_header=False)) == data

def test_json_to_sas_empty_object():
    data = {"a": {}}
    assert parse_sas(json_to_sas(data, version_header=False)) == data

def test_json_to_sas_inline_object():
    data = {"point": {"x": 1, "y": 2}}
    assert parse_sas(json_to_sas(data, version_header=False)) == data

def test_json_to_sas_version_header():
    sas = json_to_sas({"a": 1})
    assert '__sas_version__ -> "1.1"' in sas


# ── Roundtrip ─────────────────────────────────────────────────────────────────

COMPLEX_DOC = """
__sas_version__ -> "1.1"

config ::
    name -> "test"
    count -> 100
    ratio -> 0.5
    enabled -> true
    notes -> null

    nested ::
        deep -> "value"
        arr -> [1 | 2 | 3]
    :: nested

    items ::
        - ::
            id -> 1
            label -> "first"
        :: -
        - ::
            id -> 2
            label -> "second"
        :: -
    :: items
:: config
"""


def test_roundtrip():
    import json as _json
    obj1 = parse_sas(COMPLEX_DOC)
    sas2 = json_to_sas(obj1, version_header=False)
    obj2 = parse_sas(sas2)
    assert _json.dumps(obj1, sort_keys=True) == _json.dumps(obj2, sort_keys=True)
