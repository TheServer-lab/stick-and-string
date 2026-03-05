#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────
//  SAS Tools CLI
//
//  Usage:
//    sas parse     <file.sas>           Parse and print JSON
//    sas to-json   <file.sas>           SAS → JSON
//    sas to-sas    <file.json>          JSON → SAS
//    sas validate  <file.sas>           Validate only (exit 0/1)
//    sas roundtrip <file.sas|file.json> Parse → convert back → verify
// ─────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const { parseSAS, SASParseError } = require('./sas-parser');
const { sasToJSON }               = require('./sas-to-json');
const { jsonToSAS, JSONToSASError } = require('./json-to-sas');

const USAGE = `
SAS 1.1 Tools — Parser & Converter

Usage:
  node cli.js <command> <file> [options]

Commands:
  parse     <file.sas>        Parse SAS and output JSON to stdout
  to-json   <file.sas>        Alias for parse
  to-sas    <file.json>       Convert JSON to SAS and output to stdout
  validate  <file.sas>        Validate SAS; exit 0 if valid, 1 if errors
  roundtrip <file>            SAS→JSON→SAS or JSON→SAS→JSON round-trip check

Options:
  --indent <n>                JSON output indentation spaces (default: 2)
  --compact                   JSON output with no indentation
  --no-version                Omit __sas_version__ header in SAS output
  --output <file>             Write output to file instead of stdout

Examples:
  node cli.js to-json config.sas
  node cli.js to-sas  data.json --output data.sas
  node cli.js validate config.sas
  node cli.js roundtrip config.sas
`.trimStart();

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const [command, inputFile, ...rest] = args;

  if (!inputFile) {
    die(`Missing input file for command "${command}"`);
  }

  // Parse flags
  const flags = parseFlags(rest);

  // Load input
  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    die(`File not found: ${inputPath}`);
  }
  const inputText = fs.readFileSync(inputPath, 'utf8');

  switch (command) {
    case 'parse':
    case 'to-json': {
      try {
        const jsonIndent = flags.compact ? 0 : (flags.indent ?? 2);
        const result = sasToJSON(inputText, { indent: jsonIndent });
        output(result, flags.output);
      } catch (e) {
        handleError(e);
      }
      break;
    }

    case 'to-sas': {
      try {
        const result = jsonToSAS(inputText, {
          versionHeader: !flags['no-version'],
        });
        output(result, flags.output);
      } catch (e) {
        handleError(e);
      }
      break;
    }

    case 'validate': {
      try {
        parseSAS(inputText);
        process.stdout.write(`✓  Valid SAS 1.1 document: ${inputFile}\n`);
        process.exit(0);
      } catch (e) {
        if (e instanceof SASParseError) {
          process.stderr.write(`✗  Parse error: ${e.message}\n`);
        } else {
          process.stderr.write(`✗  Error: ${e.message}\n`);
        }
        process.exit(1);
      }
    }

    case 'roundtrip': {
      const ext = path.extname(inputFile).toLowerCase();
      if (ext === '.sas') {
        roundtripSAS(inputText, inputFile);
      } else if (ext === '.json') {
        roundtripJSON(inputText, inputFile);
      } else {
        die(`Roundtrip requires a .sas or .json file`);
      }
      break;
    }

    default:
      die(`Unknown command: "${command}"\n\n${USAGE}`);
  }
}

// ── Roundtrip checks ─────────────────────────

function roundtripSAS(sasText, label) {
  process.stdout.write(`Roundtrip: ${label}  (SAS → JSON → SAS)\n\n`);
  let obj1, json, obj2;

  try {
    obj1 = parseSAS(sasText);
    process.stdout.write(`  ✓ Parse SAS\n`);
  } catch (e) {
    process.stderr.write(`  ✗ Parse SAS failed: ${e.message}\n`);
    process.exit(1);
  }

  try {
    const sasOut = jsonToSAS(obj1, { versionHeader: false });
    obj2 = parseSAS(sasOut);
    process.stdout.write(`  ✓ Re-encode to SAS and re-parse\n`);
  } catch (e) {
    process.stderr.write(`  ✗ Re-encode failed: ${e.message}\n`);
    process.exit(1);
  }

  const j1 = JSON.stringify(obj1, null, 2);
  const j2 = JSON.stringify(obj2, null, 2);

  if (j1 === j2) {
    process.stdout.write(`  ✓ Data preserved exactly\n`);
  } else {
    process.stderr.write(`  ✗ Data mismatch after roundtrip!\n`);
    process.stderr.write(`  Original:  ${j1.slice(0, 200)}\n`);
    process.stderr.write(`  Roundtrip: ${j2.slice(0, 200)}\n`);
    process.exit(1);
  }
  process.stdout.write(`\n✓  Roundtrip OK\n`);
}

function roundtripJSON(jsonText, label) {
  process.stdout.write(`Roundtrip: ${label}  (JSON → SAS → JSON)\n\n`);
  let obj1, sasOut, obj2;

  try {
    obj1 = JSON.parse(jsonText);
    process.stdout.write(`  ✓ Parse JSON\n`);
  } catch (e) {
    process.stderr.write(`  ✗ Parse JSON failed: ${e.message}\n`);
    process.exit(1);
  }

  try {
    sasOut = jsonToSAS(obj1, { versionHeader: false });
    process.stdout.write(`  ✓ Encode to SAS\n`);
  } catch (e) {
    process.stderr.write(`  ✗ Encode to SAS failed: ${e.message}\n`);
    process.exit(1);
  }

  try {
    obj2 = parseSAS(sasOut);
    process.stdout.write(`  ✓ Re-parse SAS\n`);
  } catch (e) {
    process.stderr.write(`  ✗ Re-parse SAS failed: ${e.message}\n`);
    process.stderr.write(`  Generated SAS:\n${sasOut}\n`);
    process.exit(1);
  }

  const j1 = JSON.stringify(obj1, null, 2);
  const j2 = JSON.stringify(obj2, null, 2);

  if (j1 === j2) {
    process.stdout.write(`  ✓ Data preserved exactly\n`);
  } else {
    process.stderr.write(`  ✗ Data mismatch after roundtrip!\n`);
    process.stderr.write(`  Original JSON:  ${j1.slice(0, 200)}\n`);
    process.stderr.write(`  Roundtrip JSON: ${j2.slice(0, 200)}\n`);
    process.exit(1);
  }
  process.stdout.write(`\n✓  Roundtrip OK\n`);
}

// ── Utilities ────────────────────────────────

function parseFlags(args) {
  const flags = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--compact')     { flags.compact = true; }
    else if (arg === '--no-version') { flags['no-version'] = true; }
    else if (arg === '--indent') { flags.indent = parseInt(args[++i], 10); }
    else if (arg === '--output') { flags.output = args[++i]; }
    i++;
  }
  return flags;
}

function output(text, filePath) {
  if (filePath) {
    fs.writeFileSync(path.resolve(filePath), text, 'utf8');
    process.stdout.write(`Written to ${filePath}\n`);
  } else {
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
  }
}

function handleError(e) {
  if (e instanceof SASParseError || e instanceof JSONToSASError) {
    process.stderr.write(`Error: ${e.message}\n`);
  } else {
    process.stderr.write(`Unexpected error: ${e.message}\n`);
    if (process.env.DEBUG) process.stderr.write(e.stack + '\n');
  }
  process.exit(1);
}

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

main();
