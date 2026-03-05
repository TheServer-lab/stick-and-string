// SAS 1.1 Parser — ESM build
// Auto-adapted from sas-parser.js for browser / ES module environments

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
    this.stack = [];
    this.inMultiline = false;
    this.multilineKey = null;
    this.multilineLines = [];
  }

  parse() {
    const root = { type: 'object', key: '__root__', value: {}, isAnon: false };
    this.stack = [root];

    for (let i = 0; i < this.lines.length; i++) {
      this.lineNum = i + 1;
      const raw = this.lines[i];
      if (this.inMultiline) { this.processMultilineLine(raw); continue; }
      this.processLine(raw);
    }

    if (this.inMultiline) throw this.err('E03: Unexpected end of document inside multiline string');
    if (this.stack.length > 1) {
      const top = this.stack[this.stack.length - 1];
      throw new SASParseError(`E03: Unexpected end of document — unclosed block "${top.key}"`, this.lines.length);
    }
    return root.value;
  }

  processLine(raw) {
    const line = raw.trim();
    if (line === '') return;
    if (line.startsWith('#')) return;

    if (line.startsWith(':: ')) {
      const closer = line.slice(3);
      if (!closer) throw this.err('E02: Block closer missing identifier after "::"');
      this.closeBlock(closer); return;
    }
    if (line === '::') throw this.err('E02: Bare "::" not permitted in SAS 1.1; use ":: key" or ":: -"');
    if (line === '- ::') { this.openAnonBlock(); return; }
    if (line.startsWith('- ')) { this.addArrayItem(this.parseValue(line.slice(2))); return; }

    const keyMatch = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*)(.*)/);
    if (!keyMatch) {
      if (/^-[A-Za-z0-9_]/.test(line)) throw this.err(`E13: Key must not begin with "-": "${line.split(' ')[0]}"`);
      throw this.err(`Unexpected token: "${line}"`);
    }
    const key = keyMatch[1], rest = keyMatch[2];
    if (rest === ' ::') { this.openBlock(key); return; }
    if (rest.startsWith(' -> ')) {
      const valueStr = rest.slice(4);
      if (!valueStr) throw this.err(`Missing value for key "${key}"`);
      this.checkNoInlineComment(valueStr);
      if (valueStr === '"""') { this.startMultiline(key); return; }
      this.assignToFrame(key, this.parseValue(valueStr)); return;
    }
    if (rest.includes('->') || line.includes('->')) throw this.err('E08: Missing spaces around "->"; expected " -> "');
    throw this.err(`Unexpected token after key "${key}": "${rest}"`);
  }

  processMultilineLine(raw) {
    if (raw.trimEnd() === '"""') {
      const value = this.multilineLines.length > 0 ? this.multilineLines.join('\n') + '\n' : '';
      this.assignToFrame(this.multilineKey, value);
      this.inMultiline = false; this.multilineKey = null; this.multilineLines = [];
    } else { this.multilineLines.push(raw); }
  }

  startMultiline(key) {
    const frame = this.currentFrame();
    if (frame.type === 'array') throw this.err('E14: Key-value pair inside array block');
    this.checkDuplicateKey(frame, key);
    this.inMultiline = true; this.multilineKey = key; this.multilineLines = [];
  }

  openBlock(key) {
    const parent = this.currentFrame();
    if (parent.type === 'array') throw this.err(`E14: Named block opener "${key} ::" inside array block`);
    this.checkDuplicateKey(parent, key);
    this.stack.push({ type: 'object', key, value: {}, isAnon: false });
  }

  openAnonBlock() {
    const parent = this.currentFrame();
    if (parent.type === 'object' && Object.keys(parent.value).length > 0) throw this.err('E14: Anonymous block "- ::" inside object block (mixed block content)');
    if (parent.type === 'object') { parent.type = 'array'; parent.value = []; }
    if (parent.type !== 'array') throw this.err('E15: Anonymous block opener "- ::" only valid inside array block');
    const obj = {}; parent.value.push(obj);
    this.stack.push({ type: 'object', key: '-', value: obj, isAnon: true });
  }

  closeBlock(closer) {
    if (this.stack.length <= 1) throw this.err(`E02: Unexpected block closer ":: ${closer}" at top level`);
    const frame = this.stack[this.stack.length - 1];
    if (closer === '-') {
      if (!frame.isAnon) throw this.err(`E15: Anonymous closer ":: -" used to close named block "${frame.key}"`);
      this.stack.pop(); return;
    }
    if (frame.key !== closer) throw this.err(`E02: Block closer ":: ${closer}" does not match opener ":: ${frame.key}"`);
    this.stack.pop();
    const parent = this.currentFrame();
    parent.type === 'array' ? parent.value.push(frame.value) : (parent.value[frame.key] = frame.value);
  }

  assignToFrame(key, value) {
    const frame = this.currentFrame();
    if (frame.type === 'array') throw this.err('E14: Key-value pair inside array block');
    this.checkDuplicateKey(frame, key); frame.value[key] = value;
  }

  addArrayItem(value) {
    const frame = this.currentFrame();
    if (frame.type === 'object' && Object.keys(frame.value).length > 0) throw this.err('E14: Array item inside object block (mixed block content)');
    if (frame.type === 'object') { frame.type = 'array'; frame.value = []; }
    frame.value.push(value);
  }

  checkDuplicateKey(frame, key) {
    if (Object.prototype.hasOwnProperty.call(frame.value, key)) throw this.err(`E01: Duplicate key "${key}"`);
  }

  currentFrame() { return this.stack[this.stack.length - 1]; }

  parseValue(raw) {
    const str = raw.trim();
    if (str === 'null') return null;
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (/^(True|TRUE|False|FALSE|Null|NULL)$/.test(str)) throw this.err(`E06: Boolean and null must be lowercase; got "${str}"`);
    if (/^[+-]?(NaN|Infinity|inf)$/i.test(str)) throw this.err('E05: NaN and Infinity are not valid SAS number values');
    if (str.startsWith('+')) throw this.err(`E05: Numbers must not have a leading "+": "${str}"`);
    if (str.startsWith('[')) return this.parseInlineArray(str);
    if (str.startsWith('{')) return this.parseInlineObject(str);
    if (str.startsWith('"')) return this.parseString(str);
    if (/^-?[0-9]/.test(str)) return this.parseNumber(str);
    throw this.err(`Unknown value: "${str}"`);
  }

  parseString(raw) {
    if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) throw this.err(`Malformed string: ${raw}`);
    return this.processStringEscapes(raw.slice(1, -1));
  }

  processStringEscapes(s) {
    let result = '', i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\') {
        i++; const esc = s[i];
        switch (esc) {
          case '"': result += '"'; break; case '\\': result += '\\'; break;
          case 'n': result += '\n'; break; case 't': result += '\t'; break;
          case 'r': result += '\r'; break;
          case 'u': { const hex = s.slice(i+1, i+5); if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw this.err(`E04: Invalid \\u escape: "\\u${hex||'(end)'}"`); result += String.fromCharCode(parseInt(hex, 16)); i += 4; break; }
          default: throw this.err(`E04: Invalid escape sequence "\\${esc??'(end)'}"`);
        }
      } else if (ch === '"') { throw this.err('E04: Unescaped double-quote inside string');
      } else { result += ch; }
      i++;
    }
    return result;
  }

  parseNumber(str) {
    if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(str)) throw this.err(`E05: Invalid number format: "${str}"`);
    const n = Number(str);
    if (!isFinite(n)) throw this.err(`E05: Number out of range: "${str}"`);
    return n;
  }

  parseInlineArray(str) {
    if (!str.startsWith('[') || !str.endsWith(']')) throw this.err(`Malformed inline array: "${str}"`);
    const inner = str.slice(1, -1).trim();
    if (inner === '') return [];
    if (inner.endsWith(' |') || inner.endsWith('\t|')) throw this.err('E10: Trailing "|" in inline array');
    this.checkPipeSyntax(inner, 'inline array');
    return this.splitByPipe(inner).map(p => {
      const val = this.parseValue(p.trim());
      if (val !== null && typeof val === 'object') throw this.err('E11: Inline array elements must be scalar');
      return val;
    });
  }

  parseInlineObject(str) {
    if (!str.startsWith('{') || !str.endsWith('}')) throw this.err(`Malformed inline object: "${str}"`);
    const inner = str.slice(1, -1).trim();
    if (inner === '') return {};
    if (inner.endsWith(' |') || inner.endsWith('\t|')) throw this.err('E10: Trailing "|" in inline object');
    this.checkPipeSyntax(inner, 'inline object');
    const obj = {};
    for (const part of this.splitByPipe(inner)) {
      const m = part.trim().match(/^([A-Za-z0-9_][A-Za-z0-9_-]*) -> (.+)$/);
      if (!m) throw this.err(`Invalid field in inline object: "${part.trim()}"`);
      const [, k, valStr] = m;
      if (Object.prototype.hasOwnProperty.call(obj, k)) throw this.err(`E01: Duplicate key "${k}" in inline object`);
      if (valStr.trim().startsWith('{')) throw this.err('E12: Nested inline objects are not permitted');
      const val = this.parseValue(valStr.trim());
      if (val !== null && typeof val === 'object') throw this.err('E11: Inline object values must be scalar');
      obj[k] = val;
    }
    return obj;
  }

  splitByPipe(str) {
    const parts = []; let current = '', inString = false, i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '"' && !inString) { inString = true; current += ch; }
      else if (ch === '"' && inString) { let bs = 0, j = current.length-1; while(j>=0&&current[j]==='\\'){bs++;j--;} if(bs%2===0)inString=false; current += ch; }
      else if (!inString && ch === ' ' && str[i+1] === '|' && str[i+2] === ' ') { parts.push(current); current = ''; i += 3; continue; }
      else { current += ch; }
      i++;
    }
    if (current.trim() !== '') parts.push(current);
    return parts;
  }

  checkPipeSyntax(inner, context) {
    let inStr = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"' && !inStr) { inStr = true; continue; }
      if (ch === '"' && inStr)  { inStr = false; continue; }
      if (!inStr && ch === '|') { if (inner[i-1] !== ' ' || inner[i+1] !== ' ') throw this.err(`E09: "|" in ${context} must be surrounded by single spaces`); }
    }
  }

  checkNoInlineComment(valueStr) {
    let inStr = false;
    for (const ch of valueStr) {
      if (ch === '"' && !inStr) { inStr = true; continue; }
      if (ch === '"' && inStr)  { inStr = false; continue; }
      if (!inStr && ch === '#') throw this.err('E07: Inline comments are not permitted');
    }
  }

  err(msg) { return new SASParseError(msg, this.lineNum); }
}

function parseSAS(source) { return new SASParser(source).parse(); }

export { SASParser, SASParseError, parseSAS };
export default parseSAS;
