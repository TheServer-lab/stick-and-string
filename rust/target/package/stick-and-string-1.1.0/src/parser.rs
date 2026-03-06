use crate::error::ParseError;
use crate::value::{Object, Value};

// ── Public entry point ────────────────────────────────────────────────────────

/// Parse a SAS 1.1 document string into a [`Value::Object`].
pub fn parse(source: &str) -> Result<Value, ParseError> {
    Parser::new(source).parse()
}

// ── Frame ─────────────────────────────────────────────────────────────────────

#[derive(Debug)]
enum FrameContent {
    Object(Object),
    Array(Vec<Value>),
}

#[derive(Debug)]
struct Frame {
    key:     String,
    content: FrameContent,
    is_anon: bool,
}

impl Frame {
    fn new_object(key: impl Into<String>) -> Self {
        Self { key: key.into(), content: FrameContent::Object(Object::new()), is_anon: false }
    }
    fn new_anon() -> Self {
        Self { key: "-".into(), content: FrameContent::Object(Object::new()), is_anon: true }
    }

    fn is_array(&self) -> bool {
        matches!(self.content, FrameContent::Array(_))
    }

    #[allow(dead_code)]
    fn obj_len(&self) -> usize {
        match &self.content {
            FrameContent::Object(o) => o.len(),
            FrameContent::Array(_)  => 0,
        }
    }

    fn to_value(self) -> Value {
        match self.content {
            FrameContent::Object(o) => Value::Object(o),
            FrameContent::Array(a)  => Value::Array(a),
        }
    }
}

// ── Parser ────────────────────────────────────────────────────────────────────

struct Parser<'a> {
    lines:           Vec<&'a str>,
    line_num:        usize,
    stack:           Vec<Frame>,
    in_multiline:    bool,
    multiline_key:   String,
    multiline_lines: Vec<String>,
}

impl<'a> Parser<'a> {
    fn new(source: &'a str) -> Self {
        let lines: Vec<&str> = source.split('\n').collect();
        Self {
            lines,
            line_num: 0,
            stack: Vec::new(),
            in_multiline: false,
            multiline_key: String::new(),
            multiline_lines: Vec::new(),
        }
    }

    fn parse(mut self) -> Result<Value, ParseError> {
        self.stack.push(Frame::new_object("__root__"));

        let lines: Vec<String> = self.lines.iter()
            .map(|l| l.trim_end_matches('\r').to_string())
            .collect();

        for (i, raw) in lines.iter().enumerate() {
            self.line_num = i + 1;

            if self.in_multiline {
                self.process_multiline_line(raw)?;
                continue;
            }
            self.process_line(raw)?;
        }

        if self.in_multiline {
            return Err(self.err("E03: Unexpected end of document inside multiline string"));
        }
        if self.stack.len() > 1 {
            let top_key = self.stack.last().unwrap().key.clone();
            return Err(ParseError::new(
                lines.len(),
                format!("E03: Unexpected end of document — unclosed block {:?}", top_key),
            ));
        }

        let root = self.stack.pop().unwrap().to_value();
        Ok(root)
    }

    // ── Line dispatch ─────────────────────────────────────────────────────────

    fn process_line(&mut self, raw: &str) -> Result<(), ParseError> {
        let line = raw.trim();

        if line.is_empty() || line.starts_with('#') {
            return Ok(());
        }

        // Block closer: ":: key" or ":: -"
        if let Some(closer) = line.strip_prefix(":: ") {
            if closer.is_empty() {
                return Err(self.err("E02: Block closer missing identifier after \"::\""));
            }
            return self.close_block(closer);
        }
        if line == "::" {
            return Err(self.err("E02: Bare \"::\" not permitted in SAS 1.1; use \":: key\" or \":: -\""));
        }

        // Anonymous block opener: "- ::"
        if line == "- ::" {
            return self.open_anon_block();
        }

        // Array item: "- value"
        if let Some(rest) = line.strip_prefix("- ") {
            let val = self.parse_value(rest)?;
            return self.add_array_item(val);
        }

        // Key-based lines
        let key_end = line.find(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            .unwrap_or(line.len());

        if key_end == 0 {
            if line.starts_with('-') && line.len() > 1 && line.chars().nth(1).map_or(false, |c| c.is_alphanumeric() || c == '_') {
                return Err(self.errf(format!("E13: Key must not begin with \"-\": {:?}", line.split_whitespace().next().unwrap_or(line))));
            }
            return Err(self.errf(format!("Unexpected token: {:?}", line)));
        }

        // Keys must not start with '-'
        if line.starts_with('-') {
            return Err(self.errf(format!("E13: Key must not begin with \"-\": {:?}", &line[..key_end])));
        }

        let key = &line[..key_end];
        let rest = &line[key_end..];

        // Block opener: " ::"
        if rest == " ::" {
            return self.open_block(key);
        }

        // Key-value pair: " -> value"
        if let Some(value_str) = rest.strip_prefix(" -> ") {
            if value_str.is_empty() {
                return Err(self.errf(format!("Missing value for key {:?}", key)));
            }
            self.check_no_inline_comment(value_str)?;
            if value_str == "\"\"\"" {
                return self.start_multiline(key);
            }
            let val = self.parse_value(value_str)?;
            return self.assign_to_frame(key, val);
        }

        if rest.contains("->") || line.contains("->") {
            return Err(self.err("E08: Missing spaces around \"->\"; expected \" -> \""));
        }

        Err(self.errf(format!("Unexpected token after key {:?}: {:?}", key, rest)))
    }

    // ── Multiline strings ─────────────────────────────────────────────────────

    fn process_multiline_line(&mut self, raw: &str) -> Result<(), ParseError> {
        if raw.trim_end() == "\"\"\"" {
            let value = if self.multiline_lines.is_empty() {
                String::new()
            } else {
                self.multiline_lines.join("\n") + "\n"
            };
            let key = std::mem::take(&mut self.multiline_key);
            self.assign_to_frame(&key, Value::String(value))?;
            self.in_multiline = false;
            self.multiline_lines.clear();
            Ok(())
        } else {
            self.multiline_lines.push(raw.to_string());
            Ok(())
        }
    }

    fn start_multiline(&mut self, key: &str) -> Result<(), ParseError> {
        let frame = self.current_frame_mut();
        if frame.is_array() {
            return Err(ParseError::new(self.line_num, "E14: Key-value pair inside array block"));
        }
        if let FrameContent::Object(ref obj) = frame.content {
            if obj.contains_key(key) {
                return Err(self.errf(format!("E01: Duplicate key {:?}", key)));
            }
        }
        self.in_multiline = true;
        self.multiline_key = key.to_string();
        self.multiline_lines.clear();
        Ok(())
    }

    // ── Block management ──────────────────────────────────────────────────────

    fn open_block(&mut self, key: &str) -> Result<(), ParseError> {
        {
            let parent = self.current_frame();
            if parent.is_array() {
                return Err(self.errf(format!(
                    "E14: Named block opener {:?} inside array block; use \"- ::\" for anonymous elements",
                    format!("{} ::", key)
                )));
            }
            if let FrameContent::Object(ref obj) = parent.content {
                if obj.contains_key(key) {
                    return Err(self.errf(format!("E01: Duplicate key {:?}", key)));
                }
            }
        }
        self.stack.push(Frame::new_object(key));
        Ok(())
    }

    fn open_anon_block(&mut self) -> Result<(), ParseError> {
        {
            let parent = self.current_frame();
            if let FrameContent::Object(ref obj) = parent.content {
                if obj.len() > 0 {
                    return Err(self.err("E14: Anonymous block \"- ::\" inside object block (mixed block content)"));
                }
            }
        }
        // Convert object → array if needed
        {
            let parent = self.current_frame_mut();
            if let FrameContent::Object(_) = &parent.content {
                parent.content = FrameContent::Array(Vec::new());
            }
        }
        if !self.current_frame().is_array() {
            return Err(self.err("E15: Anonymous block opener \"- ::\" only valid inside array block"));
        }
        self.stack.push(Frame::new_anon());
        Ok(())
    }

    fn close_block(&mut self, closer: &str) -> Result<(), ParseError> {
        if self.stack.len() <= 1 {
            return Err(self.errf(format!("E02: Unexpected block closer {:?} at top level", format!(":: {}", closer))));
        }

        let frame_key  = self.stack.last().unwrap().key.clone();
        let frame_anon = self.stack.last().unwrap().is_anon;

        if closer == "-" {
            if !frame_anon {
                return Err(self.errf(format!(
                    "E15: Anonymous closer \":: -\" used to close named block {:?}", frame_key
                )));
            }
            let frame = self.stack.pop().unwrap();
            let val = frame.to_value();
            // Push into parent array
            let parent = self.current_frame_mut();
            if let FrameContent::Array(ref mut arr) = parent.content {
                arr.push(val);
            }
            return Ok(());
        }

        if frame_key != closer {
            return Err(self.errf(format!(
                "E02: Block closer {:?} does not match opener {:?}",
                format!(":: {}", closer),
                format!(":: {}", frame_key),
            )));
        }

        let frame = self.stack.pop().unwrap();
        let val = frame.to_value();

        let parent = self.current_frame_mut();
        match &mut parent.content {
            FrameContent::Array(arr) => arr.push(val),
            FrameContent::Object(obj) => {
                obj.insert(frame_key, val);
            }
        }
        Ok(())
    }

    // ── Value assignment ──────────────────────────────────────────────────────

    fn assign_to_frame(&mut self, key: &str, val: Value) -> Result<(), ParseError> {
        let frame = self.current_frame_mut();
        if frame.is_array() {
            return Err(ParseError::new(self.line_num, "E14: Key-value pair inside array block"));
        }
        if let FrameContent::Object(ref mut obj) = frame.content {
            if !obj.insert(key.to_string(), val) {
                return Err(self.errf(format!("E01: Duplicate key {:?}", key)));
            }
        }
        Ok(())
    }

    fn add_array_item(&mut self, val: Value) -> Result<(), ParseError> {
        let frame = self.current_frame_mut();
        if let FrameContent::Object(ref obj) = frame.content {
            if obj.len() > 0 {
                return Err(ParseError::new(self.line_num, "E14: Array item inside object block (mixed block content)"));
            }
        }
        if let FrameContent::Object(_) = &frame.content {
            frame.content = FrameContent::Array(Vec::new());
        }
        if let FrameContent::Array(ref mut arr) = frame.content {
            arr.push(val);
        }
        Ok(())
    }

    fn current_frame(&self) -> &Frame {
        self.stack.last().unwrap()
    }

    fn current_frame_mut(&mut self) -> &mut Frame {
        self.stack.last_mut().unwrap()
    }

    // ── Value parsing ─────────────────────────────────────────────────────────

    fn parse_value(&self, raw: &str) -> Result<Value, ParseError> {
        let s = raw.trim();

        match s {
            "null"  => return Ok(Value::Null),
            "true"  => return Ok(Value::Bool(true)),
            "false" => return Ok(Value::Bool(false)),
            _ => {}
        }

        // E06: wrong-case boolean/null
        if matches!(s, "True" | "TRUE" | "False" | "FALSE" | "Null" | "NULL") {
            return Err(self.errf(format!("E06: Boolean and null must be lowercase; got {:?}", s)));
        }

        // E05: NaN / Infinity
        let s_lower = s.to_lowercase();
        if s_lower == "nan" || s_lower == "infinity" || s_lower == "inf"
            || s_lower == "+nan" || s_lower == "+infinity"
            || s_lower == "-nan" || s_lower == "-infinity"
        {
            return Err(self.err("E05: NaN and Infinity are not valid SAS number values"));
        }

        // E05: leading +
        if s.starts_with('+') {
            return Err(self.errf(format!("E05: Numbers must not have a leading \"+\": {:?}", s)));
        }

        if s.starts_with('[') { return self.parse_inline_array(s); }
        if s.starts_with('{') { return self.parse_inline_object(s); }
        if s.starts_with('"') { return self.parse_string(s).map(Value::String); }
        if s.starts_with('-') || s.starts_with(|c: char| c.is_ascii_digit()) {
            return self.parse_number(s);
        }

        Err(self.errf(format!("Unknown value: {:?}", s)))
    }

    // ── String parsing ────────────────────────────────────────────────────────

    fn parse_string(&self, raw: &str) -> Result<String, ParseError> {
        if !raw.starts_with('"') || !raw.ends_with('"') || raw.len() < 2 {
            return Err(self.errf(format!("Malformed string: {}", raw)));
        }
        self.process_escapes(&raw[1..raw.len() - 1])
    }

    fn process_escapes(&self, s: &str) -> Result<String, ParseError> {
        let mut result = String::with_capacity(s.len());
        let chars: Vec<char> = s.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let ch = chars[i];
            if ch == '\\' {
                i += 1;
                if i >= chars.len() {
                    return Err(self.err("E04: Invalid escape sequence at end of string"));
                }
                match chars[i] {
                    '"'  => result.push('"'),
                    '\\' => result.push('\\'),
                    'n'  => result.push('\n'),
                    't'  => result.push('\t'),
                    'r'  => result.push('\r'),
                    'u'  => {
                        if i + 4 >= chars.len() {
                            return Err(self.err("E04: Invalid \\u escape: insufficient digits"));
                        }
                        let hex: String = chars[i + 1..=i + 4].iter().collect();
                        if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                            return Err(self.errf(format!("E04: Invalid \\u escape: \"\\u{}\"", hex)));
                        }
                        let codepoint = u32::from_str_radix(&hex, 16).unwrap();
                        let ch = char::from_u32(codepoint)
                            .ok_or_else(|| self.errf(format!("E04: Invalid Unicode codepoint U+{}", hex)))?;
                        result.push(ch);
                        i += 4;
                    }
                    c => return Err(self.errf(format!("E04: Invalid escape sequence \"\\{}\"", c))),
                }
            } else if ch == '"' {
                return Err(self.err("E04: Unescaped double-quote inside string"));
            } else {
                result.push(ch);
            }
            i += 1;
        }
        Ok(result)
    }

    // ── Number parsing ────────────────────────────────────────────────────────

    fn parse_number(&self, s: &str) -> Result<Value, ParseError> {
        // Validate format
        if !is_valid_number(s) {
            return Err(self.errf(format!("E05: Invalid number format: {:?}", s)));
        }
        if s.contains('.') || s.contains('e') || s.contains('E') {
            let f: f64 = s.parse().map_err(|_| self.errf(format!("E05: Number out of range: {:?}", s)))?;
            if f.is_infinite() || f.is_nan() {
                return Err(self.errf(format!("E05: Number out of range: {:?}", s)));
            }
            Ok(Value::Float(f))
        } else {
            let n: i64 = s.parse().map_err(|_| self.errf(format!("E05: Integer out of range: {:?}", s)))?;
            Ok(Value::Int(n))
        }
    }

    // ── Inline array ──────────────────────────────────────────────────────────

    fn parse_inline_array(&self, s: &str) -> Result<Value, ParseError> {
        if !s.starts_with('[') || !s.ends_with(']') {
            return Err(self.errf(format!("Malformed inline array: {:?}", s)));
        }
        let inner = s[1..s.len() - 1].trim();
        if inner.is_empty() {
            return Ok(Value::Array(Vec::new()));
        }
        if inner.ends_with(" |") || inner.ends_with('\t') {
            return Err(self.err("E10: Trailing \"|\" in inline array"));
        }
        self.check_pipe_syntax(inner, "inline array")?;
        let parts = split_by_pipe(inner);
        let mut result = Vec::with_capacity(parts.len());
        for part in parts {
            let val = self.parse_value(part.trim())?;
            if !val.is_scalar() {
                return Err(self.err("E11: Inline array elements must be scalar (string, number, boolean, null)"));
            }
            result.push(val);
        }
        Ok(Value::Array(result))
    }

    // ── Inline object ─────────────────────────────────────────────────────────

    fn parse_inline_object(&self, s: &str) -> Result<Value, ParseError> {
        if !s.starts_with('{') || !s.ends_with('}') {
            return Err(self.errf(format!("Malformed inline object: {:?}", s)));
        }
        let inner = s[1..s.len() - 1].trim();
        if inner.is_empty() {
            return Ok(Value::Object(Object::new()));
        }
        if inner.ends_with(" |") {
            return Err(self.err("E10: Trailing \"|\" in inline object"));
        }
        self.check_pipe_syntax(inner, "inline object")?;

        let mut obj = Object::new();
        for part in split_by_pipe(inner) {
            let part = part.trim();
            let arrow = part.find(" -> ")
                .ok_or_else(|| self.errf(format!("Invalid field in inline object: {:?}", part)))?;
            let k = &part[..arrow];
            let v_str = &part[arrow + 4..];

            if !is_valid_key(k) {
                return Err(self.errf(format!("Invalid key in inline object: {:?}", k)));
            }
            if obj.contains_key(k) {
                return Err(self.errf(format!("E01: Duplicate key {:?} in inline object", k)));
            }
            if v_str.trim().starts_with('{') {
                return Err(self.err("E12: Nested inline objects are not permitted"));
            }
            let val = self.parse_value(v_str.trim())?;
            if !val.is_scalar() {
                return Err(self.err("E11: Inline object values must be scalar"));
            }
            obj.insert(k.to_string(), val);
        }
        Ok(Value::Object(obj))
    }

    // ── Pipe / comment helpers ────────────────────────────────────────────────

    fn check_pipe_syntax(&self, inner: &str, context: &str) -> Result<(), ParseError> {
        let chars: Vec<char> = inner.chars().collect();
        let mut in_str = false;
        for (i, &ch) in chars.iter().enumerate() {
            if ch == '"' { in_str = !in_str; continue; }
            if !in_str && ch == '|' {
                let before = if i > 0 { chars[i - 1] } else { '\0' };
                let after  = if i + 1 < chars.len() { chars[i + 1] } else { '\0' };
                if before != ' ' || after != ' ' {
                    return Err(self.errf(format!(
                        "E09: \"|\" in {} must be surrounded by single spaces", context
                    )));
                }
            }
        }
        Ok(())
    }

    fn check_no_inline_comment(&self, value_str: &str) -> Result<(), ParseError> {
        let mut in_str = false;
        for ch in value_str.chars() {
            if ch == '"' { in_str = !in_str; continue; }
            if !in_str && ch == '#' {
                return Err(self.err("E07: Inline comments are not permitted"));
            }
        }
        Ok(())
    }

    // ── Error helpers ─────────────────────────────────────────────────────────

    fn err(&self, msg: &str) -> ParseError {
        ParseError::new(self.line_num, msg)
    }

    fn errf(&self, msg: String) -> ParseError {
        ParseError::new(self.line_num, msg)
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn split_by_pipe(s: &str) -> Vec<&str> {
    let bytes = s.as_bytes();
    let mut parts = Vec::new();
    let mut start = 0;
    let mut in_str = false;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' { in_str = !in_str; }
        else if !in_str && bytes[i] == b' ' && i + 2 < bytes.len() && bytes[i + 1] == b'|' && bytes[i + 2] == b' ' {
            parts.push(&s[start..i]);
            i += 3;
            start = i;
            continue;
        }
        i += 1;
    }
    if start < s.len() {
        parts.push(&s[start..]);
    }
    parts
}

fn is_valid_number(s: &str) -> bool {
    let s = if s.starts_with('-') { &s[1..] } else { s };
    if s.is_empty() { return false; }

    // Split on e/E for exponent
    let (mantissa, _exp) = if let Some(pos) = s.find(|c| c == 'e' || c == 'E') {
        let exp = &s[pos + 1..];
        let exp_body = exp.strip_prefix('+').or_else(|| exp.strip_prefix('-')).unwrap_or(exp);
        if exp_body.is_empty() || !exp_body.chars().all(|c| c.is_ascii_digit()) {
            return false;
        }
        (&s[..pos], true)
    } else {
        (s, false)
    };

    // Split on decimal point
    let (int_part, dec_part) = if let Some(pos) = mantissa.find('.') {
        let dec = &mantissa[pos + 1..];
        if dec.is_empty() || !dec.chars().all(|c| c.is_ascii_digit()) {
            return false;
        }
        (&mantissa[..pos], Some(dec))
    } else {
        (mantissa, None)
    };

    let _ = dec_part;

    // Integer part: no leading zeros (except literal "0")
    if int_part.is_empty() { return false; }
    if int_part.len() > 1 && int_part.starts_with('0') { return false; }
    int_part.chars().all(|c| c.is_ascii_digit())
}

fn is_valid_key(s: &str) -> bool {
    if s.is_empty() || s.starts_with('-') { return false; }
    s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-')
}
