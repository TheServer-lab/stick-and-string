# stick-and-string (Go)

Go implementation of the SAS 1.1 (Stick And String) data format — parser,
validator, and bidirectional JSON converter.

## Install

```bash
go get github.com/TheServer-lab/stick-and-string
```

## Quick Start

```go
import "github.com/TheServer-lab/stick-and-string/sas"

// Parse SAS → *sas.Object
obj, err := sas.Parse(`
server ::
    host -> "localhost"
    port -> 8080
:: server
`)
if err != nil {
    log.Fatal(err)
}

server := obj.Values["server"].(*sas.Object)
fmt.Println(server.Values["port"]) // int64(8080)

// SAS → JSON string
jsonStr, err := sas.ToJSON(sasSource, sas.DefaultToJSONOptions())

// JSON string → SAS string
sasStr, err := sas.FromJSON(jsonSource, sas.DefaultFromJSONOptions())

// Go map → SAS string
sasStr, err := sas.FromMap(myMap, sas.DefaultFromJSONOptions())
```

## API

### Parsing

```go
// Parse returns the root *Object or a *ParseError.
func Parse(source string) (*Object, error)

// ParseError includes the line number.
type ParseError struct {
    Line    int
    Message string
}
```

### Object type

```go
type Object struct {
    Keys   []string         // insertion-ordered keys
    Values map[string]Value // key → value
}

func (o *Object) Get(key string) (Value, bool)
func (o *Object) Set(key string, val Value) bool // false if duplicate
```

### Conversion

```go
// SAS → JSON
func ToJSON(source string, opts ToJSONOptions) (string, error)
func ToObject(source string) (*Object, error)

type ToJSONOptions struct {
    Indent       string // default "  "
    StripVersion bool   // default true
}

// JSON/map → SAS
func FromJSON(jsonSrc string, opts FromJSONOptions) (string, error)
func FromMap(m map[string]any, opts FromJSONOptions) (string, error)

type FromJSONOptions struct {
    VersionHeader bool   // default true
    Indent        string // default "    "
}
```

## CLI

```bash
# Install the binary
go install github.com/TheServer-lab/stick-and-string/cmd/sas@latest

# Use it
sas validate  config.sas
sas to-json   config.sas
sas to-json   config.sas --compact
sas to-sas    data.json  --output data.sas
sas roundtrip config.sas
```

## Running Tests

```bash
go test ./sas/...
```

## License

Copyright (c) 2025 Sourasish Das  
Licensed under the Vexon Open-Control License (VOCL) 1.0 — see LICENSE.
