'use strict';

// ─────────────────────────────────────────────
//  SAS 1.1 Parser
// ─────────────────────────────────────────────

class SASParseError extends Error {
  constructor(message, lineNum) {
    super(`[Line ${lineNum}] ${message}`);
    this.name = 'SASParseError';
    this.lineNum = lineNum;
  }
}

class SASParser {
  constructor(source) {
    this.lines = source.split(/\r?\n/);
    this.lineNum = 0;

    // Stack of frames: { type, key, value, isAnon }
    // type: 'object' | 'array'
    this.stack = [];

    // Multiline string state
    this.inMultiline = false;
    this.multilineKey = null;
    this.multilineLines = [];
  }

  // ── Public entry point ──────────────────────

  parse() {
    const root = { type: 'object', key: '__root__', value: {}, isAnon: false };
    this.stack = [root];

    for (let i = 0; i < this.lines.length; i++) {
      this.lineNum = i + 1;
      const raw = this.lines[i];

      if (this.inMultiline) {
        this.processMultilineLine(raw);
        continue;
      }

      this.processLine(raw);
    }

    if (this.inMultiline) {
      throw this.err('E03: Unexpected end of document inside multiline string');
    }
    if (this.stack.length > 1) {
      const top = this.stack[this.stack.length - 1];
      throw new SASParseError(
        `E03: Unexpected end of document — unclosed block "${top.key}"`,
        this.lines.length
      );
    }

    return root.value;
  }

  // ── Line dispatch ────────────────────────────

  processLine(raw) {
    // Strip leading whitespace (spec §6.4) and trailing whitespace
    const line = raw.trim();

    // Blank line
    if (line === '') return;

    // Comment: first non-whitespace char is '#'
    if (line.startsWith('#')) return;

    // ── Block closer: ":: key" or ":: -"
    if (line.startsWith(':: ')) {
      const closer = line.slice(3);
      if (!closer) throw this.err('E02: Block closer missing identifier after "::"');
      this.closeBlock(closer);
      return;
    }

    // Bare "::" — invalid in SAS 1.1
    if (line === '::') {
      throw this.err('E02: Bare "::" not permitted in SAS 1.1; use ":: key" or ":: -"');
    }

    // ── Anonymous block opener inside array: "- ::"
    if (line === '- ::') {
      this.openAnonBlock();
      return;
    }

    // ── Array item: "- value"
    if (line.startsWith('- ')) {
      const valueStr = line.slice(2);
      const value = this.parseValue(valueStr);
      this.addArrayItem(value);
      return;
    }

    // ── Block opener or key-value pair — both start with a key
    const keyMatch = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*)(.*)/);
    if (!keyMatch) {
      // Check for key starting with '-' (E13)
      if (/^-[A-Za-z0-9_]/.test(line)) {
        throw this.err(`E13: Key must not begin with "-": "${line.split(' ')[0]}"`);
      }
      throw this.err(`Unexpected token: "${line}"`);
    }

    const key = keyMatch[1];
    const rest = keyMatch[2];

    // Block opener: " ::" (no value after)
    if (rest === ' ::') {
      this.openBlock(key);
      return;
    }

    // Key-value pair: " -> value"
    if (rest.startsWith(' -> ')) {
      const valueStr = rest.slice(4);
      if (!valueStr) throw this.err(`Missing value for key "${key}"`);

      // Check for inline comment (E07): not inside a string
      this.checkNoInlineComment(valueStr);

      // Multiline string opener
      if (valueStr === '"""') {
        this.startMultiline(key);
        return;
      }

      const value = this.parseValue(valueStr);
      this.assignToFrame(key, value);
      return;
    }

    // E08: "->" present but without correct surrounding spaces
    if (rest.includes('->')) {
      throw this.err(`E08: Missing spaces around "->"; expected " -> "`);
    }

    // E08: could also be key->value where key consumed part of ->
    if (line.includes('->')) {
      throw this.err(`E08: Missing spaces around "->"; expected " -> "`);
    }

    throw this.err(`Unexpected token after key "${key}": "${rest}"`);
  }

  // ── Multiline string ─────────────────────────

  processMultilineLine(raw) {
    // Closing delimiter: """ alone on a line (no leading whitespace per spec §12.1)
    if (raw.trimEnd() === '"""') {
      // Trailing newline before closing """ IS included in value (spec §12.1)
      const value = this.multilineLines.length > 0
        ? this.multilineLines.join('\n') + '\n'
        : '';
      this.assignToFrame(this.multilineKey, value);
      this.inMultiline = false;
      this.multilineKey = null;
      this.multilineLines = [];
    } else {
      this.multilineLines.push(raw);
    }
  }

  startMultiline(key) {
    const frame = this.currentFrame();
    if (frame.type === 'array') {
      throw this.err('E14: Key-value pair inside array block');
    }
    this.checkDuplicateKey(frame, key);
    this.inMultiline = true;
    this.multilineKey = key;
    this.multilineLines = [];
  }

  // ── Block management ─────────────────────────

  openBlock(key) {
    const parent = this.currentFrame();
    if (parent.type === 'array') {
      throw this.err(`E14: Named block opener "${key} ::" inside array block; use "- ::" for anonymous elements`);
    }
    this.checkDuplicateKey(parent, key);
    // Placeholder — type resolved on first content line
    this.stack.push({ type: 'object', key, value: {}, isAnon: false });
  }

  openAnonBlock() {
    const parent = this.currentFrame();

    // If parent is a non-empty object → mixed content (E14)
    if (parent.type === 'object' && Object.keys(parent.value).length > 0) {
      throw this.err('E14: Anonymous block "- ::" inside object block (mixed block content)');
    }

    // Convert empty object→array on first anonymous element
    if (parent.type === 'object') {
      parent.type = 'array';
      parent.value = [];
    }

    if (parent.type !== 'array') {
      throw this.err('E15: Anonymous block opener "- ::" only valid inside array block');
    }

    // Push a shared mutable object into the parent array NOW so order is preserved
    const obj = {};
    parent.value.push(obj);
    this.stack.push({ type: 'object', key: '-', value: obj, isAnon: true });
  }

  closeBlock(closer) {
    if (this.stack.length <= 1) {
      throw this.err(`E02: Unexpected block closer ":: ${closer}" at top level`);
    }

    const frame = this.stack[this.stack.length - 1];

    // Anonymous closer ":: -"
    if (closer === '-') {
      if (!frame.isAnon) {
        throw this.err(`E15: Anonymous closer ":: -" used to close named block "${frame.key}"`);
      }
      this.stack.pop();
      // Value already in parent array by reference — nothing to assign
      return;
    }

    // Named closer must match opener key exactly
    if (frame.key !== closer) {
      throw this.err(`E02: Block closer ":: ${closer}" does not match opener ":: ${frame.key}"`);
    }

    this.stack.pop();
    const parent = this.currentFrame();
    const value = frame.value; // {} or []

    if (parent.type === 'array') {
      parent.value.push(value);
    } else {
      // object (including root)
      parent.value[frame.key] = value;
    }
  }

  // ── Value assignment helpers ─────────────────

  assignToFrame(key, value) {
    const frame = this.currentFrame();

    if (frame.type === 'array') {
      throw this.err('E14: Key-value pair inside array block');
    }

    this.checkDuplicateKey(frame, key);
    frame.value[key] = value;
  }

  addArrayItem(value) {
    const frame = this.currentFrame();

    if (frame.type === 'object' && Object.keys(frame.value).length > 0) {
      throw this.err('E14: Array item inside object block (mixed block content)');
    }

    // Lazily convert to array on first item
    if (frame.type === 'object') {
      frame.type = 'array';
      frame.value = [];
    }

    frame.value.push(value);
  }

  checkDuplicateKey(frame, key) {
    if (Object.prototype.hasOwnProperty.call(frame.value, key)) {
      throw this.err(`E01: Duplicate key "${key}"`);
    }
  }

  currentFrame() {
    return this.stack[this.stack.length - 1];
  }

  // ── Value parsing ────────────────────────────

  parseValue(raw) {
    const str = raw.trim();

    if (str === 'null')  return null;
    if (str === 'true')  return true;
    if (str === 'false') return false;

    // Wrong-case boolean/null (E06)
    if (/^(True|TRUE|False|FALSE|Null|NULL)$/.test(str)) {
      throw this.err(`E06: Boolean and null must be lowercase; got "${str}"`);
    }

    // E05: explicitly disallow NaN and Infinity variants
    if (/^[+-]?(NaN|Infinity|inf)$/i.test(str)) {
      throw this.err(`E05: NaN and Infinity are not valid SAS number values`);
    }

    // E05: leading '+' is not valid
    if (str.startsWith('+')) {
      throw this.err(`E05: Numbers must not have a leading "+": "${str}"`);
    }

    if (str.startsWith('[')) return this.parseInlineArray(str);
    if (str.startsWith('{')) return this.parseInlineObject(str);
    if (str.startsWith('"')) return this.parseString(str);

    // Number: starts with digit or '-'
    if (/^-?[0-9]/.test(str)) return this.parseNumber(str);

    throw this.err(`Unknown value: "${str}"`);
  }

  // ── String parsing ───────────────────────────

  parseString(raw) {
    if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) {
      throw this.err(`Malformed string: ${raw}`);
    }
    const inner = raw.slice(1, -1);
    return this.processStringEscapes(inner);
  }

  processStringEscapes(s) {
    let result = '';
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\') {
        i++;
        const esc = s[i];
        switch (esc) {
          case '"':  result += '"';  break;
          case '\\': result += '\\'; break;
          case 'n':  result += '\n'; break;
          case 't':  result += '\t'; break;
          case 'r':  result += '\r'; break;
          case 'u': {
            const hex = s.slice(i + 1, i + 5);
            if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
              throw this.err(`E04: Invalid \\u escape: "\\u${hex || '(end)'}"`);
            }
            result += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            throw this.err(`E04: Invalid escape sequence "\\${esc ?? '(end)'}"`);
        }
      } else if (ch === '"') {
        // Unescaped quote inside string (shouldn't happen if outer parse is correct)
        throw this.err(`E04: Unescaped double-quote inside string`);
      } else {
        result += ch;
      }
      i++;
    }
    return result;
  }

  // ── Number parsing ───────────────────────────

  parseNumber(str) {
    // E05: strict format — no leading zeros, no +, no NaN/Infinity
    if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(str)) {
      throw this.err(`E05: Invalid number format: "${str}"`);
    }
    const n = Number(str);
    if (!isFinite(n)) {
      throw this.err(`E05: Number out of range: "${str}"`);
    }
    return n;
  }

  // ── Inline array ─────────────────────────────

  parseInlineArray(str) {
    if (!str.startsWith('[') || !str.endsWith(']')) {
      throw this.err(`Malformed inline array: "${str}"`);
    }
    const inner = str.slice(1, -1).trim();
    if (inner === '') return [];

    // Check for trailing | (E10) — before pipe syntax check
    if (inner.endsWith(' |') || inner.endsWith('\t|')) {
      throw this.err('E10: Trailing "|" in inline array');
    }

    // Check for missing spaces around | (E09)
    this.checkPipeSyntax(inner, 'inline array');

    const parts = this.splitByPipe(inner);
    return parts.map(p => {
      const val = this.parseValue(p.trim());
      // E11: no objects or arrays as elements
      if (val !== null && typeof val === 'object') {
        throw this.err('E11: Inline array elements must be scalar (string, number, boolean, null)');
      }
      return val;
    });
  }

  // ── Inline object ────────────────────────────

  parseInlineObject(str) {
    if (!str.startsWith('{') || !str.endsWith('}')) {
      throw this.err(`Malformed inline object: "${str}"`);
    }
    const inner = str.slice(1, -1).trim();
    if (inner === '') return {};

    // Check for trailing | (E10) — before pipe syntax check
    if (inner.endsWith(' |') || inner.endsWith('\t|')) {
      throw this.err('E10: Trailing "|" in inline object');
    }

    // Check for missing spaces around | (E09)
    this.checkPipeSyntax(inner, 'inline object');

    // Check for trailing | (E10)
    if (inner.trimEnd().endsWith(' |')) {
      throw this.err('E10: Trailing "|" in inline object');
    }

    const parts = this.splitByPipe(inner);
    const obj = {};

    for (const part of parts) {
      const m = part.trim().match(/^([A-Za-z0-9_][A-Za-z0-9_-]*) -> (.+)$/);
      if (!m) {
        throw this.err(`Invalid field in inline object: "${part.trim()}"`);
      }
      const [, k, valStr] = m;

      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        throw this.err(`E01: Duplicate key "${k}" in inline object`);
      }

      // E12: no nested inline objects
      if (valStr.trim().startsWith('{')) {
        throw this.err(`E12: Nested inline objects are not permitted`);
      }

      // E11: only scalars in inline object values
      const val = this.parseValue(valStr.trim());
      if (val !== null && typeof val === 'object') {
        throw this.err('E11: Inline object values must be scalar');
      }

      obj[k] = val;
    }

    return obj;
  }

  // ── Pipe-split utility ────────────────────────

  /**
   * Split a string by " | " (space-pipe-space), respecting quoted strings.
   */
  splitByPipe(str) {
    const parts = [];
    let current = '';
    let inString = false;
    let i = 0;

    while (i < str.length) {
      const ch = str[i];

      if (ch === '"' && !inString) {
        inString = true;
        current += ch;
      } else if (ch === '"' && inString) {
        // Check if escaped
        let backslashes = 0;
        let j = current.length - 1;
        while (j >= 0 && current[j] === '\\') { backslashes++; j--; }
        if (backslashes % 2 === 0) inString = false;
        current += ch;
      } else if (!inString && ch === ' ' && str[i + 1] === '|' && str[i + 2] === ' ') {
        parts.push(current);
        current = '';
        i += 3; // skip " | "
        continue;
      } else {
        current += ch;
      }
      i++;
    }

    if (current.trim() !== '') parts.push(current);
    return parts;
  }

  checkPipeSyntax(inner, context) {
    // Detect "|" not surrounded by spaces (outside of strings)
    let inStr = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"' && !inStr) { inStr = true; continue; }
      if (ch === '"' && inStr) { inStr = false; continue; }
      if (!inStr && ch === '|') {
        const before = inner[i - 1];
        const after  = inner[i + 1];
        if (before !== ' ' || after !== ' ') {
          throw this.err(`E09: "|" in ${context} must be surrounded by single spaces`);
        }
      }
    }
  }

  checkNoInlineComment(valueStr) {
    // Quick check: if a # appears outside of a string, it's E07
    let inStr = false;
    for (let i = 0; i < valueStr.length; i++) {
      const ch = valueStr[i];
      if (ch === '"' && !inStr) { inStr = true; continue; }
      if (ch === '"' && inStr)  { inStr = false; continue; }
      if (!inStr && ch === '#') {
        throw this.err('E07: Inline comments are not permitted');
      }
    }
  }

  // ── Error helper ─────────────────────────────

  err(msg) {
    return new SASParseError(msg, this.lineNum);
  }
}

// ── Convenience function ─────────────────────

function parseSAS(source) {
  return new SASParser(source).parse();
}

module.exports = { SASParser, SASParseError, parseSAS };
