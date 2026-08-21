import type { Mapping } from "../types.js";
import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Location, MessageHeader, Practitioner, Provenance, Reference } from "../fhir/types.js";
import { xcnToNameParts } from "./datatypes.js";

/** Canonical HL7 Terminology / LOINC system URLs used across every mapper's coded fields. */
export const CODE_SYSTEMS = {
  identifierType: "http://terminology.hl7.org/CodeSystem/v2-0203",
  loinc: "http://loinc.org",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  observationInterpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  encounterParticipantType: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
  cvx: "http://hl7.org/fhir/sid/cvx",
  appointmentType: "http://terminology.hl7.org/CodeSystem/v2-0276",
  documentType: "http://loinc.org",
  specimenType: "http://terminology.hl7.org/CodeSystem/v2-0487",
  triggerEvent: "http://terminology.hl7.org/CodeSystem/v2-0003",
} as const;

/** Collects the field-level trail for a translation as it runs, in either direction. */
export class MappingTrail {
  readonly mappings: Mapping[] = [];
  readonly warnings: string[] = [];

  /** Records one field-level mapping; silently skipped when `value` is empty so the trail only ever cites fields that actually produced output. */
  add(source: string, target: string, value: string, note?: string): void {
    if (value === "" || value === undefined) return;
    this.mappings.push(note !== undefined ? { source, target, value, note } : { source, target, value });
  }

  /** Records an input segment/field or output resource that had no mapping and was skipped. */
  warn(message: string): void {
    this.warnings.push(message);
  }
}

/** Already-extracted family/given name components -> a Practitioner resource, or undefined when there's no family name. Shared by every XCN person-name field (attending doctor, ordering provider, administering provider, diagnosing clinician, document author/authenticator, ...) this package upgrades from a display-only Reference to a real resource. */
export function practitionerFromNameParts(family: string | undefined, given: string | undefined, id: string): Practitioner | undefined {
  if (!family) return undefined;
  return { resourceType: "Practitioner", id, name: [{ family, given: given ? [given] : undefined }] };
}

/** Resolves a Reference's person name: prefers the referenced Practitioner's structured `name[0]` when one is in the bundle, falling back to splitting the Reference's `.display` on the first space (for hand-constructed bundles with no Practitioner resource). */
export function resolvePractitionerName(
  ref: Reference | undefined,
  practitioners: Practitioner[],
): { family?: string; given?: string } | undefined {
  if (!ref) return undefined;
  const practitioner = ref.reference ? practitioners.find((p) => `Practitioner/${p.id}` === ref.reference) : undefined;
  const name = practitioner?.name?.[0];
  if (name?.family) return { family: name.family, given: name.given?.[0] };
  if (!ref.display) return undefined;
  const [given, ...rest] = ref.display.split(" ");
  return { family: rest.join(" ") || given, given: rest.length ? given : undefined };
}

const GENDER_HL7_TO_FHIR: Record<string, "male" | "female" | "other" | "unknown"> = {
  M: "male",
  F: "female",
  O: "other",
  U: "unknown",
};
const GENDER_FHIR_TO_HL7: Record<string, string> = { male: "M", female: "F", other: "O", unknown: "U" };

/** HL7 Table 0001 (Administrative Sex) -> FHIR AdministrativeGender. Unrecognized or missing codes fall back to "unknown". */
export function hl7GenderToFhir(code: string | undefined): "male" | "female" | "other" | "unknown" {
  if (!code) return "unknown";
  return GENDER_HL7_TO_FHIR[code.toUpperCase()] ?? "unknown";
}

/** FHIR AdministrativeGender -> HL7 Table 0001. Unrecognized or missing values fall back to "U". */
export function fhirGenderToHl7(gender: string | undefined): string {
  if (!gender) return "U";
  return GENDER_FHIR_TO_HL7[gender] ?? "U";
}

const PATIENT_CLASS_HL7_TO_FHIR: Record<string, { code: string; display: string }> = {
  I: { code: "IMP", display: "inpatient encounter" },
  O: { code: "AMB", display: "ambulatory" },
  E: { code: "EMER", display: "emergency" },
};
const PATIENT_CLASS_FHIR_TO_HL7: Record<string, string> = { IMP: "I", AMB: "O", EMER: "E" };

/** HL7 Table 0004 (Patient Class, PV1-2) -> a v3-ActCode `Encounter.class` code+display. Unrecognized or missing codes fall back to "UNK". */
export function hl7PatientClassToFhir(code: string | undefined): { code: string; display: string } {
  if (!code) return { code: "UNK", display: "unknown" };
  return PATIENT_CLASS_HL7_TO_FHIR[code.toUpperCase()] ?? { code: "UNK", display: "unknown" };
}

/** v3-ActCode `Encounter.class` code -> HL7 Table 0004 (Patient Class). Unrecognized or missing codes fall back to "I" (inpatient). */
export function fhirEncounterClassToHl7(code: string | undefined): string {
  if (!code) return "I";
  return PATIENT_CLASS_FHIR_TO_HL7[code] ?? "I";
}

/** HL7 DTM (YYYYMMDD or YYYYMMDDHHmmss) -> FHIR date/dateTime. */
export function hl7DateTimeToFhir(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?/.exec(value);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  if (h === undefined) return `${y}-${mo}-${d}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}Z`;
}

/** FHIR date/dateTime -> HL7 DTM. */
export function fhirDateTimeToHl7(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  if (h === undefined) return `${y}${mo}${d}`;
  return `${y}${mo}${d}${h}${mi}${s ?? "00"}`;
}

/** Combines an XPN given (PID-5.2) and middle (PID-5.3) name component into FHIR's `HumanName.given[]`; returns undefined rather than an empty array when both are absent. */
export function hl7NameToFhirGiven(given: string | undefined, middle: string | undefined): string[] | undefined {
  const parts = [given, middle].filter((p): p is string => !!p);
  return parts.length > 0 ? parts : undefined;
}

let controlIdCounter = 0;
/** A unique MSH-10 message control ID for a synthesized HL7v2 message, monotonically incrementing within the process so two messages built in the same millisecond still differ. */
export function nextMessageControlId(): string {
  controlIdCounter += 1;
  return `TRX${Date.now()}${controlIdCounter}`;
}

/** The current UTC time as an HL7 DTM (YYYYMMDDHHmmss), for synthesizing MSH-7/EVN-2 when the FHIR source has no corresponding timestamp. */
export function nowHl7DateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/**
 * Builds the MSH segment shared by every FHIR->HL7v2 mapper: HL7 2.5, and the given
 * category^trigger in MSH-9. `messageHeader`, when supplied, provides real `MSH-3`/`MSH-5`
 * (source/destination application names) instead of the synthesized "FHIR-TRANSLATOR"/
 * "HL7FHIR" defaults — `MSH-4`/`MSH-6` (facility) stay synthesized either way, since this
 * package doesn't model a facility-level FHIR resource. Also records the Bundle.type ->
 * MSH-9 mapping.
 */
export function buildMsh(
  trail: MappingTrail,
  category: string,
  trigger: string,
  controlId: string,
  now: string,
  messageHeader?: MessageHeader,
): Hl7Segment {
  const sourceName = messageHeader?.source.name;
  const destinationName = messageHeader?.destination?.[0]?.name;
  const msh = segment("MSH", {
    2: field("^~\\&"),
    3: field(sourceName ?? "FHIR-TRANSLATOR"),
    4: field("HL7FHIR"),
    5: field(destinationName ?? "HIS"),
    6: field("HOSP"),
    7: field(now),
    9: field(category, trigger),
    10: field(controlId),
    11: field("P"),
    12: field("2.5"),
  });
  if (sourceName) trail.add("MessageHeader.source.name", "MSH-3", sourceName);
  if (destinationName) trail.add("MessageHeader.destination[0].name", "MSH-5", destinationName);
  trail.add("Bundle.type", "MSH-9", `${category}^${trigger}`);
  return msh;
}

/** MSH-3/MSH-5/MSH-9 -> a MessageHeader resource, per the official IG's "Segment MSH to MessageHeader Map". `source.endpoint`/`destination[0].endpoint` are synthesized (see the interface doc comment); real HL7v2 gives no URI for them. */
export function messageHeaderFromMsh(message: Hl7Message, trail: MappingTrail, id = "messageheader-1"): MessageHeader {
  const msh = findSegment(message, "MSH");
  const sourceName = getField(msh, 3);
  const destinationName = getField(msh, 5);
  const messageHeader: MessageHeader = {
    resourceType: "MessageHeader",
    id,
    source: { name: sourceName, endpoint: `urn:hl7v2:${sourceName ?? "unknown"}` },
  };
  if (sourceName) trail.add("MSH-3", "MessageHeader.source.name", sourceName);
  if (destinationName) {
    messageHeader.destination = [{ name: destinationName, endpoint: `urn:hl7v2:${destinationName}` }];
    trail.add("MSH-5", "MessageHeader.destination[0].name", destinationName);
  }
  const category = getComponent(msh, 9, 1);
  const trigger = getComponent(msh, 9, 2);
  if (trigger) {
    messageHeader.eventCoding = {
      system: CODE_SYSTEMS.triggerEvent,
      code: trigger,
      display: category ? `${category}^${trigger}` : trigger,
    };
    trail.add("MSH-9", "MessageHeader.eventCoding", trigger, `Message type "${category}^${trigger}"`);
  }
  return messageHeader;
}

/**
 * `EVN` -> a Provenance resource (plus the Practitioner/Location it references), per the
 * official IG's "Segment EVN to Provenance Map". FHIR requires `Provenance.agent` to be
 * non-empty with `who` present on each entry, and `EVN-5` (Operator ID) is the only source
 * for that — so this returns `undefined` when `EVN-5` is absent, rather than synthesizing a
 * placeholder agent. The IG's segment-level "EVN -> activity.coding.display" row (no
 * specific field cited) isn't implemented for the same reason — there's no concrete source
 * field to derive a display string from.
 */
export function provenanceFromEvn(
  evn: Hl7Segment | undefined,
  target: Reference[],
  trail: MappingTrail,
  id = "provenance-1",
  practitionerId = "practitioner-operator",
  locationId = "provenance-location",
): { provenance?: Provenance; practitioner?: Practitioner; location?: Location } {
  if (!evn) return {};
  const { family, given } = xcnToNameParts(evn.fields[5]);
  const practitioner = practitionerFromNameParts(family, given, practitionerId);
  if (!practitioner) return {};

  const display = [given, family].filter(Boolean).join(" ");
  const provenance: Provenance = {
    resourceType: "Provenance",
    id,
    target,
    agent: [{ who: { reference: `Practitioner/${practitioner.id}`, display } }],
  };
  trail.add("EVN-5", "Provenance.agent[0].who", display, "Operator");

  const recorded = hl7DateTimeToFhir(getField(evn, 2));
  if (recorded) {
    provenance.recorded = recorded;
    trail.add("EVN-2", "Provenance.recorded", recorded);
  }

  const occurred = hl7DateTimeToFhir(getField(evn, 6));
  if (occurred) {
    provenance.occurredDateTime = occurred;
    trail.add("EVN-6", "Provenance.occurredDateTime", occurred);
  }

  const reasonCode = getField(evn, 4);
  if (reasonCode) {
    provenance.reason = [{ coding: [{ code: reasonCode }] }];
    trail.add("EVN-4", "Provenance.reason[0]", reasonCode);
  }

  let location: Location | undefined;
  const facilityName = getComponent(evn, 7, 1);
  if (facilityName) {
    location = { resourceType: "Location", id: locationId, name: facilityName };
    provenance.location = { reference: `Location/${location.id}`, display: facilityName };
    trail.add("EVN-7", "Provenance.location.display", facilityName);
  }

  return { provenance, practitioner, location };
}

/**
 * A Provenance resource -> EVN-2/4/5/6/7 field values, inverse of `provenanceFromEvn`.
 * `EVN-2` here takes precedence over a caller's own `Encounter.period.start`-based fallback
 * when `Provenance.recorded` is present — the same "real source overrides the synthesized
 * default" pattern `buildMsh` already uses for `MSH-3`/`MSH-5` from `MessageHeader`.
 */
export function evnFieldsFromProvenance(
  provenance: Provenance | undefined,
  practitioners: Practitioner[],
  locations: Location[],
  trail: MappingTrail,
): Record<number, Hl7Field> {
  if (!provenance) return {};
  const fields: Record<number, Hl7Field> = {};

  if (provenance.recorded) {
    const t = fhirDateTimeToHl7(provenance.recorded) ?? "";
    fields[2] = field(t);
    trail.add("Provenance.recorded", "EVN-2", t);
  }

  const reasonCode = provenance.reason?.[0]?.coding?.[0]?.code;
  if (reasonCode) {
    fields[4] = field(reasonCode);
    trail.add("Provenance.reason[0]", "EVN-4", reasonCode);
  }

  const operatorName = resolvePractitionerName(provenance.agent[0]?.who, practitioners);
  if (operatorName?.family) {
    fields[5] = field("", operatorName.family, operatorName.given ?? "");
    trail.add("Provenance.agent[0].who", "EVN-5", [operatorName.given, operatorName.family].filter(Boolean).join(" "));
  }

  if (provenance.occurredDateTime) {
    const t = fhirDateTimeToHl7(provenance.occurredDateTime) ?? "";
    fields[6] = field(t);
    trail.add("Provenance.occurredDateTime", "EVN-6", t);
  }

  const locationName = locations.find((l) => `Location/${l.id}` === provenance.location?.reference)?.name ?? provenance.location?.display;
  if (locationName) {
    fields[7] = field(locationName);
    trail.add("Provenance.location.display", "EVN-7", locationName);
  }

  return fields;
}
