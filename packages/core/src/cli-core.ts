import { inspectInput, type DetectionResult } from "./inspect.js";
import { translateFhirToHl7, translateHl7ToFhir } from "./translate.js";
import type { TranslationDirection, TranslationResult } from "./types.js";

/** Options for `runTranslation`, mirroring the CLI's `--direction`/`--json` flags. */
export interface CliRunOptions {
  direction?: string;
  json?: boolean;
}

/** Guesses direction from the input's shape: HL7v2 messages start with MSH, FHIR input is JSON. */
export function detectDirection(input: string): TranslationDirection {
  const { direction } = inspectInput(input);
  if (direction === "unknown") {
    throw new Error(
      "Could not auto-detect translation direction from the input. Pass --direction hl7ToFhir or --direction fhirToHl7 explicitly.",
    );
  }
  return direction;
}

/** Validates an explicit `--direction` value, or falls back to `detectDirection` when none was given. */
export function resolveDirection(input: string, requested: string | undefined): TranslationDirection {
  if (requested === undefined) return detectDirection(input);
  if (requested !== "hl7ToFhir" && requested !== "fhirToHl7") {
    throw new Error(`--direction must be "hl7ToFhir" or "fhirToHl7", got "${requested}"`);
  }
  return requested;
}

/** Pure translation logic shared by the CLI entrypoint and its tests — no filesystem/stdin/stdout I/O. */
export function runTranslation(input: string, options: CliRunOptions): { output: string; result: TranslationResult } {
  const direction = resolveDirection(input, options.direction);
  const result = direction === "hl7ToFhir" ? translateHl7ToFhir(input) : translateFhirToHl7(input);

  if (!options.json) {
    return { output: result.translated, result };
  }

  // For hl7ToFhir, `translated` is itself a JSON string — parse it back into an object so
  // --json nests real JSON instead of an escaped string blob. fhirToHl7's `translated` is
  // an HL7v2 message string and stays as-is either way.
  const display = direction === "hl7ToFhir" ? { ...result, translated: JSON.parse(result.translated) } : result;
  return { output: JSON.stringify(display, null, 2), result };
}

/** Renders inspectInput's result as the one-line summary the CLI's --detect flag prints. */
export function formatDetection({ direction, detail }: DetectionResult): string {
  if (detail.kind === "unknown") {
    return `unknown (direction: ${direction}) — ${detail.reason}`;
  }
  if (detail.kind === "hl7") {
    const support = detail.supported ? "supported" : "NOT supported";
    const desc = detail.description ? ` (${detail.description})` : "";
    return `hl7ToFhir — HL7v2 ${detail.messageType}${desc}, ${support}`;
  }
  const support = detail.supported ? `supported, would produce ${detail.targetMessageType}` : "NOT supported";
  return `fhirToHl7 — FHIR [${detail.resourceTypes.join(", ")}], ${support}`;
}

/** The text printed by `hl7-fhir-translate --help`. */
export const HELP_TEXT = `hl7-fhir-translate — deterministic HL7v2 <-> FHIR R4 translation

Usage:
  hl7-fhir-translate [options]                Read from stdin, write to stdout
  hl7-fhir-translate -i in.hl7 -o out.json     Read from/write to files

Options:
  -i, --in <file>          Input file (defaults to stdin)
  -o, --out <file>         Output file (defaults to stdout)
  -d, --direction <dir>    "hl7ToFhir" or "fhirToHl7" (auto-detected from input if omitted)
      --json                Print the full result ({ translated, mappings, warnings }) instead of just the translated output
      --detect               Print what would be detected (direction + specific message/resource type) and exit, without translating
  -h, --help                Show this help text

Examples:
  hl7-fhir-translate -i samples/adt_a01.hl7
  hl7-fhir-translate -i samples/patient.fhir.json -d fhirToHl7
  hl7-fhir-translate -i samples/oru_r01.hl7 --detect
  cat samples/oru_r01.hl7 | hl7-fhir-translate --json
`;
