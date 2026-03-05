'use strict';

// ─────────────────────────────────────────────
//  JSON → SAS 1.1 Converter
// ─────────────────────────────────────────────

const INLINE_ARRAY_MAX_LEN = 120; // chars before falling back to block array
const INLINE_OBJECT_MAX_FIELDS = 4;

class JSONToSASError extends Error {
  constructor(message, path) {
    super(path ? `At "${path}": ${message}` : message);
    this.name = 'JSONToSASError';
    this.path = path;
  }
}

/**
 * Convert a JSON string or object to a SAS 1.1 document string.
 *
 * @param {string|object} input  - Parsed JS object or raw JSON string
 * @param {object} options
 * @param {boolean} options.versionHeader  - Emit __sas_version__ (default: true)
 * @param {string}  options.indent         - Indentation string (default: '    ')
 * @returns {string}
 */
function jsonToSAS(input, options = {}) {
  const {
    versionHeader = true,
    indent = '    ',
  } = options;

  const obj = typeof input === 'string' ? JSON.parse(input) : input;

  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new JSONToSASError('Top-level value must be a JSON object');
  }

  const lines = [];

  if (versionHeader) {
    lines.push('__sas_version__ -> "1.1"');
    lines.push('');
  }

  serializeObjectBody(obj, lines, '', indent, '__root__');

  // Trim any trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  return lines.join('\n') + '\n';
}

// ── Object body serialization ────────────────

function serializeObjectBody(obj, lines, currentIndent, indentUnit, path) {
  const entries = Object.entries(obj);

  for (const [rawKey, value] of entries) {
    const key = sanitizeKey(rawKey, path);
    serializeKeyValue(key, value, lines, currentIndent, indentUnit, `${path}.${key}`);
  }
}

function serializeKeyValue(key, value, lines, indent, indentUnit, path) {
  if (value === null) {
    lines.push(`${indent}${key} -> null`);
    return;
  }

  switch (typeof value) {
    case 'boolean':
      lines.push(`${indent}${key} -> ${value}`);
      return;

    case 'number':
      lines.push(`${indent}${key} -> ${serializeNumber(value, path)}`);
      return;

    case 'string':
      if (value.includes('\n') && !value.includes('"""')) {
        // Multiline string
        lines.push(`${indent}${key} -> """`);
        // Spec: content exactly as-is; closing """ on its own line, no indent
        const content = value.endsWith('\n') ? value.slice(0, -1) : value;
        for (const line of content.split('\n')) lines.push(line);
        lines.push('"""');
      } else {
        lines.push(`${indent}${key} -> ${serializeString(value)}`);
      }
      return;

    case 'object':
      if (Array.isArray(value)) {
        serializeArray(key, value, lines, indent, indentUnit, path);
      } else {
        serializeObject(key, value, lines, indent, indentUnit, path);
      }
      return;

    default:
      throw new JSONToSASError(`Unsupported value type: ${typeof value}`, path);
  }
}

// ── Object serialization ─────────────────────

function serializeObject(key, obj, lines, indent, indentUnit, path) {
  const entries = Object.entries(obj);

  // Inline object: all scalar values, small enough
  if (
    entries.length > 0 &&
    entries.length <= INLINE_OBJECT_MAX_FIELDS &&
    entries.every(([, v]) => isScalar(v))
  ) {
    const fields = entries
      .map(([k, v]) => `${sanitizeKey(k, path)} -> ${serializeScalar(v, path)}`)
      .join(' | ');
    const candidate = `${indent}${key} -> { ${fields} }`;
    if (candidate.length <= INLINE_ARRAY_MAX_LEN) {
      lines.push(candidate);
      return;
    }
  }

  // Block object
  lines.push(`${indent}${key} ::`);
  serializeObjectBody(obj, lines, indent + indentUnit, indentUnit, path);
  lines.push(`${indent}:: ${key}`);
  lines.push('');
}

// ── Array serialization ──────────────────────

function serializeArray(key, arr, lines, indent, indentUnit, path) {
  if (arr.length === 0) {
    lines.push(`${indent}${key} -> []`);
    return;
  }

  const allScalar = arr.every(isScalar);

  // Inline array: all scalars, fits on one line
  if (allScalar) {
    const parts = arr.map(v => serializeScalar(v, path));
    const candidate = `${indent}${key} -> [${parts.join(' | ')}]`;
    if (candidate.length <= INLINE_ARRAY_MAX_LEN) {
      lines.push(candidate);
      return;
    }
  }

  // Block array
  lines.push(`${indent}${key} ::`);
  arr.forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    if (item === null || typeof item !== 'object') {
      lines.push(`${indent + indentUnit}- ${serializeScalar(item, itemPath)}`);
    } else if (Array.isArray(item)) {
      // Nested array: convert to a sub-block
      // SAS doesn't have native nested arrays at block level — wrap in an object key
      // that's the conventional approach; emit as a block with a single 'items' key
      lines.push(`${indent + indentUnit}- ::`);
      const subLines = [];
      serializeArray('items', item, subLines, indent + indentUnit + indentUnit, indentUnit, itemPath);
      lines.push(...subLines);
      lines.push(`${indent + indentUnit}:: -`);
    } else {
      // Object element in array: anonymous block
      lines.push(`${indent + indentUnit}- ::`);
      serializeObjectBody(item, lines, indent + indentUnit + indentUnit, indentUnit, itemPath);
      lines.push(`${indent + indentUnit}:: -`);
    }
  });
  lines.push(`${indent}:: ${key}`);
  lines.push('');
}

// ── Scalar serialization ─────────────────────

function serializeScalar(value, path) {
  if (value === null)          return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number')  return serializeNumber(value, path);
  if (typeof value === 'string')  return serializeString(value);
  throw new JSONToSASError(`Expected scalar, got ${typeof value}`, path);
}

function serializeString(s) {
  // Escape special characters; keep \n literal in single-line strings
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

function serializeNumber(n, path) {
  if (!isFinite(n)) {
    throw new JSONToSASError(`SAS does not support NaN or Infinity`, path);
  }
  // Use JSON.stringify to get a clean number representation
  return JSON.stringify(n);
}

// ── Key sanitization ─────────────────────────

const VALID_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const FORBIDDEN_CHARS_RE = /[^A-Za-z0-9_-]/g;

function sanitizeKey(rawKey, path) {
  if (VALID_KEY_RE.test(rawKey)) return rawKey;

  // Replace invalid characters with '_'
  let sanitized = rawKey.replace(FORBIDDEN_CHARS_RE, '_');

  // Must not start with '-'
  if (sanitized.startsWith('-')) sanitized = '_' + sanitized.slice(1);

  // Must not be empty
  if (!sanitized) sanitized = '_key';

  if (sanitized !== rawKey) {
    process.stderr.write(
      `[json-to-sas] Warning: key "${rawKey}" at "${path}" ` +
      `contains invalid characters; sanitized to "${sanitized}"\n`
    );
  }

  return sanitized;
}

// ── Helpers ──────────────────────────────────

function isScalar(v) {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

module.exports = { jsonToSAS, JSONToSASError };
