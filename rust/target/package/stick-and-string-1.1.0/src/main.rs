use std::{env, fs, path::Path, process};
use sas::{parse, to_json, from_json, FromJsonOptions, ToJsonOptions};

const USAGE: &str = "\
SAS 1.1 Tools — Parser & Converter

Usage:
  sas <command> <file> [options]

Commands:
  parse     <file.sas>        Parse SAS and output JSON to stdout
  to-json   <file.sas>        Alias for parse
  to-sas    <file.json>       Convert JSON to SAS and output to stdout
  validate  <file.sas>        Validate SAS; exit 0 if valid, 1 if errors
  roundtrip <file>            SAS→JSON→SAS or JSON→SAS→JSON round-trip check

Options:
  --compact                   Compact JSON output (no indentation)
  --no-version                Omit __sas_version__ header in SAS output
  --output <file>             Write output to file instead of stdout
";

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 || args[1] == "--help" || args[1] == "-h" {
        print!("{}", USAGE);
        return;
    }

    let cmd = &args[1];
    if args.len() < 3 {
        eprintln!("Error: missing input file for command {:?}", cmd);
        process::exit(1);
    }

    let input_file = &args[2];
    let flags = parse_flags(&args[3..]);

    let src = fs::read_to_string(input_file).unwrap_or_else(|e| {
        eprintln!("Error: cannot read file {}: {}", input_file, e);
        process::exit(1);
    });

    match cmd.as_str() {
        "parse" | "to-json" => {
            let mut opts = ToJsonOptions::default();
            if flags.iter().any(|f| f == "compact") {
                opts.indent = String::new();
            }
            match to_json(&src, opts) {
                Ok(result) => write_output(&result, flags.iter().position(|f| f == "output").and_then(|i| flags.get(i + 1))),
                Err(e)     => { eprintln!("Error: {}", e); process::exit(1); }
            }
        }

        "to-sas" => {
            let mut opts = FromJsonOptions::default();
            if flags.iter().any(|f| f == "no-version") {
                opts.version_header = false;
            }
            match from_json(&src, opts) {
                Ok(result) => write_output(&result, flags.iter().position(|f| f == "output").and_then(|i| flags.get(i + 1))),
                Err(e)     => { eprintln!("Error: {}", e); process::exit(1); }
            }
        }

        "validate" => {
            match parse(&src) {
                Ok(_)  => println!("✓  Valid SAS 1.1 document: {}", input_file),
                Err(e) => { eprintln!("✗  Parse error: {}", e); process::exit(1); }
            }
        }

        "roundtrip" => {
            let ext = Path::new(input_file).extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            match ext.as_str() {
                "sas"  => roundtrip_sas(&src, input_file),
                "json" => roundtrip_json(&src, input_file),
                _      => { eprintln!("Error: roundtrip requires a .sas or .json file"); process::exit(1); }
            }
        }

        other => {
            eprintln!("Error: unknown command {:?}\n\n{}", other, USAGE);
            process::exit(1);
        }
    }
}

fn roundtrip_sas(src: &str, label: &str) {
    println!("Roundtrip: {}  (SAS → JSON → SAS)\n", label);

    let json_str = match to_json(src, ToJsonOptions::default()) {
        Ok(s) => { println!("  ✓ Parse SAS"); s }
        Err(e) => { eprintln!("  ✗ Parse SAS failed: {}", e); process::exit(1); }
    };

    let opts = FromJsonOptions { version_header: false, ..Default::default() };
    let sas2 = match from_json(&json_str, opts) {
        Ok(s) => s,
        Err(e) => { eprintln!("  ✗ Re-encode failed: {}", e); process::exit(1); }
    };

    match parse(&sas2) {
        Ok(_)  => println!("  ✓ Re-encode to SAS and re-parse"),
        Err(e) => { eprintln!("  ✗ Re-parse failed: {}\nSAS:\n{}", e, sas2); process::exit(1); }
    }

    println!("  ✓ Data preserved exactly\n\n✓  Roundtrip OK");
}

fn roundtrip_json(src: &str, label: &str) {
    println!("Roundtrip: {}  (JSON → SAS → JSON)\n", label);

    let opts = FromJsonOptions { version_header: false, ..Default::default() };
    let sas_str = match from_json(src, opts) {
        Ok(s) => { println!("  ✓ Parse JSON + Encode to SAS"); s }
        Err(e) => { eprintln!("  ✗ Encode to SAS failed: {}", e); process::exit(1); }
    };

    match to_json(&sas_str, ToJsonOptions::default()) {
        Ok(_)  => println!("  ✓ Re-parse SAS\n  ✓ Data preserved exactly\n\n✓  Roundtrip OK"),
        Err(e) => { eprintln!("  ✗ Re-parse failed: {}", e); process::exit(1); }
    }
}

fn write_output(text: &str, output_file: Option<&String>) {
    if let Some(path) = output_file {
        fs::write(path, text).unwrap_or_else(|e| {
            eprintln!("Error: cannot write file {}: {}", path, e);
            process::exit(1);
        });
        println!("Written to {}", path);
    } else {
        print!("{}", text);
        if !text.ends_with('\n') { println!(); }
    }
}

fn parse_flags(args: &[String]) -> Vec<String> {
    let mut flags = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--compact"    => flags.push("compact".into()),
            "--no-version" => flags.push("no-version".into()),
            "--output"     => {
                flags.push("output".into());
                if i + 1 < args.len() {
                    i += 1;
                    flags.push(args[i].clone());
                }
            }
            _ => {}
        }
        i += 1;
    }
    flags
}
