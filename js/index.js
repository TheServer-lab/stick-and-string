'use strict';

const { SASParser, SASParseError, parseSAS } = require('./sas-parser');
const { sasToJSON, sasToObject }              = require('./sas-to-json');
const { jsonToSAS, JSONToSASError }           = require('./json-to-sas');

module.exports = {
  // Parser
  SASParser,
  SASParseError,
  parseSAS,
  // SAS → JSON
  sasToJSON,
  sasToObject,
  // JSON → SAS
  jsonToSAS,
  JSONToSASError,
};
