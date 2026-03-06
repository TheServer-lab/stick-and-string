// Package sas implements a parser, validator, and JSON converter for the
// SAS 1.1 (Stick And String) data serialization format.
package sas

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

// ── Errors ────────────────────────────────────────────────────────────────────

// ParseError is returned when a SAS document is invalid.
// It always includes the line number of the offending token.
type ParseError struct {
	Line    int
	Message string
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("[Line %d] %s", e.Line, e.Message)
}

func parseErr(line int, msg string) *ParseError {
	return &ParseError{Line: line, Message: msg}
}

func parseErrf(line int, format string, args ...any) *ParseError {
	return &ParseError{Line: line, Message: fmt.Sprintf(format, args...)}
}

// ── Value types ───────────────────────────────────────────────────────────────

// Value represents any SAS value. The underlying type is one of:
//
//	nil           → null
//	bool          → true / false
//	int64         → integer number
//	float64       → decimal / scientific number
//	string        → string
//	[]Value       → array
//	map[string]Value → object (insertion order not preserved — use Object for that)
//	Object        → ordered object
type Value = any

// Object is an ordered key-value store used to represent SAS objects while
// preserving insertion order (important for round-trip fidelity).
type Object struct {
	Keys   []string
	Values map[string]Value
}

// NewObject creates an empty Object.
func NewObject() *Object {
	return &Object{Values: make(map[string]Value)}
}

// Set adds or updates a key. Returns false if the key already exists (E01).
func (o *Object) Set(key string, val Value) bool {
	if _, exists := o.Values[key]; exists {
		return false
	}
	o.Keys = append(o.Keys, key)
	o.Values[key] = val
	return true
}

// Get returns the value for a key and whether it was found.
func (o *Object) Get(key string) (Value, bool) {
	v, ok := o.Values[key]
	return v, ok
}

// ── Parser internals ──────────────────────────────────────────────────────────

type frameType int

const (
	frameObject frameType = iota
	frameArray
)

type frame struct {
	kind   frameType
	key    string
	obj    *Object  // valid when kind == frameObject
	arr    *[]Value // valid when kind == frameArray
	isAnon bool
}

// Parser holds all state for parsing a single SAS document.
type Parser struct {
	lines   []string
	lineNum int
	stack   []*frame

	inMultiline   bool
	multilineKey  string
	multilineLines []string
}

// NewParser creates a Parser for the given source document.
func NewParser(source string) *Parser {
	// Normalise line endings
	source = strings.ReplaceAll(source, "\r\n", "\n")
	return &Parser{
		lines: strings.Split(source, "\n"),
	}
}

// Parse parses the document and returns the root object.
func (p *Parser) Parse() (*Object, error) {
	root := &frame{kind: frameObject, key: "__root__", obj: NewObject()}
	p.stack = []*frame{root}

	for i, raw := range p.lines {
		p.lineNum = i + 1

		if p.inMultiline {
			if err := p.processMultilineLine(raw); err != nil {
				return nil, err
			}
			continue
		}

		if err := p.processLine(raw); err != nil {
			return nil, err
		}
	}

	if p.inMultiline {
		return nil, parseErr(len(p.lines), "E03: Unexpected end of document inside multiline string")
	}
	if len(p.stack) > 1 {
		top := p.stack[len(p.stack)-1]
		return nil, parseErrf(len(p.lines), "E03: Unexpected end of document — unclosed block %q", top.key)
	}

	return root.obj, nil
}

// ── Line dispatch ─────────────────────────────────────────────────────────────

var validKeyRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_-]*`)
var keyStartDashRe = regexp.MustCompile(`^-[A-Za-z0-9_]`)

func (p *Parser) processLine(raw string) error {
	line := strings.TrimSpace(raw)

	if line == "" || strings.HasPrefix(line, "#") {
		return nil
	}

	// Block closer: ":: key" or ":: -"
	if strings.HasPrefix(line, ":: ") {
		closer := line[3:]
		if closer == "" {
			return p.err("E02: Block closer missing identifier after \"::\"")
		}
		return p.closeBlock(closer)
	}
	if line == "::" {
		return p.err("E02: Bare \"::\" not permitted in SAS 1.1; use \":: key\" or \":: -\"")
	}

	// Anonymous block opener: "- ::"
	if line == "- ::" {
		return p.openAnonBlock()
	}

	// Array item: "- value"
	if strings.HasPrefix(line, "- ") {
		val, err := p.parseValue(line[2:])
		if err != nil {
			return err
		}
		return p.addArrayItem(val)
	}

	// Key-based lines
	loc := validKeyRe.FindStringIndex(line)
	if loc == nil {
		if keyStartDashRe.MatchString(line) {
			return p.errf("E13: Key must not begin with \"-\": %q", strings.Fields(line)[0])
		}
		return p.errf("Unexpected token: %q", line)
	}

	key := line[loc[0]:loc[1]]
	rest := line[loc[1]:]

	// Block opener: " ::"
	if rest == " ::" {
		return p.openBlock(key)
	}

	// Key-value pair: " -> value"
	if strings.HasPrefix(rest, " -> ") {
		valueStr := rest[4:]
		if valueStr == "" {
			return p.errf("Missing value for key %q", key)
		}
		if err := p.checkNoInlineComment(valueStr); err != nil {
			return err
		}
		if valueStr == `"""` {
			return p.startMultiline(key)
		}
		val, err := p.parseValue(valueStr)
		if err != nil {
			return err
		}
		return p.assignToFrame(key, val)
	}

	if strings.Contains(rest, "->") || strings.Contains(line, "->") {
		return p.err("E08: Missing spaces around \"->\"; expected \" -> \"")
	}

	return p.errf("Unexpected token after key %q: %q", key, rest)
}

// ── Multiline strings ─────────────────────────────────────────────────────────

func (p *Parser) processMultilineLine(raw string) error {
	if strings.TrimRight(raw, " \t") == `"""` {
		var value string
		if len(p.multilineLines) > 0 {
			value = strings.Join(p.multilineLines, "\n") + "\n"
		}
		if err := p.assignToFrame(p.multilineKey, value); err != nil {
			return err
		}
		p.inMultiline = false
		p.multilineKey = ""
		p.multilineLines = nil
		return nil
	}
	p.multilineLines = append(p.multilineLines, raw)
	return nil
}

func (p *Parser) startMultiline(key string) error {
	cur := p.currentFrame()
	if cur.kind == frameArray {
		return p.err("E14: Key-value pair inside array block")
	}
	if !cur.obj.Set(key, nil) { // placeholder
		return p.errf("E01: Duplicate key %q", key)
	}
	// Remove the placeholder — we'll re-set on close
	delete(cur.obj.Values, key)
	cur.obj.Keys = cur.obj.Keys[:len(cur.obj.Keys)-1]

	p.inMultiline = true
	p.multilineKey = key
	p.multilineLines = nil
	return nil
}

// ── Block management ──────────────────────────────────────────────────────────

func (p *Parser) openBlock(key string) error {
	parent := p.currentFrame()
	if parent.kind == frameArray {
		return p.errf("E14: Named block opener %q inside array block; use \"- ::\" for anonymous elements", key+" ::")
	}
	if _, exists := parent.obj.Values[key]; exists {
		return p.errf("E01: Duplicate key %q", key)
	}
	obj := NewObject()
	p.stack = append(p.stack, &frame{kind: frameObject, key: key, obj: obj})
	return nil
}

func (p *Parser) openAnonBlock() error {
	parent := p.currentFrame()

	if parent.kind == frameObject && len(parent.obj.Keys) > 0 {
		return p.err("E14: Anonymous block \"- ::\" inside object block (mixed block content)")
	}
	if parent.kind == frameObject {
		// Convert to array on first anon element
		arr := make([]Value, 0)
		parent.kind = frameArray
		parent.arr = &arr
	}
	if parent.kind != frameArray {
		return p.err("E15: Anonymous block opener \"- ::\" only valid inside array block")
	}

	obj := NewObject()
	// Push a placeholder into the parent array now to preserve order
	*parent.arr = append(*parent.arr, obj)
	p.stack = append(p.stack, &frame{kind: frameObject, key: "-", obj: obj, isAnon: true})
	return nil
}

func (p *Parser) closeBlock(closer string) error {
	if len(p.stack) <= 1 {
		return p.errf("E02: Unexpected block closer %q at top level", ":: "+closer)
	}

	cur := p.currentFrame()

	if closer == "-" {
		if !cur.isAnon {
			return p.errf("E15: Anonymous closer \":: -\" used to close named block %q", cur.key)
		}
		p.stack = p.stack[:len(p.stack)-1]
		// Value already in parent array by reference
		return nil
	}

	if cur.key != closer {
		return p.errf("E02: Block closer %q does not match opener %q", ":: "+closer, ":: "+cur.key)
	}

	p.stack = p.stack[:len(p.stack)-1]
	parent := p.currentFrame()

	var value Value
	if cur.kind == frameArray {
		value = *cur.arr
	} else {
		value = cur.obj
	}

	if parent.kind == frameArray {
		*parent.arr = append(*parent.arr, value)
	} else {
		parent.obj.Set(cur.key, value)
	}
	return nil
}

// ── Value assignment ──────────────────────────────────────────────────────────

func (p *Parser) assignToFrame(key string, val Value) error {
	cur := p.currentFrame()
	if cur.kind == frameArray {
		return p.err("E14: Key-value pair inside array block")
	}
	if !cur.obj.Set(key, val) {
		return p.errf("E01: Duplicate key %q", key)
	}
	return nil
}

func (p *Parser) addArrayItem(val Value) error {
	cur := p.currentFrame()
	if cur.kind == frameObject && len(cur.obj.Keys) > 0 {
		return p.err("E14: Array item inside object block (mixed block content)")
	}
	if cur.kind == frameObject {
		arr := make([]Value, 0)
		cur.kind = frameArray
		cur.arr = &arr
	}
	*cur.arr = append(*cur.arr, val)
	return nil
}

func (p *Parser) currentFrame() *frame {
	return p.stack[len(p.stack)-1]
}

// ── Value parsing ─────────────────────────────────────────────────────────────

var wrongCaseRe = regexp.MustCompile(`^(True|TRUE|False|FALSE|Null|NULL)$`)
var nanInfRe = regexp.MustCompile(`(?i)^[+-]?(NaN|Infinity|inf)$`)
var numberRe = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`)

func (p *Parser) parseValue(raw string) (Value, error) {
	s := strings.TrimSpace(raw)

	switch s {
	case "null":  return nil, nil
	case "true":  return true, nil
	case "false": return false, nil
	}

	if wrongCaseRe.MatchString(s) {
		return nil, p.errf("E06: Boolean and null must be lowercase; got %q", s)
	}
	if nanInfRe.MatchString(s) {
		return nil, p.err("E05: NaN and Infinity are not valid SAS number values")
	}
	if strings.HasPrefix(s, "+") {
		return nil, p.errf("E05: Numbers must not have a leading \"+\": %q", s)
	}
	if strings.HasPrefix(s, "[") {
		return p.parseInlineArray(s)
	}
	if strings.HasPrefix(s, "{") {
		return p.parseInlineObject(s)
	}
	if strings.HasPrefix(s, `"`) {
		return p.parseString(s)
	}
	if len(s) > 0 && (s[0] == '-' || (s[0] >= '0' && s[0] <= '9')) {
		return p.parseNumber(s)
	}

	return nil, p.errf("Unknown value: %q", s)
}

// ── String parsing ────────────────────────────────────────────────────────────

func (p *Parser) parseString(raw string) (string, error) {
	if !strings.HasPrefix(raw, `"`) || !strings.HasSuffix(raw, `"`) || len(raw) < 2 {
		return "", p.errf("Malformed string: %s", raw)
	}
	return p.processEscapes(raw[1 : len(raw)-1])
}

func (p *Parser) processEscapes(s string) (string, error) {
	var b strings.Builder
	i := 0
	for i < len(s) {
		ch := s[i]
		if ch == '\\' {
			i++
			if i >= len(s) {
				return "", p.err("E04: Invalid escape sequence at end of string")
			}
			esc := s[i]
			switch esc {
			case '"':  b.WriteByte('"')
			case '\\': b.WriteByte('\\')
			case 'n':  b.WriteByte('\n')
			case 't':  b.WriteByte('\t')
			case 'r':  b.WriteByte('\r')
			case 'u':
				if i+4 >= len(s) {
					return "", p.errf("E04: Invalid \\u escape: insufficient digits")
				}
				hex := s[i+1 : i+5]
				if !isHex4(hex) {
					return "", p.errf("E04: Invalid \\u escape: %q", "\\u"+hex)
				}
				n, _ := strconv.ParseUint(hex, 16, 32)
				r := rune(n)
				// Handle surrogate pairs
				if utf16.IsSurrogate(r) {
					b.WriteRune(utf16.DecodeRune(r, 0xFFFD))
				} else {
					b.WriteRune(r)
				}
				i += 4
			default:
				return "", p.errf("E04: Invalid escape sequence %q", "\\"+string(esc))
			}
		} else if ch == '"' {
			return "", p.err("E04: Unescaped double-quote inside string")
		} else {
			b.WriteByte(ch)
		}
		i++
	}
	return b.String(), nil
}

func isHex4(s string) bool {
	if len(s) != 4 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// ── Number parsing ────────────────────────────────────────────────────────────

func (p *Parser) parseNumber(s string) (Value, error) {
	if !numberRe.MatchString(s) {
		return nil, p.errf("E05: Invalid number format: %q", s)
	}
	// Integer if no decimal point or exponent
	if !strings.ContainsAny(s, ".eE") {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, p.errf("E05: Integer out of range: %q", s)
		}
		return n, nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return nil, p.errf("E05: Number out of range: %q", s)
	}
	return f, nil
}

// ── Inline array ──────────────────────────────────────────────────────────────

func (p *Parser) parseInlineArray(s string) ([]Value, error) {
	if !strings.HasPrefix(s, "[") || !strings.HasSuffix(s, "]") {
		return nil, p.errf("Malformed inline array: %q", s)
	}
	inner := strings.TrimSpace(s[1 : len(s)-1])
	if inner == "" {
		return []Value{}, nil
	}
	if strings.HasSuffix(inner, " |") || strings.HasSuffix(inner, "\t|") {
		return nil, p.err("E10: Trailing \"|\" in inline array")
	}
	if err := p.checkPipeSyntax(inner, "inline array"); err != nil {
		return nil, err
	}
	parts := splitByPipe(inner)
	result := make([]Value, 0, len(parts))
	for _, part := range parts {
		val, err := p.parseValue(strings.TrimSpace(part))
		if err != nil {
			return nil, err
		}
		if isComplex(val) {
			return nil, p.err("E11: Inline array elements must be scalar (string, number, boolean, null)")
		}
		result = append(result, val)
	}
	return result, nil
}

// ── Inline object ─────────────────────────────────────────────────────────────

func (p *Parser) parseInlineObject(s string) (*Object, error) {
	if !strings.HasPrefix(s, "{") || !strings.HasSuffix(s, "}") {
		return nil, p.errf("Malformed inline object: %q", s)
	}
	inner := strings.TrimSpace(s[1 : len(s)-1])
	if inner == "" {
		return NewObject(), nil
	}
	if strings.HasSuffix(inner, " |") || strings.HasSuffix(inner, "\t|") {
		return nil, p.err("E10: Trailing \"|\" in inline object")
	}
	if err := p.checkPipeSyntax(inner, "inline object"); err != nil {
		return nil, err
	}

	obj := NewObject()
	inlineFieldRe := regexp.MustCompile(`^([A-Za-z0-9_][A-Za-z0-9_-]*) -> (.+)$`)

	for _, part := range splitByPipe(inner) {
		part = strings.TrimSpace(part)
		m := inlineFieldRe.FindStringSubmatch(part)
		if m == nil {
			return nil, p.errf("Invalid field in inline object: %q", part)
		}
		k, valStr := m[1], m[2]
		if _, exists := obj.Values[k]; exists {
			return nil, p.errf("E01: Duplicate key %q in inline object", k)
		}
		if strings.TrimSpace(valStr)[0] == '{' {
			return nil, p.err("E12: Nested inline objects are not permitted")
		}
		val, err := p.parseValue(strings.TrimSpace(valStr))
		if err != nil {
			return nil, err
		}
		if isComplex(val) {
			return nil, p.err("E11: Inline object values must be scalar")
		}
		obj.Set(k, val)
	}
	return obj, nil
}

// ── Pipe-split utility ────────────────────────────────────────────────────────

// splitByPipe splits s by " | " respecting quoted strings.
func splitByPipe(s string) []string {
	var parts []string
	var cur strings.Builder
	inStr := false
	i := 0
	for i < len(s) {
		ch := s[i]
		if ch == '"' && !inStr {
			inStr = true
			cur.WriteByte(ch)
		} else if ch == '"' && inStr {
			// Check for backslash escape
			bs := 0
			j := cur.Len() - 1
			tmp := cur.String()
			for j >= 0 && tmp[j] == '\\' {
				bs++
				j--
			}
			if bs%2 == 0 {
				inStr = false
			}
			cur.WriteByte(ch)
		} else if !inStr && ch == ' ' && i+2 < len(s) && s[i+1] == '|' && s[i+2] == ' ' {
			parts = append(parts, cur.String())
			cur.Reset()
			i += 3
			continue
		} else {
			cur.WriteByte(ch)
		}
		i++
	}
	if strings.TrimSpace(cur.String()) != "" {
		parts = append(parts, cur.String())
	}
	return parts
}

func (p *Parser) checkPipeSyntax(inner, context string) error {
	inStr := false
	for i, ch := range inner {
		if ch == '"' && !inStr {
			inStr = true
			continue
		}
		if ch == '"' && inStr {
			inStr = false
			continue
		}
		if !inStr && ch == '|' {
			before := ' ' + 1 // sentinel
			after := ' ' + 1
			if i > 0 {
				before = rune(inner[i-1])
			}
			if i+1 < len(inner) {
				after = rune(inner[i+1])
			}
			if before != ' ' || after != ' ' {
				return p.errf("E09: \"|\" in %s must be surrounded by single spaces", context)
			}
		}
	}
	return nil
}

func (p *Parser) checkNoInlineComment(valueStr string) error {
	inStr := false
	for _, ch := range valueStr {
		if ch == '"' && !inStr {
			inStr = true
			continue
		}
		if ch == '"' && inStr {
			inStr = false
			continue
		}
		if !inStr && ch == '#' {
			return p.err("E07: Inline comments are not permitted")
		}
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func isComplex(v Value) bool {
	if v == nil {
		return false
	}
	switch v.(type) {
	case bool, int64, float64, string:
		return false
	}
	return true
}

func (p *Parser) err(msg string) *ParseError  { return parseErr(p.lineNum, msg) }
func (p *Parser) errf(f string, a ...any) *ParseError { return parseErrf(p.lineNum, f, a...) }

// ── Public convenience ────────────────────────────────────────────────────────

// Parse parses a SAS 1.1 document string and returns the root object.
func Parse(source string) (*Object, error) {
	return NewParser(source).Parse()
}
