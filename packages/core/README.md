# hl7-fhir-translator

Deterministic HL7v2 ⇄ FHIR R4 translation for Node.js and the browser. A hand-written
parser and explicit, bidirectional mapping tables compute every field — every output
value traces back to a specific HL7v2 field or FHIR path through a testable mapping
table, and translation is a pure function of the string you pass in.

Try it without installing anything: [heyitskundan.github.io/hl7-fhir-translator](https://heyitskundan.github.io/hl7-fhir-translator/).

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [How to use it](#how-to-use-it) — step by step, both directions
- [Auto-detecting what you're translating](#auto-detecting-what-youre-translating)
- [Supported message types](#supported-message-types)
- [API reference](#api-reference) — every exported function, type, and error
- [CLI reference](#cli-reference)
- [Errors](#errors)
- [Contributing / running from source](#contributing--running-from-source)

## Requirements

- **Node.js 18+** if running server-side or via the CLI. Any modern browser if bundled
  into a frontend (Vite, Next.js, CRA, webpack — anything that resolves ESM).
- **Zero runtime dependencies** — the parser, mapper, and CLI arg parsing are hand-written
  or built on Node's own `node:fs`/`node:util`.
- **TypeScript is optional.** Plain JavaScript works identically; TypeScript users get
  full type definitions for both the ESM and CommonJS builds.
- Ships as **both an ESM and a CommonJS package** — see [Install](#install).

## Install

```bash
npm install hl7-fhir-translator
```

Both module systems work out of the box, same API either way:

```js
// ESM — Node with "type": "module" in package.json, .mjs files, or any bundler (React/Vite/Next.js)
import { translateHl7ToFhir } from "hl7-fhir-translator";

// CommonJS — plain require(), no config needed
const { translateHl7ToFhir } = require("hl7-fhir-translator");
```

## How to use it

### 1. Translate HL7v2 → FHIR

```ts
import { translateHl7ToFhir } from "hl7-fhir-translator";

const hl7 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r"); // segments are CR-, LF-, or CRLF-separated — all three work

const result = translateHl7ToFhir(hl7);

result.translated; // FHIR R4 Bundle, as a pretty-printed JSON string
result.mappings; // [{ source: "PID-3", target: "Patient.identifier[0].value", value: "MRN12345", note: "..." }, ...]
result.warnings; // segments/fields in the input with no FHIR mapping, e.g. ["NK1 segment has no FHIR mapping..."]

const bundle = JSON.parse(result.translated);
```

### 2. Translate FHIR → HL7v2

```ts
import { translateFhirToHl7 } from "hl7-fhir-translator";

// A bare resource is accepted and auto-wrapped in a Bundle
const patientJson = JSON.stringify({
  resourceType: "Patient",
  name: [{ family: "Doe", given: ["John"] }],
  gender: "male",
  birthDate: "1980-05-15",
});

const result = translateFhirToHl7(patientJson);
result.translated; // "MSH|^~\&|FHIR-TRANSLATOR|...\rPID|1||...\r..."
```

A `Bundle` with multiple resources also works — pass the whole `Bundle` JSON, and the
target HL7v2 message type is picked automatically from which resource types are present
(see the next section).

### 3. Handle errors

Both functions throw a typed error on invalid input — see [Errors](#errors) for the full
pattern.

### 4. Round-tripping

```ts
const forward = translateHl7ToFhir(hl7);
const back = translateFhirToHl7(forward.translated);
// back.translated is a semantically equivalent HL7v2 message (see docs/MAPPING.md
// for exactly which fields round-trip and which are synthesized, e.g. MSH-10's
// control ID is freshly generated each time)
```

## Auto-detecting what you're translating

`inspectInput()` identifies not just whether input is HL7v2 or FHIR, but the _specific_
message type or resource kind — synchronously, safe to call on every keystroke in a UI:

```ts
import { inspectInput } from "hl7-fhir-translator";

inspectInput(hl7Message);
// { direction: "hl7ToFhir",
//   detail: { kind: "hl7", messageType: "ADT^A01", category: "ADT", trigger: "A01",
//              supported: true, description: "Patient admission" } }

inspectInput(fhirBundleJson);
// { direction: "fhirToHl7",
//   detail: { kind: "fhir", resourceTypes: ["Patient", "Encounter"],
//              targetMessageType: "ADT^A01", supported: true } }

inspectInput("something else entirely");
// { direction: "unknown", detail: { kind: "unknown", reason: "Input doesn't start with MSH or {" } }
```

Use this to build a "here's what I detected" preview before committing to a translation,
to check a message type is supported before you attempt to translate it, or to route
input to the right handler in a pipeline. Full shape in [API reference](#api-reference).

## Supported message types

| HL7v2                  | FHIR                                 | Direction |
| ---------------------- | ------------------------------------ | --------- |
| `ADT^A01` (admission)  | `Patient` + `Encounter`              | both      |
| `ADT^A08` (update)     | `Patient` + `Encounter`              | both      |
| `ORU^R01` (lab result) | `DiagnosticReport` + `Observation[]` | both      |
| `ORM^O01` (order)      | `ServiceRequest`                     | both      |

This list is also available at runtime as `SUPPORTED_MESSAGE_TYPES` (see below) so you can
check support programmatically instead of hardcoding it. An unsupported message type
raises `FhirValidationError` with the specific type it couldn't handle; an unmapped
segment within an otherwise-supported message is reported in `warnings[]`. Codes are
carried through using LOINC (lab/order codes), HL7 v2-0203 (identifier type), HL7 v3
ActCode (encounter class), and HL7 v3 ObservationInterpretation (abnormal flags). Full
field-by-field detail is in [`docs/MAPPING.md`](../../docs/MAPPING.md).

## API reference

Every symbol below is exported from the package root
(`import { X } from "hl7-fhir-translator"`) — this is the complete list.

### Translation

#### `translateHl7ToFhir(rawHl7: string): TranslationResult`

Parses a raw HL7v2 message and returns a FHIR R4 `Bundle` as a pretty-printed JSON string,
keyed off `MSH-9` to select the mapper.

Throws `Hl7ParseError` for malformed HL7 (bad/missing MSH delimiters, empty message) and
`FhirValidationError` for a well-formed but unsupported or incomplete message (unsupported
message type, missing a required segment like `PID`).

#### `translateFhirToHl7(rawFhirJson: string): TranslationResult`

Parses a FHIR R4 resource or `Bundle` (JSON string) and returns an HL7v2 message string. A
bare resource is accepted and wrapped in a `Bundle` automatically. The target HL7v2
message type is inferred from which resource types are present: `ServiceRequest` →
`ORM^O01`, `DiagnosticReport` → `ORU^R01`, otherwise `Patient` → `ADT^A01`.

Throws `FhirValidationError` for invalid JSON or a bundle missing the resource type needed
to determine the target message.

#### `inspectInput(input: string): DetectionResult`

See [Auto-detecting what you're translating](#auto-detecting-what-youre-translating).
Always returns a result, never throws.

### Result and detection types

```ts
interface Mapping {
  source: string; // e.g. "PID-3" (hl7ToFhir) or "Patient.identifier[0].value" (fhirToHl7)
  target: string;
  value: string;
  note?: string;
}

interface TranslationResult {
  translated: string; // FHIR JSON (a Bundle) or an HL7v2 message string, depending on direction
  mappings: Mapping[]; // one entry per field actually translated
  warnings: string[]; // segments/fields present in the input with no mapping
}

type TranslationDirection = "hl7ToFhir" | "fhirToHl7";

interface DetectionResult {
  direction: TranslationDirection | "unknown";
  detail: DetectedHl7 | DetectedFhir | DetectedUnknown;
}

interface DetectedHl7 {
  kind: "hl7";
  messageType: string; // e.g. "ADT^A01"
  category: string; // e.g. "ADT"
  trigger: string; // e.g. "A01"
  supported: boolean;
  description?: string; // from SUPPORTED_MESSAGE_TYPES, when supported
}

interface DetectedFhir {
  kind: "fhir";
  resourceTypes: string[]; // every resourceType found; a bare resource yields a 1-element array
  targetMessageType?: string; // e.g. "ADT^A01", when determinable
  supported: boolean;
}

interface DetectedUnknown {
  kind: "unknown";
  reason: string;
}
```

### Supported-type registry

#### `SUPPORTED_MESSAGE_TYPES: SupportedMessageType[]`

```ts
interface SupportedMessageType {
  category: string; // e.g. "ADT"
  trigger: string; // e.g. "A01"
  description: string; // e.g. "Patient admission"
}
```

The runtime source of truth backing the [Supported message types](#supported-message-types)
table — check `SUPPORTED_MESSAGE_TYPES.some(t => t.category === "ADT" && t.trigger === "A01")`
instead of hardcoding support in your own code.

### Lower-level HL7v2 parsing

Exported for inspecting a message's structure directly — the translation functions above
are built on exactly these:

```ts
import { parseHl7Message, findSegment, getField, getComponent } from "hl7-fhir-translator";

const message = parseHl7Message(hl7);
const pid = findSegment(message, "PID");
getField(pid, 7); // "19800515"  (PID-7, whole field)
getComponent(pid, 5, 1); // "Doe"       (PID-5, 1st component)
```

| Export                | Signature                                                                          | What it does                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `parseHl7Message`     | `(text: string) => Hl7Message`                                                     | Parses raw HL7v2 text (CR/LF/CRLF-separated segments) into a structured message. Throws `Hl7ParseError` on malformed input. |
| `serializeHl7Message` | `(message: Hl7Message) => string`                                                  | Serializes a structured `Hl7Message` back to pipe-delimited wire format.                                                    |
| `findSegment`         | `(message: Hl7Message, id: string) => Hl7Segment \| undefined`                     | First segment with the given 3-letter id (e.g. `"PID"`).                                                                    |
| `findSegments`        | `(message: Hl7Message, id: string) => Hl7Segment[]`                                | All segments with the given id (e.g. every `OBX` in an ORU message).                                                        |
| `getField`            | `(segment: Hl7Segment \| undefined, fieldNumber: number) => string \| undefined`   | Raw value of a 1-indexed HL7 field. `undefined` when empty/absent.                                                          |
| `getComponent`        | `(segment, fieldNumber, componentNumber, repetitionIndex?) => string \| undefined` | Value of one `^`-delimited component within a field. `repetitionIndex` defaults to `0`.                                     |
| `getRepetitions`      | `(segment: Hl7Segment \| undefined, fieldNumber: number) => string[][]`            | All `~`-delimited repetitions of a repeating field, each as its component array.                                            |

```ts
interface Hl7Message {
  segments: Hl7Segment[];
  delimiters: Hl7Delimiters;
  messageType: string; // MSH-9, e.g. "ADT^A01"
}

interface Hl7Segment {
  id: string; // e.g. "PID"
  fields: Hl7Field[]; // 1-indexed by HL7 field number; fields[0] holds the segment id
}

interface Hl7Field {
  raw: string;
  reps: string[][]; // reps[repetitionIndex][componentIndex - 1]
}

interface Hl7Delimiters {
  field: string; // "|"
  component: string; // "^"
  repetition: string; // "~"
  escape: string; // "\"
  subcomponent: string; // "&"
}
```

### FHIR types

Hand-rolled TypeScript types scoped to exactly the fields this package's mapping tables
populate or read — not a runtime value, all exported as `type`. `meta` and
`Identifier`/`HumanName`'s `use` field are part of the standard FHIR shape but aren't
currently read or written by any mapper; they're kept for shape-completeness, not because
this package uses them. Field-by-field detail on what populates each field is in
[`docs/MAPPING.md`](../../docs/MAPPING.md).

```ts
interface Patient {
  resourceType: "Patient";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  name?: HumanName[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: Address[];
}

interface Encounter {
  resourceType: "Encounter";
  id?: string;
  meta?: Meta;
  status: "planned" | "in-progress" | "finished" | "unknown";
  class: Coding;
  subject?: Reference;
  participant?: { individual?: Reference; type?: CodeableConcept[] }[];
  location?: { location: Reference }[];
  period?: Period;
}

interface Observation {
  resourceType: "Observation";
  id?: string;
  meta?: Meta;
  status: "final" | "preliminary" | "amended" | "unknown";
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  valueQuantity?: Quantity;
  valueString?: string;
  referenceRange?: Range[];
  interpretation?: CodeableConcept[];
}

interface DiagnosticReport {
  resourceType: "DiagnosticReport";
  id?: string;
  meta?: Meta;
  status: "final" | "preliminary" | "amended" | "unknown";
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  result?: Reference[]; // references to this report's Observations
}

interface ServiceRequest {
  resourceType: "ServiceRequest";
  id?: string;
  meta?: Meta;
  status: "active" | "completed" | "revoked" | "unknown";
  intent: "order" | "plan" | "proposal";
  code: CodeableConcept;
  subject?: Reference;
  requester?: Reference;
  authoredOn?: string;
  occurrenceDateTime?: string;
}

type FhirResource = Patient | Encounter | Observation | DiagnosticReport | ServiceRequest;

interface BundleEntry {
  fullUrl?: string;
  resource: FhirResource;
}

interface Bundle {
  resourceType: "Bundle";
  type: "collection" | "message";
  entry: BundleEntry[];
}

// Component types used above:
interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

interface Identifier {
  use?: string;
  type?: CodeableConcept;
  system?: string;
  value?: string;
  assigner?: { display?: string };
}

interface HumanName {
  use?: string;
  family?: string;
  given?: string[];
}

interface Address {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

interface Reference {
  reference?: string;
  display?: string;
}

interface Period {
  start?: string;
  end?: string;
}

interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

interface Range {
  low?: { value?: number; unit?: string };
  high?: { value?: number; unit?: string };
}

interface Meta {
  profile?: string[];
}
```

### Errors

| Export                | Extends | Adds                                                    |
| --------------------- | ------- | ------------------------------------------------------- |
| `Hl7ParseError`       | `Error` | `context?: string` — the offending line, when available |
| `FhirValidationError` | `Error` | `context?: string`                                      |

See [Errors](#errors) below for the recommended catch pattern.

## CLI reference

Installing the package also installs a `hl7-fhir-translator` binary:

```bash
npx hl7-fhir-translator -i message.hl7                     # -> FHIR JSON on stdout
npx hl7-fhir-translator -i patient.json -d fhirToHl7        # -> HL7v2 on stdout
cat message.hl7 | npx hl7-fhir-translator --json            # direction auto-detected; full result incl. mappings/warnings
npx hl7-fhir-translator -i message.hl7 -o bundle.json        # write to a file instead of stdout
npx hl7-fhir-translator -i message.hl7 --detect              # print the detected type only
npx hl7-fhir-translator --help
```

| Flag                | Short | Meaning                                                                                  |
| ------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `--in <file>`       | `-i`  | Input file. Reads stdin if omitted.                                                      |
| `--out <file>`      | `-o`  | Output file. Writes stdout if omitted.                                                   |
| `--direction <dir>` | `-d`  | `"hl7ToFhir"` or `"fhirToHl7"`. Auto-detected from the input shape if omitted.           |
| `--json`            |       | Print the full `{ translated, mappings, warnings }` result instead of just `translated`. |
| `--detect`          |       | Print a one-line detection summary (via `inspectInput`) and exit.                        |
| `--help`            | `-h`  | Show usage.                                                                              |

Direction is auto-detected from the input shape (`MSH` prefix vs. JSON) unless you pass
`-d/--direction` explicitly. Warnings go to stderr so piped stdout stays clean; a
parse/validation failure exits with status 1 and prints one line to stderr.

## Errors

Both `Hl7ParseError` and `FhirValidationError` extend `Error` and add an optional
`context` string (the offending line/segment, when available):

```ts
import { translateHl7ToFhir, Hl7ParseError, FhirValidationError } from "hl7-fhir-translator";

try {
  translateHl7ToFhir(input);
} catch (err) {
  if (err instanceof Hl7ParseError || err instanceof FhirValidationError) {
    console.error(err.message, err.context);
  } else {
    throw err;
  }
}
```

`Hl7ParseError` means the input isn't structurally valid HL7v2 (bad/missing MSH
delimiters, empty message, unparseable segments). `FhirValidationError` means the input
parsed fine but represents an unsupported message type or is missing a required
segment/resource.

## Contributing / running from source

```bash
git clone https://github.com/heyitskundan/hl7-fhir-translator.git
cd hl7-fhir-translator
npm install
npm test -w packages/core          # 45 tests: parser, all four mapping directions, detection, CLI
npm run build -w packages/core      # tsup: dual ESM+CJS + type defs + the CLI binary
```

[`docs/MAPPING.md`](../../docs/MAPPING.md) documents the mapping-table convention to
follow when adding a new message type or field. See
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) for how to report a bug, request a feature,
and submit a pull request.

## License

MIT
