const INLINE_ARRAY_MAX_LEN = 120;
const INLINE_OBJECT_MAX_FIELDS = 4;

class JSONToSASError extends Error {
  constructor(message, path) {
    super(path ? `At "${path}": ${message}` : message);
    this.name = 'JSONToSASError'; this.path = path;
  }
}

function jsonToSAS(input, options = {}) {
  const { versionHeader = true, indent = '    ' } = options;
  const obj = typeof input === 'string' ? JSON.parse(input) : input;
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new JSONToSASError('Top-level value must be a JSON object');
  const lines = [];
  if (versionHeader) { lines.push('__sas_version__ -> "1.1"'); lines.push(''); }
  serializeObjectBody(obj, lines, '', indent, '__root__');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

function serializeObjectBody(obj, lines, currentIndent, indentUnit, path) {
  for (const [rawKey, value] of Object.entries(obj)) {
    const key = sanitizeKey(rawKey, path);
    serializeKeyValue(key, value, lines, currentIndent, indentUnit, `${path}.${key}`);
  }
}

function serializeKeyValue(key, value, lines, indent, indentUnit, path) {
  if (value === null) { lines.push(`${indent}${key} -> null`); return; }
  switch (typeof value) {
    case 'boolean': lines.push(`${indent}${key} -> ${value}`); return;
    case 'number':  lines.push(`${indent}${key} -> ${serializeNumber(value, path)}`); return;
    case 'string':
      if (value.includes('\n') && !value.includes('"""')) {
        lines.push(`${indent}${key} -> """`);
        const content = value.endsWith('\n') ? value.slice(0, -1) : value;
        for (const line of content.split('\n')) lines.push(line);
        lines.push('"""');
      } else { lines.push(`${indent}${key} -> ${serializeString(value)}`); }
      return;
    case 'object':
      Array.isArray(value) ? serializeArray(key, value, lines, indent, indentUnit, path) : serializeObject(key, value, lines, indent, indentUnit, path);
      return;
    default: throw new JSONToSASError(`Unsupported value type: ${typeof value}`, path);
  }
}

function serializeObject(key, obj, lines, indent, indentUnit, path) {
  const entries = Object.entries(obj);
  if (entries.length > 0 && entries.length <= INLINE_OBJECT_MAX_FIELDS && entries.every(([, v]) => isScalar(v))) {
    const fields = entries.map(([k, v]) => `${sanitizeKey(k, path)} -> ${serializeScalar(v, path)}`).join(' | ');
    const candidate = `${indent}${key} -> { ${fields} }`;
    if (candidate.length <= INLINE_ARRAY_MAX_LEN) { lines.push(candidate); return; }
  }
  lines.push(`${indent}${key} ::`);
  serializeObjectBody(obj, lines, indent + indentUnit, indentUnit, path);
  lines.push(`${indent}:: ${key}`); lines.push('');
}

function serializeArray(key, arr, lines, indent, indentUnit, path) {
  if (arr.length === 0) { lines.push(`${indent}${key} -> []`); return; }
  if (arr.every(isScalar)) {
    const candidate = `${indent}${key} -> [${arr.map(v => serializeScalar(v, path)).join(' | ')}]`;
    if (candidate.length <= INLINE_ARRAY_MAX_LEN) { lines.push(candidate); return; }
  }
  lines.push(`${indent}${key} ::`);
  arr.forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    if (item === null || typeof item !== 'object') { lines.push(`${indent + indentUnit}- ${serializeScalar(item, itemPath)}`); }
    else if (Array.isArray(item)) { lines.push(`${indent + indentUnit}- ::`); serializeArray('items', item, lines, indent + indentUnit + indentUnit, indentUnit, itemPath); lines.push(`${indent + indentUnit}:: -`); }
    else { lines.push(`${indent + indentUnit}- ::`); serializeObjectBody(item, lines, indent + indentUnit + indentUnit, indentUnit, itemPath); lines.push(`${indent + indentUnit}:: -`); }
  });
  lines.push(`${indent}:: ${key}`); lines.push('');
}

function serializeScalar(value, path) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return serializeNumber(value, path);
  if (typeof value === 'string') return serializeString(value);
  throw new JSONToSASError(`Expected scalar, got ${typeof value}`, path);
}

function serializeString(s) { return `"${s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\t/g,'\\t').replace(/\r/g,'\\r')}"`; }
function serializeNumber(n, path) { if (!isFinite(n)) throw new JSONToSASError('SAS does not support NaN or Infinity', path); return JSON.stringify(n); }

const VALID_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
function sanitizeKey(rawKey, path) {
  if (VALID_KEY_RE.test(rawKey)) return rawKey;
  let s = rawKey.replace(/[^A-Za-z0-9_-]/g, '_');
  if (s.startsWith('-')) s = '_' + s.slice(1);
  if (!s) s = '_key';
  return s;
}

function isScalar(v) { return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'; }

export { jsonToSAS, JSONToSASError };
export default jsonToSAS;
