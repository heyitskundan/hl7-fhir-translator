# hl7-fhir-translator

Monorepo for **`hl7-fhir-translate`**, an installable npm package that deterministically
translates HL7v2 messages to FHIR R4 (and back) with a field-level mapping trail — plus a
browser demo of it.

Translation runs through a hand-written HL7v2 parser and explicit bidirectional mapping
tables: same input always produces the same output, every output value traces back to a
specific HL7v2 field or FHIR path, and the whole thing is unit-tested. It's a pure
function with zero runtime dependencies — install it and call it, nothing else happens.

**Live demo + docs:** [heyitskundan.github.io/hl7-fhir-translator](https://heyitskundan.github.io/hl7-fhir-translator/)

## Packages

| Path                                   | What it is                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/core`](./packages/core)     | **The published package.** `npm install hl7-fhir-translate` — library API + CLI. Start here.                                            |
| [`client`](./client)                   | A React/Vite browser demo of the package. Runs entirely client-side — see [`client/README.md`](./client/README.md).                     |
| [`docs/MAPPING.md`](./docs/MAPPING.md) | Field-by-field mapping reference: every HL7v2 field this package reads/writes and exactly which FHIR path it maps to, per message type. |
| [`samples/`](./samples)                | Sample HL7v2 messages and a FHIR bundle used by the tests, CLI examples, and demo.                                                      |

## Supported message types

| HL7v2                  | FHIR                                 | Direction |
| ---------------------- | ------------------------------------ | --------- |
| `ADT^A01` (admission)  | `Patient` + `Encounter`              | both      |
| `ADT^A08` (update)     | `Patient` + `Encounter`              | both      |
| `ORU^R01` (lab result) | `DiagnosticReport` + `Observation[]` | both      |
| `ORM^O01` (order)      | `ServiceRequest`                     | both      |

Full field-level detail is in [`docs/MAPPING.md`](./docs/MAPPING.md).

## Using the package

```bash
npm install hl7-fhir-translate
```

```ts
import { translateHl7ToFhir, inspectInput } from "hl7-fhir-translate";

inspectInput(rawHl7Message); // { direction: "hl7ToFhir", detail: { kind: "hl7", messageType: "ADT^A01", ... } }

const result = translateHl7ToFhir(rawHl7Message);
result.translated; // FHIR Bundle, JSON string
result.mappings; // field-level trail
result.warnings; // anything in the input with no mapping
```

Works from `require()` and `import` alike (dual CJS+ESM build), in Node.js and in the
browser. See [`packages/core/README.md`](./packages/core/README.md) for the full API
reference (including `inspectInput` — auto-detects not just direction but the specific
message/resource type), error types, and CLI usage (`npx hl7-fhir-translate -i message.hl7`).

## Working on this repo

Requires Node.js 18+.

```bash
git clone https://github.com/heyitskundan/hl7-fhir-translator.git
cd hl7-fhir-translator
npm install
npm test               # 45 tests: parser, all four message-type mappings (both directions), detection, CLI
npm run build           # builds packages/core, then client
npm run dev              # runs the browser demo at http://localhost:5173
```

```
packages/core/   the npm package: parser, serializer, mapping tables, CLI, tests
client/          browser demo (imports packages/core directly, no backend)
docs/            field-level mapping specification
samples/         sample HL7v2 messages + a FHIR bundle, shared by tests/CLI/demo
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to report a bug, request a new
message type or field, and submit a pull request. Found a security issue? See
[`SECURITY.md`](./SECURITY.md) — report it privately, not as a public issue.

## License

MIT — see [LICENSE](./LICENSE).
