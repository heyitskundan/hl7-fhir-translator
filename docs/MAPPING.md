# HL7v2 ⇄ FHIR R4 Mapping Reference

This is the field-level specification for what [`hl7-fhir-translator`](../packages/core)
actually maps — every HL7v2 field it reads or writes, and exactly which FHIR R4 path it
corresponds to. It exists so a reviewer can audit correctness without reading the
implementation, and so a contributor extending the package has a single source of truth
to update alongside the code. Covers the 14 message types this package supports.

## Contents

Headings below are stable — they carry no leading section number, so inserting a new
message type never requires renumbering anything else in this document or in
`packages/core/test/mapping-audit.test.ts`, which matches sections by heading text alone.

- [Versions](#versions)
- [Conventions used in this document](#conventions-used-in-this-document)
- [Terminology systems used](#terminology-systems-used)
- [ADT^A01, A02, A05, A06, A08, A09, A11](#adta01-a02-a05-a06-a08-a09-a11-admission-transfer-pre-admit-class-change-update-departure-tracking-cancel-admit)
- [ADT^A17 (swap patients)](#adta17-swap-patients)
- [ORU^R01 (unsolicited lab result)](#orur01-unsolicited-lab-result)
- [ORM^O01 (general order)](#ormo01-general-order)
- [VXU^V04 (immunization record update)](#vxuv04-immunization-record-update)
- [SIU^S12 (appointment scheduling)](#sius12-appointment-scheduling)
- [OML^O21 (laboratory order)](#omlo21-laboratory-order)
- [MDM^T02 (document management)](#mdmt02-document-management)
- [Adding a new message type](#adding-a-new-message-type)
- [Detection rules (`inspectInput`)](#detection-rules-inspectinput)

## Versions

- **HL7v2**: 2.5 pipe-delimited ER7 messages (segments separated by `\r`, `\n`, or
  `\r\n`; the parser is otherwise HL7v2.x-version-agnostic — it reads delimiters from
  MSH-1/MSH-2 rather than assuming 2.5-specific behavior).
- **FHIR**: R4.

## Conventions used in this document

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

## Terminology systems used

| System                               | URL                                                                  | Used for                                                   |
| ------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| LOINC                                | `http://loinc.org`                                                   | Lab/order codes (`OBR-4`, `OBX-3`)                         |
| HL7 v2 Table 0203 (Identifier Type)  | `http://terminology.hl7.org/CodeSystem/v2-0203`                      | `Patient.identifier[].type`                                |
| HL7 v3 ActCode                       | `http://terminology.hl7.org/CodeSystem/v3-ActCode`                   | `Encounter.class`                                          |
| HL7 v3 ObservationInterpretation     | `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation` | `Observation.interpretation` (abnormal flags)              |
| HL7 v3 ParticipationType             | `http://terminology.hl7.org/CodeSystem/v3-ParticipationType`         | `Encounter.participant[].type` (attending doctor = `ATND`) |
| CVX (vaccine codes)                  | `http://hl7.org/fhir/sid/cvx`                                        | `Immunization.vaccineCode` (`RXA-5`)                       |
| HL7 v2 Table 0276 (Appointment Type) | `http://terminology.hl7.org/CodeSystem/v2-0276`                      | `Appointment.appointmentType` (`SCH-8`)                    |
| HL7 v2 Table 0487 (Specimen Type)    | `http://terminology.hl7.org/CodeSystem/v2-0487`                      | `Specimen.type` (`SPM-4`)                                  |
| LOINC (document type)                | `http://loinc.org`                                                   | `DocumentReference.type` (`TXA-2`)                         |

These are the only systems used. Codes are carried through exactly as given in the
source — e.g. a LOINC code found in `OBX-3.1` is copied straight into the output.

---

## ADT^A01, A02, A05, A06, A08, A09, A11 (admission, transfer, pre-admit, class change, update, departure tracking, cancel admit)

All seven of these trigger events use the same segment set and field mapping — the
difference is purely `MSH-9`'s trigger code and, for three of them, `Encounter.status`
(see below). `ADT^A17` (swap patients) is different enough structurally — two patients
per message instead of one — that it gets its own subsection further down.

**A note on where these trigger-specific rules come from**: the official v2-to-FHIR IG
(hl7.org/fhir/uv/v2mappings)'s ADT mapping pages map segments to FHIR resource _types_
(`PV1` → `Encounter`) the same way regardless of trigger — they specify no per-trigger
`Encounter.status` rule (checked directly against the IG's `ADT_A02` and `ADT_A11` pages).
The status choices below are this package's own interpretation of the HL7v2 spec's
trigger-event semantics, not something the IG mandates.

**Segments read**: `MSH`, `EVN`, `PID`, `PV1`
**Resources produced**: `Patient`, `Encounter` (omitted if no `PV1` is present)

### Forward: HL7v2 → FHIR

| HL7v2 field | FHIR path                                     | Notes                                                                                 |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MSH-9`     | _(routing only)_                              | Selects this mapper; any of `ADT^A01`/`A02`/`A05`/`A06`/`A08`/`A09`/`A11` routes here |
| `PID-3.1`   | `Patient.identifier[0].value`                 | Medical record number                                                                 |
| `PID-3.4`   | `Patient.identifier[0].assigner.display`      | Assigning authority                                                                   |
| `PID-3.5`   | `Patient.identifier[0].type.coding[0].code`   | Defaults to `MR` if absent                                                            |
| `PID-5.1`   | `Patient.name[0].family`                      |                                                                                       |
| `PID-5.2`   | `Patient.name[0].given[0]`                    |                                                                                       |
| `PID-5.3`   | `Patient.name[0].given[1]`                    | Middle name, appended to `given[]`                                                    |
| `PID-7`     | `Patient.birthDate`                           | `YYYYMMDD` → `YYYY-MM-DD`                                                             |
| `PID-8`     | `Patient.gender`                              | `M`→`male`, `F`→`female`, `O`→`other`, anything else→`unknown`                        |
| `PID-11.1`  | `Patient.address[0].line[0]`                  | Street address                                                                        |
| `PID-11.3`  | `Patient.address[0].city`                     |                                                                                       |
| `PID-11.4`  | `Patient.address[0].state`                    |                                                                                       |
| `PID-11.5`  | `Patient.address[0].postalCode`               |                                                                                       |
| `PID-11.6`  | `Patient.address[0].country`                  |                                                                                       |
| `PV1-2`     | `Encounter.class`                             | `I`→`IMP`, `O`→`AMB`, `E`→`EMER`, else `UNK`; system = v3-ActCode                     |
| `PV1-3.1`   | `Encounter.location[0].location.display`      | Point of care only (room/bed components not mapped)                                   |
| `PV1-7.2`   | `Encounter.participant[0].individual.display` | Attending doctor family name                                                          |
| `PV1-7.3`   | `Encounter.participant[0].individual.display` | Attending doctor given name (joined as "given family")                                |
| `EVN-2`     | `Encounter.period.start`                      | Recorded event date/time                                                              |

`Encounter.status` is derived from `MSH-9`'s trigger:

| Trigger                                           | `Encounter.status` | Why                                                                                                                                                                  |
| ------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A05`                                             | `planned`          | Pre-admit — the admission hasn't happened yet                                                                                                                        |
| `A11`                                             | `entered-in-error` | Cancel admit — the admit message itself was sent in error and should be disregarded                                                                                  |
| anything else (`A01`, `A02`, `A06`, `A08`, `A09`) | `in-progress`      | HL7v2 doesn't encode a distinct Encounter-level state for a transfer, a class change, or a departure-tracking event beyond what `PV1` already maps (location, class) |

This package doesn't attempt to infer discharge status from any of these triggers alone.
`Encounter.participant[0].type` is always set to `ATND` (attending) since that's the only
doctor field mapped.

### Reverse: FHIR → HL7v2

| FHIR path                                     | HL7v2 field           | Notes                                                                                                  |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `Patient.identifier[0].value`                 | `PID-3.1`             |                                                                                                        |
| `Patient.identifier[0].assigner.display`      | `PID-3.4`             |                                                                                                        |
| `Patient.identifier[0].type.coding[0].code`   | `PID-3.5`             | Defaults to `MR` if absent                                                                             |
| `Patient.name[0].family`                      | `PID-5.1`             |                                                                                                        |
| `Patient.name[0].given[0]`                    | `PID-5.2`             |                                                                                                        |
| `Patient.name[0].given[1]`                    | `PID-5.3`             | Written back as the middle name component                                                              |
| `Patient.birthDate`                           | `PID-7`               | `YYYY-MM-DD` → `YYYYMMDD`                                                                              |
| `Patient.gender`                              | `PID-8`               | `male`→`M`, `female`→`F`, `other`→`O`, anything else→`U`                                               |
| `Patient.address[0].line[0]`                  | `PID-11.1`            |                                                                                                        |
| `Patient.address[0].city`                     | `PID-11.3`            |                                                                                                        |
| `Patient.address[0].state`                    | `PID-11.4`            |                                                                                                        |
| `Patient.address[0].postalCode`               | `PID-11.5`            |                                                                                                        |
| `Patient.address[0].country`                  | `PID-11.6`            |                                                                                                        |
| `Encounter.class`                             | `PV1-2`               | Inverse of the forward table: `IMP`→`I`, `AMB`→`O`, `EMER`→`E`, else `I`                               |
| `Encounter.location[0].location.display`      | `PV1-3.1`             |                                                                                                        |
| `Encounter.participant[0].individual.display` | `PV1-7.2` / `PV1-7.3` | Split on the first space: everything after it → `PV1-7.2` (family), the first word → `PV1-7.3` (given) |
| `Encounter.period.start`                      | `EVN-2`               | Falls back to the current UTC timestamp if absent                                                      |

A field with no FHIR-side value is omitted from the output entirely (HL7v2
trailing/embedded empty fields), never padded with placeholder text. Additional
synthesized fields, since FHIR has no equivalent:

| HL7v2 field         | Value                                                       | Notes                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSH-2`             | `^~\&`                                                      | Standard encoding characters                                                                                                                                                                                   |
| `MSH-3`–`MSH-6`     | `FHIR-TRANSLATOR` / `HL7FHIR` / `HIS` / `HOSP`              | Synthetic sending/receiving application+facility                                                                                                                                                               |
| `MSH-7`             | Current UTC timestamp                                       | Message creation time                                                                                                                                                                                          |
| `MSH-9`             | `ADT^A01`, `A05`, or `A11`                                  | Inverse of the forward table's status row: `planned`→`A05`, `entered-in-error`→`A11`, anything else→`A01` (no signal in a bare Patient/Encounter to distinguish `A01`/`A02`/`A06`/`A08`/`A09` from each other) |
| `MSH-10`            | Generated control ID (`TRX<timestamp><counter>`)            |                                                                                                                                                                                                                |
| `MSH-11` / `MSH-12` | `P` / `2.5`                                                 | Processing ID, version ID                                                                                                                                                                                      |
| `EVN-1`             | Same trigger as `MSH-9`                                     | e.g. `A05` if `Encounter.status` was `planned`                                                                                                                                                                 |
| `EVN-2`             | `Encounter.period.start` if present, else current timestamp |                                                                                                                                                                                                                |

### Not mapped

Any segment other than `MSH`/`EVN`/`PID`/`PV1` present in the input (e.g. `NK1`, `PV2`,
`AL1`, `DG1`, `IN1`) is reported in `warnings[]` and otherwise ignored. In the reverse
direction, any FHIR resource in the bundle other than `Patient`/`Encounter` is likewise
warned about and skipped.

### Worked example

Sample messages for every trigger are in `samples/` (`adt_a01.hl7`, `adt_a02.hl7`,
`adt_a05.hl7`, `adt_a06.hl7`, `adt_a08.hl7`, `adt_a09.hl7`, `adt_a11.hl7`) — they differ
only in `MSH-9`/`EVN-1`'s trigger code and, for `A05`/`A11`, the resulting
`Encounter.status`. The full worked example below uses `A01`; translate any of the others
yourself with `npx hl7-fhir-translator -i samples/adt_a05.hl7` to see the `planned` status,
or `adt_a11.hl7` for `entered-in-error`.

Input (`samples/adt_a01.hl7`):

```hl7
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

## ADT^A17 (swap patients)

`A17` is structurally different from every other ADT trigger above: HL7v2 uses it to
report two patients swapping locations/beds in a single message, so it carries **two**
`PID`/`PV1` groups instead of one. The IG's own mapping pages don't call this cardinality
out (they describe segment-to-resource-type mapping generically), so this section — and
the two-group parsing itself — is this package's own reading of the HL7v2 spec's `A17`
definition.

**Segments read**: `MSH`, `EVN`, two `PID`/`PV1` pairs
**Resources produced**: two `Patient`+`Encounter` pairs (`patient-1`/`encounter-1`,
`patient-2`/`encounter-2`)

### Forward: HL7v2 → FHIR

Each `PID`/`PV1` pair maps through the exact same fields as `A01` above, applied twice —
once per pair, in message order (the field-by-field notes are identical to the `A01` table
two sections up, so aren't repeated here in full):

| HL7v2 field | FHIR path                                     | Notes                                   |
| ----------- | --------------------------------------------- | --------------------------------------- |
| `PID-3.1`   | `Patient.identifier[0].value`                 | Medical record number, per patient      |
| `PID-5.1`   | `Patient.name[0].family`                      | Per patient                             |
| `PID-5.2`   | `Patient.name[0].given[0]`                    | Per patient                             |
| `PID-7`     | `Patient.birthDate`                           | Per patient                             |
| `PID-8`     | `Patient.gender`                              | Per patient                             |
| `PID-11.1`  | `Patient.address[0].line[0]`                  | Per patient                             |
| `PV1-2`     | `Encounter.class`                             | Per patient's own `PV1`                 |
| `PV1-3.1`   | `Encounter.location[0].location.display`      | Per patient's own `PV1`                 |
| `PV1-7.2`   | `Encounter.participant[0].individual.display` | Per patient's own `PV1`                 |
| `EVN-2`     | `Encounter.period.start`                      | Shared — one `EVN` covers both patients |

`Encounter.status` is always `in-progress` for both (a swap isn't an admission, discharge,
or cancellation event). A message with fewer than two `PID` segments throws
`FhirValidationError` rather than falling back to the single-patient path.

### Reverse: FHIR → HL7v2

Given a bundle with two or more `Patient` resources, this package writes one `PID`/`PV1`
pair per `Patient`, in bundle order. Each `Encounter` is matched to its `Patient` via
`Encounter.subject.reference` (e.g. `"Patient/patient-1"`) — a `Patient` with no matching
`Encounter` still gets a `PID`, but no `PV1`, and a warning. `MSH-9`/`EVN-1` are always
written as `A17` when two or more `Patient` resources are present; this is also how the
reverse router (`registry.ts`) distinguishes an `A17` bundle from a single-patient `A01`
one — resource-type presence alone can't (both bundles contain `Patient` and `Encounter`),
so routing here specifically counts `Patient` occurrences rather than just checking
presence.

### Not mapped

Same as `A01` above — any segment other than `MSH`/`EVN`/`PID`/`PV1` is warned about and
skipped; any FHIR resource other than `Patient`/`Encounter` is likewise warned about and
skipped on the reverse direction.

### Worked example

Input (`samples/adt_a17.hl7`):

```hl7
MSH|^~\&|HIS|HOSP|ADT|HOSP|20240112143000||ADT^A17|MSG019|P|2.5
EVN|A17|20240112143000
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA
PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD
PID|2||MRN67890^^^HOSP^MR||Roe^Richard^B||19750822|M|||789 Elm St^^Springfield^IL^62701^USA
PV1|2|I|ICU^102^B^^^HOSP||||5678^Nguyen^Anh^^MD
```

Output (`translateHl7ToFhir` — a 4-entry Bundle: `Patient`, `Encounter`, `Patient`,
`Encounter`, one pair per patient in the swap):

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    { "resource": { "resourceType": "Patient", "id": "patient-1", "name": [{ "family": "Doe", "given": ["John", "A"] }] } },
    {
      "resource": {
        "resourceType": "Encounter",
        "id": "encounter-1",
        "status": "in-progress",
        "class": { "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP", "display": "inpatient encounter" },
        "subject": { "reference": "Patient/patient-1", "display": "Doe" },
        "location": [{ "location": { "display": "ICU" } }]
      }
    },
    { "resource": { "resourceType": "Patient", "id": "patient-2", "name": [{ "family": "Roe", "given": ["Richard", "B"] }] } },
    {
      "resource": {
        "resourceType": "Encounter",
        "id": "encounter-2",
        "status": "in-progress",
        "class": { "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "IMP", "display": "inpatient encounter" },
        "subject": { "reference": "Patient/patient-2", "display": "Roe" },
        "location": [{ "location": { "display": "ICU" } }]
      }
    }
  ]
}
```

---

## ORU^R01 (unsolicited lab result)

**Segments read**: `MSH`, `PID`, `OBR` (one panel), `OBX` (one or more results)
**Resources produced**: `Patient`, `DiagnosticReport`, one `Observation` per `OBX`

### Forward: HL7v2 → FHIR

| HL7v2 field | FHIR path                                   | Notes                                                          |
| ----------- | ------------------------------------------- | -------------------------------------------------------------- |
| `PID-3.1`   | `Patient.identifier[0].value`               | Medical record number                                          |
| `PID-3.4`   | `Patient.identifier[0].assigner.display`    | Assigning authority                                            |
| `PID-3.5`   | `Patient.identifier[0].type.coding[0].code` | Defaults to `MR` if absent                                     |
| `PID-5.1`   | `Patient.name[0].family`                    |                                                                |
| `PID-5.2`   | `Patient.name[0].given[0]`                  |                                                                |
| `PID-5.3`   | `Patient.name[0].given[1]`                  | Middle name, appended to `given[]`                             |
| `PID-7`     | `Patient.birthDate`                         | `YYYYMMDD` → `YYYY-MM-DD`                                      |
| `PID-8`     | `Patient.gender`                            | `M`→`male`, `F`→`female`, `O`→`other`, anything else→`unknown` |
| `PID-11.1`  | `Patient.address[0].line[0]`                | Street address                                                 |
| `PID-11.3`  | `Patient.address[0].city`                   |                                                                |
| `PID-11.4`  | `Patient.address[0].state`                  |                                                                |
| `PID-11.5`  | `Patient.address[0].postalCode`             |                                                                |
| `PID-11.6`  | `Patient.address[0].country`                |                                                                |

Panel- and result-level fields:

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

### Reverse: FHIR → HL7v2

| FHIR path                                   | HL7v2 field | Notes                                                    |
| ------------------------------------------- | ----------- | -------------------------------------------------------- |
| `Patient.identifier[0].value`               | `PID-3.1`   |                                                          |
| `Patient.identifier[0].assigner.display`    | `PID-3.4`   |                                                          |
| `Patient.identifier[0].type.coding[0].code` | `PID-3.5`   | Defaults to `MR` if absent                               |
| `Patient.name[0].family`                    | `PID-5.1`   |                                                          |
| `Patient.name[0].given[0]`                  | `PID-5.2`   |                                                          |
| `Patient.name[0].given[1]`                  | `PID-5.3`   | Written back as the middle name component                |
| `Patient.birthDate`                         | `PID-7`     | `YYYY-MM-DD` → `YYYYMMDD`                                |
| `Patient.gender`                            | `PID-8`     | `male`→`M`, `female`→`F`, `other`→`O`, anything else→`U` |
| `Patient.address[0].line[0]`                | `PID-11.1`  |                                                          |
| `Patient.address[0].city`                   | `PID-11.3`  |                                                          |
| `Patient.address[0].state`                  | `PID-11.4`  |                                                          |
| `Patient.address[0].postalCode`             | `PID-11.5`  |                                                          |
| `Patient.address[0].country`                | `PID-11.6`  |                                                          |

Panel- and result-level fields:

| FHIR path                                         | HL7v2 field | Notes                                                                                            |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `DiagnosticReport.code.coding[0].code`            | `OBR-4.1`   | System component is hardcoded to `LN` on the way out (LOINC)                                     |
| `DiagnosticReport.code.coding[0].display`         | `OBR-4.2`   |                                                                                                  |
| `DiagnosticReport.effectiveDateTime`              | `OBR-7`     |                                                                                                  |
| _(loop index)_                                    | `OBX-1`     | Written sequentially from 1 for each `Observation`, regardless of the source `Observation.id`    |
| `Observation[i].code.coding[0].code`              | `OBX-3.1`   | System component hardcoded to `LN`                                                               |
| `Observation[i].code.coding[0].display`           | `OBX-3.2`   |                                                                                                  |
| `Observation[i].valueQuantity.value`              | `OBX-5`     | Also sets `OBX-2` to `NM`                                                                        |
| `Observation[i].valueQuantity.unit`               | `OBX-6`     | Only written alongside `valueQuantity`                                                           |
| `Observation[i].valueString`                      | `OBX-5`     | Used only when `valueQuantity` is absent; sets `OBX-2` to `ST` instead                           |
| `Observation[i].referenceRange[0]`                | `OBX-7`     | Written back as `"low-high"`, e.g. `{ low: {value: 13.5}, high: {value: 17.5} }` → `"13.5-17.5"` |
| `Observation[i].interpretation[0].coding[0].code` | `OBX-8`     |                                                                                                  |
| `Observation[i].effectiveDateTime`                | `OBX-14`    |                                                                                                  |
| _(constant)_                                      | `OBX-11`    | Always written as `F` (final) — this package doesn't track any other result status               |

`MSH` carries no FHIR-side source — every field is synthesized:

| HL7v2 field         | Value                                            | Notes                                            |
| ------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `MSH-2`             | `^~\&`                                           | Standard encoding characters                     |
| `MSH-3`–`MSH-6`     | `FHIR-TRANSLATOR` / `HL7FHIR` / `HIS` / `HOSP`   | Synthetic sending/receiving application+facility |
| `MSH-7`             | Current UTC timestamp                            | Message creation time                            |
| `MSH-9`             | `ORU^R01`                                        |                                                  |
| `MSH-10`            | Generated control ID (`TRX<timestamp><counter>`) |                                                  |
| `MSH-11` / `MSH-12` | `P` / `2.5`                                      | Processing ID, version ID                        |

### Not mapped

Any segment other than `MSH`/`PID`/`OBR`/`OBX` is warned about and skipped. A message with
zero `OBX` segments throws `FhirValidationError` rather than producing an empty report —
an ORU with no results is treated as malformed input, not a valid empty translation.

### Worked example

Input (`samples/oru_r01.hl7`) has two `OBX` results (Hemoglobin, Hematocrit); output is a
4-entry Bundle: `Patient`, `DiagnosticReport` (referencing both), and two `Observation`
resources. Full input/output pair is in [`samples/oru_r01.hl7`](../samples/oru_r01.hl7) —
translate it yourself with `npx hl7-fhir-translator -i samples/oru_r01.hl7` to see the
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

## ORM^O01 (general order)

**Segments read**: `MSH`, `PID`, `ORC`, `OBR`
**Resources produced**: `Patient`, `ServiceRequest`

### Forward: HL7v2 → FHIR

| HL7v2 field | FHIR path                                   | Notes                                                          |
| ----------- | ------------------------------------------- | -------------------------------------------------------------- |
| `PID-3.1`   | `Patient.identifier[0].value`               | Medical record number                                          |
| `PID-3.4`   | `Patient.identifier[0].assigner.display`    | Assigning authority                                            |
| `PID-3.5`   | `Patient.identifier[0].type.coding[0].code` | Defaults to `MR` if absent                                     |
| `PID-5.1`   | `Patient.name[0].family`                    |                                                                |
| `PID-5.2`   | `Patient.name[0].given[0]`                  |                                                                |
| `PID-5.3`   | `Patient.name[0].given[1]`                  | Middle name, appended to `given[]`                             |
| `PID-7`     | `Patient.birthDate`                         | `YYYYMMDD` → `YYYY-MM-DD`                                      |
| `PID-8`     | `Patient.gender`                            | `M`→`male`, `F`→`female`, `O`→`other`, anything else→`unknown` |
| `PID-11.1`  | `Patient.address[0].line[0]`                | Street address                                                 |
| `PID-11.3`  | `Patient.address[0].city`                   |                                                                |
| `PID-11.4`  | `Patient.address[0].state`                  |                                                                |
| `PID-11.5`  | `Patient.address[0].postalCode`             |                                                                |
| `PID-11.6`  | `Patient.address[0].country`                |                                                                |

Order fields:

| HL7v2 field             | FHIR path                                           | Notes                                                                                    |
| ----------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ORC-1`                 | `ServiceRequest.status`                             | `NW`→`active`, `CA`→`revoked`, `CM`→`completed`; else `active`                           |
| `ORC-9`                 | `ServiceRequest.authoredOn`                         | Date/time of transaction                                                                 |
| `ORC-12.2` / `ORC-12.3` | `ServiceRequest.requester.display`                  | Ordering provider family/given name; falls back to `OBR-16.2`/`.3` if `ORC-12` is absent |
| `OBR-4.1`               | `ServiceRequest.code.coding[0].code`                | System = LOINC                                                                           |
| `OBR-4.2`               | `ServiceRequest.code.coding[0].display` and `.text` |                                                                                          |
| `OBR-7`                 | `ServiceRequest.occurrenceDateTime`                 | Requested date/time                                                                      |

`ServiceRequest.intent` is always `order`.

### Reverse: FHIR → HL7v2

| FHIR path                                   | HL7v2 field | Notes                                                    |
| ------------------------------------------- | ----------- | -------------------------------------------------------- |
| `Patient.identifier[0].value`               | `PID-3.1`   |                                                          |
| `Patient.identifier[0].assigner.display`    | `PID-3.4`   |                                                          |
| `Patient.identifier[0].type.coding[0].code` | `PID-3.5`   | Defaults to `MR` if absent                               |
| `Patient.name[0].family`                    | `PID-5.1`   |                                                          |
| `Patient.name[0].given[0]`                  | `PID-5.2`   |                                                          |
| `Patient.name[0].given[1]`                  | `PID-5.3`   | Written back as the middle name component                |
| `Patient.birthDate`                         | `PID-7`     | `YYYY-MM-DD` → `YYYYMMDD`                                |
| `Patient.gender`                            | `PID-8`     | `male`→`M`, `female`→`F`, `other`→`O`, anything else→`U` |
| `Patient.address[0].line[0]`                | `PID-11.1`  |                                                          |
| `Patient.address[0].city`                   | `PID-11.3`  |                                                          |
| `Patient.address[0].state`                  | `PID-11.4`  |                                                          |
| `Patient.address[0].postalCode`             | `PID-11.5`  |                                                          |
| `Patient.address[0].country`                | `PID-11.6`  |                                                          |

Order fields:

| FHIR path                               | HL7v2 field             | Notes                                                                                                                                                                              |
| --------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ServiceRequest.status`                 | `ORC-1`                 | Inverse of the forward table: `active`→`NW`, `revoked`→`CA`, `completed`→`CM`, else `NW`                                                                                           |
| `ServiceRequest.authoredOn`             | `ORC-9`                 |                                                                                                                                                                                    |
| `ServiceRequest.requester.display`      | `ORC-12.2` / `ORC-12.3` | Split on the first space: everything after it → `ORC-12.2` (family), the first word → `ORC-12.3` (given)                                                                           |
| `ServiceRequest.code.coding[0].code`    | `OBR-4.1`               | System component hardcoded to `LN` on the way out                                                                                                                                  |
| `ServiceRequest.code.coding[0].display` | `OBR-4.2`               |                                                                                                                                                                                    |
| `ServiceRequest.occurrenceDateTime`     | `OBR-7`                 |                                                                                                                                                                                    |
| _(constant)_                            | `ORC-2` and `OBR-2`     | A placer order number is synthesized (`ORD<last 6 digits of the generated control ID>`) and written to both, so the two segments stay linked the way the forward direction expects |

`MSH` carries no FHIR-side source — every field is synthesized:

| HL7v2 field         | Value                                            | Notes                                            |
| ------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `MSH-2`             | `^~\&`                                           | Standard encoding characters                     |
| `MSH-3`–`MSH-6`     | `FHIR-TRANSLATOR` / `HL7FHIR` / `HIS` / `HOSP`   | Synthetic sending/receiving application+facility |
| `MSH-7`             | Current UTC timestamp                            | Message creation time                            |
| `MSH-9`             | `ORM^O01`                                        |                                                  |
| `MSH-10`            | Generated control ID (`TRX<timestamp><counter>`) |                                                  |
| `MSH-11` / `MSH-12` | `P` / `2.5`                                      | Processing ID, version ID                        |

### Not mapped

Any segment other than `MSH`/`PID`/`ORC`/`OBR` is warned about and skipped.

### Worked example

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

## VXU^V04 (immunization record update)

**Segments read**: `MSH`, `PID`, `RXA`
**Resources produced**: `Patient`, `Immunization`

### Forward: HL7v2 → FHIR

Patient fields follow the same `PID` table as the ADT/ORU/ORM forward tables above. Immunization fields:

| HL7v2 field | FHIR path                                                | Notes                                                         |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| `RXA-20`    | `Immunization.status`                                    | `CP`/`PA`→`completed`, `RE`/`NA`→`not-done`, else `completed` |
| `RXA-5.1`   | `Immunization.vaccineCode.coding[0].code`                | System = CVX                                                  |
| `RXA-5.2`   | `Immunization.vaccineCode.coding[0].display` and `.text` |                                                               |
| `RXA-3`     | `Immunization.occurrenceDateTime`                        | Date/time administration started                              |
| `RXA-6`     | `Immunization.doseQuantity.value`                        | Parsed with `Number()`                                        |
| `RXA-7.1`   | `Immunization.doseQuantity.unit`                         | Only set alongside `doseQuantity.value`                       |
| `RXA-15`    | `Immunization.lotNumber`                                 |                                                               |
| `RXA-16`    | `Immunization.expirationDate`                            | `YYYYMMDD` → `YYYY-MM-DD`                                     |
| `RXA-17.2`  | `Immunization.manufacturer.display`                      |                                                               |
| `RXA-10.2`  | `Immunization.performer[0].actor.display`                | Administering provider family name                            |
| `RXA-10.3`  | `Immunization.performer[0].actor.display`                | Administering provider given name (joined as "given family")  |

`Immunization.patient` is always a reference to the Patient built from `PID`.

### Reverse: FHIR → HL7v2

| FHIR path                                 | HL7v2 field     | Notes                                                                                    |
| ----------------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `Immunization.occurrenceDateTime`         | `RXA-3`         |                                                                                          |
| `Immunization.vaccineCode.coding[0]`      | `RXA-5`         | System component hardcoded to `CVX` on the way out                                       |
| `Immunization.doseQuantity`               | `RXA-6`/`RXA-7` |                                                                                          |
| `Immunization.performer[0].actor.display` | `RXA-10`        | Split on the first space: everything after it → family, first word → given               |
| `Immunization.lotNumber`                  | `RXA-15`        |                                                                                          |
| `Immunization.expirationDate`             | `RXA-16`        | `YYYY-MM-DD` → `YYYYMMDD`                                                                |
| `Immunization.manufacturer.display`       | `RXA-17`        | System component hardcoded to `MVX` on the way out                                       |
| `Immunization.status`                     | `RXA-20`        | Inverse of the forward table: `completed`→`CP`, `not-done`→`RE`, `entered-in-error`→`NA` |

`RXA-1`/`RXA-2` (give/administration sub-ID counters) are always synthesized as `0`/`1`.
`MSH`/`PID` synthesis follows the same rules as ADT's reverse table above.

### Not mapped

Any segment other than `MSH`/`PID`/`RXA` (e.g. `ORC`, `RXR`, `OBX` vaccine-funding/eligibility
observations) is warned about and skipped.

### Worked example

Input (`samples/vxu_v04.hl7`):

```hl7
MSH|^~\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M
RXA|0|1|20240103090000||08^Hepatitis B pediatric^CVX|0.5|mL^milliliter^UCUM|||1234^Smith^Jane^M^MD|||||LOT12345|20250601|MSD^Merck^MVX|||CP
```

Output (`translateHl7ToFhir` — the `Immunization` entry):

```json
{
  "resourceType": "Immunization",
  "id": "immunization-1",
  "status": "completed",
  "vaccineCode": {
    "coding": [
      {
        "system": "http://hl7.org/fhir/sid/cvx",
        "code": "08",
        "display": "Hepatitis B pediatric"
      }
    ],
    "text": "Hepatitis B pediatric"
  },
  "patient": {
    "reference": "Patient/patient-1"
  },
  "occurrenceDateTime": "2024-01-03T09:00:00Z",
  "doseQuantity": {
    "value": 0.5,
    "unit": "mL"
  },
  "lotNumber": "LOT12345",
  "expirationDate": "2025-06-01",
  "manufacturer": {
    "display": "Merck"
  },
  "performer": [
    {
      "actor": {
        "display": "Jane Smith"
      }
    }
  ]
}
```

---

## SIU^S12 (appointment scheduling)

**Segments read**: `MSH`, `SCH`, `PID`, `AIL` (location), `AIP` (personnel)
**Resources produced**: `Patient`, `Appointment`

### Forward: HL7v2 → FHIR

Patient fields follow the same `PID` table as the ADT forward table above. Appointment fields:

| HL7v2 field | FHIR path                                                   | Notes                                                                                                   |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SCH-25`    | `Appointment.status`                                        | `BOOKED`→`booked`, `CANCELLED`→`cancelled`, `COMPLETE`→`fulfilled`, `PENDING`→`proposed`, else `booked` |
| `SCH-7.1`   | `Appointment.reasonCode[0].coding[0].code`                  |                                                                                                         |
| `SCH-7.2`   | `Appointment.reasonCode[0].coding[0].display` and `.text`   |                                                                                                         |
| `SCH-8.1`   | `Appointment.appointmentType.coding[0].code`                | System = v2-0276                                                                                        |
| `SCH-8.2`   | `Appointment.appointmentType.coding[0].display` and `.text` |                                                                                                         |
| `SCH-9`     | `Appointment.minutesDuration`                               | Parsed with `Number()`; `SCH-10` (units) is read only to annotate the mapping trail, not converted      |
| `SCH-11.4`  | `Appointment.start`                                         | 4th component of the SCH-11 timing quantity (TQ) — start date/time                                      |
| `SCH-11.5`  | `Appointment.end`                                           | 5th component — end date/time                                                                           |
| `AIL-3.2`   | `Appointment.participant[].actor.display`                   | Scheduled location name, falls back to `AIL-3.1` if `.2` is absent                                      |
| `AIP-3.2`   | `Appointment.participant[].actor.display`                   | Scheduled practitioner family name                                                                      |
| `AIP-3.3`   | `Appointment.participant[].actor.display`                   | Scheduled practitioner given name (joined as "given family")                                            |

`Appointment.participant[0]` is always a reference to the Patient built from `PID`, with
`status: "accepted"`; the location (from `AIL`) and practitioner (from `AIP`) are appended
as additional participants, also `status: "accepted"` — this package doesn't track pending
invitations.

### Reverse: FHIR → HL7v2

| FHIR path                                  | HL7v2 field      | Notes                                                                                                                                                                                                                         |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Appointment.reasonCode[0].coding[0]`      | `SCH-7`          |                                                                                                                                                                                                                               |
| `Appointment.appointmentType.coding[0]`    | `SCH-8`          |                                                                                                                                                                                                                               |
| `Appointment.minutesDuration`              | `SCH-9`/`SCH-10` | `SCH-10` is always written as `MIN`                                                                                                                                                                                           |
| `Appointment.start`                        | `SCH-11.4`       |                                                                                                                                                                                                                               |
| `Appointment.end`                          | `SCH-11.5`       |                                                                                                                                                                                                                               |
| `Appointment.status`                       | `SCH-25`         | Inverse of the forward table: `booked`→`BOOKED`, `cancelled`→`CANCELLED`, `fulfilled`→`COMPLETE`, `proposed`→`PENDING`, else `BOOKED`                                                                                         |
| `Appointment.participant[1].actor.display` | `AIL-3.2`        | The first non-patient participant is written back as the location. Any further participant (e.g. a practitioner) can't be distinguished from a location by shape alone — it's warned about and skipped rather than guessed at |

`SCH-1`/`SCH-2` (placer/filler appointment ID) are synthesized from the generated control
ID. `MSH`/`PID` synthesis follows the same rules as ADT's reverse table above.

### Not mapped

Any segment other than `MSH`/`SCH`/`PID`/`AIL`/`AIP` (e.g. `AIS`, `AIG`, `NTE`) is warned
about and skipped. A second or later non-patient `Appointment.participant` is warned about
on the reverse direction, per the reverse table above.

### Worked example

Input (`samples/siu_s12.hl7`):

```hl7
MSH|^~\&|SCH|CLINIC|HIS|HOSP|20240104080000||SIU^S12|MSG011|P|2.5
SCH|APT001|APT001|||||CHECKUP^Annual physical^L|ROUTINE^Routine appointment^L|30|MIN|^^^20240110090000^20240110093000||||||||||||||BOOKED
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M
AIL|1||OFFICE1^Clinic Room 1
AIP|1||1234^Smith^Jane^M^MD
```

Output (`translateHl7ToFhir` — the `Appointment` entry):

```json
{
  "resourceType": "Appointment",
  "id": "appointment-1",
  "status": "booked",
  "participant": [
    { "actor": { "reference": "Patient/patient-1" }, "status": "accepted" },
    { "actor": { "display": "Clinic Room 1" }, "status": "accepted" },
    { "actor": { "display": "Jane Smith" }, "status": "accepted" }
  ],
  "reasonCode": [
    {
      "coding": [{ "code": "CHECKUP", "display": "Annual physical" }],
      "text": "Annual physical"
    }
  ],
  "appointmentType": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/v2-0276",
        "code": "ROUTINE",
        "display": "Routine appointment"
      }
    ],
    "text": "Routine appointment"
  },
  "minutesDuration": 30,
  "start": "2024-01-10T09:00:00Z",
  "end": "2024-01-10T09:30:00Z"
}
```

---

## OML^O21 (laboratory order)

OML^O21 is what distinguishes a lab order from a general order (see ORM^O01 above): it carries a
`SPM` (specimen) segment. `registry.ts` uses the presence of a `Specimen` resource to route
a FHIR bundle back to this mapper instead of ORM's.

**Segments read**: `MSH`, `PID`, `ORC`, `OBR`, `SPM`
**Resources produced**: `Patient`, `ServiceRequest`, `Specimen`

### Forward: HL7v2 → FHIR

Patient and order fields follow the same `PID`/`ORC`/`OBR` tables as ORM^O01's forward table above (`ORC-1` →
`ServiceRequest.status`, `ORC-9` → `authoredOn`, `ORC-12` → `requester.display`, `OBR-4` →
`code`, `OBR-7` → `occurrenceDateTime`). Specimen fields:

| HL7v2 field | FHIR path                                     | Notes            |
| ----------- | --------------------------------------------- | ---------------- |
| `SPM-4.1`   | `Specimen.type.coding[0].code`                | System = v2-0487 |
| `SPM-4.2`   | `Specimen.type.coding[0].display` and `.text` |                  |
| `SPM-17`    | `Specimen.collection.collectedDateTime`       |                  |

`Specimen.subject` references the same Patient as the ServiceRequest; `Specimen.request[0]`
references the ServiceRequest built from `ORC`/`OBR`.

### Reverse: FHIR → HL7v2

| FHIR path                               | HL7v2 field | Notes                                                                                                       |
| --------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `Specimen.type.coding[0]`               | `SPM-4`     | System component hardcoded to `HL70487` on the way out                                                      |
| `Specimen.collection.collectedDateTime` | `SPM-17`    |                                                                                                             |
| _(constant)_                            | `SPM-2`     | The same synthesized placer order number as `ORC-2`/`OBR-2` is written to `SPM-2`, keeping all three linked |

`ServiceRequest` fields are written back exactly as in ORM^O01's reverse table above. `MSH`/`PID` synthesis follows
the same rules as ADT's reverse table above.

### Not mapped

Any segment other than `MSH`/`PID`/`ORC`/`OBR`/`SPM` (e.g. `TQ1`, `DG1`, `NTE`) is warned
about and skipped.

### Worked example

Input (`samples/oml_o21.hl7`) produces a 3-entry Bundle: `Patient`, `ServiceRequest`, and
`Specimen`:

```json
{
  "resourceType": "ServiceRequest",
  "id": "servicerequest-1",
  "status": "active",
  "intent": "order",
  "code": {
    "coding": [{ "system": "http://loinc.org", "code": "1558-6", "display": "Glucose" }],
    "text": "Glucose"
  },
  "subject": { "reference": "Patient/patient-1" },
  "authoredOn": "2024-01-05T10:00:00Z",
  "occurrenceDateTime": "2024-01-05T10:00:00Z",
  "requester": { "display": "Jane Smith" }
}
```

```json
{
  "resourceType": "Specimen",
  "id": "specimen-1",
  "type": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/v2-0487",
        "code": "SER",
        "display": "Serum"
      }
    ],
    "text": "Serum"
  },
  "subject": { "reference": "Patient/patient-1" },
  "request": [{ "reference": "ServiceRequest/servicerequest-1" }],
  "collection": { "collectedDateTime": "2024-01-05T10:15:00Z" }
}
```

---

## MDM^T02 (document management)

**Segments read**: `MSH`, `EVN`, `PID`, `TXA`
**Resources produced**: `Patient`, `DocumentReference`

### Forward: HL7v2 → FHIR

Patient fields follow the same `PID` table as the ADT forward table above. Document fields:

| HL7v2 field | FHIR path                                              | Notes                                                                              |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `TXA-2.1`   | `DocumentReference.type.coding[0].code`                | System = LOINC                                                                     |
| `TXA-2.2`   | `DocumentReference.type.coding[0].display` and `.text` |                                                                                    |
| `TXA-17`    | `DocumentReference.docStatus`                          | `AU`/`TR`→`final`, `DI`/`DO`/`IP`/`PA`→`preliminary`; absent → `docStatus` omitted |
| `TXA-6`     | `DocumentReference.date`                               | Origination date/time; also copied to `content[0].attachment.creation`             |
| `TXA-12`    | `DocumentReference.masterIdentifier.value`             | Unique document number                                                             |
| `TXA-9.2`   | `DocumentReference.author[0].display`                  | Originator family name                                                             |
| `TXA-9.3`   | `DocumentReference.author[0].display`                  | Originator given name (joined as "given family")                                   |

`DocumentReference.status` is always `current` (this package doesn't map amendment/rescind
notification triggers, only the T02 "original document" trigger).
`DocumentReference.content[0].attachment.contentType` is always synthesized as `text/plain`
since TXA carries no content-type field; `.title` is set from `TXA-2`'s display. HL7v2's
`TXA` segment carries no actual document bytes (those travel separately, e.g. as base64 in
an `OBX`), so `content[0].attachment` never has a `data` field — only its metadata.

### Reverse: FHIR → HL7v2

| FHIR path                                  | HL7v2 field | Notes                                                                                         |
| ------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------- |
| `DocumentReference.type.coding[0]`         | `TXA-2`     | System component hardcoded to `LN` on the way out                                             |
| `DocumentReference.date`                   | `TXA-6`     |                                                                                               |
| `DocumentReference.author[0].display`      | `TXA-9`     | Split on the first space: everything after it → family, first word → given                    |
| `DocumentReference.masterIdentifier.value` | `TXA-12`    |                                                                                               |
| `DocumentReference.docStatus`              | `TXA-17`    | Inverse of the forward table: `final`→`AU`, `preliminary`→`IP`, `amended`→`TR`; absent → `IP` |

`EVN-1`/`EVN-2` are synthesized the same way as ADT's (reverse table above). `MSH`/`PID` synthesis follows
the same rules as ADT's reverse table above.

### Not mapped

Any segment other than `MSH`/`EVN`/`PID`/`TXA` (e.g. `OBX` carrying the actual document
content, `PV1`) is warned about and skipped.

### Worked example

Input (`samples/mdm_t02.hl7`):

```hl7
MSH|^~\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5
EVN|T02|20240106140000
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M
TXA|1|18842-5^Discharge summary^LN||20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|||DOC0100|||||AU
```

Output (`translateHl7ToFhir` — the `DocumentReference` entry):

```json
{
  "resourceType": "DocumentReference",
  "id": "documentreference-1",
  "status": "current",
  "docStatus": "final",
  "type": {
    "coding": [{ "system": "http://loinc.org", "code": "18842-5", "display": "Discharge summary" }],
    "text": "Discharge summary"
  },
  "subject": { "reference": "Patient/patient-1" },
  "content": [
    {
      "attachment": {
        "contentType": "text/plain",
        "title": "Discharge summary",
        "creation": "2024-01-06T14:00:00Z"
      }
    }
  ],
  "date": "2024-01-06T14:00:00Z",
  "masterIdentifier": { "value": "DOC0100" },
  "author": [{ "display": "Anh Nguyen" }]
}
```

---

## Adding a new message type

The mapping tables above are implemented, one file per message type, in
[`packages/core/src/mapping/`](../packages/core/src/mapping) (`adt.ts`, `oru.ts`,
`orm.ts`, `vxu.ts`, `siu.ts`, `oml.ts`, `mdm.ts`), sharing PID↔Patient logic from
`buildPatientFromPid`/`buildPidFieldsFromPatient` in `adt.ts` and shared helpers
(date/code lookups) in `common.ts`. `registry.ts` routes `MSH-9` (forward) or
resource-type presence (reverse) to the right mapper — reverse routing checks the most
specific resource type first (e.g. `Specimen` before `ServiceRequest`) since some types
are shared by more than one message type. To add a message type: write its forward/reverse
functions following that pattern, register it in `registry.ts` and
`SUPPORTED_MESSAGE_TYPES`, add its section to this document, and add table-driven tests in
`packages/core/test/` following the existing files. If you also add a way to
machine-verify this document against the code, extend
[`packages/core/test/mapping-audit.test.ts`](../packages/core/test/mapping-audit.test.ts)
(see below) — it parses every `##` section's forward table here and asserts each row's
source field actually appears in that message type's `mappings[]` output, so a table that
drifts from the implementation fails CI instead of silently going stale.

---

## Detection rules (`inspectInput`)

`inspectInput(input)` (implemented in
[`packages/core/src/inspect.ts`](../packages/core/src/inspect.ts)) identifies what a
piece of input is — direction, and the specific HL7v2 message type or FHIR resource
kind — without translating it and without throwing. It's the same shape-detection logic
the CLI's direction auto-detection and the browser demo's live "Detected: …" badge both
use, exposed as a first-class API rather than duplicated. Full API shape is documented in
[`packages/core/README.md`](../packages/core/README.md#auto-detecting-what-youre-translating);
this section documents the exact rules it applies, since those rules directly determine
which mapper handles a given input.

### Direction: HL7v2 vs. FHIR vs. unknown

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

### HL7v2 message type

Once direction is `hl7ToFhir`, `inspectInput` attempts a full `parseHl7Message` (the same
parser translation uses):

- **Parse succeeds** → reads `MSH-9`, splits it into `category^trigger` (e.g. `ADT`/`A01`),
  and checks the pair against `SUPPORTED_MESSAGE_TYPES` (the ADT/ORU/ORM message types
  above). Result:
  `{ kind: "hl7", messageType, category, trigger, supported, description }` —
  `description` is only present when `supported` is `true`.
- **Parse fails** (bad/missing MSH delimiters, empty message — anything that would throw
  `Hl7ParseError` from `translateHl7ToFhir`) → `{ kind: "unknown", reason }` with the
  parser's own error message as `reason`. Direction is still reported as `"hl7ToFhir"`
  since the direction check above already committed to that; only the _specific type_ is
  unknown.

Note that `supported: false` is a valid, non-error result — it means "this parses as a
real HL7v2 message, but no mapper in this package handles `category^trigger` yet" (e.g.
`ADT^A03`, discharge — not one of the two ADT triggers this package maps). That's the
signal a caller should use to short-circuit before calling `translateHl7ToFhir` and
hitting its `FhirValidationError` instead.

### FHIR resource kind

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
    pick a mapper (checked in this priority order, first match wins, most specific first
    since some resource types are shared by more than one message type): `Specimen`
    present → `OML^O21`; else `ServiceRequest` present → `ORM^O01`; else
    `DiagnosticReport` present → `ORU^R01`; else `Immunization` present → `VXU^V04`; else
    `Appointment` present → `SIU^S12`; else `DocumentReference` present → `MDM^T02`; else
    `Patient` present → `ADT^A01`. `supported` is `true` iff one of those matched.

As with HL7 detection, `supported: false` (e.g. `resourceTypes: ["Practitioner"]`, which
matches none of the three rules) is the signal to check _before_ calling
`translateFhirToHl7`, which would otherwise throw `FhirValidationError` on the same input.
