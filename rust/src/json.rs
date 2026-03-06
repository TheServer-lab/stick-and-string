use crate::error::{ConvertError, ParseError};
use crate::parser::parse;
use crate::value::{Object, Value};

const INLINE_MAX_LEN: usize = 120;
const INLINE_MAX_FIELDS: usize = 4;

// ── Options ───────────────────────────────────────────────────────────────────

/// Options for SAS → JSON conversion.
#[derive(Debug, Clone)]
pub struct ToJsonOptions {
    /// Indentation string (default: `"  "`).
    pub indent: String,
    /// Remove `__sas_version__` from the output (default: `true`).
    pub strip_version: bool,
}

impl Default for ToJsonOptions {
    fn default() -> Self {
        Self { indent: "  ".into(), strip_version: true }
    }
}

/// Options for JSON → SAS conversion.
#[derive(Debug, Clone)]
pub struct FromJsonOptions {
    /// Emit `__sas_version__ -> "1.1"` header (default: `true`).
    pub version_header: bool,
    /// Indentation string (default: `"    "`).
    pub indent: String,
}

impl Default for FromJsonOptions {
    fn default() -> Self {
        Self { version_header: true, indent: "    ".into() }
    }
}

// ── SAS → JSON ────────────────────────────────────────────────────────────────

/// Parse a SAS document and return a JSON string.
pub fn to_json(source: &str, opts: ToJsonOptions) -> Result<String, ParseError> {
    let mut val = parse(source)?;

    if opts.strip_version {
        if let Value::Object(ref mut obj) = val {
            obj.keys.retain(|k| k != "__sas_version__");
            obj.values.remove("__sas_version__");
        }
    }

    Ok(marshal_value(&val, &opts.indent, ""))
}

fn marshal_value(val: &Value, indent: &str, prefix: &str) -> String {
    match val {
        Value::Null        => "null".into(),
        Value::Bool(b)     => b.to_string(),
        Value::Int(n)      => n.to_string(),
        Value::Float(f)    => {
            // Match JSON's number representation
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{:.1}", f)
            } else {
                format!("{}", f)
            }
        }
        Value::String(s)   => json_escape_string(s),
        Value::Array(arr)  => marshal_array(arr, indent, prefix),
        Value::Object(obj) => marshal_object(obj, indent, prefix),
    }
}

fn marshal_object(obj: &Object, indent: &str, prefix: &str) -> String {
    if obj.is_empty() { return "{}".into(); }
    let new_prefix = format!("{}{}", prefix, indent);
    let mut s = String::from("{\n");
    for (i, k) in obj.keys.iter().enumerate() {
        let v = &obj.values[k];
        s.push_str(&new_prefix);
        s.push_str(&json_escape_string(k));
        s.push_str(": ");
        s.push_str(&marshal_value(v, indent, &new_prefix));
        if i < obj.keys.len() - 1 { s.push(','); }
        s.push('\n');
    }
    s.push_str(prefix);
    s.push('}');
    s
}

fn marshal_array(arr: &[Value], indent: &str, prefix: &str) -> String {
    if arr.is_empty() { return "[]".into(); }
    let new_prefix = format!("{}{}", prefix, indent);
    let mut s = String::from("[\n");
    for (i, v) in arr.iter().enumerate() {
        s.push_str(&new_prefix);
        s.push_str(&marshal_value(v, indent, &new_prefix));
        if i < arr.len() - 1 { s.push(','); }
        s.push('\n');
    }
    s.push_str(prefix);
    s.push(']');
    s
}

fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"'  => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04X}", c as u32));
            }
            c    => out.push(c),
        }
    }
    out.push('"');
    out
}

// ── JSON → SAS ────────────────────────────────────────────────────────────────

/// Parse a JSON string and convert it to a SAS 1.1 document.
pub fn from_json(json_src: &str, opts: FromJsonOptions) -> Result<String, ConvertError> {
    // Minimal JSON parser using serde_json-free approach:
    // We re-use Rust's standard library via a simple recursive descent.
    let value = parse_json_value(json_src.trim())
        .map_err(|e| ConvertError::new(format!("JSON parse error: {}", e)))?;

    match value {
        JsonValue::Object(map) => from_map_inner(&map, &opts),
        _ => Err(ConvertError::new("Top-level JSON value must be an object")),
    }
}

fn from_map_inner(map: &[(String, JsonValue)], opts: &FromJsonOptions) -> Result<String, ConvertError> {
    let mut lines: Vec<String> = Vec::new();
    if opts.version_header {
        lines.push(r#"__sas_version__ -> "1.1""#.into());
        lines.push(String::new());
    }
    serialize_map_body(map, &mut lines, "", &opts.indent, "__root__")?;
    while lines.last().map(|l: &String| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    Ok(lines.join("\n") + "\n")
}

fn serialize_map_body(
    map: &[(String, JsonValue)],
    lines: &mut Vec<String>,
    cur: &str,
    unit: &str,
    path: &str,
) -> Result<(), ConvertError> {
    for (raw_key, val) in map {
        let key = sanitize_key(raw_key);
        let full_path = format!("{}.{}", path, key);
        serialize_kv(&key, val, lines, cur, unit, &full_path)?;
    }
    Ok(())
}

fn serialize_kv(
    key: &str, val: &JsonValue,
    lines: &mut Vec<String>,
    ind: &str, unit: &str, path: &str,
) -> Result<(), ConvertError> {
    match val {
        JsonValue::Null          => lines.push(format!("{}{} -> null", ind, key)),
        JsonValue::Bool(b)       => lines.push(format!("{}{} -> {}", ind, key, b)),
        JsonValue::Number(n)     => lines.push(format!("{}{} -> {}", ind, key, n)),
        JsonValue::String(s)     => {
            if s.contains('\n') && !s.contains("\"\"\"") {
                lines.push(format!("{}{} -> \"\"\"", ind, key));
                let content = if s.ends_with('\n') { &s[..s.len()-1] } else { s.as_str() };
                for l in content.split('\n') { lines.push(l.to_string()); }
                lines.push("\"\"\"".into());
            } else {
                lines.push(format!("{}{} -> {}", ind, key, sas_escape_string(s)));
            }
        }
        JsonValue::Array(arr)    => serialize_array(key, arr, lines, ind, unit, path)?,
        JsonValue::Object(map)   => serialize_object(key, map, lines, ind, unit, path)?,
    }
    Ok(())
}

fn serialize_object(
    key: &str, map: &[(String, JsonValue)],
    lines: &mut Vec<String>,
    ind: &str, unit: &str, path: &str,
) -> Result<(), ConvertError> {
    // Try inline
    if !map.is_empty() && map.len() <= INLINE_MAX_FIELDS && map.iter().all(|(_, v)| v.is_scalar()) {
        let fields: Vec<String> = map.iter()
            .map(|(k, v)| format!("{} -> {}", sanitize_key(k), v.to_sas_scalar()))
            .collect();
        let candidate = format!("{}{} -> {{ {} }}", ind, key, fields.join(" | "));
        if candidate.len() <= INLINE_MAX_LEN {
            lines.push(candidate);
            return Ok(());
        }
    }
    lines.push(format!("{}{} ::", ind, key));
    serialize_map_body(map, lines, &format!("{}{}", ind, unit), unit, path)?;
    lines.push(format!("{}:: {}", ind, key));
    lines.push(String::new());
    Ok(())
}

fn serialize_array(
    key: &str, arr: &[JsonValue],
    lines: &mut Vec<String>,
    ind: &str, unit: &str, path: &str,
) -> Result<(), ConvertError> {
    if arr.is_empty() {
        lines.push(format!("{}{} -> []", ind, key));
        return Ok(());
    }
    if arr.iter().all(|v| v.is_scalar()) {
        let parts: Vec<String> = arr.iter().map(|v| v.to_sas_scalar()).collect();
        let candidate = format!("{}{} -> [{}]", ind, key, parts.join(" | "));
        if candidate.len() <= INLINE_MAX_LEN {
            lines.push(candidate);
            return Ok(());
        }
    }
    lines.push(format!("{}{} ::", ind, key));
    let inner_ind = format!("{}{}", ind, unit);
    for (i, item) in arr.iter().enumerate() {
        let item_path = format!("{}[{}]", path, i);
        match item {
            JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {
                lines.push(format!("{}- {}", inner_ind, item.to_sas_scalar()));
            }
            JsonValue::Array(sub) => {
                lines.push(format!("{}- ::", inner_ind));
                serialize_array("items", sub, lines, &format!("{}{}", inner_ind, unit), unit, &item_path)?;
                lines.push(format!("{}:: -", inner_ind));
            }
            JsonValue::Object(map) => {
                lines.push(format!("{}- ::", inner_ind));
                serialize_map_body(map, lines, &format!("{}{}", inner_ind, unit), unit, &item_path)?;
                lines.push(format!("{}:: -", inner_ind));
            }
        }
    }
    lines.push(format!("{}:: {}", ind, key));
    lines.push(String::new());
    Ok(())
}

fn sas_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"'  => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c    => out.push(c),
        }
    }
    out.push('"');
    out
}

fn sanitize_key(raw: &str) -> String {
    if raw.chars().enumerate().all(|(i, c)| {
        c.is_alphanumeric() || c == '_' || (c == '-' && i > 0)
    }) && !raw.is_empty() && !raw.starts_with('-') {
        return raw.to_string();
    }
    let mut s: String = raw.chars().map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    if s.starts_with('-') { s = format!("_{}", &s[1..]); }
    if s.is_empty() { s = "_key".into(); }
    s
}

// ── Minimal JSON parser ───────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum JsonValue {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<JsonValue>),
    Object(Vec<(String, JsonValue)>),
}

impl JsonValue {
    fn is_scalar(&self) -> bool {
        matches!(self, JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_))
    }

    fn to_sas_scalar(&self) -> String {
        match self {
            JsonValue::Null      => "null".into(),
            JsonValue::Bool(b)   => b.to_string(),
            JsonValue::Number(n) => n.clone(),
            JsonValue::String(s) => sas_escape_string(s),
            _ => "null".into(),
        }
    }
}

fn parse_json_value(s: &str) -> Result<JsonValue, String> {
    let s = s.trim();
    if s.starts_with('{') { return parse_json_object(s); }
    if s.starts_with('[') { return parse_json_array(s); }
    if s.starts_with('"') { return parse_json_string(s).map(JsonValue::String); }
    if s == "null"  { return Ok(JsonValue::Null); }
    if s == "true"  { return Ok(JsonValue::Bool(true)); }
    if s == "false" { return Ok(JsonValue::Bool(false)); }
    // Number
    if s.starts_with('-') || s.starts_with(|c: char| c.is_ascii_digit()) {
        return Ok(JsonValue::Number(s.to_string()));
    }
    Err(format!("unexpected token: {}", &s[..s.len().min(20)]))
}

fn parse_json_string(s: &str) -> Result<String, String> {
    let chars: Vec<char> = s.chars().collect();
    if chars[0] != '"' { return Err("expected '\"'".into()); }
    let mut result = String::new();
    let mut i = 1;
    while i < chars.len() {
        match chars[i] {
            '"' => return Ok(result),
            '\\' => {
                i += 1;
                match chars.get(i) {
                    Some('"')  => result.push('"'),
                    Some('\\') => result.push('\\'),
                    Some('/')  => result.push('/'),
                    Some('n')  => result.push('\n'),
                    Some('t')  => result.push('\t'),
                    Some('r')  => result.push('\r'),
                    Some('b')  => result.push('\x08'),
                    Some('f')  => result.push('\x0C'),
                    Some('u')  => {
                        let hex: String = chars.get(i+1..i+5).map(|c| c.iter().collect()).unwrap_or_default();
                        let cp = u32::from_str_radix(&hex, 16).map_err(|_| format!("bad \\u{}", hex))?;
                        result.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
                        i += 4;
                    }
                    _ => return Err("bad escape".into()),
                }
            }
            c => result.push(c),
        }
        i += 1;
    }
    Err("unterminated string".into())
}

fn parse_json_object(s: &str) -> Result<JsonValue, String> {
    let s = s.trim();
    if !s.starts_with('{') { return Err("expected '{'".into()); }
    // Use a character-level scanner
    let chars: Vec<char> = s.chars().collect();
    let mut i = 1;
    let mut pairs: Vec<(String, JsonValue)> = Vec::new();

    skip_ws(&chars, &mut i);
    if chars.get(i) == Some(&'}') { return Ok(JsonValue::Object(pairs)); }

    loop {
        skip_ws(&chars, &mut i);
        let key_str: String = chars[i..].iter().collect();
        let key = parse_json_string(key_str.trim())?;
        let key_len = json_string_len(&chars[i..]);
        i += key_len;
        skip_ws(&chars, &mut i);
        if chars.get(i) != Some(&':') { return Err("expected ':'".into()); }
        i += 1;
        skip_ws(&chars, &mut i);
        let rest: String = chars[i..].iter().collect();
        let (val, consumed) = parse_json_value_len(rest.trim())?;
        let consumed_in_original = rest.find(|_| true).unwrap_or(0) + chars[i..].iter().collect::<String>().find(&rest.trim()[..1]).unwrap_or(0);
        let _ = consumed_in_original;
        i += json_value_skip(&chars[i..], &consumed);
        pairs.push((key, val));
        skip_ws(&chars, &mut i);
        match chars.get(i) {
            Some(',') => { i += 1; }
            Some('}') => return Ok(JsonValue::Object(pairs)),
            _ => return Err("expected ',' or '}'".into()),
        }
    }
}

fn parse_json_array(s: &str) -> Result<JsonValue, String> {
    let s = s.trim();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 1;
    let mut items: Vec<JsonValue> = Vec::new();
    skip_ws(&chars, &mut i);
    if chars.get(i) == Some(&']') { return Ok(JsonValue::Array(items)); }
    loop {
        skip_ws(&chars, &mut i);
        let rest: String = chars[i..].iter().collect();
        let (val, consumed) = parse_json_value_len(rest.trim())?;
        i += json_value_skip(&chars[i..], &consumed);
        items.push(val);
        skip_ws(&chars, &mut i);
        match chars.get(i) {
            Some(',') => { i += 1; }
            Some(']') => return Ok(JsonValue::Array(items)),
            _ => return Err("expected ',' or ']'".into()),
        }
    }
}

fn skip_ws(chars: &[char], i: &mut usize) {
    while *i < chars.len() && chars[*i].is_whitespace() { *i += 1; }
}

fn json_string_len(chars: &[char]) -> usize {
    let mut i = 1;
    while i < chars.len() {
        if chars[i] == '\\' { i += 2; continue; }
        if chars[i] == '"' { return i + 1; }
        i += 1;
    }
    i
}

fn parse_json_value_len(s: &str) -> Result<(JsonValue, String), String> {
    let val = parse_json_value(s)?;
    Ok((val, s.to_string()))
}

fn json_value_skip(chars: &[char], _consumed: &str) -> usize {
    // Skip over the value in the char slice
    let mut depth = 0i32;
    let mut in_str = false;
    let mut i = 0;
    let first = chars.first().copied().unwrap_or(' ');
    let is_container = first == '{' || first == '[';

    while i < chars.len() {
        let ch = chars[i];
        if in_str {
            if ch == '\\' { i += 2; continue; }
            if ch == '"' { in_str = false; if !is_container { return i + 1; } }
        } else {
            match ch {
                '"' => { in_str = true; if !is_container { } }
                '{' | '[' => depth += 1,
                '}' | ']' => {
                    depth -= 1;
                    if depth <= 0 { return i + 1; }
                }
                _ if !is_container && (ch == ',' || ch == '}' || ch == ']' || ch.is_whitespace()) => {
                    return i;
                }
                _ => {}
            }
        }
        i += 1;
    }
    i
}
