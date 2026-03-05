'use strict';

// ─────────────────────────────────────────────
//  SAS 1.1 Test Suite
// ─────────────────────────────────────────────

const { parseSAS, SASParseError } = require('./sas-parser');
const { sasToJSON }               = require('./sas-to-json');
const { jsonToSAS }               = require('./json-to-sas');

let passed = 0;
let failed = 0;

// ── Test helpers ─────────────────────────────

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${label}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

function group(label, fn) {
  console.log(`\n${label}`);
  fn();
}

function eq(a, b) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`Expected:\n  ${jb}\nGot:\n  ${ja}`);
}

function throws(fn, codeOrMsg) {
  try {
    fn();
    throw new Error('Expected an error but none was thrown');
  } catch (e) {
    if (e.message === 'Expected an error but none was thrown') throw e;
    if (codeOrMsg && !e.message.includes(codeOrMsg)) {
      throw new Error(`Expected error containing "${codeOrMsg}" but got: ${e.message}`);
    }
  }
}

function parse(s) { return parseSAS(s); }

// ── Tests ─────────────────────────────────────

group('§5 Comments', () => {
  test('full-line comment', () => {
    eq(parse('# comment\nkey -> "val"\n'), { key: 'val' });
  });
  test('indented comment', () => {
    eq(parse('    # indented\nkey -> "val"\n'), { key: 'val' });
  });
  test('E07: inline comment rejected', () => {
    throws(() => parse('key -> "val" # comment\n'), 'E07');
  });
  test('blank lines ignored', () => {
    eq(parse('\n\nkey -> "val"\n\n'), { key: 'val' });
  });
});

group('§6 Whitespace', () => {
  test('E08: missing spaces around ->', () => {
    throws(() => parse('key->"val"\n'), 'E08');
  });
  test('leading whitespace on line allowed', () => {
    eq(parse('    key -> "val"\n'), { key: 'val' });
  });
});

group('§8 Keys', () => {
  test('alphanumeric key', () => {
    eq(parse('abc123 -> 1\n'), { abc123: 1 });
  });
  test('underscore key', () => {
    eq(parse('__sas_version__ -> "1.1"\n'), { __sas_version__: '1.1' });
  });
  test('hyphen in key', () => {
    eq(parse('my-key -> 1\n'), { 'my-key': 1 });
  });
  test('E01: duplicate key rejected', () => {
    throws(() => parse('a -> 1\na -> 2\n'), 'E01');
  });
  test('E13: key starting with - rejected', () => {
    throws(() => parse('-bad -> 1\n'), 'E13');
  });
});

group('§10 Objects', () => {
  test('simple block object', () => {
    eq(parse('server ::\n    host -> "localhost"\n    port -> 8080\n:: server\n'), {
      server: { host: 'localhost', port: 8080 }
    });
  });
  test('E02: mismatched closer rejected', () => {
    throws(() => parse('server ::\n    host -> "x"\n:: database\n'), 'E02');
  });
  test('E02: bare :: rejected', () => {
    throws(() => parse('server ::\n    host -> "x"\n::\n'), 'E02');
  });
  test('nested objects', () => {
    const src = `
app ::
    db ::
        host -> "db.local"
    :: db
:: app
`;
    eq(parse(src), { app: { db: { host: 'db.local' } } });
  });
  test('inline object', () => {
    eq(parse('point -> { x -> 1 | y -> 2 }\n'), { point: { x: 1, y: 2 } });
  });
  test('E12: nested inline object rejected', () => {
    throws(() => parse('a -> { x -> { y -> 1 } }\n'), 'E12');
  });
  test('E01: duplicate key in inline object rejected', () => {
    throws(() => parse('a -> { x -> 1 | x -> 2 }\n'), 'E01');
  });
  test('empty block object', () => {
    eq(parse('empty ::\n:: empty\n'), { empty: {} });
  });
});

group('§11 Arrays', () => {
  test('inline array of strings', () => {
    eq(parse('tags -> ["a" | "b" | "c"]\n'), { tags: ['a', 'b', 'c'] });
  });
  test('inline array of mixed scalars', () => {
    eq(parse('vals -> [1 | true | null | "x"]\n'), { vals: [1, true, null, 'x'] });
  });
  test('E09: missing spaces around | rejected', () => {
    throws(() => parse('tags -> ["a"|"b"]\n'), 'E09');
  });
  test('E10: trailing | rejected', () => {
    throws(() => parse('tags -> ["a" | "b" |]\n'), 'E10');
  });
  test('E11: object in inline array rejected', () => {
    throws(() => parse('a -> [{ x -> 1 }]\n'), 'E11');
  });
  test('block array of strings', () => {
    eq(parse('tags ::\n    - "a"\n    - "b"\n:: tags\n'), { tags: ['a', 'b'] });
  });
  test('block array of numbers', () => {
    eq(parse('nums ::\n    - 1\n    - 2\n    - 3\n:: nums\n'), { nums: [1, 2, 3] });
  });
  test('block array of anonymous objects', () => {
    const src = `
servers ::
    - ::
        host -> "a.local"
        port -> 8080
    :: -
    - ::
        host -> "b.local"
        port -> 9090
    :: -
:: servers
`;
    eq(parse(src), {
      servers: [
        { host: 'a.local', port: 8080 },
        { host: 'b.local', port: 9090 },
      ]
    });
  });
  test('E14: mixed block content rejected', () => {
    throws(() => parse('block ::\n    - "a"\n    key -> 1\n:: block\n'), 'E14');
  });
  test('empty inline array', () => {
    eq(parse('a -> []\n'), { a: [] });
  });
  test('E15: anon closer at top level rejected', () => {
    throws(() => parse(':: -\n'), 'E02');
  });
  test('E15: anon block open in object context rejected', () => {
    throws(() => parse('obj ::\n    key -> 1\n    - ::\n        x -> 1\n    :: -\n:: obj\n'), 'E14');
  });
});

group('§12 Strings', () => {
  test('basic string', () => {
    eq(parse('s -> "hello"\n'), { s: 'hello' });
  });
  test('escaped quote', () => {
    eq(parse('s -> "say \\"hi\\""\n'), { s: 'say "hi"' });
  });
  test('escape sequences', () => {
    eq(parse('s -> "a\\nb\\tc"\n'), { s: 'a\nb\tc' });
  });
  test('unicode escape', () => {
    eq(parse('s -> "caf\\u00E9"\n'), { s: 'café' });
  });
  test('E04: invalid escape rejected', () => {
    throws(() => parse('s -> "bad\\q"\n'), 'E04');
  });
  test('multiline string', () => {
    const src = 'text -> """\nLine one\nLine two\n"""\n';
    eq(parse(src), { text: 'Line one\nLine two\n' });
  });
  test('E03: unclosed multiline string', () => {
    throws(() => parse('text -> """\nLine one\n'), 'E03');
  });
});

group('§13 Numbers', () => {
  test('integer', () => { eq(parse('n -> 42\n'), { n: 42 }); });
  test('negative integer', () => { eq(parse('n -> -7\n'), { n: -7 }); });
  test('zero', () => { eq(parse('n -> 0\n'), { n: 0 }); });
  test('decimal', () => { eq(parse('n -> 3.14\n'), { n: 3.14 }); });
  test('scientific notation', () => { eq(parse('n -> 1.2e10\n'), { n: 1.2e10 }); });
  test('negative exponent', () => { eq(parse('n -> 1e-3\n'), { n: 1e-3 }); });
  test('E05: leading zero rejected', () => { throws(() => parse('n -> 01\n'), 'E05'); });
  test('E05: leading + rejected', () => { throws(() => parse('n -> +5\n'), 'E05'); });
  test('E05: NaN rejected', () => { throws(() => parse('n -> NaN\n'), 'E05'); });
});

group('§14–15 Boolean and Null', () => {
  test('true', () => { eq(parse('v -> true\n'), { v: true }); });
  test('false', () => { eq(parse('v -> false\n'), { v: false }); });
  test('null', () => { eq(parse('v -> null\n'), { v: null }); });
  test('E06: True rejected', () => { throws(() => parse('v -> True\n'), 'E06'); });
  test('E06: NULL rejected', () => { throws(() => parse('v -> NULL\n'), 'E06'); });
});

group('§17 Version Declaration', () => {
  test('__sas_version__ parsed as string key', () => {
    eq(parse('__sas_version__ -> "1.1"\n'), { __sas_version__: '1.1' });
  });
});

group('§ Error conditions', () => {
  test('E03: unclosed block at EOF', () => {
    throws(() => parse('server ::\n    host -> "x"\n'), 'E03');
  });
  test('E02: closer at top level rejected', () => {
    throws(() => parse(':: orphan\n'), 'E02');
  });
});

group('Full example document', () => {
  const FULL_DOC = `
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
`;

  test('parses without error', () => {
    const obj = parse(FULL_DOC);
    eq(obj.app.name, 'myservice');
    eq(obj.app.debug, false);
    eq(obj.app.db.port, 5432);
    eq(obj.app.db.credentials, null);
    eq(obj.app.tags, ['api', 'production', 'v2']);
    eq(obj.app.origin, { lat: 37.77, lon: -122.41 });
    eq(obj.app.allowed_hosts, ['localhost', '127.0.0.1', 'myservice.internal']);
    eq(obj.app.description, 'This is a multiline description.\nIt preserves newlines exactly.\n');
  });
});

group('SAS → JSON converter', () => {
  test('produces valid JSON', () => {
    const sas = 'key -> "value"\nnum -> 42\n';
    const json = sasToJSON(sas);
    const obj = JSON.parse(json);
    eq(obj, { key: 'value', num: 42 });
  });
  test('strips __sas_version__ by default', () => {
    const sas = '__sas_version__ -> "1.1"\nkey -> 1\n';
    const obj = JSON.parse(sasToJSON(sas));
    eq(Object.prototype.hasOwnProperty.call(obj, '__sas_version__'), false);
  });
  test('keeps __sas_version__ when stripVersion=false', () => {
    const sas = '__sas_version__ -> "1.1"\nkey -> 1\n';
    const obj = JSON.parse(sasToJSON(sas, { stripVersion: false }));
    eq(obj.__sas_version__, '1.1');
  });
});

group('JSON → SAS converter', () => {
  test('scalar values', () => {
    const sas = jsonToSAS({ a: 'hello', b: 42, c: true, d: null }, { versionHeader: false });
    const obj = parseSAS(sas);
    eq(obj, { a: 'hello', b: 42, c: true, d: null });
  });
  test('nested object', () => {
    const input = { server: { host: 'localhost', port: 8080 } };
    const sas = jsonToSAS(input, { versionHeader: false });
    eq(parseSAS(sas), input);
  });
  test('array of scalars → inline', () => {
    const input = { tags: ['a', 'b', 'c'] };
    const sas = jsonToSAS(input, { versionHeader: false });
    eq(parseSAS(sas), input);
    // Should use inline syntax
    if (!sas.includes('["a" | "b" | "c"]')) {
      throw new Error('Expected inline array syntax');
    }
  });
  test('array of objects → block', () => {
    const input = { servers: [{ host: 'a' }, { host: 'b' }] };
    const sas = jsonToSAS(input, { versionHeader: false });
    eq(parseSAS(sas), input);
  });
  test('multiline string value', () => {
    const input = { text: 'line1\nline2\n' };
    const sas = jsonToSAS(input, { versionHeader: false });
    eq(parseSAS(sas), input);
  });
  test('empty array', () => {
    const input = { a: [] };
    const sas = jsonToSAS(input, { versionHeader: false });
    eq(parseSAS(sas), input);
  });
  test('empty object', () => {
    const input = { a: {} };
    const sas = jsonToSAS(input, { versionHeader: false });
    eq(parseSAS(sas), input);
  });
  test('small flat object → inline object', () => {
    const input = { point: { x: 1, y: 2 } };
    const sas = jsonToSAS(input, { versionHeader: false });
    eq(parseSAS(sas), input);
  });
  test('version header emitted by default', () => {
    const sas = jsonToSAS({ a: 1 });
    if (!sas.includes('__sas_version__ -> "1.1"')) {
      throw new Error('Expected version header');
    }
  });
});

group('Roundtrip: SAS → JSON → SAS → parse', () => {
  const COMPLEX = `
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
`;

  test('data preserved after full roundtrip', () => {
    const obj1 = parseSAS(COMPLEX);
    const sas2 = jsonToSAS(obj1, { versionHeader: false });
    const obj2 = parseSAS(sas2);
    eq(JSON.stringify(obj1), JSON.stringify(obj2));
  });
});

// ── Summary ──────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log('─'.repeat(40));

if (failed > 0) process.exit(1);
