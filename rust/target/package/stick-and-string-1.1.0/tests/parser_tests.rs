use sas::{parse, to_json, from_json, FromJsonOptions, ToJsonOptions, Value};
use sas::value::Object;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn ok(src: &str) -> Value {
    parse(src).unwrap_or_else(|e| panic!("unexpected parse error: {}", e))
}

fn fails(src: &str, code: &str) {
    let err = parse(src).expect_err(&format!("expected error {} but parsing succeeded", code));
    assert!(
        err.to_string().contains(code),
        "expected error containing {:?}, got: {}", code, err
    );
}

fn get_str<'a>(obj: &'a Object, key: &str) -> &'a str {
    match obj.get(key) {
        Some(Value::String(s)) => s,
        other => panic!("key {:?}: expected String, got {:?}", key, other),
    }
}
fn get_int(obj: &Object, key: &str) -> i64 {
    match obj.get(key) {
        Some(Value::Int(n)) => *n,
        other => panic!("key {:?}: expected Int, got {:?}", key, other),
    }
}
fn get_bool(obj: &Object, key: &str) -> bool {
    match obj.get(key) {
        Some(Value::Bool(b)) => *b,
        other => panic!("key {:?}: expected Bool, got {:?}", key, other),
    }
}
fn get_null(obj: &Object, key: &str) {
    match obj.get(key) {
        Some(Value::Null) => {}
        other => panic!("key {:?}: expected Null, got {:?}", key, other),
    }
}
fn get_obj<'a>(obj: &'a Object, key: &str) -> &'a Object {
    match obj.get(key) {
        Some(Value::Object(o)) => o,
        other => panic!("key {:?}: expected Object, got {:?}", key, other),
    }
}
fn get_arr<'a>(obj: &'a Object, key: &str) -> &'a Vec<Value> {
    match obj.get(key) {
        Some(Value::Array(a)) => a,
        other => panic!("key {:?}: expected Array, got {:?}", key, other),
    }
}
fn root(v: Value) -> Object {
    match v { Value::Object(o) => o, _ => panic!("expected Object at root") }
}

// ── §5 Comments ───────────────────────────────────────────────────────────────

#[test] fn full_line_comment()    { let o = root(ok("# comment\nkey -> \"val\"\n")); assert_eq!(get_str(&o,"key"), "val"); }
#[test] fn indented_comment()     { let o = root(ok("    # indented\nkey -> \"val\"\n")); assert_eq!(get_str(&o,"key"), "val"); }
#[test] fn e07_inline_comment()   { fails("key -> \"val\" # comment\n", "E07"); }
#[test] fn blank_lines_ignored()  { let o = root(ok("\n\nkey -> \"val\"\n\n")); assert_eq!(get_str(&o,"key"), "val"); }

// ── §6 Whitespace ─────────────────────────────────────────────────────────────

#[test] fn e08_missing_spaces()   { fails("key->\"val\"\n", "E08"); }
#[test] fn leading_whitespace()   { let o = root(ok("    key -> \"val\"\n")); assert_eq!(get_str(&o,"key"), "val"); }

// ── §8 Keys ───────────────────────────────────────────────────────────────────

#[test] fn alphanumeric_key()     { let o = root(ok("abc123 -> 1\n")); assert_eq!(get_int(&o,"abc123"), 1); }
#[test] fn underscore_key()       { let o = root(ok("__sas_version__ -> \"1.1\"\n")); assert_eq!(get_str(&o,"__sas_version__"), "1.1"); }
#[test] fn hyphen_key()           { let o = root(ok("my-key -> 1\n")); assert_eq!(get_int(&o,"my-key"), 1); }
#[test] fn e01_duplicate_key()    { fails("a -> 1\na -> 2\n", "E01"); }
#[test] fn e13_key_starts_dash()  { fails("-bad -> 1\n", "E13"); }

// ── §10 Objects ───────────────────────────────────────────────────────────────

#[test]
fn simple_block_object() {
    let o = root(ok("server ::\n    host -> \"localhost\"\n    port -> 8080\n:: server\n"));
    let s = get_obj(&o, "server");
    assert_eq!(get_str(s, "host"), "localhost");
    assert_eq!(get_int(s, "port"), 8080);
}
#[test] fn e02_mismatched_closer() { fails("server ::\n    host -> \"x\"\n:: database\n", "E02"); }
#[test] fn e02_bare_closer()       { fails("server ::\n    host -> \"x\"\n::\n", "E02"); }
#[test]
fn nested_objects() {
    let o = root(ok("\napp ::\n    db ::\n        host -> \"db.local\"\n    :: db\n:: app\n"));
    assert_eq!(get_str(get_obj(get_obj(&o, "app"), "db"), "host"), "db.local");
}
#[test]
fn inline_object() {
    let o = root(ok("point -> { x -> 1 | y -> 2 }\n"));
    let p = get_obj(&o, "point");
    assert_eq!(get_int(p, "x"), 1);
    assert_eq!(get_int(p, "y"), 2);
}
#[test] fn e12_nested_inline()     { fails("a -> { x -> { y -> 1 } }\n", "E12"); }
#[test] fn e01_dup_inline_key()    { fails("a -> { x -> 1 | x -> 2 }\n", "E01"); }
#[test] fn empty_block_object()    { let o = root(ok("empty ::\n:: empty\n")); assert!(get_obj(&o,"empty").is_empty()); }

// ── §11 Arrays ────────────────────────────────────────────────────────────────

#[test]
fn inline_array_strings() {
    let o = root(ok("tags -> [\"a\" | \"b\" | \"c\"]\n"));
    let a = get_arr(&o, "tags");
    assert_eq!(a.len(), 3);
    assert_eq!(a[0], Value::String("a".into()));
}
#[test]
fn inline_array_mixed() {
    let o = root(ok("vals -> [1 | true | null | \"x\"]\n"));
    let a = get_arr(&o, "vals");
    assert_eq!(a[0], Value::Int(1));
    assert_eq!(a[1], Value::Bool(true));
    assert_eq!(a[2], Value::Null);
    assert_eq!(a[3], Value::String("x".into()));
}
#[test] fn e09_missing_pipe_spaces() { fails("tags -> [\"a\"|\"b\"]\n", "E09"); }
#[test] fn e10_trailing_pipe()       { fails("tags -> [\"a\" | \"b\" |]\n", "E10"); }
#[test] fn e11_object_in_inline()    { fails("a -> [{ x -> 1 }]\n", "E11"); }
#[test]
fn block_array_strings() {
    let o = root(ok("tags ::\n    - \"a\"\n    - \"b\"\n:: tags\n"));
    let a = get_arr(&o, "tags");
    assert_eq!(a.len(), 2);
    assert_eq!(a[0], Value::String("a".into()));
}
#[test]
fn block_array_anon_objects() {
    let src = "\nservers ::\n    - ::\n        host -> \"a.local\"\n        port -> 8080\n    :: -\n    - ::\n        host -> \"b.local\"\n        port -> 9090\n    :: -\n:: servers\n";
    let o = root(ok(src));
    let a = get_arr(&o, "servers");
    assert_eq!(a.len(), 2);
    if let Value::Object(ref s0) = a[0] {
        assert_eq!(get_str(s0, "host"), "a.local");
        assert_eq!(get_int(s0, "port"), 8080);
    } else { panic!("expected object"); }
}
#[test] fn e14_mixed_content()         { fails("block ::\n    - \"a\"\n    key -> 1\n:: block\n", "E14"); }
#[test] fn empty_inline_array()        { let o = root(ok("a -> []\n")); assert!(get_arr(&o,"a").is_empty()); }
#[test] fn e15_anon_closer_top()       { fails(":: -\n", "E02"); }
#[test] fn e15_anon_in_object()        { fails("obj ::\n    key -> 1\n    - ::\n        x -> 1\n    :: -\n:: obj\n", "E14"); }

// ── §12 Strings ───────────────────────────────────────────────────────────────

#[test] fn basic_string()     { let o = root(ok("s -> \"hello\"\n")); assert_eq!(get_str(&o,"s"), "hello"); }
#[test] fn escaped_quote()    { let o = root(ok("s -> \"say \\\"hi\\\"\"\n")); assert_eq!(get_str(&o,"s"), "say \"hi\""); }
#[test] fn escape_sequences() { let o = root(ok("s -> \"a\\nb\\tc\"\n")); assert_eq!(get_str(&o,"s"), "a\nb\tc"); }
#[test] fn unicode_escape()   { let o = root(ok("s -> \"caf\\u00E9\"\n")); assert_eq!(get_str(&o,"s"), "café"); }
#[test] fn e04_bad_escape()   { fails("s -> \"bad\\q\"\n", "E04"); }
#[test]
fn multiline_string() {
    let src = "text -> \"\"\"\nLine one\nLine two\n\"\"\"\n";
    let o = root(ok(src));
    assert_eq!(get_str(&o,"text"), "Line one\nLine two\n");
}
#[test] fn e03_unclosed_multiline() { fails("text -> \"\"\"\nLine one\n", "E03"); }

// ── §13 Numbers ───────────────────────────────────────────────────────────────

#[test] fn integer()          { let o = root(ok("n -> 42\n")); assert_eq!(get_int(&o,"n"), 42); }
#[test] fn negative_integer() { let o = root(ok("n -> -7\n")); assert_eq!(get_int(&o,"n"), -7); }
#[test] fn zero()             { let o = root(ok("n -> 0\n")); assert_eq!(get_int(&o,"n"), 0); }
#[test] fn decimal()          { let o = root(ok("n -> 3.14\n")); assert_eq!(o.get("n"), Some(&Value::Float(3.14))); }
#[test] fn scientific()       { let o = root(ok("n -> 1.2e10\n")); assert_eq!(o.get("n"), Some(&Value::Float(1.2e10))); }
#[test] fn e05_leading_zero() { fails("n -> 01\n", "E05"); }
#[test] fn e05_leading_plus() { fails("n -> +5\n", "E05"); }
#[test] fn e05_nan()          { fails("n -> NaN\n", "E05"); }

// ── §14-15 Boolean & Null ─────────────────────────────────────────────────────

#[test] fn bool_true()    { let o = root(ok("v -> true\n"));  assert!(get_bool(&o,"v")); }
#[test] fn bool_false()   { let o = root(ok("v -> false\n")); assert!(!get_bool(&o,"v")); }
#[test] fn null_val()     { let o = root(ok("v -> null\n")); get_null(&o,"v"); }
#[test] fn e06_true_caps(){ fails("v -> True\n", "E06"); }
#[test] fn e06_null_caps(){ fails("v -> NULL\n", "E06"); }

// ── Error conditions ──────────────────────────────────────────────────────────

#[test] fn e03_unclosed_block()   { fails("server ::\n    host -> \"x\"\n", "E03"); }
#[test] fn e02_closer_top_level() { fails(":: orphan\n", "E02"); }

// ── Full example document ─────────────────────────────────────────────────────

#[test]
fn full_document() {
    let doc = r#"
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

    description -> """
This is a multiline description.
It preserves newlines exactly.
"""
:: app
"#;
    let o = root(ok(doc));
    let app = get_obj(&o, "app");
    assert_eq!(get_str(app, "name"), "myservice");
    assert!(!get_bool(app, "debug"));
    assert_eq!(get_int(get_obj(app, "db"), "port"), 5432);
    get_null(get_obj(app, "db"), "credentials");
    assert_eq!(get_arr(app, "tags").len(), 3);
    assert_eq!(get_str(app, "description"), "This is a multiline description.\nIt preserves newlines exactly.\n");
}

// ── SAS → JSON ────────────────────────────────────────────────────────────────

#[test]
fn to_json_basic() {
    let src = "key -> \"value\"\nnum -> 42\n";
    let json = to_json(src, ToJsonOptions::default()).unwrap();
    assert!(json.contains("\"key\""));
    assert!(json.contains("\"value\""));
    assert!(json.contains("42"));
}

#[test]
fn to_json_strips_version() {
    let src = "__sas_version__ -> \"1.1\"\nkey -> 1\n";
    let json = to_json(src, ToJsonOptions::default()).unwrap();
    assert!(!json.contains("__sas_version__"));
}

// ── JSON → SAS ────────────────────────────────────────────────────────────────

#[test]
fn from_json_scalars() {
    let json = r#"{"a":"hello","b":42,"c":true,"d":null}"#;
    let sas_str = from_json(json, FromJsonOptions { version_header: false, indent: "    ".into() }).unwrap();
    let o = root(parse(&sas_str).unwrap());
    assert_eq!(get_str(&o, "a"), "hello");
    assert_eq!(get_int(&o, "b"), 42);
    assert!(get_bool(&o, "c"));
    get_null(&o, "d");
}

#[test]
fn from_json_inline_array() {
    let json = r#"{"tags":["a","b","c"]}"#;
    let sas_str = from_json(json, FromJsonOptions { version_header: false, indent: "    ".into() }).unwrap();
    assert!(sas_str.contains(r#"["a" | "b" | "c"]"#), "expected inline array, got:\n{}", sas_str);
    let o = root(parse(&sas_str).unwrap());
    assert_eq!(get_arr(&o, "tags").len(), 3);
}

#[test]
fn from_json_version_header() {
    let json = r#"{"a":1}"#;
    let sas_str = from_json(json, FromJsonOptions::default()).unwrap();
    assert!(sas_str.contains(r#"__sas_version__ -> "1.1""#));
}

// ── Roundtrip ─────────────────────────────────────────────────────────────────

#[test]
fn roundtrip() {
    let doc = r#"
__sas_version__ -> "1.1"

config ::
    name -> "test"
    count -> 100
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
"#;
    let json_str = to_json(doc, ToJsonOptions::default()).unwrap();
    let sas2 = from_json(&json_str, FromJsonOptions { version_header: false, indent: "    ".into() }).unwrap();
    let o2 = root(parse(&sas2).unwrap_or_else(|e| panic!("roundtrip re-parse failed: {}\nSAS:\n{}", e, sas2)));
    let cfg = get_obj(&o2, "config");
    assert_eq!(get_str(cfg, "name"), "test");
    assert_eq!(get_int(cfg, "count"), 100);
}
