import type { Mapping } from "../types.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Segment } from "../hl7/types.js";

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

/** Builds the MSH segment shared by every FHIR->HL7v2 mapper: fixed sending/receiving application and facility, HL7 2.5, and the given category^trigger in MSH-9. Also records the Bundle.type -> MSH-9 mapping. */
export function buildMsh(trail: MappingTrail, category: string, trigger: string, controlId: string, now: string): Hl7Segment {
  const msh = segment("MSH", {
    2: field("^~\\&"),
    3: field("FHIR-TRANSLATOR"),
    4: field("HL7FHIR"),
    5: field("HIS"),
    6: field("HOSP"),
    7: field(now),
    9: field(category, trigger),
    10: field(controlId),
    11: field("P"),
    12: field("2.5"),
  });
  trail.add("Bundle.type", "MSH-9", `${category}^${trigger}`);
  return msh;
}
