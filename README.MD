# Stick And String (SAS 1.1)

**A human-readable, deterministic data serialization format.**

SAS is designed to be easy to read and write by hand, while remaining
strict enough to parse unambiguously — no comma errors, no
indentation-sensitivity, and full JSON interoperability.

```
# SAS 1.1 example
__sas_version__ -> "1.1"

server ::
    host -> "localhost"
    port -> 8080
    tags -> ["api" | "production"]
    tls  -> true
:: server
```

---

## Install

**Node.js / Browser**
```bash
npm install stick-and-string
```

**Python**
```bash
pip install stick-and-string
```

---

## Quick Start

### JavaScript

```js
import { parseSAS, sasToJSON, jsonToSAS } from 'stick-and-string';

// Parse SAS → JS object
const obj = parseSAS(`
server ::
    host -> "localhost"
    port -> 8080
:: server
`);
console.log(obj.server.port); // 8080

// SAS → JSON string
const json = sasToJSON(sasSource);

// JS object / JSON string → SAS
const sas = jsonToSAS({ host: 'localhost', port: 8080 });
```

**CommonJS**
```js
const { parseSAS, sasToJSON, jsonToSAS } = require('stick-and-string');
```

**Browser (ESM)**
```html
<script type="module">
  import { parseSAS } from './node_modules/stick-and-string/index.mjs';
</script>
```

---

### Python

```python
from sas_tools import parse_sas, sas_to_json, json_to_sas

# Parse SAS → dict
obj = parse_sas(open("config.sas").read())
print(obj["server"]["port"])  # 8080

# SAS → JSON string
json_str = sas_to_json(open("config.sas").read())

# dict → SAS string
sas = json_to_sas({"host": "localhost", "port": 8080})
```

---

## CLI

Both packages install a `sas` command.

```bash
# Validate a SAS file
sas validate config.sas

# Convert SAS → JSON
sas to-json config.sas
sas to-json config.sas --output config.json
sas to-json config.sas --compact

# Convert JSON → SAS
sas to-sas data.json
sas to-sas data.json --output data.sas --no-version

# Round-trip check (great for CI)
sas roundtrip config.sas
sas roundtrip data.json
```

---

## Format Overview

### Key → Value pairs

```
name    -> "Alice"
port    -> 8080
enabled -> true
ratio   -> 3.14
nothing -> null
```

### Block objects (named open/close)

```
server ::
    host -> "db.internal"
    port -> 5432
:: server
```

### Inline objects (small, flat)

```
origin -> { lat -> 37.77 | lon -> -122.41 }
```

### Inline arrays (scalars)

```
tags -> ["api" | "production" | "v2"]
```

### Block arrays

```
hosts ::
    - "web1.internal"
    - "web2.internal"
:: hosts
```

### Block arrays of objects

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

### Multiline strings

```
description -> """
Line one.
Line two.
"""
```

### Comments

```
# This is a comment
# Inline comments are NOT permitted
```

---

## API Reference

### JavaScript

| Export | Signature | Description |
|--------|-----------|-------------|
| `parseSAS` | `(source: string) → object` | Parse SAS document |
| `sasToJSON` | `(source, {indent, stripVersion}) → string` | SAS → JSON string |
| `sasToObject` | `(source) → object` | SAS → plain JS object |
| `jsonToSAS` | `(input, {versionHeader, indent}) → string` | object/JSON → SAS |
| `SASParseError` | class | Parse error with `.lineNum` |
| `JSONToSASError` | class | Serialization error with `.path` |

### Python

| Export | Signature | Description |
|--------|-----------|-------------|
| `parse_sas` | `(source: str) → dict` | Parse SAS document |
| `sas_to_json` | `(source, indent, strip_version) → str` | SAS → JSON string |
| `sas_to_object` | `(source) → dict` | SAS → Python dict |
| `json_to_sas` | `(input, version_header, indent) → str` | dict/JSON → SAS |
| `SASParseError` | class | Parse error with `.line_num` |
| `JSONToSASError` | class | Serialization error with `.path` |

---

## Error Codes

All errors include a line number. Parser errors are **never silent**.

| Code | Description |
|------|-------------|
| E01 | Duplicate key in same scope |
| E02 | Block closer mismatch or bare `::` |
| E03 | Unclosed block or multiline string at EOF |
| E04 | Invalid escape sequence |
| E05 | Invalid number (leading zero, `+`, `NaN`, etc.) |
| E06 | Wrong-case boolean or null (`True`, `NULL`, …) |
| E07 | Inline comment |
| E08 | Missing spaces around `->` |
| E09 | Missing spaces around `\|` in inline array/object |
| E10 | Trailing `\|` |
| E11 | Non-scalar in inline array |
| E12 | Nested inline object |
| E13 | Key starting with `-` |
| E14 | Mixed block content (array items + pairs) |
| E15 | Anonymous closer outside array context |

---

## Publishing

**npm**
```bash
cd npm/
npm publish --access public
```

**PyPI**
```bash
cd pip/
pip install build twine
python -m build
twine upload dist/*
```

---

## License

Copyright (c) 2025 Sourasish Das  
Licensed under the [Vexon Open-Control License (VOCL) 1.0](./LICENSE).
