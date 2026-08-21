# Contributing

## Reporting a bug

Open an issue on this repository's Issues tab. The fastest way to get a bug fixed is to
include:

- **The input** that triggers it — a real (de-identified/synthetic — never real patient
  data) HL7v2 message or FHIR JSON, and the direction you translated it with.
- **What you expected** vs. **what you got** — the actual `translated`/`mappings`/
  `warnings` output, or the exact error message and `.context` if one was thrown.
- **How you're running it** — package version (`npm ls hl7-fhir-translator`), Node.js
  version, and whether you're using the library API or the CLI.

If the bug is a mapping that looks wrong for a field this package already claims to
support, check [`docs/MAPPING.md`](./docs/MAPPING.md) first — it's the source of truth
for what each field is supposed to map to, and it'll tell you whether the behavior you're
seeing is a bug or the documented (if surprising) intent.

## Requesting a feature

Two common requests have a defined path already:

- **A new message type** (e.g. `SIU^S12`, `VXU^V04`) — see
  [Adding a new message type](./docs/MAPPING.md#adding-a-new-message-type) for the
  pattern to follow. Open an issue naming the message type and, ideally, a real
  (de-identified) sample message before starting work, so the mapping table can be
  reviewed before code is.
- **A field within an already-supported message type** — open an issue naming the
  HL7v2 field and the FHIR path it should map to; include a sample showing the field
  populated.

For anything else, open an issue describing the use case before sending a PR — for a
translation library, agreeing on the target mapping table up front avoids rework.

## Development setup

```bash
git clone https://github.com/heyitskundan/hl7-fhir-translator.git
cd hl7-fhir-translator
npm install
npm test               # 368 tests: 327 in packages/core (parser, all 14 mapping directions,
                        # a docs/code mapping audit, detection, CLI) + 41 in client (UI/demo)
npm run build           # packages/core (dual ESM+CJS via tsup) + client
npm run dev              # browser demo at http://localhost:5173
```

```
packages/core/   the npm package itself — start here for library/CLI changes
client/          browser demo, imports packages/core directly
docs/            field-level mapping specification
samples/         sample HL7v2 messages + a FHIR bundle, shared by tests/CLI/demo
```

## Making a pull request

1. Fork the repo and branch from `main`.
2. Match the existing pattern: each message type is one file in
   `packages/core/src/mapping/` (`adt.ts`, `oru.ts`, `orm.ts`) with an explicit,
   bidirectional field table — no inference or guessing, every field traceable in
   [`docs/MAPPING.md`](./docs/MAPPING.md).
3. Add table-driven tests in `packages/core/test/` following the existing files —
   a mapping change without a test won't be merged.
4. If you touched what fields are mapped, update
   [`docs/MAPPING.md`](./docs/MAPPING.md) in the same PR — it's the spec, not
   incidental documentation, and it should never drift from the code.
5. Run `npm run lint`, `npm run format:check`, `npm test -w packages/core`, and
   `npm run build` before opening the PR.
6. Describe the _why_ in the PR description — what real-world case motivated the
   change, not just what changed.

## Code of conduct

Be direct and be kind. Disagreements about a mapping decision are welcome and should be
resolved with a sample message and a citation to the relevant HL7v2/FHIR field
definition, not opinion.
