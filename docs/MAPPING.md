# HL7v2 ⇄ FHIR R4 Mapping Reference

This is the field-level specification for what [`hl7-fhir-translate`](../packages/core)
actually maps — every HL7v2 field it reads or writes, and exactly which FHIR R4 path it
corresponds to. It exists so a reviewer can audit correctness without reading the
implementation, and so a contributor extending the package has a single source of truth
to update alongside the code. Covers the four message types this package supports.

## Contents

1. [Versions](#1-versions)
2. [Conventions used in this document](#2-conventions-used-in-this-document)
3. [Terminology systems used](#3-terminology-systems-used)
4. [ADT^A01 (admission) and ADT^A08 (update)](#4-adta01-admission-and-adta08-update)
5. [ORU^R01 (unsolicited lab result)](#5-orur01-unsolicited-lab-result)
6. [ORM^O01 (general order)](#6-ormo01-general-order)
7. [Adding a new message type](#7-adding-a-new-message-type)
8. [Detection rules (`inspectInput`)](#8-detection-rules-inspectinput)

## 1. Versions

- **HL7v2**: 2.5 pipe-delimited ER7 messages (segments separated by `\r`, `\n`, or
  `\r\n`; the parser is otherwise HL7v2.x-version-agnostic — it reads delimiters from
  MSH-1/MSH-2 rather than assuming 2.5-specific behavior).
- **FHIR**: R4.

## 2. Conventions used in this document

- `SEGMENT-N` refers to the Nth field of a segment, 1-indexed exactly as in the HL7v2
  spec (e.g. `PID-5` is the 5th field of PID). `SEGMENT-N.C` refers to the Cth component
  of that field (e.g. `PID-5.1` is the family name component of PID-5).
- `Resource.path[i]` refers to a FHIR element using standard FHIRPath-like notation.
- **Deterministic guarantee**: every row in the tables below is implemented as an
  explicit, unit-tested code path. These tables are the complete list of fields this
  package reads or writes.
- **Unmapped input**: a segment or field present in the input but absent from these
  tables is reported in the `warnings[]` array of the result.
- **Errors**: a missing _required_ segment (e.g. no `PID` in any message) or an
  unsupported message type throws `FhirValidationError`; malformed HL7v2 structure
  (bad delimiters, no `MSH`) throws `Hl7ParseError`. Both carry a specific `.message` and
  optional `.context`.

## 3. Terminology systems used

| System                              | URL                                                                  | Used for                                                   |
| ----------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| LOINC                               | `http://loinc.org`                                                   | Lab/order codes (`OBR-4`, `OBX-3`)                         |
| HL7 v2 Table 0203 (Identifier Type) | `http://terminology.hl7.org/CodeSystem/v2-0203`                      | `Patient.identifier[].type`                                |
| HL7 v3 ActCode                      | `http://terminology.hl7.org/CodeSystem/v3-ActCode`                   | `Encounter.class`                                          |
| HL7 v3 ObservationInterpretation    | `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation` | `Observation.interpretation` (abnormal flags)              |
| HL7 v3 ParticipationType            | `http://terminology.hl7.org/CodeSystem/v3-ParticipationType`         | `Encounter.participant[].type` (attending doctor = `ATND`) |

These are the only systems used. Codes are carried through exactly as given in the
source — e.g. a LOINC code found in `OBX-3.1` is copied straight into the output.

---

## 4. ADT^A01 (admission) and ADT^A08 (update)

Both trigger events use the same segment set and mapping — the difference is purely
`MSH-9`'s trigger code and, clinically, what the update represents. The package treats
them identically.

**Segments read**: `MSH`, `EVN`, `PID`, `PV1`
**Resources produced**: `Patient`, `Encounter` (omitted if no `PV1` is present)

### 4.1 Forward: HL7v2 → FHIR

| HL7v2 field | FHIR path                                     | Notes                                                             |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `MSH-9`     | _(routing only)_                              | Selects this mapper; `ADT^A01` and `ADT^A08` both route here      |
| `PID-3.1`   | `Patient.identifier[0].value`                 | Medical record number                                             |
| `PID-3.4`   | `Patient.identifier[0].assigner.display`      | Assigning authority                                               |
| `PID-3.5`   | `Patient.identifier[0].type.coding[0].code`   | Defaults to `MR` if absent                                        |
| `PID-5.1`   | `Patient.name[0].family`                      |                                                                   |
| `PID-5.2`   | `Patient.name[0].given[0]`                    |                                                                   |
| `PID-5.3`   | `Patient.name[0].given[1]`                    | Middle name, appended to `given[]`                                |
| `PID-7`     | `Patient.birthDate`                           | `YYYYMMDD` → `YYYY-MM-DD`                                         |
| `PID-8`     | `Patient.gender`                              | `M`→`male`, `F`→`female`, `O`→`other`, anything else→`unknown`    |
| `PID-11.1`  | `Patient.address[0].line[0]`                  | Street address                                                    |
| `PID-11.3`  | `Patient.address[0].city`                     |                                                                   |
| `PID-11.4`  | `Patient.address[0].state`                    |                                                                   |
| `PID-11.5`  | `Patient.address[0].postalCode`               |                                                                   |
| `PID-11.6`  | `Patient.address[0].country`                  |                                                                   |
| `PV1-2`     | `Encounter.class`                             | `I`→`IMP`, `O`→`AMB`, `E`→`EMER`, else `UNK`; system = v3-ActCode |
| `PV1-3.1`   | `Encounter.location[0].location.display`      | Point of care only (room/bed components not mapped)               |
| `PV1-7.2`   | `Encounter.participant[0].individual.display` | Attending doctor family name                                      |
| `PV1-7.3`   | `Encounter.participant[0].individual.display` | Attending doctor given name (joined as "given family")            |
| `EVN-2`     | `Encounter.period.start`                      | Recorded event date/time                                          |

`Encounter.status` is always set to `in-progress` (this package doesn't attempt to infer
discharge status from ADT^A01/A08 alone). `Encounter.participant[0].type` is always set
to `ATND` (attending) since that's the only doctor field mapped.

### 4.2 Reverse: FHIR → HL7v2

The same table applies in reverse for every row above. Fields with no FHIR-side value are
omitted from the output field entirely (HL7v2 trailing/embedded empty fields), never
padded with placeholder text. Additional synthesized fields, since FHIR has no equivalent:

| HL7v2 field         | Value                                                       | Notes                                                                                                                          |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `MSH-2`             | `^~\&`                                                      | Standard encoding characters                                                                                                   |
| `MSH-3`–`MSH-6`     | `FHIR-TRANSLATOR` / `HL7FHIR` / `HIS` / `HOSP`              | Synthetic sending/receiving application+facility                                                                               |
| `MSH-7`             | Current UTC timestamp                                       | Message creation time                                                                                                          |
| `MSH-9`             | `ADT^A01`                                                   | Trigger is always `A01` when translating from FHIR (no signal in a bare Patient/Encounter to distinguish admission vs. update) |
| `MSH-10`            | Generated control ID (`TRX<timestamp><counter>`)            |                                                                                                                                |
| `MSH-11` / `MSH-12` | `P` / `2.5`                                                 | Processing ID, version ID                                                                                                      |
| `EVN-1`             | `A01`                                                       | Matches `MSH-9`'s trigger                                                                                                      |
| `EVN-2`             | `Encounter.period.start` if present, else current timestamp |                                                                                                                                |

### 4.3 Not mapped

Any segment other than `MSH`/`EVN`/`PID`/`PV1` present in the input (e.g. `NK1`, `PV2`,
`AL1`, `DG1`, `IN1`) is reported in `warnings[]` and otherwise ignored. In the reverse
direction, any FHIR resource in the bundle other than `Patient`/`Encounter` is likewise
warned about and skipped.

### 4.4 Worked example

Input (`samples/adt_a01.hl7`):

```
MSH|^~\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5
EVN|A01|20240101120000
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA
PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD
```

Output (`translateHl7ToFhir` — the complete Bundle, both entries):

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "patient-1",
        "identifier": [
          {
            "value": "MRN12345",
            "assigner": {
              "display": "HOSP"
            },
            "type": {
              "coding": [
                {
                  "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                  "code": "MR"
                }
              ]
            }
          }
        ],
        "name": [
          {
            "family": "Doe",
            "given": ["John", "A"]
          }
        ],
        "birthDate": "1980-05-15",
        "gender": "male",
        "address": [
          {
            "line": ["123 Main St"],
            "city": "Springfield",
            "state": "IL",
            "postalCode": "62701",
            "country": "USA"
          }
        ]
      }
    },
    {
      "resource": {
        "resourceType": "Encounter",
        "id": "encounter-1",
        "status": "in-progress",
        "class": {
          "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
          "code": "IMP",
          "display": "inpatient encounter"
        },
        "subject": {
          "reference": "Patient/patient-1",
          "display": "Doe"
        },
        "location": [
          {
            "location": {
              "display": "ICU"
            }
          }
        ],
        "participant": [
          {
            "individual": {
              "display": "Jane Smith"
            },
            "type": [
              {
                "coding": [
                  {
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                    "code": "ATND",
                    "display": "attender"
                  }
                ]
              }
            ]
          }
        ],
        "period": {
          "start": "2024-01-01T12:00:00Z"
        }
      }
    }
  ]
}
```

---

## 5. ORU^R01 (unsolicited lab result)

**Segments read**: `MSH`, `PID`, `OBR` (one panel), `OBX` (one or more results)
**Resources produced**: `Patient`, `DiagnosticReport`, one `Observation` per `OBX`

### 5.1 Forward: HL7v2 → FHIR

PID mapping is identical to §4.1. Panel- and result-level fields:

| HL7v2 field       | FHIR path                                                                        | Notes                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBR-4.1`         | `DiagnosticReport.code.coding[0].code`                                           | System = LOINC                                                                                                                                      |
| `OBR-4.2`         | `DiagnosticReport.code.coding[0].display` and `.text`                            | Panel name, e.g. "CBC"                                                                                                                              |
| `OBR-7`           | `DiagnosticReport.effectiveDateTime`                                             | Observation/collection date-time                                                                                                                    |
| `OBX-1`           | `Observation[i].id` suffix                                                       | Set ID, used to generate a stable `observation-<n>` id                                                                                              |
| `OBX-3.1`         | `Observation[i].code.coding[0].code`                                             | System = LOINC; **required** — an `OBX` missing `OBX-3` is skipped with a warning, not defaulted                                                    |
| `OBX-3.2`         | `Observation[i].code.coding[0].display` and `.text`                              |                                                                                                                                                     |
| `OBX-2` + `OBX-5` | `Observation[i].valueQuantity` (if `OBX-2` = `NM`) or `.valueString` (otherwise) | Numeric values are parsed with `Number()`                                                                                                           |
| `OBX-6`           | `Observation[i].valueQuantity.unit`                                              | Only set alongside `valueQuantity`                                                                                                                  |
| `OBX-7`           | `Observation[i].referenceRange[0]`                                               | Parsed from a `"low-high"` numeric string, e.g. `"13.5-17.5"` → `{ low: {value: 13.5}, high: {value: 17.5} }`; non-numeric ranges are left unmapped |
| `OBX-8`           | `Observation[i].interpretation[0].coding[0].code`                                | System = v3-ObservationInterpretation                                                                                                               |
| `OBX-14`          | `Observation[i].effectiveDateTime`                                               |                                                                                                                                                     |

`DiagnosticReport.status` and each `Observation.status` are always `final` (this package
doesn't map `OBR-25`/`OBX-11` result-status codes to FHIR's fuller status vocabulary).
`DiagnosticReport.result[]` is populated with a `Reference` to every `Observation`
produced from the message, in `OBX` order.

### 5.2 Reverse: FHIR → HL7v2

Symmetrical to §5.1: `DiagnosticReport.code` → `OBR-4` (LOINC system component hardcoded
to `LN` on the way out), `effectiveDateTime` → `OBR-7`; each `Observation` becomes one
`OBX` segment, numbered sequentially from 1 regardless of the source `Observation.id`.
`OBX-11` (result status) is always written as `F` (final). MSH/PID synthesis follows the
same rules as §4.2, with `MSH-9` fixed to `ORU^R01`.

### 5.3 Not mapped

Any segment other than `MSH`/`PID`/`OBR`/`OBX` is warned about and skipped. A message with
zero `OBX` segments throws `FhirValidationError` rather than producing an empty report —
an ORU with no results is treated as malformed input, not a valid empty translation.

### 5.4 Worked example

Input (`samples/oru_r01.hl7`) has two `OBX` results (Hemoglobin, Hematocrit); output is a
4-entry Bundle: `Patient`, `DiagnosticReport` (referencing both), and two `Observation`
resources. Full input/output pair is in [`samples/oru_r01.hl7`](../samples/oru_r01.hl7) —
translate it yourself with `npx hl7-fhir-translate -i samples/oru_r01.hl7` to see the
complete JSON; abbreviated, the first Observation is:

```json
{
  "resourceType": "Observation",
  "id": "observation-1",
  "status": "final",
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "718-7",
        "display": "Hemoglobin"
      }
    ],
    "text": "Hemoglobin"
  },
  "subject": {
    "reference": "Patient/patient-1"
  },
  "valueQuantity": {
    "value": 14.5,
    "unit": "g/dL"
  },
  "referenceRange": [
    {
      "low": {
        "value": 13.5
      },
      "high": {
        "value": 17.5
      }
    }
  ],
  "interpretation": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
          "code": "N",
          "display": "Normal"
        }
      ]
    }
  ],
  "effectiveDateTime": "2024-01-01T13:00:00Z"
}
```

---

## 6. ORM^O01 (general order)

**Segments read**: `MSH`, `PID`, `ORC`, `OBR`
**Resources produced**: `Patient`, `ServiceRequest`

### 6.1 Forward: HL7v2 → FHIR

PID mapping is identical to §4.1.

| HL7v2 field             | FHIR path                                           | Notes                                                                                    |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ORC-1`                 | `ServiceRequest.status`                             | `NW`→`active`, `CA`→`revoked`, `CM`→`completed`; else `active`                           |
| `ORC-9`                 | `ServiceRequest.authoredOn`                         | Date/time of transaction                                                                 |
| `ORC-12.2` / `ORC-12.3` | `ServiceRequest.requester.display`                  | Ordering provider family/given name; falls back to `OBR-16.2`/`.3` if `ORC-12` is absent |
| `OBR-4.1`               | `ServiceRequest.code.coding[0].code`                | System = LOINC                                                                           |
| `OBR-4.2`               | `ServiceRequest.code.coding[0].display` and `.text` |                                                                                          |
| `OBR-7`                 | `ServiceRequest.occurrenceDateTime`                 | Requested date/time                                                                      |

`ServiceRequest.intent` is always `order`.

### 6.2 Reverse: FHIR → HL7v2

Symmetrical to §6.1. `ServiceRequest.status` → `ORC-1` via the inverse of the table above
(`active`→`NW`, `revoked`→`CA`, `completed`→`CM`, else `NW`). A placer order number is
synthesized (`ORD<last 6 digits of the generated control ID>`) and written to both
`ORC-2` and `OBR-2` so the two segments stay linked, matching how the forward direction
expects them. `MSH-9` is fixed to `ORM^O01`.

### 6.3 Not mapped

Any segment other than `MSH`/`PID`/`ORC`/`OBR` is warned about and skipped.

### 6.4 Worked example

Input (`samples/orm_o01.hl7`) produces a 2-entry Bundle:

```json
{
  "resourceType": "ServiceRequest",
  "id": "servicerequest-1",
  "status": "active",
  "intent": "order",
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "85025",
        "display": "CBC"
      }
    ],
    "text": "CBC"
  },
  "subject": {
    "reference": "Patient/patient-1"
  },
  "authoredOn": "2024-01-01T11:00:00Z",
  "occurrenceDateTime": "2024-01-01T11:00:00Z",
  "requester": {
    "display": "Jane Smith"
  }
}
```

---

## 7. Adding a new message type

The mapping tables above are implemented, one file per message type, in
[`packages/core/src/mapping/`](../packages/core/src/mapping) (`adt.ts`, `oru.ts`,
`orm.ts`), sharing PID↔Patient logic from `buildPatientFromPid`/`buildPidFieldsFromPatient`
in `adt.ts` and shared helpers (date/code lookups) in `common.ts`. `registry.ts` routes
`MSH-9` (forward) or resource-type presence (reverse) to the right mapper. To add a
message type: write its forward/reverse functions following that pattern, register it in
`registry.ts` and `SUPPORTED_MESSAGE_TYPES`, add its section to this document, and add
table-driven tests in `packages/core/test/` following the existing files.

---

## 8. Detection rules (`inspectInput`)

`inspectInput(input)` (implemented in
[`packages/core/src/inspect.ts`](../packages/core/src/inspect.ts)) identifies what a
piece of input is — direction, and the specific HL7v2 message type or FHIR resource
kind — without translating it and without throwing. It's the same shape-detection logic
the CLI's direction auto-detection and the browser demo's live "Detected: …" badge both
use, exposed as a first-class API rather than duplicated. Full API shape is documented in
[`packages/core/README.md`](../packages/core/README.md#auto-detecting-what-youre-translating);
this section documents the exact rules it applies, since those rules directly determine
which mapper handles a given input.

### 8.1 Direction: HL7v2 vs. FHIR vs. unknown

Applied to the input after trimming leading/trailing whitespace, in this order:

1. Starts with `MSH` → treated as HL7v2. `direction: "hl7ToFhir"`.
2. Otherwise starts with `{` → treated as FHIR JSON. `direction: "fhirToHl7"`.
3. Otherwise → `direction: "unknown"`. This is the only case where detection cannot even
   guess a direction — pass `direction` explicitly to `translateHl7ToFhir`/
   `translateFhirToHl7` yourself (they don't need direction as an argument since each is
   direction-specific; this case only affects the CLI's `-d/--direction` requirement and
   `inspectInput`'s own return value).

This is a shape check, not a validity check — step 1 doesn't require the rest of the
message to parse correctly; step 2 doesn't require the JSON to be well-formed.

### 8.2 HL7v2 message type

Once direction is `hl7ToFhir`, `inspectInput` attempts a full `parseHl7Message` (the same
parser translation uses):

- **Parse succeeds** → reads `MSH-9`, splits it into `category^trigger` (e.g. `ADT`/`A01`),
  and checks the pair against `SUPPORTED_MESSAGE_TYPES` (§4-6 above). Result:
  `{ kind: "hl7", messageType, category, trigger, supported, description }` —
  `description` is only present when `supported` is `true`.
- **Parse fails** (bad/missing MSH delimiters, empty message — anything that would throw
  `Hl7ParseError` from `translateHl7ToFhir`) → `{ kind: "unknown", reason }` with the
  parser's own error message as `reason`. Direction is still reported as `"hl7ToFhir"`
  since the shape check in §8.1 already committed to that; only the _specific type_ is
  unknown.

Note that `supported: false` is a valid, non-error result — it means "this parses as a
real HL7v2 message, but no mapper in this package handles `category^trigger` yet" (e.g.
`ADT^A03`, discharge — not one of the two ADT triggers this package maps). That's the
signal a caller should use to short-circuit before calling `translateHl7ToFhir` and
hitting its `FhirValidationError` instead.

### 8.3 FHIR resource kind

Once direction is `fhirToHl7`:

- Invalid JSON → `{ kind: "unknown", reason: "Input is not valid JSON" }`.
- Valid JSON with no `resourceType` property → `{ kind: "unknown", reason: 'JSON has no "resourceType"' }`.
- Valid JSON with a `resourceType`:
  - If `resourceType === "Bundle"`, `resourceTypes` is every `entry[].resource.resourceType`
    found, in entry order (missing/malformed entries are skipped, not errored).
  - Otherwise, `resourceTypes` is a single-element array holding the bare resource's own
    `resourceType` — matching how `translateFhirToHl7` auto-wraps a bare resource into a
    one-entry `Bundle` before translating.
  - `targetMessageType` is computed by the same rule `fhirToHl7ByResourceType` uses to
    pick a mapper (checked in this priority order, first match wins): `ServiceRequest`
    present → `ORM^O01`; else `DiagnosticReport` present → `ORU^R01`; else `Patient`
    present → `ADT^A01`. `supported` is `true` iff one of those matched.

As with HL7 detection, `supported: false` (e.g. `resourceTypes: ["Practitioner"]`, which
matches none of the three rules) is the signal to check _before_ calling
`translateFhirToHl7`, which would otherwise throw `FhirValidationError` on the same input.
