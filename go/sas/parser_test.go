package sas_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/YOURUSERNAME/stick-and-string/sas"
)

// ── Helpers ───────────────────────────────────────────────────────────────────

func parse(t *testing.T, src string) *sas.Object {
	t.Helper()
	obj, err := sas.Parse(src)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	return obj
}

func mustFail(t *testing.T, src, code string) {
	t.Helper()
	_, err := sas.Parse(src)
	if err == nil {
		t.Fatalf("expected error %q but parsing succeeded", code)
	}
	if !strings.Contains(err.Error(), code) {
		t.Fatalf("expected error containing %q, got: %v", code, err)
	}
}

func getString(t *testing.T, obj *sas.Object, key string) string {
	t.Helper()
	v, ok := obj.Get(key)
	if !ok {
		t.Fatalf("key %q not found", key)
	}
	s, ok := v.(string)
	if !ok {
		t.Fatalf("key %q: expected string, got %T", key, v)
	}
	return s
}

func getInt(t *testing.T, obj *sas.Object, key string) int64 {
	t.Helper()
	v, ok := obj.Get(key)
	if !ok {
		t.Fatalf("key %q not found", key)
	}
	n, ok := v.(int64)
	if !ok {
		t.Fatalf("key %q: expected int64, got %T", key, v)
	}
	return n
}

func getBool(t *testing.T, obj *sas.Object, key string) bool {
	t.Helper()
	v, ok := obj.Get(key)
	if !ok {
		t.Fatalf("key %q not found", key)
	}
	b, ok := v.(bool)
	if !ok {
		t.Fatalf("key %q: expected bool, got %T", key, v)
	}
	return b
}

func getNull(t *testing.T, obj *sas.Object, key string) {
	t.Helper()
	v, ok := obj.Get(key)
	if !ok {
		t.Fatalf("key %q not found", key)
	}
	if v != nil {
		t.Fatalf("key %q: expected null, got %T", key, v)
	}
}

func getObj(t *testing.T, obj *sas.Object, key string) *sas.Object {
	t.Helper()
	v, ok := obj.Get(key)
	if !ok {
		t.Fatalf("key %q not found", key)
	}
	sub, ok := v.(*sas.Object)
	if !ok {
		t.Fatalf("key %q: expected *Object, got %T", key, v)
	}
	return sub
}

func getArr(t *testing.T, obj *sas.Object, key string) []sas.Value {
	t.Helper()
	v, ok := obj.Get(key)
	if !ok {
		t.Fatalf("key %q not found", key)
	}
	arr, ok := v.([]sas.Value)
	if !ok {
		t.Fatalf("key %q: expected []Value, got %T", key, v)
	}
	return arr
}

// ── §5 Comments ───────────────────────────────────────────────────────────────

func TestFullLineComment(t *testing.T) {
	obj := parse(t, "# comment\nkey -> \"val\"\n")
	if getString(t, obj, "key") != "val" {
		t.Fatal("wrong value")
	}
}

func TestIndentedComment(t *testing.T) {
	obj := parse(t, "    # indented\nkey -> \"val\"\n")
	if getString(t, obj, "key") != "val" {
		t.Fatal("wrong value")
	}
}

func TestE07InlineComment(t *testing.T) {
	mustFail(t, "key -> \"val\" # comment\n", "E07")
}

func TestBlankLinesIgnored(t *testing.T) {
	obj := parse(t, "\n\nkey -> \"val\"\n\n")
	if getString(t, obj, "key") != "val" {
		t.Fatal("wrong value")
	}
}

// ── §6 Whitespace ─────────────────────────────────────────────────────────────

func TestE08MissingSpaces(t *testing.T) {
	mustFail(t, "key->\"val\"\n", "E08")
}

func TestLeadingWhitespace(t *testing.T) {
	obj := parse(t, "    key -> \"val\"\n")
	if getString(t, obj, "key") != "val" {
		t.Fatal("wrong value")
	}
}

// ── §8 Keys ───────────────────────────────────────────────────────────────────

func TestAlphanumericKey(t *testing.T) {
	obj := parse(t, "abc123 -> 1\n")
	if getInt(t, obj, "abc123") != 1 {
		t.Fatal("wrong value")
	}
}

func TestUnderscoreKey(t *testing.T) {
	obj := parse(t, "__sas_version__ -> \"1.1\"\n")
	if getString(t, obj, "__sas_version__") != "1.1" {
		t.Fatal("wrong value")
	}
}

func TestHyphenKey(t *testing.T) {
	obj := parse(t, "my-key -> 1\n")
	if getInt(t, obj, "my-key") != 1 {
		t.Fatal("wrong value")
	}
}

func TestE01DuplicateKey(t *testing.T) {
	mustFail(t, "a -> 1\na -> 2\n", "E01")
}

func TestE13KeyStartsWithDash(t *testing.T) {
	mustFail(t, "-bad -> 1\n", "E13")
}

// ── §10 Objects ───────────────────────────────────────────────────────────────

func TestSimpleBlockObject(t *testing.T) {
	obj := parse(t, "server ::\n    host -> \"localhost\"\n    port -> 8080\n:: server\n")
	server := getObj(t, obj, "server")
	if getString(t, server, "host") != "localhost" {
		t.Fatal("wrong host")
	}
	if getInt(t, server, "port") != 8080 {
		t.Fatal("wrong port")
	}
}

func TestE02MismatchedCloser(t *testing.T) {
	mustFail(t, "server ::\n    host -> \"x\"\n:: database\n", "E02")
}

func TestE02BareCloser(t *testing.T) {
	mustFail(t, "server ::\n    host -> \"x\"\n::\n", "E02")
}

func TestNestedObjects(t *testing.T) {
	src := "\napp ::\n    db ::\n        host -> \"db.local\"\n    :: db\n:: app\n"
	obj := parse(t, src)
	app := getObj(t, obj, "app")
	db := getObj(t, app, "db")
	if getString(t, db, "host") != "db.local" {
		t.Fatal("wrong host")
	}
}

func TestInlineObject(t *testing.T) {
	obj := parse(t, "point -> { x -> 1 | y -> 2 }\n")
	point := getObj(t, obj, "point")
	if getInt(t, point, "x") != 1 || getInt(t, point, "y") != 2 {
		t.Fatal("wrong values")
	}
}

func TestE12NestedInlineObject(t *testing.T) {
	mustFail(t, "a -> { x -> { y -> 1 } }\n", "E12")
}

func TestE01DuplicateKeyInlineObject(t *testing.T) {
	mustFail(t, "a -> { x -> 1 | x -> 2 }\n", "E01")
}

func TestEmptyBlockObject(t *testing.T) {
	obj := parse(t, "empty ::\n:: empty\n")
	empty := getObj(t, obj, "empty")
	if len(empty.Keys) != 0 {
		t.Fatal("expected empty object")
	}
}

// ── §11 Arrays ────────────────────────────────────────────────────────────────

func TestInlineArrayStrings(t *testing.T) {
	obj := parse(t, "tags -> [\"a\" | \"b\" | \"c\"]\n")
	arr := getArr(t, obj, "tags")
	if len(arr) != 3 || arr[0] != "a" || arr[1] != "b" || arr[2] != "c" {
		t.Fatal("wrong array")
	}
}

func TestInlineArrayMixedScalars(t *testing.T) {
	obj := parse(t, "vals -> [1 | true | null | \"x\"]\n")
	arr := getArr(t, obj, "vals")
	if len(arr) != 4 {
		t.Fatal("wrong length")
	}
	if arr[0].(int64) != 1 { t.Fatal("wrong [0]") }
	if arr[1].(bool) != true { t.Fatal("wrong [1]") }
	if arr[2] != nil { t.Fatal("wrong [2]") }
	if arr[3].(string) != "x" { t.Fatal("wrong [3]") }
}

func TestE09MissingPipeSpaces(t *testing.T) {
	mustFail(t, "tags -> [\"a\"|\"b\"]\n", "E09")
}

func TestE10TrailingPipe(t *testing.T) {
	mustFail(t, "tags -> [\"a\" | \"b\" |]\n", "E10")
}

func TestE11ObjectInInlineArray(t *testing.T) {
	mustFail(t, "a -> [{ x -> 1 }]\n", "E11")
}

func TestBlockArrayStrings(t *testing.T) {
	obj := parse(t, "tags ::\n    - \"a\"\n    - \"b\"\n:: tags\n")
	arr := getArr(t, obj, "tags")
	if len(arr) != 2 || arr[0] != "a" || arr[1] != "b" {
		t.Fatal("wrong array")
	}
}

func TestBlockArrayAnonObjects(t *testing.T) {
	src := "\nservers ::\n    - ::\n        host -> \"a.local\"\n        port -> 8080\n    :: -\n    - ::\n        host -> \"b.local\"\n        port -> 9090\n    :: -\n:: servers\n"
	obj := parse(t, src)
	arr := getArr(t, obj, "servers")
	if len(arr) != 2 {
		t.Fatalf("expected 2 servers, got %d", len(arr))
	}
	s0 := arr[0].(*sas.Object)
	if getString(t, s0, "host") != "a.local" { t.Fatal("wrong host[0]") }
	if getInt(t, s0, "port") != 8080 { t.Fatal("wrong port[0]") }
	s1 := arr[1].(*sas.Object)
	if getString(t, s1, "host") != "b.local" { t.Fatal("wrong host[1]") }
}

func TestE14MixedBlockContent(t *testing.T) {
	mustFail(t, "block ::\n    - \"a\"\n    key -> 1\n:: block\n", "E14")
}

func TestEmptyInlineArray(t *testing.T) {
	obj := parse(t, "a -> []\n")
	arr := getArr(t, obj, "a")
	if len(arr) != 0 {
		t.Fatal("expected empty array")
	}
}

func TestE15AnonCloserTopLevel(t *testing.T) {
	mustFail(t, ":: -\n", "E02")
}

func TestE15AnonBlockInObject(t *testing.T) {
	mustFail(t, "obj ::\n    key -> 1\n    - ::\n        x -> 1\n    :: -\n:: obj\n", "E14")
}

// ── §12 Strings ───────────────────────────────────────────────────────────────

func TestBasicString(t *testing.T) {
	obj := parse(t, "s -> \"hello\"\n")
	if getString(t, obj, "s") != "hello" {
		t.Fatal("wrong value")
	}
}

func TestEscapedQuote(t *testing.T) {
	obj := parse(t, "s -> \"say \\\"hi\\\"\"\n")
	if getString(t, obj, "s") != `say "hi"` {
		t.Fatal("wrong value")
	}
}

func TestEscapeSequences(t *testing.T) {
	obj := parse(t, "s -> \"a\\nb\\tc\"\n")
	if getString(t, obj, "s") != "a\nb\tc" {
		t.Fatal("wrong value")
	}
}

func TestUnicodeEscape(t *testing.T) {
	obj := parse(t, "s -> \"caf\\u00E9\"\n")
	if getString(t, obj, "s") != "café" {
		t.Fatal("wrong value")
	}
}

func TestE04InvalidEscape(t *testing.T) {
	mustFail(t, "s -> \"bad\\q\"\n", "E04")
}

func TestMultilineString(t *testing.T) {
	src := "text -> \"\"\"\nLine one\nLine two\n\"\"\"\n"
	obj := parse(t, src)
	if getString(t, obj, "text") != "Line one\nLine two\n" {
		t.Fatalf("wrong value: %q", getString(t, obj, "text"))
	}
}

func TestE03UnclosedMultiline(t *testing.T) {
	mustFail(t, "text -> \"\"\"\nLine one\n", "E03")
}

// ── §13 Numbers ───────────────────────────────────────────────────────────────

func TestInteger(t *testing.T)         { obj := parse(t, "n -> 42\n"); if getInt(t, obj, "n") != 42 { t.Fatal() } }
func TestNegativeInteger(t *testing.T) { obj := parse(t, "n -> -7\n"); if getInt(t, obj, "n") != -7 { t.Fatal() } }
func TestZero(t *testing.T)            { obj := parse(t, "n -> 0\n"); if getInt(t, obj, "n") != 0 { t.Fatal() } }

func TestDecimal(t *testing.T) {
	obj := parse(t, "n -> 3.14\n")
	v, _ := obj.Get("n")
	if v.(float64) != 3.14 { t.Fatal() }
}

func TestScientific(t *testing.T) {
	obj := parse(t, "n -> 1.2e10\n")
	v, _ := obj.Get("n")
	if v.(float64) != 1.2e10 { t.Fatal() }
}

func TestE05LeadingZero(t *testing.T) { mustFail(t, "n -> 01\n", "E05") }
func TestE05LeadingPlus(t *testing.T) { mustFail(t, "n -> +5\n", "E05") }
func TestE05NaN(t *testing.T)         { mustFail(t, "n -> NaN\n", "E05") }

// ── §14-15 Boolean and Null ───────────────────────────────────────────────────

func TestTrue(t *testing.T)  { obj := parse(t, "v -> true\n"); if !getBool(t, obj, "v") { t.Fatal() } }
func TestFalse(t *testing.T) { obj := parse(t, "v -> false\n"); if getBool(t, obj, "v") { t.Fatal() } }
func TestNull(t *testing.T)  { obj := parse(t, "v -> null\n"); getNull(t, obj, "v") }

func TestE06TrueCaps(t *testing.T) { mustFail(t, "v -> True\n", "E06") }
func TestE06NullCaps(t *testing.T) { mustFail(t, "v -> NULL\n", "E06") }

// ── Error conditions ──────────────────────────────────────────────────────────

func TestE03UnclosedBlock(t *testing.T) {
	mustFail(t, "server ::\n    host -> \"x\"\n", "E03")
}

func TestE02CloserAtTopLevel(t *testing.T) {
	mustFail(t, ":: orphan\n", "E02")
}

// ── Full example document ─────────────────────────────────────────────────────

const fullDoc = `
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
`

func TestFullDocument(t *testing.T) {
	obj, err := sas.Parse(fullDoc)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	app := getObj(t, obj, "app")
	if getString(t, app, "name") != "myservice" { t.Fatal("wrong name") }
	if getBool(t, app, "debug") { t.Fatal("debug should be false") }

	db := getObj(t, app, "db")
	if getInt(t, db, "port") != 5432 { t.Fatal("wrong port") }
	getNull(t, db, "credentials")

	tags := getArr(t, app, "tags")
	if len(tags) != 3 || tags[0] != "api" { t.Fatal("wrong tags") }

	origin := getObj(t, app, "origin")
	latV, _ := origin.Get("lat")
	if latV.(float64) != 37.77 { t.Fatal("wrong lat") }

	hosts := getArr(t, app, "allowed_hosts")
	if len(hosts) != 3 || hosts[0] != "localhost" { t.Fatal("wrong hosts") }

	desc := getString(t, app, "description")
	if desc != "This is a multiline description.\nIt preserves newlines exactly.\n" {
		t.Fatalf("wrong description: %q", desc)
	}
}

// ── SAS → JSON ────────────────────────────────────────────────────────────────

func TestToJSONValid(t *testing.T) {
	src := "key -> \"value\"\nnum -> 42\n"
	jsonStr, err := sas.ToJSON(src, sas.DefaultToJSONOptions())
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(jsonStr), &m); err != nil {
		t.Fatal(err)
	}
	if m["key"] != "value" { t.Fatal("wrong key") }
	if m["num"].(float64) != 42 { t.Fatal("wrong num") }
}

func TestToJSONStripsVersion(t *testing.T) {
	src := "__sas_version__ -> \"1.1\"\nkey -> 1\n"
	jsonStr, err := sas.ToJSON(src, sas.DefaultToJSONOptions())
	if err != nil { t.Fatal(err) }
	if strings.Contains(jsonStr, "__sas_version__") {
		t.Fatal("version should be stripped")
	}
}

func TestToJSONKeepsVersionWhenAsked(t *testing.T) {
	src := "__sas_version__ -> \"1.1\"\nkey -> 1\n"
	opts := sas.DefaultToJSONOptions()
	opts.StripVersion = false
	jsonStr, err := sas.ToJSON(src, opts)
	if err != nil { t.Fatal(err) }
	if !strings.Contains(jsonStr, "__sas_version__") {
		t.Fatal("version should be present")
	}
}

// ── JSON → SAS ────────────────────────────────────────────────────────────────

func TestFromJSONScalars(t *testing.T) {
	sasStr, err := sas.FromJSON(`{"a":"hello","b":42,"c":true,"d":null}`, sas.FromJSONOptions{VersionHeader: false, Indent: "    "})
	if err != nil { t.Fatal(err) }
	obj, err := sas.Parse(sasStr)
	if err != nil { t.Fatal(err) }
	if getString(t, obj, "a") != "hello" { t.Fatal() }
	if getInt(t, obj, "b") != 42 { t.Fatal() }
	if !getBool(t, obj, "c") { t.Fatal() }
	getNull(t, obj, "d")
}

func TestFromJSONInlineArray(t *testing.T) {
	sasStr, err := sas.FromJSON(`{"tags":["a","b","c"]}`, sas.FromJSONOptions{VersionHeader: false, Indent: "    "})
	if err != nil { t.Fatal(err) }
	if !strings.Contains(sasStr, `["a" | "b" | "c"]`) {
		t.Fatalf("expected inline array syntax, got:\n%s", sasStr)
	}
	obj, err := sas.Parse(sasStr)
	if err != nil { t.Fatal(err) }
	arr := getArr(t, obj, "tags")
	if len(arr) != 3 { t.Fatal() }
}

func TestFromJSONObjectArray(t *testing.T) {
	sasStr, err := sas.FromJSON(`{"servers":[{"host":"a"},{"host":"b"}]}`, sas.FromJSONOptions{VersionHeader: false, Indent: "    "})
	if err != nil { t.Fatal(err) }
	obj, err := sas.Parse(sasStr)
	if err != nil { t.Fatal(err) }
	arr := getArr(t, obj, "servers")
	if len(arr) != 2 { t.Fatal() }
}

func TestFromJSONVersionHeader(t *testing.T) {
	sasStr, err := sas.FromJSON(`{"a":1}`, sas.DefaultFromJSONOptions())
	if err != nil { t.Fatal(err) }
	if !strings.Contains(sasStr, `__sas_version__ -> "1.1"`) {
		t.Fatal("missing version header")
	}
}

// ── Roundtrip ─────────────────────────────────────────────────────────────────

const complexDoc = `
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
`

func TestRoundtrip(t *testing.T) {
	// SAS → JSON → SAS → parse
	jsonStr, err := sas.ToJSON(complexDoc, sas.DefaultToJSONOptions())
	if err != nil { t.Fatal(err) }

	opts := sas.DefaultFromJSONOptions()
	opts.VersionHeader = false
	sasStr, err := sas.FromJSON(jsonStr, opts)
	if err != nil { t.Fatal(err) }

	obj2, err := sas.Parse(sasStr)
	if err != nil { t.Fatalf("roundtrip re-parse failed: %v\nSAS was:\n%s", err, sasStr) }

	cfg := getObj(t, obj2, "config")
	if getString(t, cfg, "name") != "test" { t.Fatal() }
	if getInt(t, cfg, "count") != 100 { t.Fatal() }
}
