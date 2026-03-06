use std::fmt;

/// Represents any SAS 1.1 value.
///
/// Insertion order is preserved for objects via the `Object` type.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    Array(Vec<Value>),
    Object(Object),
}

impl Value {
    pub fn is_scalar(&self) -> bool {
        matches!(self, Value::Null | Value::Bool(_) | Value::Int(_) | Value::Float(_) | Value::String(_))
    }

    pub fn as_object(&self) -> Option<&Object> {
        if let Value::Object(o) = self { Some(o) } else { None }
    }

    pub fn as_array(&self) -> Option<&Vec<Value>> {
        if let Value::Array(a) = self { Some(a) } else { None }
    }

    pub fn as_str(&self) -> Option<&str> {
        if let Value::String(s) = self { Some(s) } else { None }
    }

    pub fn as_i64(&self) -> Option<i64> {
        if let Value::Int(n) = self { Some(*n) } else { None }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Float(f) => Some(*f),
            Value::Int(n)   => Some(*n as f64),
            _ => None,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null        => write!(f, "null"),
            Value::Bool(b)     => write!(f, "{}", b),
            Value::Int(n)      => write!(f, "{}", n),
            Value::Float(n)    => write!(f, "{}", n),
            Value::String(s)   => write!(f, "{:?}", s),
            Value::Array(arr)  => {
                write!(f, "[")?;
                for (i, v) in arr.iter().enumerate() {
                    if i > 0 { write!(f, ", ")?; }
                    write!(f, "{}", v)?;
                }
                write!(f, "]")
            }
            Value::Object(obj) => write!(f, "{}", obj),
        }
    }
}

// ── Object — insertion-order-preserving map ───────────────────────────────────

/// An ordered key-value store used for SAS objects.
/// Preserves insertion order, which is required for deterministic round-trips.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Object {
    pub keys: Vec<String>,
    pub values: std::collections::HashMap<String, Value>,
}

impl Object {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert a key-value pair. Returns `false` if the key already exists (E01).
    pub fn insert(&mut self, key: String, val: Value) -> bool {
        if self.values.contains_key(&key) {
            return false;
        }
        self.keys.push(key.clone());
        self.values.insert(key, val);
        true
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.values.get(key)
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.values.contains_key(key)
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }

    /// Iterate in insertion order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.keys.iter().map(move |k| (k.as_str(), &self.values[k]))
    }
}

impl fmt::Display for Object {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{{")?;
        for (i, k) in self.keys.iter().enumerate() {
            if i > 0 { write!(f, ", ")?; }
            write!(f, "{:?}: {}", k, self.values[k])?;
        }
        write!(f, "}}")
    }
}
