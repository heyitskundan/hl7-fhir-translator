/**
 * AL1 <-> AllergyIntolerance, per the official IG's "Segment AL1 to AllergyIntolerance Map"
 * (hl7.org/fhir/uv/v2mappings/ConceptMap-segment-al1-to-allergyintolerance.html, fetched
 * directly). AL1 is a repeating segment — a message can carry zero or more, one per
 * documented allergy — so this produces zero or more `AllergyIntolerance` resources, not
 * one. Wired into whichever message-type mappers read a PID (currently the ADT mappers;
 * AL1 is common in admission messages) rather than being its own message type.
 *
 * `IAM` (the newer "Patient Adverse Reaction Information" segment, per the IG's "Segment
 * IAM to AllergyIntolerance Map") is handled alongside AL1 in the same file, since both
 * target the same resource — `iamToAllergyIntolerances` below. Only the fields with a
 * clear single-valued FHIR target are implemented: `IAM-2`/`IAM-4`'s dual category/severity
 * vs. criticality encoding (the IG marks these "Required"-binding with extension fallbacks
 * this package's `CodeableConcept` shape can't carry) and `IAM-14`/`IAM-15`'s
 * conditional-on-relationship recorder dispatch are left unmapped for the same reason
 * `AL1`'s onset/criticality overlap is: this package has no per-field way to record which
 * of two possible interpretations a source value took, so a lossy default would silently
 * pick one on every round-trip rather than surfacing the ambiguity.
 */
import { findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { AllergyIntolerance, Patient } from "../fhir/types.js";
import { cweToCodeableConcept, cxToIdentifier } from "./datatypes.js";
import { fhirDateTimeToHl7, hl7DateTimeToFhir, type MappingTrail } from "./common.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";

const CATEGORY_TABLE = "table-hl70127-to-allergy-intolerance-category";
const CRITICALITY_TABLE = "table-hl70128-to-allergy-intolerance-criticality";
const REACTION_SEVERITY_TABLE = "table-hl70128-to-reaction-event-severity";

/**
 * AL1 segments -> zero or more AllergyIntolerance resources, one per segment, each
 * referencing `patient`. `clinicalStatus` is always synthesized as "active" — AL1 carries
 * no clinical-status signal, and the IG's own mapping notes this gap (`AllergyIntolerance`
 * requires `clinicalStatus` unless `verificationStatus` is "entered-in-error", which AL1
 * gives no basis to infer either).
 */
export function al1ToAllergyIntolerances(message: Hl7Message, patient: Patient, trail: MappingTrail): AllergyIntolerance[] {
  const al1Segments = findSegments(message, "AL1");
  return al1Segments.map((al1, i) => buildOneAllergyIntolerance(al1, patient, trail, `allergyintolerance-${i + 1}`));
}

function buildOneAllergyIntolerance(al1: Hl7Segment, patient: Patient, trail: MappingTrail, id: string): AllergyIntolerance {
  const allergy: AllergyIntolerance = {
    resourceType: "AllergyIntolerance",
    id,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
    patient: { reference: `Patient/${patient.id}` },
  };

  const categoryCode = getField(al1, 2);
  const category = lookupVocabulary(CATEGORY_TABLE, categoryCode);
  if (category?.code) {
    allergy.category = [category.code as "food" | "medication" | "environment" | "biologic"];
    trail.add("AL1-2", "AllergyIntolerance.category", category.code, `HL7 allergen type "${categoryCode}"`);
  }

  const allergenField: Hl7Field | undefined = al1.fields[3];
  const code = cweToCodeableConcept(allergenField);
  if (code) {
    allergy.code = code;
    trail.add("AL1-3", "AllergyIntolerance.code", getComponent(al1, 3, 1) ?? "");
  }

  const criticalityCode = getField(al1, 4);
  const criticality = lookupVocabulary(CRITICALITY_TABLE, criticalityCode);
  if (criticality?.code) {
    allergy.criticality = criticality.code as AllergyIntolerance["criticality"];
    trail.add("AL1-4", "AllergyIntolerance.criticality", criticality.code, `HL7 severity "${criticalityCode}"`);
  }

  const reactionText = getField(al1, 5);
  if (reactionText) {
    const severity = lookupVocabulary(REACTION_SEVERITY_TABLE, criticalityCode)?.code as "mild" | "moderate" | "severe" | undefined;
    allergy.reaction = [{ manifestation: [{ text: reactionText }], ...(severity ? { severity } : {}) }];
    trail.add("AL1-5", "AllergyIntolerance.reaction[0].manifestation[0].text", reactionText);
    if (severity)
      trail.add("AL1-4", "AllergyIntolerance.reaction[0].severity", severity, `HL7 severity "${criticalityCode}" (secondary target)`);
  }

  const onsetRaw = getField(al1, 6);
  const onset = hl7DateTimeToFhir(onsetRaw);
  if (onset) {
    allergy.onsetDateTime = onset;
    trail.add("AL1-6", "AllergyIntolerance.onsetDateTime", onset);
  }

  return allergy;
}

/** AllergyIntolerance resources -> AL1 segments, in bundle order (AL1-1's set-id is 1-indexed by position). */
export function allergyIntolerancesToAl1(allergies: AllergyIntolerance[], trail: MappingTrail): Hl7Segment[] {
  return allergies.map((allergy, i) => {
    const fields: Record<number, Hl7Field> = { 1: field(String(i + 1)) };

    const categoryCode = allergy.category?.[0];
    if (categoryCode) {
      const hl7Code = reverseLookupVocabulary(CATEGORY_TABLE, categoryCode);
      if (hl7Code) {
        fields[2] = field(hl7Code);
        trail.add("AllergyIntolerance.category", "AL1-2", hl7Code);
      }
    }

    const coding = allergy.code?.coding?.[0];
    if (coding?.code) {
      fields[3] = field(coding.code, coding.display ?? "");
      trail.add("AllergyIntolerance.code", "AL1-3", coding.code);
    }

    if (allergy.criticality) {
      const hl7Code = reverseLookupVocabulary(CRITICALITY_TABLE, allergy.criticality);
      if (hl7Code) {
        fields[4] = field(hl7Code);
        trail.add("AllergyIntolerance.criticality", "AL1-4", hl7Code);
      }
    } else if (allergy.reaction?.[0]?.severity) {
      // AL1-4 is the source of both criticality and reaction.severity (the IG's own
      // secondary-target mapping); criticality takes precedence when both are present since
      // it was written first on the forward pass, but severity alone can still round-trip.
      const hl7Code = reverseLookupVocabulary(REACTION_SEVERITY_TABLE, allergy.reaction[0].severity);
      if (hl7Code) {
        fields[4] = field(hl7Code);
        trail.add("AllergyIntolerance.reaction[0].severity", "AL1-4", hl7Code);
      }
    }

    const manifestationText = allergy.reaction?.[0]?.manifestation?.[0]?.text;
    if (manifestationText) {
      fields[5] = field(manifestationText);
      trail.add("AllergyIntolerance.reaction[0].manifestation[0].text", "AL1-5", manifestationText);
    }

    if (allergy.onsetDateTime) {
      const hl7Date = fhirDateTimeToHl7(allergy.onsetDateTime) ?? "";
      fields[6] = field(hl7Date);
      trail.add("AllergyIntolerance.onsetDateTime", "AL1-6", hl7Date);
    }

    return segment("AL1", fields);
  });
}

/** IAM segments -> zero or more AllergyIntolerance resources, one per segment, each referencing `patient`. IDs continue past whatever `al1ToAllergyIntolerances` already produced for the same message, so the two segment types can coexist without id collisions. */
export function iamToAllergyIntolerances(message: Hl7Message, patient: Patient, trail: MappingTrail, startIndex = 0): AllergyIntolerance[] {
  const iamSegments = findSegments(message, "IAM");
  return iamSegments.map((iam, i) => buildOneIamAllergyIntolerance(iam, patient, trail, `allergyintolerance-${startIndex + i + 1}`));
}

function buildOneIamAllergyIntolerance(iam: Hl7Segment, patient: Patient, trail: MappingTrail, id: string): AllergyIntolerance {
  const allergy: AllergyIntolerance = {
    resourceType: "AllergyIntolerance",
    id,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
    patient: { reference: `Patient/${patient.id}` },
  };

  const identifier = cxToIdentifier(iam.fields[7]);
  if (identifier) {
    allergy.identifier = [identifier];
    trail.add("IAM-7", "AllergyIntolerance.identifier[0]", identifier.value ?? "");
  }

  const code = cweToCodeableConcept(iam.fields[3]);
  if (code) {
    allergy.code = code;
    trail.add("IAM-3", "AllergyIntolerance.code", getComponent(iam, 3, 1) ?? "");
  }

  const reactionText = getField(iam, 5);
  if (reactionText) {
    allergy.reaction = [{ manifestation: [{ text: reactionText }] }];
    trail.add("IAM-5", "AllergyIntolerance.reaction[0].manifestation[0].text", reactionText);
  }

  const onset = hl7DateTimeToFhir(getField(iam, 11));
  if (onset) {
    allergy.onsetDateTime = onset;
    trail.add("IAM-11", "AllergyIntolerance.onsetDateTime", onset);
  }

  return allergy;
}

/** AllergyIntolerance resources -> IAM segments, inverse of `iamToAllergyIntolerances`. Only the resources this package can tell came from an IAM segment (those carrying an `identifier`, since AL1-sourced ones never do — see `al1ToAllergyIntolerances`) round-trip back through here; the rest belong to `allergyIntolerancesToAl1`. */
export function allergyIntolerancesToIam(allergies: AllergyIntolerance[], trail: MappingTrail): Hl7Segment[] {
  return allergies.map((allergy, i) => {
    const fields: Record<number, Hl7Field> = { 1: field(String(i + 1)) };

    if (allergy.identifier?.[0]?.value) {
      fields[7] = field(allergy.identifier[0].value);
      trail.add("AllergyIntolerance.identifier[0]", "IAM-7", allergy.identifier[0].value);
    }

    const coding = allergy.code?.coding?.[0];
    if (coding?.code) {
      fields[3] = field(coding.code, coding.display ?? "");
      trail.add("AllergyIntolerance.code", "IAM-3", coding.code);
    }

    const manifestationText = allergy.reaction?.[0]?.manifestation?.[0]?.text;
    if (manifestationText) {
      fields[5] = field(manifestationText);
      trail.add("AllergyIntolerance.reaction[0].manifestation[0].text", "IAM-5", manifestationText);
    }

    if (allergy.onsetDateTime) {
      const hl7Date = fhirDateTimeToHl7(allergy.onsetDateTime) ?? "";
      fields[11] = field(hl7Date);
      trail.add("AllergyIntolerance.onsetDateTime", "IAM-11", hl7Date);
    }

    return segment("IAM", fields);
  });
}
