// Command sas is a CLI tool for the SAS 1.1 (Stick And String) data format.
//
// Usage:
//
//	sas parse    <file.sas>         Parse and print JSON
//	sas to-json  <file.sas>         SAS → JSON
//	sas to-sas   <file.json>        JSON → SAS
//	sas validate <file.sas>         Validate only (exit 0/1)
//	sas roundtrip <file>            Round-trip check
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/YOURUSERNAME/stick-and-string/sas"
)

const usage = `SAS 1.1 Tools — Parser & Converter

Usage:
  sas <command> <file> [options]

Commands:
  parse     <file.sas>        Parse SAS and output JSON to stdout
  to-json   <file.sas>        Alias for parse
  to-sas    <file.json>       Convert JSON to SAS and output to stdout
  validate  <file.sas>        Validate SAS; exit 0 if valid, 1 if errors
  roundtrip <file>            SAS→JSON→SAS or JSON→SAS→JSON round-trip check

Options:
  --compact                   Compact JSON output (no indentation)
  --no-version                Omit __sas_version__ header in SAS output
  --output <file>             Write output to file instead of stdout
`

func main() {
	args := os.Args[1:]
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		fmt.Print(usage)
		os.Exit(0)
	}

	cmd := args[0]
	if len(args) < 2 {
		die("missing input file for command %q", cmd)
	}

	inputFile := args[1]
	flags := parseFlags(args[2:])

	data, err := os.ReadFile(inputFile)
	if err != nil {
		die("cannot read file: %v", err)
	}
	src := string(data)

	switch cmd {
	case "parse", "to-json":
		opts := sas.DefaultToJSONOptions()
		if flags["compact"] {
			opts.Indent = ""
		}
		result, err := sas.ToJSON(src, opts)
		if err != nil {
			fatalf("Error: %v\n", err)
		}
		writeOutput(result, flags["output"])

	case "to-sas":
		opts := sas.DefaultFromJSONOptions()
		if flags["no-version"] {
			opts.VersionHeader = false
		}
		result, err := sas.FromJSON(src, opts)
		if err != nil {
			fatalf("Error: %v\n", err)
		}
		writeOutput(result, flags["output"])

	case "validate":
		if _, err := sas.Parse(src); err != nil {
			fmt.Fprintf(os.Stderr, "✗  Parse error: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("✓  Valid SAS 1.1 document: %s\n", inputFile)

	case "roundtrip":
		ext := strings.ToLower(filepath.Ext(inputFile))
		switch ext {
		case ".sas":
			roundtripSAS(src, inputFile)
		case ".json":
			roundtripJSON(src, inputFile)
		default:
			die("roundtrip requires a .sas or .json file")
		}

	default:
		die("unknown command %q\n\n%s", cmd, usage)
	}
}

// ── Roundtrip ─────────────────────────────────────────────────────────────────

func roundtripSAS(src, label string) {
	fmt.Printf("Roundtrip: %s  (SAS → JSON → SAS)\n\n", label)

	obj1, err := sas.Parse(src)
	if err != nil {
		fatalf("  ✗ Parse SAS failed: %v\n", err)
	}
	fmt.Println("  ✓ Parse SAS")

	jsonStr, err := sas.ToJSON(src, sas.DefaultToJSONOptions())
	if err != nil {
		fatalf("  ✗ Convert to JSON failed: %v\n", err)
	}

	opts := sas.DefaultFromJSONOptions()
	opts.VersionHeader = false
	sasOut, err := sas.FromJSON(jsonStr, opts)
	if err != nil {
		fatalf("  ✗ Re-encode to SAS failed: %v\n", err)
	}

	obj2, err := sas.Parse(sasOut)
	if err != nil {
		fatalf("  ✗ Re-parse SAS failed: %v\nGenerated SAS:\n%s\n", err, sasOut)
	}
	fmt.Println("  ✓ Re-encode to SAS and re-parse")

	j1, _ := json.Marshal(objectToMap(obj1))
	j2, _ := json.Marshal(objectToMap(obj2))
	if string(j1) != string(j2) {
		fatalf("  ✗ Data mismatch after roundtrip!\n")
	}
	fmt.Println("  ✓ Data preserved exactly\n\n✓  Roundtrip OK")
}

func roundtripJSON(src, label string) {
	fmt.Printf("Roundtrip: %s  (JSON → SAS → JSON)\n\n", label)

	var obj1 map[string]any
	if err := json.Unmarshal([]byte(src), &obj1); err != nil {
		fatalf("  ✗ Parse JSON failed: %v\n", err)
	}
	fmt.Println("  ✓ Parse JSON")

	opts := sas.DefaultFromJSONOptions()
	opts.VersionHeader = false
	sasOut, err := sas.FromJSON(src, opts)
	if err != nil {
		fatalf("  ✗ Encode to SAS failed: %v\n", err)
	}
	fmt.Println("  ✓ Encode to SAS")

	jsonOut, err := sas.ToJSON(sasOut, sas.DefaultToJSONOptions())
	if err != nil {
		fatalf("  ✗ Re-parse SAS failed: %v\n", err)
	}
	fmt.Println("  ✓ Re-parse SAS")

	var obj2 map[string]any
	json.Unmarshal([]byte(jsonOut), &obj2)

	j1, _ := json.Marshal(obj1)
	j2, _ := json.Marshal(obj2)
	if string(j1) != string(j2) {
		fatalf("  ✗ Data mismatch after roundtrip!\n")
	}
	fmt.Println("  ✓ Data preserved exactly\n\n✓  Roundtrip OK")
}

// ── Utilities ─────────────────────────────────────────────────────────────────

func objectToMap(obj *sas.Object) map[string]any {
	m := make(map[string]any, len(obj.Keys))
	for _, k := range obj.Keys {
		v := obj.Values[k]
		switch val := v.(type) {
		case *sas.Object:
			m[k] = objectToMap(val)
		case []sas.Value:
			m[k] = sliceToAny(val)
		default:
			m[k] = v
		}
	}
	return m
}

func sliceToAny(arr []sas.Value) []any {
	result := make([]any, len(arr))
	for i, v := range arr {
		switch val := v.(type) {
		case *sas.Object:
			result[i] = objectToMap(val)
		case []sas.Value:
			result[i] = sliceToAny(val)
		default:
			result[i] = v
		}
	}
	return result
}

func parseFlags(args []string) map[string]string {
	flags := make(map[string]string)
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--compact":
			flags["compact"] = "1"
		case "--no-version":
			flags["no-version"] = "1"
		case "--output":
			if i+1 < len(args) {
				i++
				flags["output"] = args[i]
			}
		}
	}
	return flags
}

func writeOutput(text, filePath string) {
	if filePath != "" {
		if err := os.WriteFile(filePath, []byte(text), 0644); err != nil {
			fatalf("cannot write file: %v\n", err)
		}
		fmt.Printf("Written to %s\n", filePath)
		return
	}
	fmt.Print(text)
	if !strings.HasSuffix(text, "\n") {
		fmt.Println()
	}
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "Error: "+format+"\n", args...)
	os.Exit(1)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format, args...)
	os.Exit(1)
}
