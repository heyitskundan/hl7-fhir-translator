/**
 * DG1 <-> Condition, per the official IG's "Segment DG1 to Condition Map"
 * (hl7.org/fhir/uv/v2mappings/ConceptMap-segment-dg1-to-condition.html, fetched directly).
 * DG1 is a repeating segment — a message can carry zero or more, one per diagnosis — so
 * this produces zero or more `Condition` resources. Wired into the ADT mappers, the same
 * way `allergy.ts`/AL1 is.
 *
 * `DG1-21` (diagnosis confirmation status) maps to `verificationStatus` only for the
 * value "D" ("Deleted"/entered in error) — per the IG's own note on that field, the other
 * defined values ("A", "U") don't map to anything, so this isn't a table lookup, it's a
 * single constant assignment, exactly as the IG specifies it.
 */
import { findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Condition, Encounter, Patient, Practitioner } from "../fhir/types.js";
import { cweToCodeableConcept, eiToIdentifier } from "./datatypes.js";
import { fhirDateTimeToHl7, hl7DateTimeToFhir, type MappingTrail, practitionerFromNameParts, resolvePractitionerName } from "./common.js";

const VERIFICATION_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-ver-status";

/** DG1 segments -> zero or more Condition resources (each referencing `patient`), plus zero or more Practitioner resources for their asserters, one pair per segment. */
export function dg1ToConditions(
  message: Hl7Message,
  patient: Patient,
  trail: MappingTrail,
): { conditions: Condition[]; practitioners: Practitioner[] } {
  const conditions: Condition[] = [];
  const practitioners: Practitioner[] = [];
  findSegments(message, "DG1").forEach((dg1, i) => {
    const { condition, practitioner } = buildOneCondition(dg1, patient, trail, `condition-${i + 1}`, `practitioner-asserter-${i + 1}`);
    conditions.push(condition);
    if (practitioner) practitioners.push(practitioner);
  });
  return { conditions, practitioners };
}

function buildOneCondition(
  dg1: Hl7Segment,
  patient: Patient,
  trail: MappingTrail,
  id: string,
  practitionerId: string,
): { condition: Condition; practitioner?: Practitioner } {
  const condition: Condition = { resourceType: "Condition", id, subject: { reference: `Patient/${patient.id}` } };

  const codeField: Hl7Field | undefined = dg1.fields[3];
  const code = cweToCodeableConcept(codeField);
  const description = getField(dg1, 4);
  if (code) {
    condition.code = description ? { ...code, text: description } : code;
    trail.add("DG1-3", "Condition.code", getComponent(dg1, 3, 1) ?? "");
    if (description) trail.add("DG1-4", "Condition.code.text", description);
  } else if (description) {
    condition.code = { text: description };
    trail.add("DG1-4", "Condition.code.text", description);
  }

  const onset = hl7DateTimeToFhir(getField(dg1, 5));
  if (onset) {
    condition.onsetDateTime = onset;
    trail.add("DG1-5", "Condition.onsetDateTime", onset);
  }

  const asserterFamily = getComponent(dg1, 16, 2);
  const asserterGiven = getComponent(dg1, 16, 3);
  let practitioner: Practitioner | undefined;
  if (asserterFamily) {
    const display = [asserterGiven, asserterFamily].filter(Boolean).join(" ");
    practitioner = practitionerFromNameParts(asserterFamily, asserterGiven, practitionerId);
    condition.asserter = practitioner ? { reference: `Practitioner/${practitionerId}`, display } : { display };
    trail.add("DG1-16", "Condition.asserter.display", display);
  }

  const recordedDate = hl7DateTimeToFhir(getField(dg1, 19));
  if (recordedDate) {
    condition.recordedDate = recordedDate;
    trail.add("DG1-19", "Condition.recordedDate", recordedDate);
  }

  const identifier = eiToIdentifier(dg1.fields[20]);
  if (identifier) {
    condition.identifier = [identifier];
    trail.add("DG1-20", "Condition.identifier[0]", identifier.value ?? "");
  }

  const confirmationStatus = getField(dg1, 21);
  if (confirmationStatus === "D") {
    condition.verificationStatus = { coding: [{ system: VERIFICATION_STATUS_SYSTEM, code: "entered-in-error" }] };
    trail.add("DG1-21", "Condition.verificationStatus", "entered-in-error", 'HL7 confirmation status "D"');
  }

  return { condition, practitioner };
}

/**
 * DG1 segments + the Conditions already built from them (same order, same source
 * segments) -> `Encounter.diagnosis[]`, per the IG's "Segment DG1 to Encounter Map"
 * (`DG1-6` -> `diagnosis.use`, `DG1-15` -> `diagnosis.rank`). Only entries with at least
 * one of those two fields present are added — a DG1 with neither is already fully
 * represented by its Condition resource alone.
 */
export function dg1ToEncounterDiagnoses(message: Hl7Message, conditions: Condition[], trail: MappingTrail): Encounter["diagnosis"] {
  const dg1Segments = findSegments(message, "DG1");
  const diagnoses: NonNullable<Encounter["diagnosis"]> = [];
  dg1Segments.forEach((dg1, i) => {
    const condition = conditions[i];
    if (!condition) return;
    const use = cweToCodeableConcept(dg1.fields[6]);
    const rankRaw = getField(dg1, 15);
    const rank = rankRaw ? Number(rankRaw) : undefined;
    if (!use && rank === undefined) return;
    diagnoses.push({
      condition: { reference: `Condition/${condition.id}` },
      ...(use ? { use } : {}),
      ...(rank !== undefined ? { rank } : {}),
    });
    if (use) trail.add(`DG1-6 (#${i + 1})`, `Encounter.diagnosis[${diagnoses.length - 1}].use`, getComponent(dg1, 6, 1) ?? "");
    if (rank !== undefined) trail.add(`DG1-15 (#${i + 1})`, `Encounter.diagnosis[${diagnoses.length - 1}].rank`, String(rank));
  });
  return diagnoses.length > 0 ? diagnoses : undefined;
}

/** Condition resources -> DG1 segments, in bundle order (DG1-1's set-id is 1-indexed by position). `encounter`'s `diagnosis[]`, when present, supplies DG1-6/DG1-15 back for the matching Condition (matched by reference). `practitioners` supplies DG1-16's structured name when the referenced Practitioner is in the bundle. */
export function conditionsToDg1(
  conditions: Condition[],
  trail: MappingTrail,
  encounter?: Encounter,
  practitioners: Practitioner[] = [],
): Hl7Segment[] {
  return conditions.map((condition, i) => {
    const fields: Record<number, Hl7Field> = { 1: field(String(i + 1)) };
    const diagnosis = encounter?.diagnosis?.find((d) => d.condition.reference === `Condition/${condition.id}`);
    if (diagnosis?.use?.coding?.[0]?.code) {
      const useCoding = diagnosis.use.coding[0];
      fields[6] = field(useCoding.code ?? "", useCoding.display ?? "");
      trail.add(`Encounter.diagnosis[${i}].use`, `DG1-6 (#${i + 1})`, useCoding.code ?? "");
    }
    if (diagnosis?.rank !== undefined) {
      fields[15] = field(String(diagnosis.rank));
      trail.add(`Encounter.diagnosis[${i}].rank`, `DG1-15 (#${i + 1})`, String(diagnosis.rank));
    }

    const coding = condition.code?.coding?.[0];
    if (coding?.code) {
      fields[3] = field(coding.code, coding.display ?? "");
      trail.add("Condition.code", "DG1-3", coding.code);
    }
    if (condition.code?.text) {
      fields[4] = field(condition.code.text);
      trail.add("Condition.code.text", "DG1-4", condition.code.text);
    }
    if (condition.onsetDateTime) {
      const hl7Date = fhirDateTimeToHl7(condition.onsetDateTime) ?? "";
      fields[5] = field(hl7Date);
      trail.add("Condition.onsetDateTime", "DG1-5", hl7Date);
    }
    const asserter = resolvePractitionerName(condition.asserter, practitioners);
    if (asserter?.family) {
      fields[16] = field("", asserter.family, asserter.given ?? "");
      trail.add("Condition.asserter.display", "DG1-16", [asserter.given, asserter.family].filter(Boolean).join(" "));
    }
    if (condition.recordedDate) {
      const hl7Date = fhirDateTimeToHl7(condition.recordedDate) ?? "";
      fields[19] = field(hl7Date);
      trail.add("Condition.recordedDate", "DG1-19", hl7Date);
    }
    if (condition.identifier?.[0]?.value) {
      fields[20] = field(condition.identifier[0].value);
      trail.add("Condition.identifier[0]", "DG1-20", condition.identifier[0].value);
    }
    if (condition.verificationStatus?.coding?.[0]?.code === "entered-in-error") {
      fields[21] = field("D");
      trail.add("Condition.verificationStatus", "DG1-21", "D");
    }

    return segment("DG1", fields);
  });
}
