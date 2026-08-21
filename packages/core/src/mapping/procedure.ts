/**
 * PR1 <-> Procedure, per the official IG's "Segment PR1 to Procedure Map"
 * (hl7.org/fhir/uv/v2mappings/ConceptMap-segment-pr1-to-procedure.html, fetched directly).
 * PR1 is a repeating segment; this produces zero or more `Procedure` resources, wired into
 * the ADT mappers the same way `allergy.ts`/AL1, `condition.ts`/DG1, `relatedperson.ts`/NK1,
 * and `coverage.ts`/IN1 are.
 *
 * `Procedure.status` is always `unknown` — the IG's own mapping for `PR1`'s (segment-level,
 * not field-level) status target says the value "depends on the message context ... to be
 * determined by the implementer. If not clear, use 'unknown'." A bare PR1 read generically
 * (this package doesn't special-case by message type) gives no such context, so `unknown`
 * is the IG-specified fallback, not a guess.
 */
import { findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Patient, Procedure } from "../fhir/types.js";
import { cweToCodeableConcept, eiToIdentifier } from "./datatypes.js";
import { fhirDateTimeToHl7, hl7DateTimeToFhir, type MappingTrail } from "./common.js";

/** PR1 segments -> zero or more Procedure resources, one per segment, each referencing `patient`. */
export function pr1ToProcedures(message: Hl7Message, patient: Patient, trail: MappingTrail): Procedure[] {
  return findSegments(message, "PR1").map((pr1, i) => buildOneProcedure(pr1, patient, trail, `procedure-${i + 1}`));
}

function buildOneProcedure(pr1: Hl7Segment, patient: Patient, trail: MappingTrail, id: string): Procedure {
  const procedure: Procedure = { resourceType: "Procedure", id, status: "unknown", subject: { reference: `Patient/${patient.id}` } };

  const code = cweToCodeableConcept(pr1.fields[3]);
  const description = getField(pr1, 4);
  if (code) {
    procedure.code = description ? { ...code, text: description } : code;
    trail.add("PR1-3", "Procedure.code", getField(pr1, 3) ?? "");
    if (description) trail.add("PR1-4", "Procedure.code.text", description);
  } else if (description) {
    procedure.code = { text: description };
    trail.add("PR1-4", "Procedure.code.text", description);
  }

  const category = cweToCodeableConcept(pr1.fields[6]);
  if (category) {
    procedure.category = category;
    trail.add("PR1-6", "Procedure.category", getComponent(pr1, 6, 1) ?? "");
  }

  const performedStart = hl7DateTimeToFhir(getField(pr1, 5));
  const performedEnd = hl7DateTimeToFhir(getField(pr1, 7));
  if (performedEnd && performedStart) {
    procedure.performedPeriod = { start: performedStart, end: performedEnd };
    trail.add("PR1-5", "Procedure.performedPeriod.start", performedStart);
    trail.add("PR1-7", "Procedure.performedPeriod.end", performedEnd);
  } else if (performedStart) {
    procedure.performedDateTime = performedStart;
    trail.add("PR1-5", "Procedure.performedDateTime", performedStart);
  }

  const reasonCode = cweToCodeableConcept(pr1.fields[15]);
  if (reasonCode) {
    procedure.reasonCode = [reasonCode];
    trail.add("PR1-15", "Procedure.reasonCode[0]", getComponent(pr1, 15, 1) ?? "");
  }

  const identifier = eiToIdentifier(pr1.fields[19]);
  if (identifier) {
    procedure.identifier = [identifier];
    trail.add("PR1-19", "Procedure.identifier[0]", identifier.value ?? "");
  }

  // PR1-23 is PL (Person Location): component 1 is point of care, matching how PV1-3.1 is
  // read elsewhere in this codebase — room/bed/facility components aren't mapped.
  const locationDisplay = getComponent(pr1, 23, 1);
  if (locationDisplay) {
    procedure.location = { display: locationDisplay };
    trail.add("PR1-23", "Procedure.location.display", locationDisplay);
  }

  return procedure;
}

/** Procedure resources -> PR1 segments, in bundle order (PR1-1's set-id is 1-indexed by position). */
export function proceduresToPr1(procedures: Procedure[], trail: MappingTrail): Hl7Segment[] {
  return procedures.map((procedure, i) => {
    const fields: Record<number, ReturnType<typeof field>> = { 1: field(String(i + 1)) };

    const coding = procedure.code?.coding?.[0];
    if (coding?.code) {
      fields[3] = field(coding.code, coding.display ?? "");
      trail.add("Procedure.code", "PR1-3", coding.code);
    }
    if (procedure.code?.text) {
      fields[4] = field(procedure.code.text);
      trail.add("Procedure.code.text", "PR1-4", procedure.code.text);
    }
    const categoryCoding = procedure.category?.coding?.[0];
    if (categoryCoding?.code) {
      fields[6] = field(categoryCoding.code, categoryCoding.display ?? "");
      trail.add("Procedure.category", "PR1-6", categoryCoding.code);
    }
    if (procedure.performedPeriod?.start) {
      const hl7Start = fhirDateTimeToHl7(procedure.performedPeriod.start) ?? "";
      fields[5] = field(hl7Start);
      trail.add("Procedure.performedPeriod.start", "PR1-5", hl7Start);
      if (procedure.performedPeriod.end) {
        const hl7End = fhirDateTimeToHl7(procedure.performedPeriod.end) ?? "";
        fields[7] = field(hl7End);
        trail.add("Procedure.performedPeriod.end", "PR1-7", hl7End);
      }
    } else if (procedure.performedDateTime) {
      const hl7Date = fhirDateTimeToHl7(procedure.performedDateTime) ?? "";
      fields[5] = field(hl7Date);
      trail.add("Procedure.performedDateTime", "PR1-5", hl7Date);
    }
    const reasonCoding = procedure.reasonCode?.[0]?.coding?.[0];
    if (reasonCoding?.code) {
      fields[15] = field(reasonCoding.code, reasonCoding.display ?? "");
      trail.add("Procedure.reasonCode[0]", "PR1-15", reasonCoding.code);
    }
    if (procedure.identifier?.[0]?.value) {
      fields[19] = field(procedure.identifier[0].value);
      trail.add("Procedure.identifier[0]", "PR1-19", procedure.identifier[0].value);
    }
    if (procedure.location?.display) {
      fields[23] = field(procedure.location.display);
      trail.add("Procedure.location.display", "PR1-23", procedure.location.display);
    }

    return segment("PR1", fields);
  });
}
