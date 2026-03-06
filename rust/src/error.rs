use std::fmt;

/// Returned when a SAS document fails to parse.
/// Always includes the line number of the offending token.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub line: usize,
    pub message: String,
}

impl ParseError {
    pub fn new(line: usize, message: impl Into<String>) -> Self {
        Self { line, message: message.into() }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[Line {}] {}", self.line, self.message)
    }
}

impl std::error::Error for ParseError {}

/// Returned when a value cannot be serialized to SAS.
#[derive(Debug, Clone, PartialEq)]
pub struct ConvertError {
    pub path: Option<String>,
    pub message: String,
}

impl ConvertError {
    pub fn new(message: impl Into<String>) -> Self {
        Self { path: None, message: message.into() }
    }
    pub fn at(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self { path: Some(path.into()), message: message.into() }
    }
}

impl fmt::Display for ConvertError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.path {
            Some(p) => write!(f, "at \"{}\": {}", p, self.message),
            None    => write!(f, "{}", self.message),
        }
    }
}

impl std::error::Error for ConvertError {}
