# Stick And String (SAS 1.1)

**A human-readable, deterministic data serialization format.**

SAS eliminates comma errors, avoids indentation-sensitivity, and maps
cleanly to JSON — making it easy to read, write, and parse.

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

## Packages

| Platform | Package | Install |
|----------|---------|---------|
| Node.js / Browser | [![npm](https://img.shields.io/npm/v/stick-and-string)](https://www.npmjs.com/package/stick-and-string) | `npm install stick-and-string` |
| Python | [![PyPI](https://img.shields.io/pypi/v/stick-and-string)](https://pypi.org/project/stick-and-string/) | `pip install stick-and-string` |

---

## Repository Structure

```
stick-and-string/
├── js/                  JavaScript implementation (npm package)
│   ├── sas-parser.js    Parser (CJS)
│   ├── sas-parser.mjs   Parser (ESM / browser)
│   ├── sas-to-json.js   SAS → JSON converter
│   ├── json-to-sas.js   JSON → SAS converter
│   ├── index.js         CJS entry point
│   ├── index.mjs        ESM entry point
│   ├── cli.js           CLI tool
│   ├── test.js          Test suite (69 tests)
│   └── package.json
│
├── python/              Python implementation (PyPI package)
│   ├── sas_tools/
│   │   ├── parser.py        Parser
│   │   ├── sas_to_json.py   SAS → JSON converter
│   │   ├── json_to_sas.py   JSON → SAS converter
│   │   └── _cli.py          CLI tool
│   ├── tests/
│   │   └── test_sas.py      Test suite (68 tests)
│   └── pyproject.toml
│
├── SAS-1_1-Specification.md   Full format specification
└── LICENSE                    Vexon Open-Control License (VOCL) 1.0
```

---

## Quick Start

### JavaScript

```js
import { parseSAS, sasToJSON, jsonToSAS } from 'stick-and-string';

const obj = parseSAS(`
server ::
    host -> "localhost"
    port -> 8080
:: server
`);
console.log(obj.server.port); // 8080

const json = sasToJSON(sasSource);
const sas  = jsonToSAS({ host: 'localhost', port: 8080 });
```

### Python

```python
from sas_tools import parse_sas, sas_to_json, json_to_sas

obj      = parse_sas(open("config.sas").read())
json_str = sas_to_json(open("config.sas").read())
sas      = json_to_sas({"host": "localhost", "port": 8080})
```

---

## CLI

```bash
sas validate config.sas
sas to-json  config.sas
sas to-sas   data.json --output data.sas
sas roundtrip config.sas
```

---

## Format Overview

| Construct | Syntax |
|-----------|--------|
| Key → value | `name -> "Alice"` |
| Block object | `key ::` … `:: key` |
| Inline object | `point -> { x -> 1 \| y -> 2 }` |
| Inline array | `tags -> ["a" \| "b" \| "c"]` |
| Block array | `key ::` / `- value` / `:: key` |
| Multiline string | `key -> """` … `"""` |
| Comment | `# comment` |

See [SAS-1_1-Specification.md](./SAS-1_1-Specification.md) for the full spec.

---

## License

Copyright (c) 2025 Sourasish Das  
Licensed under the [Vexon Open-Control License (VOCL) 1.0](./LICENSE).
