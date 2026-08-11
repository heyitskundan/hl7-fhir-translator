import type { Mapping } from "../types.js";

export const CODE_SYSTEMS = {
  identifierType: "http://terminology.hl7.org/CodeSystem/v2-0203",
  loinc: "http://loinc.org",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  observationInterpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
  encounterParticipantType: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
} as const;

/** Collects the field-level trail for a translation as it runs, in either direction. */
export class MappingTrail {
  readonly mappings: Mapping[] = [];
  readonly warnings: string[] = [];

  add(source: string, target: string, value: string, note?: string): void {
    if (value === "" || value === undefined) return;
    this.mappings.push(note !== undefined ? { source, target, value, note } : { source, target, value });
  }

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

export function hl7GenderToFhir(code: string | undefined): "male" | "female" | "other" | "unknown" {
  if (!code) return "unknown";
  return GENDER_HL7_TO_FHIR[code.toUpperCase()] ?? "unknown";
}

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

export function hl7PatientClassToFhir(code: string | undefined): { code: string; display: string } {
  if (!code) return { code: "UNK", display: "unknown" };
  return PATIENT_CLASS_HL7_TO_FHIR[code.toUpperCase()] ?? { code: "UNK", display: "unknown" };
}

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

export function hl7NameToFhirGiven(given: string | undefined, middle: string | undefined): string[] | undefined {
  const parts = [given, middle].filter((p): p is string => !!p);
  return parts.length > 0 ? parts : undefined;
}

let controlIdCounter = 0;
export function nextMessageControlId(): string {
  controlIdCounter += 1;
  return `TRX${Date.now()}${controlIdCounter}`;
}

export function nowHl7DateTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
