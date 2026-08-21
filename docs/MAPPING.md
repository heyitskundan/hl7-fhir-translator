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

| System                                  | URL                                                                  | Used for                                                   |
| --------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| LOINC                                   | `http://loinc.org`                                                   | Lab/order codes (`OBR-4`, `OBX-3`)                         |
| HL7 v2 Table 0203 (Identifier Type)     | `http://terminology.hl7.org/CodeSystem/v2-0203`                      | `Patient.identifier[].type`                                |
| HL7 v3 ActCode                          | `http://terminology.hl7.org/CodeSystem/v3-ActCode`                   | `Encounter.class`                                          |
| HL7 v3 ObservationInterpretation        | `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation` | `Observation.interpretation` (abnormal flags)              |
| HL7 v3 ParticipationType                | `http://terminology.hl7.org/CodeSystem/v3-ParticipationType`         | `Encounter.participant[].type` (attending doctor = `ATND`) |
| CVX (vaccine codes)                     | `http://hl7.org/fhir/sid/cvx`                                        | `Immunization.vaccineCode` (`RXA-5`)                       |
| HL7 v2 Table 0276 (Appointment Type)    | `http://terminology.hl7.org/CodeSystem/v2-0276`                      | `Appointment.appointmentType` (`SCH-8`)                    |
| HL7 v2 Table 0487 (Specimen Type)       | `http://terminology.hl7.org/CodeSystem/v2-0487`                      | `Specimen.type` (`SPM-4`)                                  |
| LOINC (document type)                   | `http://loinc.org`                                                   | `DocumentReference.type` (`TXA-2`)                         |
| FHIR AllergyIntolerance Clinical Status | `http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical`  | `AllergyIntolerance.clinicalStatus` (always `active`)      |

The table above lists the fixed systems hardcoded in `common.ts`'s `CODE_SYSTEMS` — codes
using one of these are carried through exactly as given in the source (e.g. a LOINC code
found in `OBX-3.1` is copied straight into the output). Fields whose FHIR system depends on
looking up the actual HL7v2 code (e.g. `AllergyIntolerance.category`/`.criticality`, both
sourced from `AL1` — see below) instead resolve their system dynamically via
[`mapping/vocabulary.ts`](../packages/core/src/mapping/vocabulary.ts), generated directly
from the official IG's ~70 vocabulary ConceptMap resources; that file's own header comment
and `lookupVocabulary`/`reverseLookupVocabulary` functions are the source of truth for which
HL7v2 table maps to which FHIR system per field, not a table duplicated here.

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

**Segments read**: `MSH`, `EVN`, `PID`, `PD1`, `PV1`, `PV2`, `AL1` (zero or more), `DG1`
(zero or more), `NK1` (zero or more), `IN1` (zero or more), `IN3` (first occurrence only),
`PR1` (zero or more), `ROL` (zero or more)
**Resources produced**: `Patient`, `Encounter` (omitted if no `PV1` is present),
`AllergyIntolerance` (one per `AL1` segment), `Condition` (one per `DG1` segment),
`RelatedPerson` (one per `NK1` segment), `Coverage` (one per `IN1` segment), `Organization`
(one per `IN1` segment with a payor name, plus one per `ROL-14`), `Location` (one, from
`PV1-3`, if present, plus one more from `EVN-7` if a `Provenance` is built), `Practitioner`
(one per `PV1-7`/`PV1-8`/`DG1-16` present, plus one more from `EVN-5` if a `Provenance` is
built, plus one per `ROL-4`), `Procedure` (one per `PR1` segment), `MessageHeader` (one,
from `MSH`, always produced), `Provenance` (one, from `EVN`, only when `EVN-5` is present —
see below), `CareTeam` (one, from `ROL`/`IN3-21`, only when either is present — see below)

### Forward: HL7v2 → FHIR

| HL7v2 field | FHIR path                                   | Notes                                                                                                                                                                                                    |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSH-9`     | _(routing only)_                            | Selects this mapper; any of `ADT^A01`/`A02`/`A05`/`A06`/`A08`/`A09`/`A11` routes here                                                                                                                    |
| `PID-3.1`   | `Patient.identifier[0].value`               | Medical record number                                                                                                                                                                                    |
| `PID-3.4`   | `Patient.identifier[0].assigner.display`    | Assigning authority                                                                                                                                                                                      |
| `PID-3.5`   | `Patient.identifier[0].type.coding[0].code` | Defaults to `MR` if absent                                                                                                                                                                               |
| `PID-5.1`   | `Patient.name[0].family`                    |                                                                                                                                                                                                          |
| `PID-5.2`   | `Patient.name[0].given[0]`                  |                                                                                                                                                                                                          |
| `PID-5.3`   | `Patient.name[0].given[1]`                  | Middle name, appended to `given[]`                                                                                                                                                                       |
| `PID-7`     | `Patient.birthDate`                         | `YYYYMMDD` → `YYYY-MM-DD`                                                                                                                                                                                |
| `PID-8`     | `Patient.gender`                            | `M`→`male`, `F`→`female`, `O`→`other`, anything else→`unknown`                                                                                                                                           |
| `PID-11.1`  | `Patient.address[0].line[0]`                | Street address                                                                                                                                                                                           |
| `PID-11.3`  | `Patient.address[0].city`                   |                                                                                                                                                                                                          |
| `PID-11.4`  | `Patient.address[0].state`                  |                                                                                                                                                                                                          |
| `PID-11.5`  | `Patient.address[0].postalCode`             |                                                                                                                                                                                                          |
| `PID-11.6`  | `Patient.address[0].country`                |                                                                                                                                                                                                          |
| `PID-13`    | `Patient.telecom[]`                         | XTN — home phone; `PID-14` (business) and `PID-40` (other) are also read into the same array when present, but this sample only populates `PID-13`                                                       |
| `PID-16.1`  | `Patient.maritalStatus`                     | HL7 Table 0002 → `http://terminology.hl7.org/CodeSystem/v3-MaritalStatus` (or `v3-NullFlavor` for unknown/other)                                                                                         |
| `PID-19`    | `Patient.identifier[]`                      | SSN, appended to `identifier[]` with `type.coding[0].code` = `SS`                                                                                                                                        |
| `PID-20.1`  | `Patient.identifier[]`                      | Driver's license number, appended to `identifier[]` with `type.coding[0].code` = `DL`                                                                                                                    |
| `PID-25`    | `Patient.multipleBirthInteger`              | Birth order; takes precedence over `PID-24` when both are present                                                                                                                                        |
| `PID-30`    | `Patient.deceasedBoolean`                   | `Y`→`true`, else `false`; only read when `PID-29` is absent                                                                                                                                              |
| `PV1-2`     | `Encounter.class`                           | `I`→`IMP`, `O`→`AMB`, `E`→`EMER`, else `UNK`; system = v3-ActCode                                                                                                                                        |
| `PV1-3.1`   | `Location.name`                             | Point of care only (room/bed components not mapped); a `Location` resource is built and referenced from `Encounter.location[0].location`, with the same value also copied to `.display`                  |
| `PV1-7.2`   | `Practitioner.name[0].family`               | Attending doctor family name; a `Practitioner` resource is built and referenced from `Encounter.participant[].individual` (`type.coding[0].code` = `ATND`), with the same name also copied to `.display` |
| `PV1-7.3`   | `Practitioner.name[0].given[0]`             | Attending doctor given name                                                                                                                                                                              |
| `PV1-8.2`   | `Practitioner.name[0].family`               | Referring doctor family name; participant `type.coding[0].code` = `REF`                                                                                                                                  |
| `PV1-8.3`   | `Practitioner.name[0].given[0]`             | Referring doctor given name                                                                                                                                                                              |
| `PV1-19.1`  | `Encounter.identifier[0].value`             | Visit number                                                                                                                                                                                             |
| `PV1-44`    | `Encounter.period.start`                    | Admit date/time — the IG's actual source for `period.start`; takes precedence over `EVN-2` below when present                                                                                            |
| `PV1-45`    | `Encounter.period.end`                      | Discharge date/time; only read alongside `PV1-44`                                                                                                                                                        |
| `MSH-3`     | `MessageHeader.source.name`                 | Sending application; endpoint is synthesized as `urn:hl7v2:<name>` since HL7v2 gives no real URI                                                                                                         |
| `MSH-5`     | `MessageHeader.destination[0].name`         | Receiving application; endpoint synthesized the same way                                                                                                                                                 |
| `MSH-9`     | `MessageHeader.eventCoding`                 | Trigger event code/display; second target for this field, alongside the routing use above                                                                                                                |

`EVN-2` (recorded event date/time) is this package's own fallback for `Encounter.period.start`
when `PV1-44` is absent — not an IG-specified mapping (the IG's own `EVN` target is
`Provenance`, not `Encounter`). It isn't exercised by the canonical worked example below,
since `PV1-44` is present there; see `adt.test.ts`'s dedicated fallback test instead.

`EVN` (event) fields, per the official IG's "Segment EVN to Provenance Map"
(`ConceptMap-segment-evn-to-provenance.html`, fetched directly). FHIR requires
`Provenance.agent` to be non-empty with `who` present on each entry, and `EVN-5` (Operator
ID) is the only source for that — so a `Provenance` resource (and the `Practitioner`/
`Location` it references) is only built when `EVN-5` is present; the canonical worked
example below doesn't populate `EVN-5`, so it doesn't produce a `Provenance` — see the
dedicated test cases in `adt.test.ts` for a message that does. The IG's segment-level
"`EVN` → `activity.coding.display`" row (cited against the whole segment, no specific field)
isn't implemented — there's no concrete source field to derive a display string from.

| HL7v2 field | FHIR path                     | Notes                                                                                                                         |
| ----------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `EVN-2`     | `Provenance.recorded`         | Recorded date/time                                                                                                            |
| `EVN-4`     | `Provenance.reason[0]`        | Event reason code, carried through as given (not normalized against a fixed table)                                            |
| `EVN-5`     | `Provenance.agent[0].who`     | Operator ID (XCN family/given). A `Practitioner` resource is built and referenced, with the name also copied to `.display`    |
| `EVN-6`     | `Provenance.occurredDateTime` | Event occurred date/time                                                                                                      |
| `EVN-7`     | `Provenance.location`         | Event facility (HD namespace ID only). A `Location` resource is built and referenced, with the name also copied to `.display` |

`Provenance.target` references the `Patient` (and `Encounter`, if one was built) the event
is about.

`ROL` (+ `IN3-21`) fields, per the official IG's "Segment ROL to CareTeam Map" and
"Segment IN3 to CareTeam Map" (`ConceptMap-segment-rol-to-careteam.html` /
`-in3-to-careteam.html`, fetched directly). `ROL` is a repeating segment — a message can
carry zero or more, one per team member — so this builds at most one `CareTeam`, with one
`participant` per `ROL` repetition, plus one more member-less participant (just a role
text) when `IN3-21` is present. `CareTeam.status` is always synthesized as `"active"` —
neither segment carries a status signal:

| HL7v2 field | FHIR path                             | Notes                                                                                                                  |
| ----------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ROL-3`     | `CareTeam.participant[].role[0]`      | CWE — role                                                                                                             |
| `ROL-4`     | `CareTeam.participant[].member`       | XCN family/given name. A `Practitioner` resource is built and referenced, with the name also copied to `.display`      |
| `ROL-5`     | `CareTeam.participant[].period.start` |                                                                                                                        |
| `ROL-6`     | `CareTeam.participant[].period.end`   |                                                                                                                        |
| `ROL-8`     | `CareTeam.reasonCode[]`               | CWE — role action reason. Not per-participant on the FHIR side, so every `ROL-8` present is appended to the same array |
| `ROL-9`     | `CareTeam.participant[].role[1]`      | CWE — provider type, second target for the same field alongside `ROL-3`                                                |
| `ROL-12`    | `CareTeam.telecom[]`                  | XTN. Not per-participant on the FHIR side, same as `ROL-8`                                                             |
| `ROL-14`    | `CareTeam.participant[].onBehalfOf`   | XON — organization name only. A real `Organization` resource is built and referenced, same pattern as `IN1-4` above    |
| `IN3-21`    | `CareTeam.participant[].role[0].text` | Case Manager name (free text) — appended as one more participant, with no `member` reference                           |

The `PRT`-to-`CareTeam` map (in the ORM/OML `PRT` sections) isn't implemented for this
resource — it would need the same person/org/role dispatch `PRT`-to-`PractitionerRole`
already covers, for a resource that would otherwise be redundant with it here.

`PID-24` (multiple birth indicator, `Y`/`N` → `Patient.multipleBirthBoolean`) and `PID-29`
(death date/time → `Patient.deceasedDateTime`) are also mapped, but only read when `PID-25`
(birth order) and `PID-30` (death indicator) respectively are absent — since the canonical
worked example below populates the latter two, `PID-24`/`PID-29` aren't exercised by it; see
the dedicated test cases in `adt.test.ts` instead.

`AL1` (allergy/intolerance) fields, per the official IG's "Segment AL1 to AllergyIntolerance
Map" (`ConceptMap-segment-al1-to-allergyintolerance.html`, fetched directly — this one, unlike
the ADT trigger-status table above, _is_ IG-specified):

| HL7v2 field | FHIR path                                              | Notes                                                                                                                                                                        |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AL1-2`     | `AllergyIntolerance.category[0]`                       | HL7 Table 0127 → `http://hl7.org/fhir/allergy-intolerance-category`                                                                                                          |
| `AL1-3.1`   | `AllergyIntolerance.code.coding[0].code`               | Allergen code (CWE) — system is carried through as given, not normalized                                                                                                     |
| `AL1-3.2`   | `AllergyIntolerance.code.coding[0].display`            |                                                                                                                                                                              |
| `AL1-4`     | `AllergyIntolerance.criticality`                       | HL7 Table 0128 → `http://hl7.org/fhir/allergy-intolerance-criticality`                                                                                                       |
| `AL1-4`     | `AllergyIntolerance.reaction[0].severity`              | Same field, second target per the IG — HL7 Table 0128 → `http://hl7.org/fhir/reaction-event-severity`; only set alongside `AL1-5`, since `reaction` requires a manifestation |
| `AL1-5`     | `AllergyIntolerance.reaction[0].manifestation[0].text` | Free text, not coded                                                                                                                                                         |
| `AL1-6`     | `AllergyIntolerance.onsetDateTime`                     | Withdrawn from the HL7v2 spec as of v2.7, but still commonly populated in v2.5                                                                                               |

`AllergyIntolerance.clinicalStatus` is always synthesized as `active` — `AL1` carries no
clinical-status signal, and FHIR's own `ait-1` constraint requires `clinicalStatus` unless
`verificationStatus` is `entered-in-error`, which `AL1` gives no basis to infer either (this
gap is called out in the IG's own mapping notes, not something this package invented).

`DG1` (diagnosis) fields, per the official IG's "Segment DG1 to Condition Map"
(`ConceptMap-segment-dg1-to-condition.html`, fetched directly):

| HL7v2 field | FHIR path                          | Notes                                                                                                                                                                                          |
| ----------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DG1-3.1`   | `Condition.code.coding[0].code`    | Diagnosis code (CWE) — system is carried through as given, not normalized                                                                                                                      |
| `DG1-3.2`   | `Condition.code.coding[0].display` |                                                                                                                                                                                                |
| `DG1-4`     | `Condition.code.text`              | Diagnosis description; also used as `.text` alone when `DG1-3` is absent                                                                                                                       |
| `DG1-5`     | `Condition.onsetDateTime`          |                                                                                                                                                                                                |
| `DG1-16`    | `Practitioner.name[0]`             | Diagnosing clinician (XCN family/given). A `Practitioner` resource is built and referenced from `Condition.asserter`, with the same name also copied to `.display`                             |
| `DG1-19`    | `Condition.recordedDate`           | Diagnosis attestation date/time                                                                                                                                                                |
| `DG1-20`    | `Condition.identifier[0]`          |                                                                                                                                                                                                |
| `DG1-21`    | `Condition.verificationStatus`     | Only the value `D` maps (→ `entered-in-error`) — per the IG's own note, the other defined values (`A`, `U`) don't map to anything, so this is a single constant assignment, not a table lookup |

`DG1-6` (diagnosis type) and `DG1-15` (diagnosis priority) additionally map, per the IG's
"Segment DG1 to Encounter Map", to `Encounter.diagnosis[].use` and `.rank` — one entry per
`DG1` that has at least one of those two fields populated, each referencing the `Condition`
built from that same `DG1` segment. Only added when an `Encounter` was produced (i.e. `PV1`
was present).

`NK1` (next of kin / emergency contact) fields, per the official IG's "Segment NK1 to
RelatedPerson Map" (`ConceptMap-segment-nk1-to-relatedperson.html`, fetched directly — this
package implements the `RelatedPerson`-side mapping; the IG also documents an NK1-to-`Patient`
mapping, which is not implemented here):

| HL7v2 field | FHIR path                       | Notes                                                                                                                                      |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `NK1-2`     | `RelatedPerson.name[0]`         | XPN — family/given/middle components                                                                                                       |
| `NK1-3`     | `RelatedPerson.relationship[0]` | HL7 Table 0063 → `http://terminology.hl7.org/CodeSystem/v3-RoleCode` (or `v2-0063`/`v2-0131`, depending on the code — see `vocabulary.ts`) |
| `NK1-4`     | `RelatedPerson.address[0]`      | XAD                                                                                                                                        |
| `NK1-5`     | `RelatedPerson.telecom[0]`      | XTN — home/business phone                                                                                                                  |
| `NK1-6`     | `RelatedPerson.telecom[1]`      | XTN — second phone, if present                                                                                                             |
| `NK1-8`     | `RelatedPerson.period.start`    |                                                                                                                                            |
| `NK1-9`     | `RelatedPerson.period.end`      |                                                                                                                                            |
| `NK1-12`    | `RelatedPerson.identifier[0]`   | CX — employee number                                                                                                                       |
| `NK1-15`    | `RelatedPerson.gender`          | Same HL7 gender table as `PID-8`/`Patient.gender`                                                                                          |
| `NK1-16`    | `RelatedPerson.birthDate`       |                                                                                                                                            |

`IN1` (insurance) fields, per the official IG's "Segment IN1 to Coverage Map"
(`ConceptMap-segment-in1-to-coverage.html`, fetched directly). `policyHolder` and
`subscriber` stay display-only References, the same pattern `Encounter.participant`
already uses for the attending doctor — but `payor` is the one exception: the IG's own map
nests `Organization.name`/`.address` inside the `payor` target, so it references a real
`Organization` resource instead:

| HL7v2 field | FHIR path                       | Notes                                                                      |
| ----------- | ------------------------------- | -------------------------------------------------------------------------- |
| `IN1-2`     | `Coverage.identifier[0]`        | CX — insurance plan ID                                                     |
| `IN1-4`     | `Organization.name`             | XON — insurance company name; also copied to `Coverage.payor[0].display`   |
| `IN1-5`     | `Organization.address[0]`       | XAD — insurance company address                                            |
| `IN1-11`    | `Coverage.policyHolder.display` | XON — group name                                                           |
| `IN1-12`    | `Coverage.period.start`         |                                                                            |
| `IN1-13`    | `Coverage.period.end`           |                                                                            |
| `IN1-15`    | `Coverage.type`                 | Plan type, carried through as given (not normalized against a fixed table) |
| `IN1-16`    | `Coverage.subscriber.display`   | XPN — name of insured                                                      |
| `IN1-17`    | `Coverage.relationship`         | HL7 Table 0063, same lookup as `NK1-3` above                               |

`Coverage.status` is always synthesized as `active` and `Coverage.beneficiary` is always a
reference to the Patient built from `PID` — `IN1` carries no status field, and FHIR requires
both.

`PR1` (procedure) fields, per the official IG's "Segment PR1 to Procedure Map"
(`ConceptMap-segment-pr1-to-procedure.html`, fetched directly):

| HL7v2 field | FHIR path                       | Notes                                                                  |
| ----------- | ------------------------------- | ---------------------------------------------------------------------- |
| `PR1-3`     | `Procedure.code.coding[0]`      | CE/CWE — procedure code                                                |
| `PR1-4`     | `Procedure.code.text`           |                                                                        |
| `PR1-5`     | `Procedure.performedDateTime`   | Or `.performedPeriod.start` when `PR1-7` (end) is also present         |
| `PR1-6`     | `Procedure.category`            | CE/CWE — procedure functional type (HL7 Table 0230)                    |
| `PR1-7`     | `Procedure.performedPeriod.end` | Only set alongside `PR1-5`; without a start, an end alone isn't mapped |
| `PR1-15`    | `Procedure.reasonCode[0]`       | CE/CWE — associated diagnosis code                                     |
| `PR1-19`    | `Procedure.identifier[0]`       | EI                                                                     |
| `PR1-23`    | `Procedure.location.display`    | PL — point-of-care component only, same convention as `PV1-3.1` above  |

`Procedure.status` is always `unknown` — this is not a guess: the IG's own mapping for
`PR1`'s status target says the value "depends on the message context ... to be determined
by the implementer. If not clear, use 'unknown'." This package reads `PR1` generically
across message types, so that context isn't available, and `unknown` is the IG-specified
fallback.

`PD1` (additional demographics) and `PV2` (additional visit info) fields, per the official
IG's "Segment PD1 to Patient Map" and "Segment PV2 to Encounter Map"
(`ConceptMap-segment-pd1-to-patient.html`/`ConceptMap-segment-pv2-to-encounter.html`,
fetched directly). Most of both segments' IG-mapped fields target FHIR extensions this
package doesn't produce anywhere else, so only the non-extension fields are implemented:

| HL7v2 field    | FHIR path                                   | Notes                                                    |
| -------------- | ------------------------------------------- | -------------------------------------------------------- |
| `PD1-3.1`      | `Patient.generalPractitioner[0].display`    | XON — primary care organization name                     |
| `PD1-4.2`/`.3` | `Patient.generalPractitioner[1].display`    | XCN — primary care provider name (joined "given family") |
| `PV2-3.1`      | `Encounter.reasonCode[0].coding[0].code`    | CWE — admit reason                                       |
| `PV2-3.2`      | `Encounter.reasonCode[0].coding[0].display` |                                                          |
| `PV2-25`       | `Encounter.priority`                        | CWE — visit priority code                                |

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

| FHIR path                                              | HL7v2 field           | Notes                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Patient.identifier[0].value`                          | `PID-3.1`             |                                                                                                                                                                         |
| `Patient.identifier[0].assigner.display`               | `PID-3.4`             |                                                                                                                                                                         |
| `Patient.identifier[0].type.coding[0].code`            | `PID-3.5`             | Defaults to `MR` if absent                                                                                                                                              |
| `Patient.name[0].family`                               | `PID-5.1`             |                                                                                                                                                                         |
| `Patient.name[0].given[0]`                             | `PID-5.2`             |                                                                                                                                                                         |
| `Patient.name[0].given[1]`                             | `PID-5.3`             | Written back as the middle name component                                                                                                                               |
| `Patient.birthDate`                                    | `PID-7`               | `YYYY-MM-DD` → `YYYYMMDD`                                                                                                                                               |
| `Patient.gender`                                       | `PID-8`               | `male`→`M`, `female`→`F`, `other`→`O`, anything else→`U`                                                                                                                |
| `Patient.address[0].line[0]`                           | `PID-11.1`            |                                                                                                                                                                         |
| `Patient.address[0].city`                              | `PID-11.3`            |                                                                                                                                                                         |
| `Patient.address[0].state`                             | `PID-11.4`            |                                                                                                                                                                         |
| `Patient.address[0].postalCode`                        | `PID-11.5`            |                                                                                                                                                                         |
| `Patient.address[0].country`                           | `PID-11.6`            |                                                                                                                                                                         |
| `Patient.telecom[0].value`                             | `PID-13`              | Only the first `telecom[]` entry is written back                                                                                                                        |
| `Patient.maritalStatus`                                | `PID-16`              | Inverse of the forward table's HL7 Table 0002 lookup                                                                                                                    |
| `Patient.identifier[]` (type `SS`)                     | `PID-19`              | First identifier whose `type.coding[0].code` is `SS`                                                                                                                    |
| `Patient.identifier[]` (type `DL`)                     | `PID-20`              | First identifier whose `type.coding[0].code` is `DL`                                                                                                                    |
| `Patient.multipleBirthInteger`                         | `PID-25`              | Takes precedence over `multipleBirthBoolean` below when both are present                                                                                                |
| `Patient.multipleBirthBoolean`                         | `PID-24`              | Only written when `multipleBirthInteger` is absent                                                                                                                      |
| `Patient.deceasedDateTime`                             | `PID-29`              | Takes precedence over `deceasedBoolean` below when both are present                                                                                                     |
| `Patient.deceasedBoolean`                              | `PID-30`              | Only written when `deceasedDateTime` is absent                                                                                                                          |
| `Encounter.class`                                      | `PV1-2`               | Inverse of the forward table: `IMP`→`I`, `AMB`→`O`, `EMER`→`E`, else `I`                                                                                                |
| `Encounter.location[0].location.display`               | `PV1-3.1`             | Read directly from the Reference's `.display`, not by looking up a separate `Location` resource in the bundle                                                           |
| `Encounter.participant[]` (type `ATND`)                | `PV1-7.2` / `PV1-7.3` | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `Encounter.participant[]` (type `REF`)                 | `PV1-8.2` / `PV1-8.3` | Same resolution, written only when a participant with `type.coding[0].code` = `REF` is present                                                                          |
| `Encounter.identifier[0].value`                        | `PV1-19`              |                                                                                                                                                                         |
| `Encounter.period.start`                               | `PV1-44`              | Also written to `EVN-2` (see below); `PV1-44` is skipped when `period.start` is absent                                                                                  |
| `Encounter.period.end`                                 | `PV1-45`              | Only written alongside `PV1-44`                                                                                                                                         |
| `Encounter.period.start`                               | `EVN-2`               | Falls back to the current UTC timestamp if absent; written independently of `PV1-44` above                                                                              |
| `AllergyIntolerance.category[0]`                       | `AL1-2`               | Inverse of the forward table's HL7 Table 0127 lookup                                                                                                                    |
| `AllergyIntolerance.code.coding[0]`                    | `AL1-3`               |                                                                                                                                                                         |
| `AllergyIntolerance.criticality`                       | `AL1-4`               | Inverse of the forward table's HL7 Table 0128 lookup; takes precedence over `reaction[0].severity` below when both are present                                          |
| `AllergyIntolerance.reaction[0].severity`              | `AL1-4`               | Only written when `criticality` is absent — otherwise `criticality` already owns `AL1-4`                                                                                |
| `AllergyIntolerance.reaction[0].manifestation[0].text` | `AL1-5`               |                                                                                                                                                                         |
| `AllergyIntolerance.onsetDateTime`                     | `AL1-6`               |                                                                                                                                                                         |
| `Condition.code.coding[0]`                             | `DG1-3`               |                                                                                                                                                                         |
| `Condition.code.text`                                  | `DG1-4`               |                                                                                                                                                                         |
| `Condition.onsetDateTime`                              | `DG1-5`               |                                                                                                                                                                         |
| `Condition.asserter`                                   | `DG1-16`              | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `Condition.recordedDate`                               | `DG1-19`              |                                                                                                                                                                         |
| `Condition.identifier[0]`                              | `DG1-20`              |                                                                                                                                                                         |
| `Condition.verificationStatus`                         | `DG1-21`              | Only written when the code is `entered-in-error`, as `D`                                                                                                                |
| `Encounter.diagnosis[].use`                            | `DG1-6`               | Matched back to the `DG1` segment for the referenced `Condition`                                                                                                        |
| `Encounter.diagnosis[].rank`                           | `DG1-15`              | Matched back to the `DG1` segment for the referenced `Condition`                                                                                                        |
| `RelatedPerson.name[0]`                                | `NK1-2`               |                                                                                                                                                                         |
| `RelatedPerson.relationship[0]`                        | `NK1-3`               | Inverse of the forward table's HL7 Table 0063 lookup                                                                                                                    |
| `RelatedPerson.address[0]`                             | `NK1-4`               |                                                                                                                                                                         |
| `RelatedPerson.telecom[0]`                             | `NK1-5`               | Only the first `telecom[]` entry is written back                                                                                                                        |
| `RelatedPerson.period.start`                           | `NK1-8`               |                                                                                                                                                                         |
| `RelatedPerson.period.end`                             | `NK1-9`               |                                                                                                                                                                         |
| `RelatedPerson.identifier[0]`                          | `NK1-12`              |                                                                                                                                                                         |
| `RelatedPerson.gender`                                 | `NK1-15`              | Inverse of the same HL7 gender table as `Patient.gender`/`PID-8`                                                                                                        |
| `RelatedPerson.birthDate`                              | `NK1-16`              |                                                                                                                                                                         |
| `Coverage.identifier[0]`                               | `IN1-2`               |                                                                                                                                                                         |
| `Organization.name`                                    | `IN1-4`               | Resolved from `Coverage.payor[0].reference`; falls back to `Coverage.payor[0].display` when the referenced `Organization` isn't in the bundle                           |
| `Organization.address[0]`                              | `IN1-5`               |                                                                                                                                                                         |
| `Coverage.policyHolder.display`                        | `IN1-11`              |                                                                                                                                                                         |
| `Coverage.period.start`                                | `IN1-12`              |                                                                                                                                                                         |
| `Coverage.period.end`                                  | `IN1-13`              |                                                                                                                                                                         |
| `Coverage.type`                                        | `IN1-15`              |                                                                                                                                                                         |
| `Coverage.subscriber.display`                          | `IN1-16`              |                                                                                                                                                                         |
| `Coverage.relationship`                                | `IN1-17`              | Inverse of the forward table's HL7 Table 0063 lookup                                                                                                                    |
| `Procedure.code.coding[0]`                             | `PR1-3`               |                                                                                                                                                                         |
| `Procedure.code.text`                                  | `PR1-4`               |                                                                                                                                                                         |
| `Procedure.performedDateTime`/`.performedPeriod.start` | `PR1-5`               |                                                                                                                                                                         |
| `Procedure.category`                                   | `PR1-6`               |                                                                                                                                                                         |
| `Procedure.performedPeriod.end`                        | `PR1-7`               | Only written when `performedPeriod.start` is also present                                                                                                               |
| `Procedure.reasonCode[0]`                              | `PR1-15`              |                                                                                                                                                                         |
| `Procedure.identifier[0]`                              | `PR1-19`              |                                                                                                                                                                         |
| `Procedure.location.display`                           | `PR1-23`              |                                                                                                                                                                         |
| `Patient.generalPractitioner[0].display`               | `PD1-3`               |                                                                                                                                                                         |
| `Patient.generalPractitioner[1].display`               | `PD1-4`               | Split on the first space: everything after it → family, first word → given                                                                                              |
| `Encounter.reasonCode[0].coding[0]`                    | `PV2-3`               |                                                                                                                                                                         |
| `Encounter.priority`                                   | `PV2-25`              |                                                                                                                                                                         |
| `MessageHeader.source.name`                            | `MSH-3`               | Overrides the synthesized `HL7FHIR` default when a `MessageHeader` is present in the bundle                                                                             |
| `MessageHeader.destination[0].name`                    | `MSH-5`               | Overrides the synthesized `HIS` default the same way                                                                                                                    |
| `Provenance.recorded`                                  | `EVN-2`               | Overrides the `Encounter.period.start`-based `EVN-2` above when a `Provenance` is present in the bundle                                                                 |
| `Provenance.reason[0]`                                 | `EVN-4`               |                                                                                                                                                                         |
| `Provenance.agent[0].who`                              | `EVN-5`               | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `Provenance.occurredDateTime`                          | `EVN-6`               |                                                                                                                                                                         |
| `Provenance.location`                                  | `EVN-7`               | Resolved from the referenced `Location`'s `.name`; falls back to `.display` when the referenced `Location` isn't in the bundle                                          |
| `CareTeam.participant[].role[0]`                       | `ROL-3`               |                                                                                                                                                                         |
| `CareTeam.participant[].member`                        | `ROL-4`               | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `CareTeam.participant[].period.start`                  | `ROL-5`               |                                                                                                                                                                         |
| `CareTeam.participant[].period.end`                    | `ROL-6`               |                                                                                                                                                                         |
| `CareTeam.reasonCode[0]`                               | `ROL-8`               | Written onto the first `ROL` segment only — `reasonCode` isn't per-participant on the FHIR side                                                                         |
| `CareTeam.participant[].role[1]`                       | `ROL-9`               |                                                                                                                                                                         |
| `CareTeam.telecom[0]`                                  | `ROL-12`              | Written onto the first `ROL` segment only, same reason as `ROL-8`                                                                                                       |
| `CareTeam.participant[].onBehalfOf`                    | `ROL-14`              | Resolved from the referenced `Organization`'s `.name`; falls back to `.display` when the referenced `Organization` isn't in the bundle                                  |
| `CareTeam.participant[].role[0].text`                  | `IN3-21`              | Only for a participant with no `member` and a text-only `role[0]` (no `coding`) — that shape identifies the Case Manager entry rather than a `ROL`-sourced one          |

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

Any segment other than
`MSH`/`EVN`/`PID`/`PD1`/`PV1`/`PV2`/`AL1`/`DG1`/`NK1`/`IN1`/`IN3`/`PR1`/`ROL` present in the
input (e.g. `GT1`, guarantor) is reported in `warnings[]` and otherwise ignored. In the
reverse direction, any FHIR resource in the bundle other than `Patient`/`Encounter`/
`AllergyIntolerance`/`Condition`/`RelatedPerson`/`Coverage`/`Organization`/`Location`/
`Practitioner`/`Procedure`/`MessageHeader`/`Provenance`/`CareTeam` is likewise warned about
and skipped. `ADT^A17` (swap patients, see below) doesn't attach
`AL1`/`DG1`/`NK1`/`IN1`/`IN3`/`PR1`/`ROL` to either patient — a two-patient swap message has
no clear per-patient ownership for a repeating optional segment, so if present there they're
warned about like any other unmapped segment for that trigger, rather than guessed at.
`PD1`/`PV2` are each single, non-repeating segments, so this ownership ambiguity doesn't
apply to them — `ADT^A17` simply doesn't read them for either patient, same as any other
segment not in its known set.

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
EVN|A01|20240101120000||01|7802^Rivera^Carlos^^RN|20240101115500|HOSP
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA||5559876543^PRN^PH|||M^Married^HL70002|||123-45-6789|D1234567|||||2|||||N
PD1|||FAMILY PRACTICE ASSOCIATES|9012^Nguyen^Anh^^MD
PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD|5678^Johnson^Mary^R^MD|||||||||||VN000123|||||||||||||||||||||||||20240101110000
PV2|||CHKUP^Annual checkup||||||||||||||||||||||R^Routine^HL70360
AL1|1|DA|1191^Aspirin^RXNORM|SV|Anaphylaxis|20230101
DG1|1||E119^Type 2 diabetes mellitus without complications^ICD10||20240101120000|W^Working^HL70052|||||||||1|9012^Nguyen^Anh^^MD
NK1|1|Doe^Jane^M|SPO|123 Main St^^Springfield^IL^62701^USA|5551234567^PRN^PH|||||||EMP009^^^HOSP|||F|19820310
IN1|1|PLAN001||Blue Cross|1 Insurance Plaza^^Chicago^IL^60601^USA||||||ACME Corp Group|20240101|20241231||HMO^Health Maintenance Organization|Doe^John^A|SEL
IN3|1||||||||||||||||||||Diane Okafor
PR1|1||89050^Appendectomy^CPT||20240101110000|S^Surgical^HL70230|||||||||K35.80^Acute appendicitis^ICD10||||||||OR1
ROL|1|AD|PP^Primary Care Physician^HL70443|9012^Nguyen^Anh^^MD|20240101080000|20241231235959||FU^Follow-up^HL70443|IM^Internal Medicine^SCT|||5553219876^WPN^PH||Springfield Medical Group
```

Output (`translateHl7ToFhir` — the complete Bundle, all nineteen entries):

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
          },
          { "value": "123-45-6789", "type": { "coding": [{ "code": "SS" }] } },
          { "value": "D1234567", "type": { "coding": [{ "code": "DL" }] } }
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
        ],
        "telecom": [{ "system": "phone", "value": "5559876543", "use": "home" }],
        "maritalStatus": {
          "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus", "code": "M", "display": "Married" }]
        },
        "multipleBirthInteger": 2,
        "deceasedBoolean": false,
        "generalPractitioner": [{ "display": "FAMILY PRACTICE ASSOCIATES" }, { "display": "Anh Nguyen" }]
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
              "reference": "Location/location-1",
              "display": "ICU"
            }
          }
        ],
        "participant": [
          {
            "individual": {
              "reference": "Practitioner/practitioner-attending",
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
          },
          {
            "individual": { "reference": "Practitioner/practitioner-referring", "display": "Mary Johnson" },
            "type": [
              {
                "coding": [
                  {
                    "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                    "code": "REF",
                    "display": "referrer"
                  }
                ]
              }
            ]
          }
        ],
        "identifier": [{ "value": "VN000123" }],
        "period": {
          "start": "2024-01-01T11:00:00Z"
        },
        "reasonCode": [
          {
            "coding": [{ "code": "CHKUP", "display": "Annual checkup" }],
            "text": "Annual checkup"
          }
        ],
        "diagnosis": [
          {
            "condition": { "reference": "Condition/condition-1" },
            "use": { "coding": [{ "code": "W", "display": "Working" }], "text": "Working" },
            "rank": 1
          }
        ],
        "priority": {
          "coding": [{ "code": "R", "display": "Routine" }],
          "text": "Routine"
        }
      }
    },
    {
      "resource": {
        "resourceType": "Location",
        "id": "location-1",
        "name": "ICU"
      }
    },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-attending",
        "name": [{ "family": "Smith", "given": ["Jane"] }]
      }
    },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-referring",
        "name": [{ "family": "Johnson", "given": ["Mary"] }]
      }
    },
    {
      "resource": {
        "resourceType": "AllergyIntolerance",
        "id": "allergyintolerance-1",
        "clinicalStatus": {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              "code": "active"
            }
          ]
        },
        "patient": {
          "reference": "Patient/patient-1"
        },
        "category": ["medication"],
        "code": {
          "coding": [
            {
              "code": "1191",
              "display": "Aspirin"
            }
          ],
          "text": "Aspirin"
        },
        "criticality": "high",
        "reaction": [
          {
            "manifestation": [
              {
                "text": "Anaphylaxis"
              }
            ],
            "severity": "severe"
          }
        ],
        "onsetDateTime": "2023-01-01"
      }
    },
    {
      "resource": {
        "resourceType": "Condition",
        "id": "condition-1",
        "subject": {
          "reference": "Patient/patient-1"
        },
        "code": {
          "coding": [
            {
              "code": "E119",
              "display": "Type 2 diabetes mellitus without complications"
            }
          ],
          "text": "Type 2 diabetes mellitus without complications"
        },
        "onsetDateTime": "2024-01-01T12:00:00Z",
        "asserter": {
          "reference": "Practitioner/practitioner-asserter-1",
          "display": "Anh Nguyen"
        }
      }
    },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-asserter-1",
        "name": [{ "family": "Nguyen", "given": ["Anh"] }]
      }
    },
    {
      "resource": {
        "resourceType": "RelatedPerson",
        "id": "relatedperson-1",
        "patient": {
          "reference": "Patient/patient-1"
        },
        "name": [
          {
            "family": "Doe",
            "given": ["Jane", "M"]
          }
        ],
        "relationship": [
          {
            "coding": [
              {
                "system": "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
                "code": "SPS",
                "display": "spouse"
              }
            ]
          }
        ],
        "address": [
          {
            "line": ["123 Main St"],
            "city": "Springfield",
            "state": "IL",
            "postalCode": "62701",
            "country": "USA"
          }
        ],
        "telecom": [
          {
            "system": "phone",
            "value": "5551234567",
            "use": "home"
          }
        ],
        "identifier": [
          {
            "value": "EMP009",
            "assigner": { "display": "HOSP" }
          }
        ],
        "gender": "female",
        "birthDate": "1982-03-10"
      }
    },
    {
      "resource": {
        "resourceType": "Coverage",
        "id": "coverage-1",
        "status": "active",
        "beneficiary": {
          "reference": "Patient/patient-1"
        },
        "payor": [
          {
            "reference": "Organization/organization-1",
            "display": "Blue Cross"
          }
        ],
        "identifier": [
          {
            "value": "PLAN001"
          }
        ],
        "policyHolder": {
          "display": "ACME Corp Group"
        },
        "period": {
          "start": "2024-01-01",
          "end": "2024-12-31"
        },
        "type": {
          "coding": [
            {
              "code": "HMO",
              "display": "Health Maintenance Organization"
            }
          ],
          "text": "Health Maintenance Organization"
        },
        "subscriber": {
          "display": "John Doe"
        },
        "relationship": {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
              "code": "ONESELF",
              "display": "self"
            }
          ]
        }
      }
    },
    {
      "resource": {
        "resourceType": "Organization",
        "id": "organization-1",
        "name": "Blue Cross",
        "address": [
          {
            "line": ["1 Insurance Plaza"],
            "city": "Chicago",
            "state": "IL",
            "postalCode": "60601",
            "country": "USA"
          }
        ]
      }
    },
    {
      "resource": {
        "resourceType": "Procedure",
        "id": "procedure-1",
        "status": "unknown",
        "subject": {
          "reference": "Patient/patient-1"
        },
        "code": {
          "coding": [
            {
              "code": "89050",
              "display": "Appendectomy"
            }
          ],
          "text": "Appendectomy"
        },
        "category": {
          "coding": [{ "code": "S", "display": "Surgical" }],
          "text": "Surgical"
        },
        "performedDateTime": "2024-01-01T11:00:00Z",
        "reasonCode": [
          {
            "coding": [{ "code": "K35.80", "display": "Acute appendicitis" }],
            "text": "Acute appendicitis"
          }
        ],
        "location": {
          "display": "OR1"
        }
      }
    },
    {
      "resource": {
        "resourceType": "CareTeam",
        "id": "careteam-1",
        "status": "active",
        "subject": { "reference": "Patient/patient-1" },
        "participant": [
          {
            "role": [
              { "coding": [{ "code": "PP", "display": "Primary Care Physician" }], "text": "Primary Care Physician" },
              { "coding": [{ "code": "IM", "display": "Internal Medicine" }], "text": "Internal Medicine" }
            ],
            "member": { "reference": "Practitioner/practitioner-team-1", "display": "Anh Nguyen" },
            "period": { "start": "2024-01-01T08:00:00Z", "end": "2024-12-31T23:59:59Z" },
            "onBehalfOf": { "reference": "Organization/organization-team-1", "display": "Springfield Medical Group" }
          },
          { "role": [{ "text": "Diane Okafor" }] }
        ],
        "reasonCode": [{ "coding": [{ "code": "FU", "display": "Follow-up" }], "text": "Follow-up" }],
        "telecom": [{ "system": "phone", "value": "5553219876", "use": "work" }]
      }
    },
    { "resource": { "resourceType": "Practitioner", "id": "practitioner-team-1", "name": [{ "family": "Nguyen", "given": ["Anh"] }] } },
    { "resource": { "resourceType": "Organization", "id": "organization-team-1", "name": "Springfield Medical Group" } },
    {
      "resource": {
        "resourceType": "Provenance",
        "id": "provenance-1",
        "target": [{ "reference": "Patient/patient-1" }, { "reference": "Encounter/encounter-1" }],
        "agent": [{ "who": { "reference": "Practitioner/practitioner-operator", "display": "Carlos Rivera" } }],
        "recorded": "2024-01-01T12:00:00Z",
        "occurredDateTime": "2024-01-01T11:55:00Z",
        "reason": [{ "coding": [{ "code": "01" }] }],
        "location": { "reference": "Location/provenance-location", "display": "HOSP" }
      }
    },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-operator",
        "name": [{ "family": "Rivera", "given": ["Carlos"] }]
      }
    },
    { "resource": { "resourceType": "Location", "id": "provenance-location", "name": "HOSP" } },
    {
      "resource": {
        "resourceType": "MessageHeader",
        "id": "messageheader-1",
        "source": { "name": "HIS", "endpoint": "urn:hl7v2:HIS" },
        "destination": [{ "name": "ADT", "endpoint": "urn:hl7v2:ADT" }],
        "eventCoding": {
          "system": "http://terminology.hl7.org/CodeSystem/v2-0003",
          "code": "A01",
          "display": "ADT^A01"
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
**Resources produced**: two `Patient`+`Encounter`+`Location`+`Practitioner` groups
(`patient-1`/`encounter-1`/`location-1`/`practitioner-1-attending`,
`patient-2`/`encounter-2`/`location-2`/`practitioner-2-attending`), plus one shared
`MessageHeader` (from `MSH`, always produced) and one shared `Provenance` (from `EVN`, only
when `EVN-5` is present, targeting both patients and both encounters — see `A01`'s `EVN`
table above for the field-by-field mapping, identical here)

### Forward: HL7v2 → FHIR

Each `PID`/`PV1` pair maps through the exact same fields as `A01` above, applied twice —
once per pair, in message order (the field-by-field notes are identical to the `A01` table
two sections up, so aren't repeated here in full):

| HL7v2 field | FHIR path                           | Notes                                                                                                                                      |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `PID-3.1`   | `Patient.identifier[0].value`       | Medical record number, per patient                                                                                                         |
| `PID-5.1`   | `Patient.name[0].family`            | Per patient                                                                                                                                |
| `PID-5.2`   | `Patient.name[0].given[0]`          | Per patient                                                                                                                                |
| `PID-7`     | `Patient.birthDate`                 | Per patient                                                                                                                                |
| `PID-8`     | `Patient.gender`                    | Per patient                                                                                                                                |
| `PID-11.1`  | `Patient.address[0].line[0]`        | Per patient                                                                                                                                |
| `PV1-2`     | `Encounter.class`                   | Per patient's own `PV1`                                                                                                                    |
| `PV1-3.1`   | `Location.name`                     | Per patient's own `PV1`; a `Location` resource is built and referenced from `Encounter.location[0].location`, same as `A01` above          |
| `PV1-7.2`   | `Practitioner.name[0].family`       | Per patient's own `PV1`; a `Practitioner` resource is built and referenced from `Encounter.participant[0].individual`, same as `A01` above |
| `EVN-2`     | `Encounter.period.start`            | Shared — one `EVN` covers both patients                                                                                                    |
| `MSH-3`     | `MessageHeader.source.name`         | Shared, same as `A01` above                                                                                                                |
| `MSH-5`     | `MessageHeader.destination[0].name` | Shared, same as `A01` above                                                                                                                |
| `EVN-4`     | `Provenance.reason[0]`              | Shared, same as `A01` above                                                                                                                |
| `EVN-5`     | `Provenance.agent[0].who`           | Shared, same as `A01` above — one `Practitioner`, referenced by the single shared `Provenance`                                             |
| `EVN-6`     | `Provenance.occurredDateTime`       | Shared, same as `A01` above                                                                                                                |
| `EVN-7`     | `Provenance.location`               | Shared, same as `A01` above                                                                                                                |

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
skipped; any FHIR resource other than `Patient`/`Encounter`/`Location`/`Practitioner`/
`MessageHeader`/`Provenance` is likewise warned about and skipped on the reverse direction.

### Worked example

Input (`samples/adt_a17.hl7`):

```hl7
MSH|^~\&|HIS|HOSP|ADT|HOSP|20240112143000||ADT^A17|MSG019|P|2.5
EVN|A17|20240112143000||05|8891^Chen^Linda^^RN|20240112142900|HOSP
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA
PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD
PID|2||MRN67890^^^HOSP^MR||Roe^Richard^B||19750822|M|||789 Elm St^^Springfield^IL^62701^USA
PV1|2|I|ICU^102^B^^^HOSP||||5678^Nguyen^Anh^^MD
```

Output (`translateHl7ToFhir` — a 12-entry Bundle: `Patient`, `Encounter`, `Location`,
`Practitioner`, `Patient`, `Encounter`, `Location`, `Practitioner` (one group per patient
in the swap), the shared `Provenance` plus the `Practitioner`/`Location` it references, and
a trailing `MessageHeader`):

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
        "location": [{ "location": { "reference": "Location/location-1", "display": "ICU" } }],
        "participant": [
          {
            "individual": { "reference": "Practitioner/practitioner-1-attending", "display": "Jane Smith" },
            "type": [
              {
                "coding": [
                  { "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "code": "ATND", "display": "attender" }
                ]
              }
            ]
          }
        ]
      }
    },
    { "resource": { "resourceType": "Location", "id": "location-1", "name": "ICU" } },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-1-attending",
        "name": [{ "family": "Smith", "given": ["Jane"] }]
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
        "location": [{ "location": { "reference": "Location/location-2", "display": "ICU" } }],
        "participant": [
          {
            "individual": { "reference": "Practitioner/practitioner-2-attending", "display": "Anh Nguyen" },
            "type": [
              {
                "coding": [
                  { "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", "code": "ATND", "display": "attender" }
                ]
              }
            ]
          }
        ]
      }
    },
    { "resource": { "resourceType": "Location", "id": "location-2", "name": "ICU" } },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-2-attending",
        "name": [{ "family": "Nguyen", "given": ["Anh"] }]
      }
    },
    {
      "resource": {
        "resourceType": "Provenance",
        "id": "provenance-1",
        "target": [
          { "reference": "Patient/patient-1" },
          { "reference": "Encounter/encounter-1" },
          { "reference": "Patient/patient-2" },
          { "reference": "Encounter/encounter-2" }
        ],
        "agent": [{ "who": { "reference": "Practitioner/practitioner-operator", "display": "Linda Chen" } }],
        "recorded": "2024-01-12T14:30:00Z",
        "occurredDateTime": "2024-01-12T14:29:00Z",
        "reason": [{ "coding": [{ "code": "05" }] }],
        "location": { "reference": "Location/provenance-location", "display": "HOSP" }
      }
    },
    {
      "resource": {
        "resourceType": "Practitioner",
        "id": "practitioner-operator",
        "name": [{ "family": "Chen", "given": ["Linda"] }]
      }
    },
    { "resource": { "resourceType": "Location", "id": "provenance-location", "name": "HOSP" } },
    {
      "resource": {
        "resourceType": "MessageHeader",
        "id": "messageheader-1",
        "source": { "name": "HIS", "endpoint": "urn:hl7v2:HIS" },
        "destination": [{ "name": "ADT", "endpoint": "urn:hl7v2:ADT" }],
        "eventCoding": {
          "system": "http://terminology.hl7.org/CodeSystem/v2-0003",
          "code": "A17",
          "display": "ADT^A17"
        }
      }
    }
  ]
}
```

---

## ORU^R01 (unsolicited lab result)

**Segments read**: `MSH`, `PID`, `OBR` (one panel), `OBX` (one or more results), `NTE` (zero or more, each attached to the `OBX` it immediately follows)
**Resources produced**: `Patient`, `DiagnosticReport`, one `Observation` per `OBX`,
`MessageHeader` (from `MSH`, always produced)

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

| HL7v2 field       | FHIR path                                                                        | Notes                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBR-2.1`         | `DiagnosticReport.identifier[0]`                                                 | Placer order number; `identifier[0].type.coding[0].code` is hardcoded to `PLAC`                                                                                                                                                 |
| `OBR-3.1`         | `DiagnosticReport.identifier[1]`                                                 | Filler order number; `identifier[1].type.coding[0].code` is hardcoded to `FILL`                                                                                                                                                 |
| `OBR-4.1`         | `DiagnosticReport.code.coding[0].code`                                           | System = LOINC                                                                                                                                                                                                                  |
| `OBR-4.2`         | `DiagnosticReport.code.coding[0].display` and `.text`                            | Panel name, e.g. "CBC"                                                                                                                                                                                                          |
| `OBR-7`           | `DiagnosticReport.effectiveDateTime`                                             | Observation/collection date-time; or `.effectivePeriod.start` when `OBR-8` (end) is also present                                                                                                                                |
| `OBR-8`           | `DiagnosticReport.effectivePeriod.end`                                           | Only set alongside `OBR-7`; without a start, an end alone isn't mapped                                                                                                                                                          |
| `OBR-22`          | `DiagnosticReport.issued`                                                        | Results report/status change date-time                                                                                                                                                                                          |
| `OBR-24`          | `DiagnosticReport.category[0].coding[0].code`                                    | Diagnostic service section id (ID datatype — no display component)                                                                                                                                                              |
| `OBR-25`          | `DiagnosticReport.status`                                                        | HL7 Table 0123 → `http://hl7.org/fhir/diagnostic-report-status` (`O`/`I`/`S`→`registered`, `P`→`preliminary`, `C`→`corrected`, `R`→`partial`, `F`→`final`, `X`→`cancelled`); falls back to `final` when absent or unmapped      |
| `OBX-1`           | `Observation[i].id` suffix                                                       | Set ID, used to generate a stable `observation-<n>` id                                                                                                                                                                          |
| `OBX-3.1`         | `Observation[i].code.coding[0].code`                                             | System = LOINC; **required** — an `OBX` missing `OBX-3` is skipped with a warning, not defaulted                                                                                                                                |
| `OBX-3.2`         | `Observation[i].code.coding[0].display` and `.text`                              |                                                                                                                                                                                                                                 |
| `OBX-2` + `OBX-5` | `Observation[i].valueQuantity` (if `OBX-2` = `NM`) or `.valueString` (otherwise) | Numeric values are parsed with `Number()`                                                                                                                                                                                       |
| `OBX-6`           | `Observation[i].valueQuantity.unit`                                              | Only set alongside `valueQuantity`                                                                                                                                                                                              |
| `OBX-7`           | `Observation[i].referenceRange[0]`                                               | Parsed from a `"low-high"` numeric string, e.g. `"13.5-17.5"` → `{ low: {value: 13.5}, high: {value: 17.5} }`; non-numeric ranges are left unmapped                                                                             |
| `OBX-8`           | `Observation[i].interpretation[0].coding[0].code`                                | System = v3-ObservationInterpretation                                                                                                                                                                                           |
| `OBX-14`          | `Observation[i].effectiveDateTime`                                               |                                                                                                                                                                                                                                 |
| `OBX-11`          | `Observation[i].status`                                                          | HL7 Table 0085 → `http://hl7.org/fhir/observation-status` (`A`→amended, `C`→corrected, `D`/`W`→entered-in-error, `F`→final, `P`→preliminary, `X`→cancelled); falls back to `final` when absent or unmapped                      |
| `OBX-17`          | `Observation[i].method`                                                          | CE/CWE — observation method                                                                                                                                                                                                     |
| `OBX-20`          | `Observation[i].bodySite`                                                        | CE/CWE — observation site                                                                                                                                                                                                       |
| `OBX-21`          | `Observation[i].identifier[0]`                                                   | EI — observation instance identifier                                                                                                                                                                                            |
| `OBX-29`          | `Observation[i].category[0]`                                                     | CE/CWE — observation type                                                                                                                                                                                                       |
| `NTE-3`           | `Observation[i].note[].text`                                                     | One entry per `NTE` segment immediately following that `OBX`, in message order — an `NTE` annotates the `OBX` right before it, not the whole message (unlike `NTE` on `ORM`/`OML`, which annotates the single `ServiceRequest`) |
| `NTE-6`           | `Observation[i].note[].time`                                                     | Only set alongside `NTE-3`                                                                                                                                                                                                      |
| `MSH-3`           | `MessageHeader.source.name`                                                      | Sending application; endpoint synthesized as `urn:hl7v2:<name>`                                                                                                                                                                 |
| `MSH-5`           | `MessageHeader.destination[0].name`                                              | Receiving application, synthesized the same way                                                                                                                                                                                 |
| `MSH-9`           | `MessageHeader.eventCoding`                                                      | Trigger event code/display                                                                                                                                                                                                      |

`DiagnosticReport.status` is always `final` (this package doesn't map `OBR-25`, only
`OBX-11` per-Observation). `DiagnosticReport.result[]` is populated with a `Reference` to
every `Observation` produced from the message, in `OBX` order.

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

| FHIR path                                                     | HL7v2 field | Notes                                                                                                       |
| ------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `DiagnosticReport.identifier[0]`                              | `OBR-2`     | Written only when `type.coding[0].code` is `PLAC`                                                           |
| `DiagnosticReport.identifier[1]`                              | `OBR-3`     | Written only when `type.coding[0].code` is `FILL`                                                           |
| `DiagnosticReport.code.coding[0].code`                        | `OBR-4.1`   | System component is hardcoded to `LN` on the way out (LOINC)                                                |
| `DiagnosticReport.code.coding[0].display`                     | `OBR-4.2`   |                                                                                                             |
| `DiagnosticReport.effectiveDateTime`/`.effectivePeriod.start` | `OBR-7`     |                                                                                                             |
| `DiagnosticReport.effectivePeriod.end`                        | `OBR-8`     | Only written when `effectivePeriod.start` is also present                                                   |
| `DiagnosticReport.issued`                                     | `OBR-22`    |                                                                                                             |
| `DiagnosticReport.category[0].coding[0].code`                 | `OBR-24`    |                                                                                                             |
| `DiagnosticReport.status`                                     | `OBR-25`    | Inverse of the forward table's HL7 Table 0123 lookup; only written when the status has a known reverse code |
| _(loop index)_                                                | `OBX-1`     | Written sequentially from 1 for each `Observation`, regardless of the source `Observation.id`               |
| `Observation[i].code.coding[0].code`                          | `OBX-3.1`   | System component hardcoded to `LN`                                                                          |
| `Observation[i].code.coding[0].display`                       | `OBX-3.2`   |                                                                                                             |
| `Observation[i].valueQuantity.value`                          | `OBX-5`     | Also sets `OBX-2` to `NM`                                                                                   |
| `Observation[i].valueQuantity.unit`                           | `OBX-6`     | Only written alongside `valueQuantity`                                                                      |
| `Observation[i].valueString`                                  | `OBX-5`     | Used only when `valueQuantity` is absent; sets `OBX-2` to `ST` instead                                      |
| `Observation[i].referenceRange[0]`                            | `OBX-7`     | Written back as `"low-high"`, e.g. `{ low: {value: 13.5}, high: {value: 17.5} }` → `"13.5-17.5"`            |
| `Observation[i].interpretation[0].coding[0].code`             | `OBX-8`     |                                                                                                             |
| `Observation[i].effectiveDateTime`                            | `OBX-14`    |                                                                                                             |
| `Observation[i].status`                                       | `OBX-11`    | Inverse of the forward table's HL7 Table 0085 lookup; falls back to `F` when unmapped                       |
| `Observation[i].method`                                       | `OBX-17`    |                                                                                                             |
| `Observation[i].bodySite`                                     | `OBX-20`    |                                                                                                             |
| `Observation[i].identifier[0].value`                          | `OBX-21`    |                                                                                                             |
| `Observation[i].category[0]`                                  | `OBX-29`    |                                                                                                             |
| `Observation[i].note[].text`                                  | `NTE-3`     | One `NTE` segment per note, placed right after that `Observation`'s `OBX` segment                           |
| `Observation[i].note[].time`                                  | `NTE-6`     |                                                                                                             |

The remaining `MSH` fields are always synthesized:

| HL7v2 field         | Value                                            | Notes                                                                          |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `MSH-2`             | `^~\&`                                           | Standard encoding characters                                                   |
| `MSH-3`             | `MessageHeader.source.name` or `FHIR-TRANSLATOR` | Falls back to the synthesized default when no `MessageHeader` is in the bundle |
| `MSH-4`             | `HL7FHIR`                                        | Synthetic sending facility (always synthesized, not read from `MessageHeader`) |
| `MSH-5`             | `MessageHeader.destination[0].name` or `HIS`     | Falls back the same way                                                        |
| `MSH-6`             | `HOSP`                                           | Synthetic receiving facility                                                   |
| `MSH-7`             | Current UTC timestamp                            | Message creation time                                                          |
| `MSH-9`             | `ORU^R01`                                        |                                                                                |
| `MSH-10`            | Generated control ID (`TRX<timestamp><counter>`) |                                                                                |
| `MSH-11` / `MSH-12` | `P` / `2.5`                                      | Processing ID, version ID                                                      |

### Not mapped

Any segment other than `MSH`/`PID`/`OBR`/`OBX`/`NTE` is warned about and skipped. Any FHIR
resource in the bundle other than `Patient`/`DiagnosticReport`/`Observation`/`MessageHeader`
is likewise warned about and skipped on the reverse direction. A message
with zero `OBX` segments throws `FhirValidationError` rather than producing an empty
report — an ORU with no results is treated as malformed input, not a valid empty
translation.

### Worked example

Input (`samples/oru_r01.hl7`) has two `OBX` results (Hemoglobin, Hematocrit); output is a
5-entry Bundle: `Patient`, `DiagnosticReport` (referencing both), two `Observation`
resources, and a trailing `MessageHeader`. Full input/output pair is in [`samples/oru_r01.hl7`](../samples/oru_r01.hl7) —
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
  "effectiveDateTime": "2024-01-01T13:00:00Z",
  "method": {
    "coding": [{ "code": "Spectrophotometry" }]
  },
  "bodySite": {
    "coding": [{ "code": "65205", "display": "Left arm vein" }],
    "text": "Left arm vein"
  },
  "identifier": [{ "value": "OBSID001", "assigner": { "display": "HOSP" } }],
  "category": [
    {
      "coding": [{ "code": "96945", "display": "Chem/Hem" }],
      "text": "Chem/Hem"
    }
  ],
  "note": [{ "text": "Hemolyzed specimen, repeat draw recommended", "time": "2024-01-01T13:15:00Z" }]
}
```

---

## ORM^O01 (general order)

**Segments read**: `MSH`, `PID`, `ORC`, `OBR`, `NTE` (zero or more), `TQ1` (first occurrence only), `PRT` (zero or more)
**Resources produced**: `Patient`, `ServiceRequest`, `Practitioner` (from `ORC-12`/`OBR-16`, if present, plus one
per `PractitionerRole`-describing `PRT` repetition), `MessageHeader` (from `MSH`, always produced), `Device`
(one per `PRT` repetition describing one — see below), `PractitionerRole`/`Organization`/`Location` (from
`PRT` repetitions describing a person — see below)

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

| HL7v2 field             | FHIR path                                           | Notes                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORC-1`                 | `ServiceRequest.status`                             | `NW`→`active`, `CA`→`revoked`, `CM`→`completed`; else `active`                                                                                                                                                                                        |
| `ORC-9`                 | `ServiceRequest.authoredOn`                         | Date/time of transaction                                                                                                                                                                                                                              |
| `ORC-12.2` / `ORC-12.3` | `Practitioner.name[0]`                              | Ordering provider family/given name; falls back to `OBR-16.2`/`.3` if `ORC-12` is absent. A `Practitioner` resource is built and referenced from `ServiceRequest.requester`, with the same name also copied to `.display`                             |
| `OBR-4.1`               | `ServiceRequest.code.coding[0].code`                | System = LOINC                                                                                                                                                                                                                                        |
| `OBR-4.2`               | `ServiceRequest.code.coding[0].display` and `.text` |                                                                                                                                                                                                                                                       |
| `OBR-7`                 | `ServiceRequest.occurrenceDateTime`                 | Requested date/time                                                                                                                                                                                                                                   |
| `OBR-2.1`               | `ServiceRequest.identifier[0]`                      | Placer order number; `identifier[0].type.coding[0].code` is hardcoded to `PLAC`                                                                                                                                                                       |
| `OBR-3.1`               | `ServiceRequest.identifier[1]`                      | Filler order number; `identifier[1].type.coding[0].code` is hardcoded to `FILL`                                                                                                                                                                       |
| `ORC-33.1`              | `ServiceRequest.identifier[]`                       | Alternate placer order number, appended with no `type.coding` (distinguishing it from the `PLAC`/`FILL` entries above)                                                                                                                                |
| `OBR-31.1`              | `ServiceRequest.reasonCode[0].coding[0].code`       | CWE — reason for study                                                                                                                                                                                                                                |
| `OBR-31.2`              | `ServiceRequest.reasonCode[0].coding[0].display`    |                                                                                                                                                                                                                                                       |
| `NTE-3`                 | `ServiceRequest.note[].text`                        | One entry per `NTE` segment in the message, in message order                                                                                                                                                                                          |
| `TQ1-9`                 | `ServiceRequest.priority`                           | HL7 Table 0485 → FHIR `request-priority`, via the `table-hl70485-to-request-priority` vocabulary table (`S`→`stat`, `A`→`asap`, `R`→`routine`; other codes have no FHIR-side match and leave `priority` unset). Only the first `TQ1` segment is read. |
| `MSH-3`                 | `MessageHeader.source.name`                         | Sending application; endpoint synthesized as `urn:hl7v2:<name>`                                                                                                                                                                                       |
| `MSH-5`                 | `MessageHeader.destination[0].name`                 | Receiving application, synthesized the same way                                                                                                                                                                                                       |
| `MSH-9`                 | `MessageHeader.eventCoding`                         | Trigger event code/display                                                                                                                                                                                                                            |

`ServiceRequest.intent` is always `order`. This "Order fields" table (and its reverse
counterpart below) is shared code (`mapping/order.ts`) between `ORM^O01` and `OML^O21` — see
the `OML^O21` section below for what it adds on top (`SPM`).

`TQ1`'s other fields (`TQ1-2` through `TQ1-8`, `TQ1-13`, `TQ1-14`) map, per the IG, into a
FHIR `Timing` structure on `ServiceRequest.occurrenceTiming` — a different branch of the same
choice-type field this package already populates as `occurrenceDateTime` from `OBR-7`, so the
two can't coexist on one `ServiceRequest`. `TQ1-11` (free-text instruction) maps to the same
`note[]` array already owned by `NTE-3`; mapping both would make round-tripping ambiguous
about which segment produced a given note. Both are left unmapped for these reasons rather
than implemented and silently wrong.

`PRT` (participation) fields, per the official IG's "Segment PRT to Device Map" and
"Segment PRT to PractitionerRole Map" (`ConceptMap-segment-prt-to-device.html` /
`-to-practitionerrole.html`, fetched directly). `PRT` is a repeating, multi-purpose
participant segment covering people, organizations, locations, and devices; this package
dispatches each repetition by which identifying field is populated — `PRT-10`/`PRT-16`
(device fields) build a `Device`, `PRT-5` (Person, XCN) builds a `PractitionerRole`. The
`PRT`-to-`CareTeam` map is not implemented:

| HL7v2 field | FHIR path                               | Notes                                                                |
| ----------- | --------------------------------------- | -------------------------------------------------------------------- |
| `PRT-10`    | `Device.identifier[0].value`            | CWE — device code; only the code component is kept                   |
| `PRT-16`    | `Device.udiCarrier[0].deviceIdentifier` | Raw UDI string — see note below on the simplified `udiCarrier` shape |
| `PRT-17`    | `Device.manufactureDate`                |                                                                      |
| `PRT-18`    | `Device.expirationDate`                 |                                                                      |
| `PRT-19`    | `Device.lotNumber`                      |                                                                      |
| `PRT-20`    | `Device.serialNumber`                   |                                                                      |
| `PRT-21`    | `Device.distinctIdentifier`             |                                                                      |
| `PRT-22`    | `Device.type`                           | CWE — device type                                                    |

This package doesn't replicate FHIR's full `udiCarrier` component structure
(`deviceIdentifier`/`carrierHRF`/`entryType`/etc.) — `PRT-16` is a single UDI string with no
further HL7v2-side decomposition to draw the other components from, so only
`udiCarrier[0].deviceIdentifier` is populated.

`PractitionerRole` fields (from `PRT` repetitions where `PRT-5` is present):

| HL7v2 field | FHIR path                       | Notes                                                                                                                            |
| ----------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PRT-4`     | `PractitionerRole.code[0]`      | CWE — role of participation                                                                                                      |
| `PRT-5`     | `PractitionerRole.practitioner` | XCN family/given name. A `Practitioner` resource is built and referenced, with the same name also copied to `.display`           |
| `PRT-6`     | `PractitionerRole.specialty[0]` | CWE — person provider type                                                                                                       |
| `PRT-8`     | `PractitionerRole.organization` | XON — organization name only. A real `Organization` resource is built and referenced, same pattern as `IN1-4` in ADT above       |
| `PRT-9`     | `PractitionerRole.location[0]`  | PL — point-of-care component only, same convention as `PV1-3.1` in ADT above. A real `Location` resource is built and referenced |
| `PRT-11`    | `PractitionerRole.period.start` |                                                                                                                                  |
| `PRT-12`    | `PractitionerRole.period.end`   |                                                                                                                                  |
| `PRT-15`    | `PractitionerRole.telecom[0]`   | XTN — only the first occurrence is read                                                                                          |

`PRT-7` (Organization Unit Type, nested on the referenced `Organization` per the IG) isn't
mapped — this package's `Organization` shape doesn't carry a `type`, and extending it for
this one field alone isn't worth the interface change. `PRT-14` (the participant's address)
isn't mapped for the same reason on `Practitioner`.

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

| FHIR path                                | HL7v2 field             | Notes                                                                                                                                                                              |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ServiceRequest.status`                  | `ORC-1`                 | Inverse of the forward table: `active`→`NW`, `revoked`→`CA`, `completed`→`CM`, else `NW`                                                                                           |
| `ServiceRequest.authoredOn`              | `ORC-9`                 |                                                                                                                                                                                    |
| `ServiceRequest.requester`               | `ORC-12.2` / `ORC-12.3` | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise            |
| `ServiceRequest.code.coding[0].code`     | `OBR-4.1`               | System component hardcoded to `LN` on the way out                                                                                                                                  |
| `ServiceRequest.code.coding[0].display`  | `OBR-4.2`               |                                                                                                                                                                                    |
| `ServiceRequest.occurrenceDateTime`      | `OBR-7`                 |                                                                                                                                                                                    |
| `ServiceRequest.reasonCode[0].coding[0]` | `OBR-31`                |                                                                                                                                                                                    |
| `ServiceRequest.note[].text`             | `NTE-3`                 | One `NTE` segment per note, in array order                                                                                                                                         |
| `ServiceRequest.priority`                | `TQ1-9`                 | Inverse of `table-hl70485-to-request-priority`; a `TQ1` segment is only emitted when `priority` is set                                                                             |
| `ServiceRequest.identifier[]` (untyped)  | `ORC-33`                | First identifier with no `type.coding` (i.e. not the `PLAC`/`FILL` entries)                                                                                                        |
| _(constant)_                             | `ORC-2` and `OBR-2`     | A placer order number is synthesized (`ORD<last 6 digits of the generated control ID>`) and written to both, so the two segments stay linked the way the forward direction expects |

`ServiceRequest.identifier` entries typed `PLAC`/`FILL` are **not** round-tripped back into
`OBR-2`/`OBR-3` — those fields are already used above for the synthesized placer/filler
linking number, not for carrying an arbitrary FHIR identifier back out. An untyped
identifier (i.e. one with no `type.coding`) is round-tripped to `ORC-33` instead, per the
row above.

`PRT` fields:

| FHIR path                               | HL7v2 field | Notes |
| --------------------------------------- | ----------- | ----- |
| `Device.identifier[0].value`            | `PRT-10`    |       |
| `Device.udiCarrier[0].deviceIdentifier` | `PRT-16`    |       |
| `Device.manufactureDate`                | `PRT-17`    |       |
| `Device.expirationDate`                 | `PRT-18`    |       |
| `Device.lotNumber`                      | `PRT-19`    |       |
| `Device.serialNumber`                   | `PRT-20`    |       |
| `Device.distinctIdentifier`             | `PRT-21`    |       |
| `Device.type`                           | `PRT-22`    |       |

One `PRT` segment is written per `Device` resource in the bundle, in bundle order.

`PractitionerRole` fields:

| FHIR path                       | HL7v2 field | Notes                                                                                                                                                                   |
| ------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PractitionerRole.code[0]`      | `PRT-4`     |                                                                                                                                                                         |
| `PractitionerRole.practitioner` | `PRT-5`     | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `PractitionerRole.specialty[0]` | `PRT-6`     |                                                                                                                                                                         |
| `PractitionerRole.organization` | `PRT-8`     | Resolved from the referenced `Organization`'s `.name`; falls back to `.display` when the referenced `Organization` isn't in the bundle                                  |
| `PractitionerRole.location[0]`  | `PRT-9`     | Resolved from the referenced `Location`'s `.name`; falls back to `.display` the same way                                                                                |
| `PractitionerRole.period.start` | `PRT-11`    |                                                                                                                                                                         |
| `PractitionerRole.period.end`   | `PRT-12`    |                                                                                                                                                                         |
| `PractitionerRole.telecom[0]`   | `PRT-15`    |                                                                                                                                                                         |

One `PRT` segment is written per `PractitionerRole` resource in the bundle, in bundle order,
separate from (and after) the `Device`-sourced `PRT` segments above.

The remaining `MSH` fields are always synthesized:

| HL7v2 field         | Value                                            | Notes                                                                          |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `MSH-2`             | `^~\&`                                           | Standard encoding characters                                                   |
| `MSH-3`             | `MessageHeader.source.name` or `FHIR-TRANSLATOR` | Falls back to the synthesized default when no `MessageHeader` is in the bundle |
| `MSH-4`             | `HL7FHIR`                                        | Synthetic sending facility (always synthesized, not read from `MessageHeader`) |
| `MSH-5`             | `MessageHeader.destination[0].name` or `HIS`     | Falls back the same way                                                        |
| `MSH-6`             | `HOSP`                                           | Synthetic receiving facility                                                   |
| `MSH-7`             | Current UTC timestamp                            | Message creation time                                                          |
| `MSH-9`             | `ORM^O01`                                        |                                                                                |
| `MSH-10`            | Generated control ID (`TRX<timestamp><counter>`) |                                                                                |
| `MSH-11` / `MSH-12` | `P` / `2.5`                                      | Processing ID, version ID                                                      |

### Not mapped

Any segment other than `MSH`/`PID`/`ORC`/`OBR`/`NTE`/`TQ1`/`PRT` is warned about and
skipped. Any FHIR resource in the bundle other than `Patient`/`ServiceRequest`/
`Practitioner`/`MessageHeader`/`Device`/`PractitionerRole`/`Organization`/`Location` is
likewise warned about and skipped on the reverse direction.

### Worked example

Input (`samples/orm_o01.hl7`) produces a 9-entry Bundle (`Patient`, `ServiceRequest`,
`Practitioner`, `Device`, `PractitionerRole`, `Practitioner`, `Organization`, `Location`,
`MessageHeader`):

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
  "identifier": [
    { "value": "ORD001", "type": { "coding": [{ "code": "PLAC" }] } },
    { "value": "FIL9001", "type": { "coding": [{ "code": "FILL" }] } },
    { "value": "ALT-ORD001" }
  ],
  "reasonCode": [
    {
      "coding": [{ "code": "789.0", "display": "Abdominal pain" }],
      "text": "Abdominal pain"
    }
  ],
  "authoredOn": "2024-01-01T11:00:00Z",
  "occurrenceDateTime": "2024-01-01T11:00:00Z",
  "requester": {
    "reference": "Practitioner/practitioner-requester",
    "display": "Jane Smith"
  },
  "note": [
    {
      "text": "Patient fasting for 12 hours prior to draw"
    }
  ],
  "priority": "routine"
}
```

The bundle also includes a `Practitioner` entry for the requester (`{ "resourceType": "Practitioner", "id": "practitioner-requester", "name": [{ "family": "Smith", "given": ["Jane"] }] }`); a `Device` entry built from the sample's first `PRT` segment (`{ "resourceType": "Device", "id": "device-1", "identifier": [{ "value": "AUTO123" }], "udiCarrier": [{ "deviceIdentifier": "01234567890128" }], "manufactureDate": "2023-01-01", "expirationDate": "2026-01-01", "lotNumber": "LOT4455", "serialNumber": "SN998877", "distinctIdentifier": "DON0099", "type": { "coding": [{ "code": "ANALYZER", "display": "Analyzer" }], "text": "Analyzer" } }`); a `PractitionerRole` entry built from the sample's second `PRT` segment, referencing a `Practitioner`, `Organization`, and `Location`:

```json
{
  "resourceType": "PractitionerRole",
  "id": "practitionerrole-1",
  "code": [{ "coding": [{ "code": "CONSULT", "display": "Consulting Provider" }], "text": "Consulting Provider" }],
  "practitioner": { "reference": "Practitioner/practitioner-role-1", "display": "Rita Patel" },
  "specialty": [{ "coding": [{ "code": "CARD", "display": "Cardiology" }], "text": "Cardiology" }],
  "organization": { "reference": "Organization/organization-role-1", "display": "Central Lab Services" },
  "location": [{ "reference": "Location/location-role-1", "display": "LAB2" }],
  "period": { "start": "2024-01-01T10:00:00Z", "end": "2024-01-01T12:00:00Z" },
  "telecom": [{ "system": "phone", "value": "5551112222", "use": "work" }]
}
```

(`{ "resourceType": "Practitioner", "id": "practitioner-role-1", "name": [{ "family": "Patel", "given": ["Rita"] }] }`, `{ "resourceType": "Organization", "id": "organization-role-1", "name": "Central Lab Services" }`, and `{ "resourceType": "Location", "id": "location-role-1", "name": "LAB2" }`); and a trailing `MessageHeader` (`{ "resourceType": "MessageHeader", "id": "messageheader-1", "source": { "name": "HIS", "endpoint": "urn:hl7v2:HIS" }, "destination": [{ "name": "LIS", "endpoint": "urn:hl7v2:LIS" }], "eventCoding": { "system": "http://terminology.hl7.org/CodeSystem/v2-0003", "code": "O01", "display": "ORM^O01" } }`).

---

## VXU^V04 (immunization record update)

**Segments read**: `MSH`, `PID`, `RXA`
**Resources produced**: `Patient`, `Immunization`, `Practitioner` (from `RXA-10`, if present),
`MessageHeader` (from `MSH`, always produced)

### Forward: HL7v2 → FHIR

Patient fields follow the same `PID` table as the ADT/ORU/ORM forward tables above. Immunization fields:

| HL7v2 field | FHIR path                                                | Notes                                                                                                                                                                      |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RXA-20`    | `Immunization.status`                                    | `CP`/`PA`→`completed`, `RE`/`NA`→`not-done`, else `completed`                                                                                                              |
| `RXA-5.1`   | `Immunization.vaccineCode.coding[0].code`                | System = CVX                                                                                                                                                               |
| `RXA-5.2`   | `Immunization.vaccineCode.coding[0].display` and `.text` |                                                                                                                                                                            |
| `RXA-3`     | `Immunization.occurrenceDateTime`                        | Date/time administration started                                                                                                                                           |
| `RXA-6`     | `Immunization.doseQuantity.value`                        | Parsed with `Number()`                                                                                                                                                     |
| `RXA-7.1`   | `Immunization.doseQuantity.unit`                         | Only set alongside `doseQuantity.value`                                                                                                                                    |
| `RXA-15`    | `Immunization.lotNumber`                                 |                                                                                                                                                                            |
| `RXA-16`    | `Immunization.expirationDate`                            | `YYYYMMDD` → `YYYY-MM-DD`                                                                                                                                                  |
| `RXA-17.2`  | `Immunization.manufacturer.display`                      |                                                                                                                                                                            |
| `RXA-10.2`  | `Practitioner.name[0].family`                            | Administering provider family name; a `Practitioner` resource is built and referenced from `Immunization.performer[0].actor`, with the same name also copied to `.display` |
| `RXA-10.3`  | `Practitioner.name[0].given[0]`                          | Administering provider given name                                                                                                                                          |
| `RXA-19.1`  | `Immunization.reasonCode[0].coding[0].code`              | CWE — reason the immunization was given                                                                                                                                    |
| `RXA-19.2`  | `Immunization.reasonCode[0].coding[0].display`           |                                                                                                                                                                            |
| `RXA-22`    | `Immunization.recorded`                                  | Date/time the administration was documented                                                                                                                                |
| `RXA-27`    | `Immunization.location.display`                          | PL — point-of-care component only, same convention as `PV1-3.1` above                                                                                                      |
| `MSH-3`     | `MessageHeader.source.name`                              | Sending application; endpoint synthesized as `urn:hl7v2:<name>`                                                                                                            |
| `MSH-5`     | `MessageHeader.destination[0].name`                      | Receiving application, synthesized the same way                                                                                                                            |
| `MSH-9`     | `MessageHeader.eventCoding`                              | Trigger event code/display                                                                                                                                                 |

`Immunization.patient` is always a reference to the Patient built from `PID`. `RXA-18`
(CWE — substance/treatment refusal reason) maps to `Immunization.statusReason` the same way
`RXA-19` maps to `reasonCode`, but only makes sense on a _not-given_ dose (`RXA-20` = `RE`/
`NA`), so it isn't exercised by the canonical worked example below (a completed dose) — see
`vxu.test.ts`'s dedicated not-done test case instead.

### Reverse: FHIR → HL7v2

| FHIR path                              | HL7v2 field     | Notes                                                                                                                                                                   |
| -------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Immunization.occurrenceDateTime`      | `RXA-3`         |                                                                                                                                                                         |
| `Immunization.vaccineCode.coding[0]`   | `RXA-5`         | System component hardcoded to `CVX` on the way out                                                                                                                      |
| `Immunization.doseQuantity`            | `RXA-6`/`RXA-7` |                                                                                                                                                                         |
| `Immunization.performer[0].actor`      | `RXA-10`        | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `Immunization.lotNumber`               | `RXA-15`        |                                                                                                                                                                         |
| `Immunization.expirationDate`          | `RXA-16`        | `YYYY-MM-DD` → `YYYYMMDD`                                                                                                                                               |
| `Immunization.manufacturer.display`    | `RXA-17`        | System component hardcoded to `MVX` on the way out                                                                                                                      |
| `Immunization.status`                  | `RXA-20`        | Inverse of the forward table: `completed`→`CP`, `not-done`→`RE`, `entered-in-error`→`NA`                                                                                |
| `Immunization.statusReason.coding[0]`  | `RXA-18`        |                                                                                                                                                                         |
| `Immunization.reasonCode[0].coding[0]` | `RXA-19`        |                                                                                                                                                                         |
| `Immunization.recorded`                | `RXA-22`        |                                                                                                                                                                         |
| `Immunization.location.display`        | `RXA-27`        |                                                                                                                                                                         |

`RXA-1`/`RXA-2` (give/administration sub-ID counters) are always synthesized as `0`/`1`.
`MSH`/`PID` synthesis follows the same rules as ADT's reverse table above, including
`MSH-3`/`MSH-5` being read from a `MessageHeader` resource when one is present in the bundle.

### Not mapped

Any segment other than `MSH`/`PID`/`RXA` (e.g. `ORC`, `RXR`, `OBX` vaccine-funding/eligibility
observations) is warned about and skipped. Any FHIR resource in the bundle other than
`Patient`/`Immunization`/`Practitioner`/`MessageHeader` is likewise warned about and skipped
on the reverse direction.

### Worked example

Input (`samples/vxu_v04.hl7`):

```hl7
MSH|^~\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M
RXA|0|1|20240103090000||08^Hepatitis B pediatric^CVX|0.5|mL^milliliter^UCUM|||1234^Smith^Jane^M^MD|||||LOT12345|20250601|MSD^Merck^MVX||01^Routine immunization^HL70162|CP||20240103090000|||||PEDS^Pediatric Clinic^HOSP
```

Output (`translateHl7ToFhir` — the `Immunization` entry; the bundle also includes a
`Practitioner` entry for the administering provider, referenced above, and a trailing
`MessageHeader`):

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
        "reference": "Practitioner/practitioner-performer",
        "display": "Jane Smith"
      }
    }
  ],
  "reasonCode": [
    {
      "coding": [{ "code": "01", "display": "Routine immunization" }],
      "text": "Routine immunization"
    }
  ],
  "recorded": "2024-01-03T09:00:00Z",
  "location": {
    "display": "PEDS"
  }
}
```

---

## SIU^S12 (appointment scheduling)

**Segments read**: `MSH`, `SCH`, `PID`, `AIL` (location), `AIP` (personnel), `AIS` (service, first occurrence only), `NTE` (zero or more)
**Resources produced**: `Patient`, `Appointment`, `MessageHeader` (from `MSH`, always produced)

### Forward: HL7v2 → FHIR

Patient fields follow the same `PID` table as the ADT forward table above. Appointment fields:

| HL7v2 field | FHIR path                                                   | Notes                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCH-25`    | `Appointment.status`                                        | `BOOKED`→`booked`, `CANCELLED`→`cancelled`, `COMPLETE`→`fulfilled`, `PENDING`→`proposed`, else `booked`                                                                                                     |
| `SCH-7.1`   | `Appointment.reasonCode[0].coding[0].code`                  |                                                                                                                                                                                                             |
| `SCH-7.2`   | `Appointment.reasonCode[0].coding[0].display` and `.text`   |                                                                                                                                                                                                             |
| `SCH-8.1`   | `Appointment.appointmentType.coding[0].code`                | System = v2-0276                                                                                                                                                                                            |
| `SCH-8.2`   | `Appointment.appointmentType.coding[0].display` and `.text` |                                                                                                                                                                                                             |
| `SCH-9`     | `Appointment.minutesDuration`                               | Parsed with `Number()`; `SCH-10` (units) is read only to annotate the mapping trail, not converted                                                                                                          |
| `SCH-11.4`  | `Appointment.start`                                         | 4th component of the SCH-11 timing quantity (TQ) — start date/time                                                                                                                                          |
| `SCH-11.5`  | `Appointment.end`                                           | 5th component — end date/time                                                                                                                                                                               |
| `AIL-3.2`   | `Appointment.participant[].actor.display`                   | Scheduled location name, falls back to `AIL-3.1` if `.2` is absent                                                                                                                                          |
| `AIP-3.2`   | `Appointment.participant[].actor.display`                   | Scheduled practitioner family name                                                                                                                                                                          |
| `AIP-3.3`   | `Appointment.participant[].actor.display`                   | Scheduled practitioner given name (joined as "given family")                                                                                                                                                |
| `SCH-1`     | `Appointment.identifier[0]`                                 | Placer appointment ID; `identifier[0].type.coding[0].code` is hardcoded to `PLAC`                                                                                                                           |
| `SCH-2`     | `Appointment.identifier[1]`                                 | Filler appointment ID; `identifier[1].type.coding[0].code` is hardcoded to `FILL`                                                                                                                           |
| `AIS-3.1`   | `Appointment.serviceType[0].coding[0].code`                 | Universal service identifier (CWE)                                                                                                                                                                          |
| `AIS-3.2`   | `Appointment.serviceType[0].coding[0].display` and `.text`  |                                                                                                                                                                                                             |
| `NTE-3`     | `Appointment.comment`                                       | One or more `NTE` segments joined with `\n` — `Appointment.comment` is a single string, not an array (unlike `ServiceRequest.note[]` elsewhere in this package), so multiple `NTE`s collapse into one field |
| `MSH-3`     | `MessageHeader.source.name`                                 | Sending application; endpoint synthesized as `urn:hl7v2:<name>`                                                                                                                                             |
| `MSH-5`     | `MessageHeader.destination[0].name`                         | Receiving application, synthesized the same way                                                                                                                                                             |
| `MSH-9`     | `MessageHeader.eventCoding`                                 | Trigger event code/display                                                                                                                                                                                  |

`Appointment.participant[0]` is always a reference to the Patient built from `PID`, with
`status: "accepted"`; the location (from `AIL`) and practitioner (from `AIP`) are appended
as additional participants, also `status: "accepted"` — this package doesn't track pending
invitations.

`AIG` (general resource — equipment, etc.) isn't mapped: the IG's own "Segment AIG to
Appointment Map" targets `participant.actor(Location.identifier)`, modeling a general
resource as a `Location` referenced by identifier rather than name — a different `Location`
shape than the point-of-care-name pattern this package already uses everywhere else
(`PV1-3`, `PRT-9`, `EVN-7`), and not worth a second `Location` construction path for.

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
| `Appointment.identifier[0]`                | `SCH-1`          | Falls back to a synthesized ID (from the generated control ID) when absent                                                                                                                                                    |
| `Appointment.identifier[1]`                | `SCH-2`          | Same fallback as `SCH-1`                                                                                                                                                                                                      |
| `Appointment.serviceType[0].coding[0]`     | `AIS-3`          | Only written when `serviceType` is set                                                                                                                                                                                        |
| `Appointment.comment`                      | `NTE-3`          | Written as a single `NTE` segment carrying the whole (possibly multi-line) comment — not split back into multiple `NTE`s                                                                                                      |

`MSH`/`PID` synthesis follows the same rules as ADT's reverse table above, including
`MSH-3`/`MSH-5` being read from a `MessageHeader` resource when one is present in the bundle.

### Not mapped

Any segment other than `MSH`/`SCH`/`PID`/`AIL`/`AIP`/`AIS`/`NTE` (e.g. `AIG`) is warned
about and skipped. A second or later non-patient `Appointment.participant` is warned about
on the reverse direction, per the reverse table above. Any FHIR resource in the bundle other
than `Patient`/`Appointment`/`MessageHeader` is likewise warned about and skipped.

### Worked example

Input (`samples/siu_s12.hl7`):

```hl7
MSH|^~\&|SCH|CLINIC|HIS|HOSP|20240104080000||SIU^S12|MSG011|P|2.5
SCH|APT001|APT001|||||CHECKUP^Annual physical^L|ROUTINE^Routine appointment^L|30|MIN|^^^20240110090000^20240110093000||||||||||||||BOOKED
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M
AIL|1||OFFICE1^Clinic Room 1
AIP|1||1234^Smith^Jane^M^MD
AIS|1||GENCHECK^General Checkup^L
NTE|1||Please arrive 15 minutes early with insurance card
```

Output (`translateHl7ToFhir` — the `Appointment` entry; the bundle also includes a trailing
`MessageHeader`):

```json
{
  "resourceType": "Appointment",
  "id": "appointment-1",
  "status": "booked",
  "identifier": [
    { "value": "APT001", "type": { "coding": [{ "code": "PLAC" }] } },
    { "value": "APT001", "type": { "coding": [{ "code": "FILL" }] } }
  ],
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
  "end": "2024-01-10T09:30:00Z",
  "serviceType": [
    {
      "coding": [{ "code": "GENCHECK", "display": "General Checkup" }],
      "text": "General Checkup"
    }
  ],
  "comment": "Please arrive 15 minutes early with insurance card"
}
```

---

## OML^O21 (laboratory order)

OML^O21 is what distinguishes a lab order from a general order (see ORM^O01 above): it carries a
`SPM` (specimen) segment. `registry.ts` uses the presence of a `Specimen` resource to route
a FHIR bundle back to this mapper instead of ORM's.

**Segments read**: `MSH`, `PID`, `ORC`, `OBR`, `SPM`, `NTE` (zero or more), `TQ1` (first occurrence only), `PRT` (zero or more)
**Resources produced**: `Patient`, `ServiceRequest`, `Specimen`, `Practitioner` (from `ORC-12`/`OBR-16`, if present, plus
one per `PractitionerRole`-describing `PRT` repetition), `MessageHeader` (from `MSH`, always produced), `Device`
(one per `PRT` repetition describing one — same rule as `ORM^O01` above), `PractitionerRole`/`Organization`/`Location`
(from `PRT` repetitions describing a person — same rule as `ORM^O01` above)

### Forward: HL7v2 → FHIR

Patient and order fields follow the same `PID`/`ORC`/`OBR` tables as ORM^O01's forward table above (`ORC-1` →
`ServiceRequest.status`, `ORC-9` → `authoredOn`, `ORC-12` → `requester` (a real `Practitioner` resource), `OBR-4` →
`code`, `OBR-7` → `occurrenceDateTime`, `OBR-2`/`OBR-3` → `identifier[]`, `OBR-31` →
`reasonCode`, `NTE-3` → `note[].text`, one entry per `NTE` segment in message order, `TQ1-9` →
`priority`). Specimen fields:

| HL7v2 field | FHIR path                                     | Notes                                                                                                                |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SPM-4.1`   | `Specimen.type.coding[0].code`                | System = v2-0487                                                                                                     |
| `SPM-4.2`   | `Specimen.type.coding[0].display` and `.text` |                                                                                                                      |
| `SPM-7`     | `Specimen.collection.method`                  | CE/CWE — collection method                                                                                           |
| `SPM-8`     | `Specimen.collection.bodySite`                | CE/CWE — source site                                                                                                 |
| `SPM-17`    | `Specimen.collection.collectedDateTime`       |                                                                                                                      |
| `SPM-18`    | `Specimen.receivedTime`                       |                                                                                                                      |
| `SPM-20`    | `Specimen.status`                             | HL7 Table 0136 → FHIR `specimen-status`, via `table-hl70136-to-specimen-status` (`Y`→`available`, `N`→`unavailable`) |
| `SPM-24`    | `Specimen.condition[0]`                       | CE/CWE — specimen condition                                                                                          |
| `MSH-3`     | `MessageHeader.source.name`                   | Sending application; endpoint synthesized as `urn:hl7v2:<name>`                                                      |
| `MSH-5`     | `MessageHeader.destination[0].name`           | Receiving application, synthesized the same way                                                                      |
| `MSH-9`     | `MessageHeader.eventCoding`                   | Trigger event code/display                                                                                           |

`Specimen.subject` references the same Patient as the ServiceRequest; `Specimen.request[0]`
references the ServiceRequest built from `ORC`/`OBR`.

`PRT` fields (both `Device` and `PractitionerRole`) are read the same way as `ORM^O01`
above — see that section's `PRT` tables for the full field-by-field mapping.

### Reverse: FHIR → HL7v2

| FHIR path                               | HL7v2 field | Notes                                                                                                       |
| --------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `Specimen.type.coding[0]`               | `SPM-4`     | System component hardcoded to `HL70487` on the way out                                                      |
| `Specimen.collection.method`            | `SPM-7`     |                                                                                                             |
| `Specimen.collection.bodySite`          | `SPM-8`     |                                                                                                             |
| `Specimen.collection.collectedDateTime` | `SPM-17`    |                                                                                                             |
| `Specimen.receivedTime`                 | `SPM-18`    |                                                                                                             |
| `Specimen.status`                       | `SPM-20`    | Inverse of `table-hl70136-to-specimen-status`; only written when the status has a known reverse code        |
| `Specimen.condition[0]`                 | `SPM-24`    |                                                                                                             |
| _(constant)_                            | `SPM-2`     | The same synthesized placer order number as `ORC-2`/`OBR-2` is written to `SPM-2`, keeping all three linked |

`ServiceRequest` fields are written back exactly as in ORM^O01's reverse table above, including
`ServiceRequest.note[].text` → `NTE-3` (one `NTE` segment per note, in array order) and
`ServiceRequest.priority` → `TQ1-9`. `MSH`/`PID` synthesis follows the same rules as ADT's
reverse table above, including `MSH-3`/`MSH-5` being read from a `MessageHeader` resource
when one is present in the bundle. One `PRT` segment is written per `Device` and per
`PractitionerRole` resource in the bundle, same as `ORM^O01` above.

### Not mapped

Any segment other than `MSH`/`PID`/`ORC`/`OBR`/`SPM`/`NTE`/`TQ1`/`PRT` (e.g. `DG1`) is
warned about and skipped. Any FHIR resource in the bundle other than
`Patient`/`ServiceRequest`/`Specimen`/`Practitioner`/`MessageHeader`/`Device`/
`PractitionerRole`/`Organization`/`Location` is likewise warned about and skipped on the
reverse direction.

### Worked example

Input (`samples/oml_o21.hl7`) produces a 6-entry Bundle: `Patient`, `ServiceRequest`,
`Practitioner`, `Specimen`, `Device`, and a trailing `MessageHeader`:

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
  "requester": { "reference": "Practitioner/practitioner-requester", "display": "Jane Smith" },
  "note": [{ "text": "Draw from left arm, patient on anticoagulants" }]
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
  "collection": {
    "collectedDateTime": "2024-01-05T10:15:00Z",
    "method": { "coding": [{ "code": "VEN", "display": "Venipuncture" }], "text": "Venipuncture" },
    "bodySite": { "coding": [{ "code": "65205", "display": "Left arm vein" }], "text": "Left arm vein" }
  },
  "receivedTime": "2024-01-05T10:30:00Z",
  "status": "available",
  "condition": [{ "coding": [{ "code": "SAT", "display": "Satisfactory" }], "text": "Satisfactory" }]
}
```

```json
{
  "resourceType": "Device",
  "id": "device-1",
  "identifier": [{ "value": "GLU200" }],
  "udiCarrier": [{ "deviceIdentifier": "00987654321098" }],
  "manufactureDate": "2022-06-01",
  "expirationDate": "2027-06-01",
  "lotNumber": "LOT7788",
  "serialNumber": "SN112233",
  "type": { "coding": [{ "code": "ANALYZER", "display": "Analyzer" }], "text": "Analyzer" }
}
```

---

## MDM^T02 (document management)

**Segments read**: `MSH`, `EVN`, `PID`, `TXA`
**Resources produced**: `Patient`, `DocumentReference`, `Practitioner` (one for `TXA-9`, one
for `TXA-10`, if present, plus one more from `EVN-5` if a `Provenance` is built),
`MessageHeader` (from `MSH`, always produced), `Provenance` (one, from `EVN`, only when
`EVN-5` is present — same rule and field mapping as `ADT^A01`'s `EVN` table), `Location`
(one, from `EVN-7`, only alongside a `Provenance`)

### Forward: HL7v2 → FHIR

Patient fields follow the same `PID` table as the ADT forward table above. Document fields:

| HL7v2 field | FHIR path                                              | Notes                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TXA-2.1`   | `DocumentReference.type.coding[0].code`                | System = LOINC                                                                                                                                                                                 |
| `TXA-2.2`   | `DocumentReference.type.coding[0].display` and `.text` |                                                                                                                                                                                                |
| `TXA-17`    | `DocumentReference.docStatus`                          | `AU`/`TR`→`final`, `DI`/`DO`/`IP`/`PA`→`preliminary`; absent → `docStatus` omitted                                                                                                             |
| `TXA-6`     | `DocumentReference.date`                               | Origination date/time; also copied to `content[0].attachment.creation`                                                                                                                         |
| `TXA-12`    | `DocumentReference.masterIdentifier.value`             | Unique document number                                                                                                                                                                         |
| `TXA-9.2`   | `Practitioner.name[0].family`                          | Originator family name; a `Practitioner` resource is built and referenced from `DocumentReference.author[0]`, with the same name also copied to `.display`                                     |
| `TXA-9.3`   | `Practitioner.name[0].given[0]`                        | Originator given name                                                                                                                                                                          |
| `TXA-3`     | `DocumentReference.content[0].attachment.contentType`  | HL7 Table 0191 (Document Content Presentation) → MIME type (`TX`/`FT`→`text/plain`, `PDF`→`application/pdf`, `HD`→`text/html`, `RTF`→`application/rtf`); unrecognized or absent → `text/plain` |
| `TXA-10.2`  | `Practitioner.name[0].family`                          | Authenticating provider family name; a separate `Practitioner` resource is built and referenced from `DocumentReference.authenticator`                                                         |
| `TXA-10.3`  | `Practitioner.name[0].given[0]`                        | Authenticating provider given name                                                                                                                                                             |
| `TXA-16`    | `DocumentReference.identifier[0].value`                | Unique document file name/identifier (distinct from `TXA-12`'s master identifier)                                                                                                              |
| `TXA-25`    | `DocumentReference.description`                        |                                                                                                                                                                                                |
| `TXA-18`    | `DocumentReference.securityLabel[0]`                   | CE/CWE — document confidentiality status (HL7 Table 0272)                                                                                                                                      |
| `MSH-3`     | `MessageHeader.source.name`                            | Sending application; endpoint synthesized as `urn:hl7v2:<name>`                                                                                                                                |
| `MSH-5`     | `MessageHeader.destination[0].name`                    | Receiving application, synthesized the same way                                                                                                                                                |
| `MSH-9`     | `MessageHeader.eventCoding`                            | Trigger event code/display                                                                                                                                                                     |
| `EVN-2`     | `Provenance.recorded`                                  | Same rule as `ADT^A01`'s `EVN` table — only built when `EVN-5` is present                                                                                                                      |
| `EVN-4`     | `Provenance.reason[0]`                                 |                                                                                                                                                                                                |
| `EVN-5`     | `Provenance.agent[0].who`                              | A `Practitioner` resource is built and referenced, with the name also copied to `.display`                                                                                                     |
| `EVN-6`     | `Provenance.occurredDateTime`                          |                                                                                                                                                                                                |
| `EVN-7`     | `Provenance.location`                                  | A `Location` resource is built and referenced, with the name also copied to `.display`                                                                                                         |

`DocumentReference.status` is always `current` (this package doesn't map amendment/rescind
notification triggers, only the T02 "original document" trigger). `.title` is set from
`TXA-2`'s display. HL7v2's `TXA` segment carries no actual document bytes (those travel
separately, e.g. as base64 in an `OBX`), so `content[0].attachment` never has a `data`
field — only its metadata.

### Reverse: FHIR → HL7v2

| FHIR path                                             | HL7v2 field | Notes                                                                                                                                                                   |
| ----------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DocumentReference.type.coding[0]`                    | `TXA-2`     | System component hardcoded to `LN` on the way out                                                                                                                       |
| `DocumentReference.content[0].attachment.contentType` | `TXA-3`     | Inverse of the forward table's HL7 Table 0191 lookup; only written when the content type has a known reverse code (`text/plain` reverse-maps to `TX`, the first match)  |
| `DocumentReference.date`                              | `TXA-6`     |                                                                                                                                                                         |
| `DocumentReference.author[0]`                         | `TXA-9`     | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `DocumentReference.masterIdentifier.value`            | `TXA-12`    |                                                                                                                                                                         |
| `DocumentReference.docStatus`                         | `TXA-17`    | Inverse of the forward table: `final`→`AU`, `preliminary`→`IP`, `amended`→`TR`; absent → `IP`                                                                           |
| `DocumentReference.authenticator`                     | `TXA-10`    | Same resolution as `DocumentReference.author[0]` above                                                                                                                  |
| `DocumentReference.identifier[0].value`               | `TXA-16`    |                                                                                                                                                                         |
| `DocumentReference.description`                       | `TXA-25`    |                                                                                                                                                                         |
| `DocumentReference.securityLabel[0]`                  | `TXA-18`    |                                                                                                                                                                         |
| `Provenance.recorded`                                 | `EVN-2`     | Overrides the synthesized current-timestamp `EVN-2` default when a `Provenance` is present in the bundle                                                                |
| `Provenance.reason[0]`                                | `EVN-4`     |                                                                                                                                                                         |
| `Provenance.agent[0].who`                             | `EVN-5`     | Prefers the referenced `Practitioner`'s structured `name[0]` when one is in the bundle; falls back to splitting the Reference's `.display` on the first space otherwise |
| `Provenance.occurredDateTime`                         | `EVN-6`     |                                                                                                                                                                         |
| `Provenance.location`                                 | `EVN-7`     | Resolved from the referenced `Location`'s `.name`; falls back to `.display` when the referenced `Location` isn't in the bundle                                          |

`EVN-1`/`EVN-2` are synthesized the same way as ADT's (reverse table above). `MSH`/`PID` synthesis follows
the same rules as ADT's reverse table above, including `MSH-3`/`MSH-5` being read from a
`MessageHeader` resource when one is present in the bundle.

### Not mapped

Any segment other than `MSH`/`EVN`/`PID`/`TXA` (e.g. `OBX` carrying the actual document
content, `PV1`) is warned about and skipped. Any FHIR resource in the bundle other than
`Patient`/`DocumentReference`/`Practitioner`/`MessageHeader`/`Provenance`/`Location` is
likewise warned about and skipped on the reverse direction.

### Worked example

Input (`samples/mdm_t02.hl7`):

```hl7
MSH|^~\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5
EVN|T02|20240106140000||03|5678^Nguyen^Anh^^MD|20240106135500|HOSP
PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M
TXA|1|18842-5^Discharge summary^LN|TX|20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|9012^Patel^Raj^^MD||DOC0100||||DOC-ALT-001|AU|R^Restricted^HL70272|||||||Discharge summary for admission 2024-01-06
```

Output (`translateHl7ToFhir` — the `DocumentReference` entry; the bundle also includes two
`Practitioner` entries for the author and the authenticator, a `Provenance` (from `EVN`,
since `EVN-5` is populated here) with its own `Practitioner`/`Location`, and a trailing
`MessageHeader`):

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
  "author": [{ "reference": "Practitioner/practitioner-author", "display": "Anh Nguyen" }],
  "authenticator": { "reference": "Practitioner/practitioner-authenticator", "display": "Raj Patel" },
  "identifier": [{ "value": "DOC-ALT-001" }],
  "description": "Discharge summary for admission 2024-01-06",
  "securityLabel": [{ "coding": [{ "code": "R", "display": "Restricted" }], "text": "Restricted" }]
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
