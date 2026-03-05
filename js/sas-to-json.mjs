import { parseSAS, SASParseError } from './sas-parser.mjs';

function sasToJSON(sasSource, options = {}) {
  const { indent = 2, stripVersion = true } = options;
  const obj = parseSAS(sasSource);
  if (stripVersion && Object.prototype.hasOwnProperty.call(obj, '__sas_version__')) delete obj['__sas_version__'];
  return JSON.stringify(obj, null, indent);
}

function sasToObject(sasSource) { return parseSAS(sasSource); }

export { sasToJSON, sasToObject, SASParseError };
