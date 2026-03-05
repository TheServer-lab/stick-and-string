'use strict';

// ─────────────────────────────────────────────
//  SAS → JSON Converter
// ─────────────────────────────────────────────

const { parseSAS, SASParseError } = require('./sas-parser');

/**
 * Parse a SAS 1.1 document and return a JSON string.
 *
 * @param {string} sasSource  - Raw SAS document text
 * @param {object} options
 * @param {number} options.indent  - JSON indentation spaces (default: 2). Use 0 for compact.
 * @param {boolean} options.stripVersion  - Remove __sas_version__ key from output (default: true)
 * @returns {string}  Pretty-printed JSON
 */
function sasToJSON(sasSource, options = {}) {
  const { indent = 2, stripVersion = true } = options;

  const obj = parseSAS(sasSource);

  if (stripVersion && Object.prototype.hasOwnProperty.call(obj, '__sas_version__')) {
    delete obj['__sas_version__'];
  }

  return JSON.stringify(obj, null, indent);
}

/**
 * Parse a SAS 1.1 document and return a plain JS object.
 */
function sasToObject(sasSource) {
  return parseSAS(sasSource);
}

module.exports = { sasToJSON, sasToObject, SASParseError };
