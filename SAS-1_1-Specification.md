# SAS 1.1 Specification

**Stick And String Data Format**  
Version: 1.1.0  
Status: Draft — Supersedes SAS 1.0

---

# 1. Introduction

SAS (Stick And String) is a human-readable, deterministic data
serialization format.

SAS is designed to:

- Eliminate comma-related syntax errors
- Avoid indentation-sensitive parsing
- Preserve JSON-equivalent data modeling
- Support strict and predictable parsing
- Enable streaming and low-memory implementations

SAS 1.1 extends SAS 1.0 with: named block closers, inline object
syntax, explicit whitespace rules, a formal grammar, and an expanded
error catalog.

---

# 2. Changes from SAS 1.0

| # | Change | Reason |
|---|--------|--------|
| 1 | Named block closers: `:: key` required | Eliminates bare `::` ambiguity in nested structures |
| 2 | Inline object syntax added | Avoids verbosity for small flat objects |
| 3 | Whitespace rules made explicit | Closes parser interop gaps |
| 4 | Formal ABNF grammar added | Enables unambiguous implementation |
| 5 | Error catalog expanded with examples | Improves parser conformance |

SAS 1.1 is **not** backward-compatible with SAS 1.0 due to change #1.
Parsers MUST reject bare `::` closers.

---

# 3. Design Principles

1. Deterministic parsing
2. No implicit type conversion
3. No indentation-based structure
4. No optional syntax shortcuts
5. No duplicate object keys
6. JSON-equivalent data model
7. Every syntax rule has one correct interpretation

---

# 4. Encoding

- UTF-8 only
- LF (`\n`) or CRLF (`\r\n`) line endings allowed
- Parsers MUST treat both equally
- A trailing newline on the final line is OPTIONAL and MUST be accepted

---

# 5. Data Model

SAS supports exactly six value types:

| Type    | Example                   |
|---------|---------------------------|
| Object  | `server ::`...`:: server` |
| Array   | `["a" \| "b"]` or block   |
| String  | `"hello"`                 |
| Number  | `42`, `3.14`, `1.2e10`    |
| Boolean | `true`, `false`           |
| Null    | `null`                    |

---

# 6. Whitespace

## 6.1 Around `->`

Exactly one SP (U+0020) MUST appear on each side of `->`:

```
name -> "Alice"    # valid
name->"Alice"      # INVALID — no spaces
name ->  "Alice"   # INVALID — extra space
```

## 6.2 Around `|` in Inline Arrays and Objects

One SP on each side of `|` is REQUIRED:

```
tags -> ["a" | "b" | "c"]    # valid
tags -> ["a"|"b"|"c"]        # INVALID
```

## 6.3 Blank Lines

Blank lines (lines containing only whitespace) are permitted anywhere
between statements. They carry no structural meaning.

## 6.4 Leading Whitespace

Leading whitespace on any non-comment line is permitted and carries no
structural meaning. Parsers MUST strip it before parsing.

---

# 7. Comments

A comment is a line where the first non-whitespace character is `#`.
The `#` and all following characters on that line are ignored.

```
# This is a comment
    # This is also a comment (leading whitespace allowed)
```

Comments MUST NOT appear inline (after a value on the same line):

```
name -> "Alice"  # INVALID — inline comment
```

---

# 8. Keys

A key:

- MUST consist of one or more characters from: `[A-Za-z0-9_-]`
- MUST NOT begin with `-`
- MUST be unique within its immediate object scope
- Case-sensitive: `Name` and `name` are distinct keys

Forbidden in keys: whitespace, `->`, `::`, `[`, `]`, `"`, `|`, `.`

Duplicate keys MUST cause a parse error.

---

# 9. Key-Value Pair

```
key -> value
```

- `->` is mandatory, with exactly one SP on each side
- One pair per line
- No trailing tokens permitted after `value`
- `value` is one of: string, number, boolean, null, inline array,
  inline object, or a block opener (`::`)

---

# 10. Objects

## 10.1 Block Object

```
server ::
    host -> "localhost"
    port -> 8080
:: server
```

Rules:

- `key ::` opens a named block
- `:: key` closes the most recently opened block with that exact name
- The closing key MUST match the opening key exactly
- Blocks MUST close in LIFO order; mismatched closers MUST error
- Nesting depth is unlimited

Example of valid nesting:

```
app ::
    db ::
        host -> "db.local"
        port -> 5432
    :: db
    name -> "myapp"
:: app
```

Invalid — mismatched closer:

```
server ::
    host -> "localhost"
:: database    # INVALID — opened as "server", closed as "database"
```

## 10.2 Inline Object

For small, flat objects, an inline form is permitted:

```
point -> { x -> 1 | y -> 2 }
```

Rules:

- Delimited by `{` and `}`
- Fields separated by ` | ` (one SP, pipe, one SP)
- Each field follows `key -> value` syntax
- Nested inline objects are NOT permitted
- No trailing ` | ` allowed
- Maximum one inline object per line

---

# 11. Arrays

## 11.1 Inline Array

```
tags -> ["a" | "b" | "c"]
```

- Values separated by ` | ` (one SP, pipe, one SP)
- No trailing ` | ` allowed
- All values MUST be of a scalar type (string, number, boolean, null)
- Objects and arrays MUST NOT appear in inline arrays

## 11.2 Block Array

```
tags ::
    - "a"
    - "b"
    - "c"
:: tags
```

- Each element MUST begin with `- ` (hyphen, one SP)
- Elements may be any value type including nested objects and arrays
- Block arrays use the same named closer syntax as block objects

Example with nested object elements:

```
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
```

For anonymous nested blocks inside arrays, use `::` / `:: -` as the
open/close pair. The closer `:: -` is the only permitted anonymous
closer and is only valid inside a block array.

---

# 12. Strings

```
name -> "Orrin"
```

- MUST be enclosed in double quotes
- Supported escape sequences:

| Escape   | Meaning           |
|----------|-------------------|
| `\"`     | Double quote      |
| `\\`     | Backslash         |
| `\n`     | Line feed         |
| `\t`     | Horizontal tab    |
| `\r`     | Carriage return   |
| `\uXXXX` | Unicode code point (exactly 4 hex digits, uppercase or lowercase) |

- Any other `\` sequence MUST cause a parse error

## 12.1 Multiline Strings

```
text -> """
Line one
Line two
"""
```

- Opening `"""` MUST be immediately followed by a newline
- Closing `"""` MUST appear on its own line with no leading whitespace
- Content is captured exactly as-is between the two `"""` lines
- Escape sequences are NOT processed inside multiline strings
- The trailing newline before the closing `"""` IS included in the value

---

# 13. Numbers

```
port -> 8080
pi -> 3.14
mass -> 1.2e10
negative -> -42
fraction -> -0.5
```

Rules:

- Integer: optional leading `-`, then digits with no leading zeros
  (except the literal value `0`)
- Decimal: integer part, `.`, one or more digits
- Exponent: decimal or integer part, `e` or `E`, optional `+` or `-`,
  one or more digits
- No hex, octal, binary literals
- `NaN` and `Infinity` are NOT valid
- Leading `+` is NOT valid

---

# 14. Boolean

```
enabled -> true
debug -> false
```

Lowercase only. `True`, `TRUE`, `False`, `FALSE` MUST cause a parse error.

---

# 15. Null

```
value -> null
```

Lowercase only. `Null`, `NULL` MUST cause a parse error.

---

# 16. Formal Grammar (ABNF)

```abnf
document    = *line
line        = comment / blank / statement
blank       = *SP CRLF
comment     = *SP "#" *VCHAR CRLF
statement   = *SP (pair / block-open / block-close / array-item)

pair        = key SP "->" SP value CRLF
block-open  = key SP "::" CRLF
block-close = "::" SP key CRLF
anon-open   = "-" SP "::" CRLF
anon-close  = "::" SP "-" CRLF
array-item  = "-" SP value CRLF

key         = ALPHA / DIGIT / "_" / "-"
              ; MUST NOT begin with "-"

value       = string / number / boolean / null
            / inline-array / inline-object

string      = DQUOTE *str-char DQUOTE
            / DQUOTE DQUOTE DQUOTE CRLF *OCTET CRLF DQUOTE DQUOTE DQUOTE
str-char    = %x20-21 / %x23-5B / %x5D-10FFFF / escape
escape      = "\" ( DQUOTE / "\" / "n" / "t" / "r" / "u" 4HEXDIG )

number      = ["-"] (int / decimal) [exp]
int         = "0" / NZDIGIT *DIGIT
decimal     = int "." 1*DIGIT
exp         = ("e" / "E") ["+" / "-"] 1*DIGIT

boolean     = "true" / "false"
null        = "null"

inline-array  = "[" *(value SP "|" SP) value "]"
inline-object = "{" *(key SP "->" SP scalar SP "|" SP) key SP "->" SP scalar "}"
scalar        = string / number / boolean / null

SP    = %x20
CRLF  = %x0A / %x0D %x0A
ALPHA = %x41-5A / %x61-7A
DIGIT = %x30-39
NZDIGIT = %x31-39
HEXDIG  = DIGIT / "A"-"F" / "a"-"f"
DQUOTE  = %x22
VCHAR   = %x21-7E
OCTET   = %x00-FF
```

---

# 17. Error Conditions

Parsers MUST produce an error (with line number) for all of the
following. Parsers MUST NOT silently skip or recover.

| Code | Condition | Example |
|------|-----------|---------|
| E01 | Duplicate key in same scope | `name -> "a"` then `name -> "b"` |
| E02 | Block closer does not match opener | `server ::` ... `:: database` |
| E03 | Unexpected document end inside open block | File ends inside `server ::` |
| E04 | Invalid escape sequence in string | `"bad \q escape"` |
| E05 | Invalid number format | `01`, `+5`, `1.`, `NaN` |
| E06 | Boolean or null with wrong case | `True`, `NULL` |
| E07 | Inline comment | `key -> "val"  # comment` |
| E08 | Missing spaces around `->` | `key->"val"` |
| E09 | Missing spaces around `\|` in inline array/object | `["a"\|"b"]` |
| E10 | Trailing `\|` in inline array or object | `["a" \| "b" \|]` |
| E11 | Inline array containing non-scalar value | `[{x -> 1} \| 2]` |
| E12 | Nested inline object | `{ a -> { b -> 1 } }` |
| E13 | Key beginning with `-` | `-name -> "val"` |
| E14 | Mixed block content (array items and pairs) | `- "a"` then `key -> "b"` in same block |
| E15 | Anonymous closer outside array context | `:: -` at top level |

---

# 18. Interoperability

## 18.1 SAS → JSON

Every valid SAS document MUST be convertible to JSON without data loss.

Mapping:

| SAS | JSON |
|-----|------|
| Block object | `{}` |
| Inline object | `{}` |
| Block array | `[]` |
| Inline array | `[]` |
| String | `string` |
| Number | `number` |
| `true` / `false` | `true` / `false` |
| `null` | `null` |
| Comment | (dropped) |

## 18.2 JSON → SAS

Every JSON document MUST be convertible to SAS.

Rules for converters:

- JSON object keys that contain characters invalid in SAS keys MUST be
  quoted by wrapping in a string-keyed workaround (implementation-defined)
  or the converter MUST error
- JSON arrays of objects MUST use block array syntax
- JSON arrays of scalars MAY use inline array syntax if all elements fit
  on one line (recommended max: 120 characters), otherwise MUST use
  block syntax

---

# 19. Streaming

SAS is designed to support streaming parsers:

- Blocks MUST be emitted as open/close events
- A parser MAY emit values before a block is fully closed
- A conforming streaming parser MUST buffer only the current line

---

# 20. File Extension and Media Type

```
.sas
application/sas
```

---

# 21. Version Declaration

The reserved key `__sas_version__` at the top level declares the
format version:

```
__sas_version__ -> "1.1"
```

- MUST appear before any other key-value pair if present
- MUST be a string value
- Parsers encountering a version they do not support SHOULD warn

---

# 22. Full Example

```
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
```

---

# 23. Conformance

A conforming SAS 1.1 parser MUST:

1. Accept all documents valid under this specification
2. Reject all documents that violate any MUST or MUST NOT rule
3. Report errors with at minimum the line number of the offending token
4. Not perform implicit type coercion of any kind
5. Not silently ignore unknown constructs

A conforming SAS 1.1 serializer MUST:

1. Produce output that is valid under this specification
2. Use named block closers matching the opener key
3. Produce exactly one SP on each side of `->` and `|`

---

# End of SAS 1.1 Specification
