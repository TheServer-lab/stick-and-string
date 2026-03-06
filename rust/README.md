# stick-and-string (Rust)

Rust implementation of the SAS 1.1 (Stick And String) data format.  
Zero dependencies. Parser, validator, and bidirectional JSON converter.

## Install

Add to `Cargo.toml`:

```toml
[dependencies]
stick-and-string = "1.1.0"
```

## Quick Start

```rust
use sas::{parse, to_json, from_json, ToJsonOptions, FromJsonOptions, Value};

// Parse SAS → Value
let doc = r#"
server ::
    host -> "localhost"
    port -> 8080
    tags -> ["api" | "v2"]
:: server
"#;

let val = parse(doc)?;
if let Value::Object(root) = &val {
    if let Some(Value::Object(server)) = root.get("server") {
        println!("{:?}", server.get("host")); // Some(String("localhost"))
        println!("{:?}", server.get("port")); // Some(Int(8080))
    }
}

// SAS → JSON string
let json = to_json(doc, ToJsonOptions::default())?;

// JSON string → SAS string
let sas = from_json(&json, FromJsonOptions::default())?;
```

## Error Handling

```rust
use sas::{parse, ParseError};

match parse("name -> \"Alice\"\nname -> \"Bob\"\n") {
    Ok(_)  => println!("valid"),
    Err(e) => eprintln!("Line {}: {}", e.line, e.message),
    // Line 2: E01: Duplicate key "name"
}
```

## Value Type

```rust
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    Array(Vec<Value>),
    Object(Object),   // insertion-order preserving
}
```

`Object` exposes:
- `obj.get(key) -> Option<&Value>`
- `obj.keys: Vec<String>` (insertion order)
- `obj.iter()` — yields `(&str, &Value)` in insertion order

## API

```rust
// Parsing
pub fn parse(source: &str) -> Result<Value, ParseError>;

// SAS → JSON
pub fn to_json(source: &str, opts: ToJsonOptions) -> Result<String, ParseError>;

// JSON → SAS
pub fn from_json(json_src: &str, opts: FromJsonOptions) -> Result<String, ConvertError>;

// Options
pub struct ToJsonOptions   { pub indent: String, pub strip_version: bool }
pub struct FromJsonOptions { pub version_header: bool, pub indent: String }
```

## CLI

```bash
# Install
cargo install stick-and-string

# Use
sas validate  config.sas
sas to-json   config.sas
sas to-json   config.sas --compact
sas to-sas    data.json  --output data.sas
sas roundtrip config.sas
```

## Running Tests

```bash
cargo test
```

## License

Copyright (c) 2025 Sourasish Das  
Licensed under the Vexon Open-Control License (VOCL) 1.0 — see LICENSE.
