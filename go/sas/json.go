package sas

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
)

// ── SAS → JSON ────────────────────────────────────────────────────────────────

// ToJSONOptions controls SAS → JSON conversion.
type ToJSONOptions struct {
	Indent       string // default "  " (two spaces)
	StripVersion bool   // remove __sas_version__ from output (default true)
}

// DefaultToJSONOptions returns the default conversion options.
func DefaultToJSONOptions() ToJSONOptions {
	return ToJSONOptions{Indent: "  ", StripVersion: true}
}

// ToJSON parses a SAS document and returns a JSON string.
func ToJSON(source string, opts ToJSONOptions) (string, error) {
	obj, err := Parse(source)
	if err != nil {
		return "", err
	}
	if opts.StripVersion {
		delete(obj.Values, "__sas_version__")
		for i, k := range obj.Keys {
			if k == "__sas_version__" {
				obj.Keys = append(obj.Keys[:i], obj.Keys[i+1:]...)
				break
			}
		}
	}
	return marshalValue(obj, opts.Indent, "")
}

// ToObject parses a SAS document and returns the root Object.
func ToObject(source string) (*Object, error) {
	return Parse(source)
}

func marshalValue(v Value, indent, prefix string) (string, error) {
	if v == nil {
		return "null", nil
	}
	switch val := v.(type) {
	case bool:
		if val {
			return "true", nil
		}
		return "false", nil
	case int64:
		return fmt.Sprintf("%d", val), nil
	case float64:
		b, err := json.Marshal(val)
		return string(b), err
	case string:
		b, err := json.Marshal(val)
		return string(b), err
	case []Value:
		return marshalArray(val, indent, prefix)
	case *Object:
		return marshalObject(val, indent, prefix)
	default:
		return "", fmt.Errorf("unsupported value type: %T", v)
	}
}

func marshalObject(obj *Object, indent, prefix string) (string, error) {
	if len(obj.Keys) == 0 {
		return "{}", nil
	}
	newPrefix := prefix + indent
	var sb strings.Builder
	sb.WriteString("{\n")
	for i, k := range obj.Keys {
		v := obj.Values[k]
		keyJSON, _ := json.Marshal(k)
		valJSON, err := marshalValue(v, indent, newPrefix)
		if err != nil {
			return "", err
		}
		sb.WriteString(newPrefix)
		sb.Write(keyJSON)
		sb.WriteString(": ")
		sb.WriteString(valJSON)
		if i < len(obj.Keys)-1 {
			sb.WriteString(",")
		}
		sb.WriteString("\n")
	}
	sb.WriteString(prefix + "}")
	return sb.String(), nil
}

func marshalArray(arr []Value, indent, prefix string) (string, error) {
	if len(arr) == 0 {
		return "[]", nil
	}
	newPrefix := prefix + indent
	var sb strings.Builder
	sb.WriteString("[\n")
	for i, v := range arr {
		valJSON, err := marshalValue(v, indent, newPrefix)
		if err != nil {
			return "", err
		}
		sb.WriteString(newPrefix)
		sb.WriteString(valJSON)
		if i < len(arr)-1 {
			sb.WriteString(",")
		}
		sb.WriteString("\n")
	}
	sb.WriteString(prefix + "]")
	return sb.String(), nil
}

// ── JSON → SAS ────────────────────────────────────────────────────────────────

// FromJSONOptions controls JSON → SAS conversion.
type FromJSONOptions struct {
	VersionHeader bool   // emit __sas_version__ header (default true)
	Indent        string // indentation string (default "    ")
}

// DefaultFromJSONOptions returns the default conversion options.
func DefaultFromJSONOptions() FromJSONOptions {
	return FromJSONOptions{VersionHeader: true, Indent: "    "}
}

// ConvertError is returned when a value cannot be serialized to SAS.
type ConvertError struct {
	Path    string
	Message string
}

func (e *ConvertError) Error() string {
	if e.Path != "" {
		return fmt.Sprintf("at %q: %s", e.Path, e.Message)
	}
	return e.Message
}

const inlineArrayMaxLen = 120
const inlineObjectMaxFields = 4

// FromJSON converts a JSON string to a SAS 1.1 document.
func FromJSON(jsonSrc string, opts FromJSONOptions) (string, error) {
	var data any
	if err := json.Unmarshal([]byte(jsonSrc), &data); err != nil {
		return "", err
	}
	m, ok := data.(map[string]any)
	if !ok {
		return "", &ConvertError{Message: "top-level JSON value must be an object"}
	}
	return fromMap(m, opts)
}

// FromMap converts a Go map to a SAS 1.1 document.
func FromMap(m map[string]any, opts FromJSONOptions) (string, error) {
	return fromMap(m, opts)
}

func fromMap(m map[string]any, opts FromJSONOptions) (string, error) {
	var lines []string
	if opts.VersionHeader {
		lines = append(lines, `__sas_version__ -> "1.1"`, "")
	}
	if err := serializeMapBody(m, &lines, "", opts.Indent, "__root__"); err != nil {
		return "", err
	}
	// Trim trailing blank lines
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n") + "\n", nil
}

func serializeMapBody(m map[string]any, lines *[]string, cur, unit, path string) error {
	for rawKey, val := range m {
		key := sanitizeKey(rawKey)
		if err := serializeKV(key, val, lines, cur, unit, path+"."+key); err != nil {
			return err
		}
	}
	return nil
}

func serializeKV(key string, val any, lines *[]string, ind, unit, path string) error {
	if val == nil {
		*lines = append(*lines, ind+key+" -> null")
		return nil
	}
	switch v := val.(type) {
	case bool:
		s := "false"
		if v { s = "true" }
		*lines = append(*lines, ind+key+" -> "+s)
	case float64:
		*lines = append(*lines, ind+key+" -> "+serializeFloat(v, path))
	case string:
		if strings.Contains(v, "\n") && !strings.Contains(v, `"""`) {
			*lines = append(*lines, ind+key+` -> """`)
			content := v
			if strings.HasSuffix(content, "\n") {
				content = content[:len(content)-1]
			}
			for _, l := range strings.Split(content, "\n") {
				*lines = append(*lines, l)
			}
			*lines = append(*lines, `"""`)
		} else {
			*lines = append(*lines, ind+key+" -> "+serializeString(v))
		}
	case []any:
		if err := serializeArray(key, v, lines, ind, unit, path); err != nil {
			return err
		}
	case map[string]any:
		if err := serializeObject(key, v, lines, ind, unit, path); err != nil {
			return err
		}
	default:
		return &ConvertError{Path: path, Message: fmt.Sprintf("unsupported type %T", val)}
	}
	return nil
}

func serializeObject(key string, m map[string]any, lines *[]string, ind, unit, path string) error {
	entries := mapEntries(m)
	// Try inline
	if len(entries) > 0 && len(entries) <= inlineObjectMaxFields {
		allScalar := true
		for _, e := range entries {
			if !isJSONScalar(e.val) { allScalar = false; break }
		}
		if allScalar {
			var fields []string
			for _, e := range entries {
				fields = append(fields, sanitizeKey(e.key)+" -> "+serializeScalar(e.val))
			}
			candidate := ind + key + " -> { " + strings.Join(fields, " | ") + " }"
			if len(candidate) <= inlineArrayMaxLen {
				*lines = append(*lines, candidate)
				return nil
			}
		}
	}
	// Block
	*lines = append(*lines, ind+key+" ::")
	if err := serializeMapBody(m, lines, ind+unit, unit, path); err != nil {
		return err
	}
	*lines = append(*lines, ind+":: "+key, "")
	return nil
}

func serializeArray(key string, arr []any, lines *[]string, ind, unit, path string) error {
	if len(arr) == 0 {
		*lines = append(*lines, ind+key+" -> []")
		return nil
	}
	// Try inline scalar array
	allScalar := true
	for _, v := range arr {
		if !isJSONScalar(v) { allScalar = false; break }
	}
	if allScalar {
		var parts []string
		for _, v := range arr {
			parts = append(parts, serializeScalar(v))
		}
		candidate := ind + key + " -> [" + strings.Join(parts, " | ") + "]"
		if len(candidate) <= inlineArrayMaxLen {
			*lines = append(*lines, candidate)
			return nil
		}
	}
	// Block array
	*lines = append(*lines, ind+key+" ::")
	for i, item := range arr {
		itemPath := fmt.Sprintf("%s[%d]", path, i)
		if item == nil || isJSONScalar(item) {
			*lines = append(*lines, ind+unit+"- "+serializeScalar(item))
		} else if sub, ok := item.([]any); ok {
			*lines = append(*lines, ind+unit+"- ::")
			if err := serializeArray("items", sub, lines, ind+unit+unit, unit, itemPath); err != nil {
				return err
			}
			*lines = append(*lines, ind+unit+":: -")
		} else if subMap, ok := item.(map[string]any); ok {
			*lines = append(*lines, ind+unit+"- ::")
			if err := serializeMapBody(subMap, lines, ind+unit+unit, unit, itemPath); err != nil {
				return err
			}
			*lines = append(*lines, ind+unit+":: -")
		} else {
			return &ConvertError{Path: itemPath, Message: fmt.Sprintf("unsupported array element type %T", item)}
		}
	}
	*lines = append(*lines, ind+":: "+key, "")
	return nil
}

// ── Scalar serialization ──────────────────────────────────────────────────────

func serializeString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	s = strings.ReplaceAll(s, "\t", `\t`)
	s = strings.ReplaceAll(s, "\r", `\r`)
	return `"` + s + `"`
}

func serializeFloat(f float64, path string) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null" // best effort fallback
	}
	b, _ := json.Marshal(f)
	return string(b)
}

func serializeScalar(v any) string {
	if v == nil { return "null" }
	switch val := v.(type) {
	case bool:
		if val { return "true" }
		return "false"
	case float64:
		return serializeFloat(val, "")
	case string:
		return serializeString(val)
	}
	return "null"
}

func isJSONScalar(v any) bool {
	if v == nil { return true }
	switch v.(type) {
	case bool, float64, string:
		return true
	}
	return false
}

// ── Key sanitization ──────────────────────────────────────────────────────────

var validKeyFullRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_-]*$`)
var invalidCharRe = regexp.MustCompile(`[^A-Za-z0-9_-]`)

func sanitizeKey(raw string) string {
	if validKeyFullRe.MatchString(raw) {
		return raw
	}
	s := invalidCharRe.ReplaceAllString(raw, "_")
	if strings.HasPrefix(s, "-") {
		s = "_" + s[1:]
	}
	if s == "" {
		s = "_key"
	}
	return s
}

// ── Map entry ordering helper ─────────────────────────────────────────────────

type entry struct{ key string; val any }

func mapEntries(m map[string]any) []entry {
	entries := make([]entry, 0, len(m))
	for k, v := range m {
		entries = append(entries, entry{k, v})
	}
	return entries
}
