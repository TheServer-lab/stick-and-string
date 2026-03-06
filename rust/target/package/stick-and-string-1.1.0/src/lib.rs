//! # stick-and-string
//!
//! A parser, validator, and bidirectional JSON converter for the
//! **SAS 1.1 (Stick And String)** data serialization format.
//!
//! ## Quick start
//!
//! ```rust
//! use sas::{parse, to_json, from_json, ToJsonOptions, FromJsonOptions};
//!
//! // Parse SAS → Value
//! let doc = r#"
//! server ::
//!     host -> "localhost"
//!     port -> 8080
//! :: server
//! "#;
//!
//! let value = parse(doc).unwrap();
//! // value is Value::Object(...)
//!
//! // SAS → JSON string
//! let json = to_json(doc, ToJsonOptions::default()).unwrap();
//!
//! // JSON string → SAS string
//! let sas = from_json(&json, FromJsonOptions::default()).unwrap();
//! ```

pub mod error;
pub mod parser;
pub mod value;
pub mod json;

pub use error::{ParseError, ConvertError};
pub use parser::parse;
pub use value::Value;
pub use json::{to_json, from_json, ToJsonOptions, FromJsonOptions};
