/**
 * NK1 <-> RelatedPerson, per the official IG's "Segment NK1 to RelatedPerson Map"
 * (hl7.org/fhir/uv/v2mappings/ConceptMap-segment-nk1-to-relatedperson.html, fetched
 * directly). NK1 also has an IG mapping to `Patient` (contact details on the patient
 * itself) — this file only implements the `RelatedPerson` side, the more commonly useful
 * of the two for a standalone next-of-kin/emergency-contact record. NK1 is a repeating
 * segment; this produces zero or more `RelatedPerson` resources, wired into the ADT
 * mappers the same way `allergy.ts`/AL1 and `condition.ts`/DG1 are.
 */
import { findSegments, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Patient, RelatedPerson } from "../fhir/types.js";
import { fhirDateTimeToHl7, fhirGenderToHl7, hl7DateTimeToFhir, hl7GenderToFhir, hl7NameToFhirGiven, type MappingTrail } from "./common.js";
import { cxToIdentifier, periodFrom, xadToAddress, xtnToContactPoint } from "./datatypes.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";

const RELATIONSHIP_TABLE = "table-hl70063-to-v3-rolecode";

/** NK1 segments -> zero or more RelatedPerson resources, one per segment, each referencing `patient`. */
export function nk1ToRelatedPersons(message: Hl7Message, patient: Patient, trail: MappingTrail): RelatedPerson[] {
  return findSegments(message, "NK1").map((nk1, i) => buildOneRelatedPerson(nk1, patient, trail, `relatedperson-${i + 1}`));
}

function buildOneRelatedPerson(nk1: Hl7Segment, patient: Patient, trail: MappingTrail, id: string): RelatedPerson {
  const relatedPerson: RelatedPerson = { resourceType: "RelatedPerson", id, patient: { reference: `Patient/${patient.id}` } };

  const nameField = nk1.fields[2];
  const family = nameField?.reps[0]?.[0];
  const given = nameField?.reps[0]?.[1];
  const middle = nameField?.reps[0]?.[2];
  if (family || given) {
    relatedPerson.name = [{ family: family || undefined, given: hl7NameToFhirGiven(given, middle) }];
    trail.add("NK1-2", "RelatedPerson.name[0]", [family, given, middle].filter(Boolean).join(" "));
  }

  const relationshipCode = getField(nk1, 3);
  const relationship = lookupVocabulary(RELATIONSHIP_TABLE, relationshipCode);
  if (relationship?.code) {
    relatedPerson.relationship = [{ coding: [{ system: relationship.system, code: relationship.code, display: relationship.display }] }];
    trail.add("NK1-3", "RelatedPerson.relationship[0]", relationship.code, `HL7 relationship "${relationshipCode}"`);
  }

  const address = xadToAddress(nk1.fields[4]);
  if (address) {
    relatedPerson.address = [address];
    trail.add("NK1-4", "RelatedPerson.address[0]", address.line?.[0] ?? "");
  }

  const telecoms = [nk1.fields[5], nk1.fields[6]]
    .map((f) => xtnToContactPoint(f))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  if (telecoms.length > 0) {
    relatedPerson.telecom = telecoms;
    trail.add("NK1-5", "RelatedPerson.telecom", telecoms.map((t) => t.value).join(", "));
  }

  const start = hl7DateTimeToFhir(getField(nk1, 8));
  const end = hl7DateTimeToFhir(getField(nk1, 9));
  if (start || end) {
    relatedPerson.period = periodFrom(start, end);
    trail.add("NK1-8", "RelatedPerson.period.start", start ?? "");
    if (end) trail.add("NK1-9", "RelatedPerson.period.end", end);
  }

  const identifier = cxToIdentifier(nk1.fields[12]);
  if (identifier) {
    relatedPerson.identifier = [identifier];
    trail.add("NK1-12", "RelatedPerson.identifier[0]", identifier.value ?? "");
  }

  const genderRaw = getField(nk1, 15);
  if (genderRaw) {
    relatedPerson.gender = hl7GenderToFhir(genderRaw);
    trail.add("NK1-15", "RelatedPerson.gender", relatedPerson.gender, `HL7 code "${genderRaw}"`);
  }

  const dob = hl7DateTimeToFhir(getField(nk1, 16));
  if (dob) {
    relatedPerson.birthDate = dob.substring(0, 10);
    trail.add("NK1-16", "RelatedPerson.birthDate", relatedPerson.birthDate);
  }

  return relatedPerson;
}

/** RelatedPerson resources -> NK1 segments, in bundle order (NK1-1's set-id is 1-indexed by position). */
export function relatedPersonsToNk1(relatedPersons: RelatedPerson[], trail: MappingTrail): Hl7Segment[] {
  return relatedPersons.map((rp, i) => {
    const fields: Record<number, ReturnType<typeof field>> = { 1: field(String(i + 1)) };

    const name = rp.name?.[0];
    if (name) {
      fields[2] = field(name.family ?? "", name.given?.[0] ?? "", name.given?.[1] ?? "");
      trail.add("RelatedPerson.name[0]", "NK1-2", [name.family, ...(name.given ?? [])].filter(Boolean).join(" "));
    }

    const relationshipCode = rp.relationship?.[0]?.coding?.[0]?.code;
    if (relationshipCode) {
      const hl7Code = reverseLookupVocabulary(RELATIONSHIP_TABLE, relationshipCode);
      if (hl7Code) {
        fields[3] = field(hl7Code);
        trail.add("RelatedPerson.relationship[0]", "NK1-3", hl7Code);
      }
    }

    const addr = rp.address?.[0];
    if (addr) {
      fields[4] = field(addr.line?.[0] ?? "", "", addr.city ?? "", addr.state ?? "", addr.postalCode ?? "", addr.country ?? "");
      trail.add("RelatedPerson.address[0]", "NK1-4", [addr.line?.[0], addr.city].filter(Boolean).join(", "));
    }

    const phone = rp.telecom?.[0];
    if (phone?.value) {
      fields[5] = field(phone.value);
      trail.add("RelatedPerson.telecom", "NK1-5", phone.value);
    }

    if (rp.period?.start) {
      const hl7Date = fhirDateTimeToHl7(rp.period.start) ?? "";
      fields[8] = field(hl7Date);
      trail.add("RelatedPerson.period.start", "NK1-8", hl7Date);
    }
    if (rp.period?.end) {
      const hl7Date = fhirDateTimeToHl7(rp.period.end) ?? "";
      fields[9] = field(hl7Date);
      trail.add("RelatedPerson.period.end", "NK1-9", hl7Date);
    }

    if (rp.identifier?.[0]?.value) {
      fields[12] = field(rp.identifier[0].value);
      trail.add("RelatedPerson.identifier[0]", "NK1-12", rp.identifier[0].value);
    }

    if (rp.gender) {
      const g = fhirGenderToHl7(rp.gender);
      fields[15] = field(g);
      trail.add("RelatedPerson.gender", "NK1-15", g);
    }

    if (rp.birthDate) {
      const hl7Date = fhirDateTimeToHl7(rp.birthDate) ?? "";
      fields[16] = field(hl7Date);
      trail.add("RelatedPerson.birthDate", "NK1-16", hl7Date);
    }

    return segment("NK1", fields);
  });
}
