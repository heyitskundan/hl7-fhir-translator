#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatDetection, HELP_TEXT, runTranslation } from "./cli-core.js";
import { inspectInput } from "./inspect.js";

function readInput(inPath: string | undefined): string {
  const fd = inPath ?? 0; // 0 = stdin
  return readFileSync(fd, "utf8");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      in: { type: "string", short: "i" },
      out: { type: "string", short: "o" },
      direction: { type: "string", short: "d" },
      json: { type: "boolean" },
      detect: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const input = readInput(values.in);

  if (values.detect) {
    process.stdout.write(formatDetection(inspectInput(input)) + "\n");
    return;
  }

  const { output, result } = runTranslation(input, { direction: values.direction, json: values.json });

  if (values.out) {
    writeFileSync(values.out, output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }

  for (const warning of result.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
