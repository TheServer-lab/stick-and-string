"""CLI entry point for sas-tools."""

from __future__ import annotations
import argparse
import json
import os
import sys

from .parser import parse_sas, SASParseError
from .sas_to_json import sas_to_json
from .json_to_sas import json_to_sas, JSONToSASError


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="sas",
        description="SAS 1.1 (Stick And String) Tools — Parser & Converter",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # parse / to-json
    for cmd in ("parse", "to-json"):
        p = sub.add_parser(cmd, help="Parse SAS and output JSON")
        p.add_argument("file", help="Input .sas file")
        p.add_argument("--indent", type=int, default=2, metavar="N")
        p.add_argument("--compact", action="store_true", help="Compact JSON output")
        p.add_argument("--output", "-o", metavar="FILE", help="Write output to file")
        p.add_argument("--no-strip-version", action="store_true")

    # to-sas
    p = sub.add_parser("to-sas", help="Convert JSON to SAS")
    p.add_argument("file", help="Input .json file")
    p.add_argument("--no-version", action="store_true", help="Omit __sas_version__ header")
    p.add_argument("--output", "-o", metavar="FILE", help="Write output to file")

    # validate
    p = sub.add_parser("validate", help="Validate a SAS 1.1 document")
    p.add_argument("file", help="Input .sas file")

    # roundtrip
    p = sub.add_parser("roundtrip", help="Round-trip check for .sas or .json files")
    p.add_argument("file", help="Input .sas or .json file")

    args = parser.parse_args()

    try:
        with open(args.file, encoding="utf-8") as f:
            input_text = f.read()
    except FileNotFoundError:
        print(f"Error: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    cmd = args.command

    if cmd in ("parse", "to-json"):
        try:
            indent = 0 if args.compact else args.indent
            result = sas_to_json(input_text, indent=indent, strip_version=not args.no_strip_version)
            _write(result, getattr(args, "output", None))
        except (SASParseError, JSONToSASError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)

    elif cmd == "to-sas":
        try:
            result = json_to_sas(input_text, version_header=not args.no_version)
            _write(result, getattr(args, "output", None))
        except (SASParseError, JSONToSASError, json.JSONDecodeError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)

    elif cmd == "validate":
        try:
            parse_sas(input_text)
            print(f"✓  Valid SAS 1.1 document: {args.file}")
            sys.exit(0)
        except SASParseError as exc:
            print(f"✗  Parse error: {exc}", file=sys.stderr)
            sys.exit(1)

    elif cmd == "roundtrip":
        ext = os.path.splitext(args.file)[1].lower()
        if ext == ".sas":
            _roundtrip_sas(input_text, args.file)
        elif ext == ".json":
            _roundtrip_json(input_text, args.file)
        else:
            print("Error: Roundtrip requires a .sas or .json file", file=sys.stderr)
            sys.exit(1)


def _write(text: str, file_path: str | None) -> None:
    if file_path:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Written to {file_path}")
    else:
        sys.stdout.write(text)
        if not text.endswith("\n"):
            sys.stdout.write("\n")


def _roundtrip_sas(sas_text: str, label: str) -> None:
    print(f"Roundtrip: {label}  (SAS → JSON → SAS)\n")
    try:
        obj1 = parse_sas(sas_text)
        print("  ✓ Parse SAS")
    except SASParseError as exc:
        print(f"  ✗ Parse SAS failed: {exc}", file=sys.stderr)
        sys.exit(1)
    try:
        sas_out = json_to_sas(obj1, version_header=False)
        obj2 = parse_sas(sas_out)
        print("  ✓ Re-encode to SAS and re-parse")
    except (SASParseError, JSONToSASError) as exc:
        print(f"  ✗ Re-encode failed: {exc}", file=sys.stderr)
        sys.exit(1)
    if json.dumps(obj1, sort_keys=True) == json.dumps(obj2, sort_keys=True):
        print("  ✓ Data preserved exactly\n\n✓  Roundtrip OK")
    else:
        print("  ✗ Data mismatch after roundtrip!", file=sys.stderr)
        sys.exit(1)


def _roundtrip_json(json_text: str, label: str) -> None:
    print(f"Roundtrip: {label}  (JSON → SAS → JSON)\n")
    try:
        obj1 = json.loads(json_text)
        print("  ✓ Parse JSON")
    except json.JSONDecodeError as exc:
        print(f"  ✗ Parse JSON failed: {exc}", file=sys.stderr)
        sys.exit(1)
    try:
        sas_out = json_to_sas(obj1, version_header=False)
        print("  ✓ Encode to SAS")
    except JSONToSASError as exc:
        print(f"  ✗ Encode to SAS failed: {exc}", file=sys.stderr)
        sys.exit(1)
    try:
        obj2 = parse_sas(sas_out)
        print("  ✓ Re-parse SAS")
    except SASParseError as exc:
        print(f"  ✗ Re-parse SAS failed: {exc}", file=sys.stderr)
        sys.exit(1)
    if json.dumps(obj1, sort_keys=True) == json.dumps(obj2, sort_keys=True):
        print("  ✓ Data preserved exactly\n\n✓  Roundtrip OK")
    else:
        print("  ✗ Data mismatch after roundtrip!", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
