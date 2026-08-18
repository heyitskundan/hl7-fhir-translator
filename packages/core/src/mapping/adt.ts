import { findSegment, findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message, type Hl7Segment } from "../hl7/types.js";
import type { Bundle, Encounter, Patient } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import {
  CODE_SYSTEMS,
  MappingTrail,
  buildMsh,
  fhirDateTimeToHl7,
  fhirEncounterClassToHl7,
  fhirGenderToHl7,
  hl7DateTimeToFhir,
  hl7GenderToFhir,
  hl7NameToFhirGiven,
  hl7PatientClassToFhir,
  nextMessageControlId,
  nowHl7DateTime,
} from "./common.js";

const KNOWN_ADT_SEGMENTS = new Set(["MSH", "EVN", "PID", "PV1"]);

/**
 * `Encounter.status` per ADT trigger event. The official v2-to-FHIR IG's ADT mapping
 * pages (checked directly against ADT^A02 and ADT^A11) map segments to resource *types*
 * (PV1 -> Encounter) but specify no trigger-specific status rule — this table is this
 * package's own interpretation of the HL7v2 spec's trigger semantics, not an IG mandate.
 * A05 (pre-admit) hasn't happened yet, so "planned" fits FHIR's status vocabulary; A11
 * (cancel admit) means the admission message itself was sent in error, closest to FHIR's
 * "entered-in-error". Every other trigger (including the newly added A02/A06/A09) keeps
 * the existing "in-progress" default — HL7v2 doesn't encode a different Encounter-level
 * state for a transfer, a class change, or a departure-tracking event; those are
 * expressed via PV1's other fields (location, class), already mapped below.
 */
const STATUS_FOR_TRIGGER: Partial<Record<string, Encounter["status"]>> = {
  A05: "planned",
  A11: "entered-in-error",
};

function statusForTrigger(trigger: string): Encounter["status"] {
  return STATUS_FOR_TRIGGER[trigger] ?? "in-progress";
}

/** Inverse of `STATUS_FOR_TRIGGER`, used by the reverse direction to pick MSH-9/EVN-1's trigger from `Encounter.status`. Any other status (including "in-progress", "finished", "unknown") falls back to A01 — same limitation already documented for A01 vs. A08: a bare Encounter carries no signal to distinguish those from each other, or from A02/A06/A09. */
const TRIGGER_FOR_STATUS: Partial<Record<string, string>> = {
  planned: "A05",
  "entered-in-error": "A11",
};

function triggerForStatus(status: Encounter["status"] | undefined): string {
  return (status && TRIGGER_FOR_STATUS[status]) ?? "A01";
}

/** Shared PID -> Patient mapping, reused by every HL7v2 message type that carries a PID segment. */
export function buildPatientFromPid(pid: Hl7Segment, trail: MappingTrail, id = "patient-1"): Patient {
  const patient: Patient = { resourceType: "Patient", id };

  const mrn = getComponent(pid, 3, 1);
  const authority = getComponent(pid, 3, 4);
  const idType = getComponent(pid, 3, 5) ?? "MR";
  if (mrn) {
    patient.identifier = [
      {
        value: mrn,
        ...(authority ? { assigner: { display: authority } } : {}),
        type: { coding: [{ system: CODE_SYSTEMS.identifierType, code: idType }] },
      },
    ];
    trail.add("PID-3", "Patient.identifier[0].value", mrn, "Medical record number");
  }

  const family = getComponent(pid, 5, 1);
  const given = getComponent(pid, 5, 2);
  const middle = getComponent(pid, 5, 3);
  if (family || given) {
    patient.name = [{ family, given: hl7NameToFhirGiven(given, middle) }];
    trail.add("PID-5", "Patient.name[0]", [family, given, middle].filter(Boolean).join(" "));
  }

  const dob = getField(pid, 7);
  const fhirDob = hl7DateTimeToFhir(dob);
  if (fhirDob) {
    patient.birthDate = fhirDob.substring(0, 10);
    trail.add("PID-7", "Patient.birthDate", patient.birthDate);
  }

  const genderRaw = getField(pid, 8);
  if (genderRaw) {
    patient.gender = hl7GenderToFhir(genderRaw);
    trail.add("PID-8", "Patient.gender", patient.gender, `HL7 code "${genderRaw}"`);
  }

  const street = getComponent(pid, 11, 1);
  const city = getComponent(pid, 11, 3);
  const state = getComponent(pid, 11, 4);
  const zip = getComponent(pid, 11, 5);
  const country = getComponent(pid, 11, 6);
  if (street || city) {
    patient.address = [{ line: street ? [street] : undefined, city, state, postalCode: zip, country }];
    trail.add("PID-11", "Patient.address[0]", [street, city, state, zip].filter(Boolean).join(", "));
  }

  return patient;
}

/** Shared Patient -> PID field mapping, reused by every FHIR-to-HL7v2 direction. */
export function buildPidFieldsFromPatient(patient: Patient, trail: MappingTrail): Record<number, Hl7Field> {
  const pidFields: Record<number, Hl7Field> = {};
  const identifier = patient.identifier?.[0];
  const idTypeCode = identifier?.type?.coding?.[0]?.code ?? "MR";
  if (identifier?.value) {
    pidFields[3] = field(identifier.value, "", "", identifier.assigner?.display ?? "", idTypeCode);
    trail.add("Patient.identifier[0].value", "PID-3", identifier.value);
  }
  const name = patient.name?.[0];
  if (name) {
    pidFields[5] = field(name.family ?? "", name.given?.[0] ?? "", name.given?.[1] ?? "");
    trail.add("Patient.name[0]", "PID-5", [name.family, ...(name.given ?? [])].filter(Boolean).join(" "));
  }
  if (patient.birthDate) {
    const dob = fhirDateTimeToHl7(patient.birthDate) ?? "";
    pidFields[7] = field(dob);
    trail.add("Patient.birthDate", "PID-7", dob);
  }
  if (patient.gender) {
    const g = fhirGenderToHl7(patient.gender);
    pidFields[8] = field(g);
    trail.add("Patient.gender", "PID-8", g);
  }
  const addr = patient.address?.[0];
  if (addr) {
    pidFields[11] = field(addr.line?.[0] ?? "", "", addr.city ?? "", addr.state ?? "", addr.postalCode ?? "", addr.country ?? "");
    trail.add("Patient.address[0]", "PID-11", [addr.line?.[0], addr.city, addr.state, addr.postalCode].filter(Boolean).join(", "));
  }
  return pidFields;
}

/** Shared PV1(+EVN) -> Encounter mapping. Returns undefined (mirroring the caller's existing silent-omission behavior) when PV1 or PV1-2 is absent. */
function buildEncounterFromPv1(
  pv1: Hl7Segment | undefined,
  evn: Hl7Segment | undefined,
  patient: Patient,
  status: Encounter["status"],
  trail: MappingTrail,
  id: string,
): Encounter | undefined {
  const patientClass = getField(pv1, 2);
  if (!pv1 || !patientClass) return undefined;

  const cls = hl7PatientClassToFhir(patientClass);
  const encounter: Encounter = {
    resourceType: "Encounter",
    id,
    status,
    class: { system: CODE_SYSTEMS.actCode, code: cls.code, display: cls.display },
    subject: { reference: `Patient/${patient.id}`, display: patient.name?.[0]?.family },
  };
  trail.add("PV1-2", "Encounter.class", cls.code, `HL7 patient class "${patientClass}"`);

  const location = getComponent(pv1, 3, 1);
  if (location) {
    encounter.location = [{ location: { display: location } }];
    trail.add("PV1-3", "Encounter.location[0].location.display", location, "Point of care");
  }

  const attendingFamily = getComponent(pv1, 7, 2);
  const attendingGiven = getComponent(pv1, 7, 3);
  if (attendingFamily) {
    const display = [attendingGiven, attendingFamily].filter(Boolean).join(" ");
    encounter.participant = [
      {
        individual: { display },
        type: [{ coding: [{ system: CODE_SYSTEMS.encounterParticipantType, code: "ATND", display: "attender" }] }],
      },
    ];
    trail.add("PV1-7", "Encounter.participant[0].individual.display", display, "Attending doctor");
  }

  const eventTime = getField(evn, 2);
  const fhirEventTime = hl7DateTimeToFhir(eventTime);
  if (fhirEventTime) {
    encounter.period = { start: fhirEventTime };
    trail.add("EVN-2", "Encounter.period.start", fhirEventTime);
  }

  return encounter;
}

/**
 * ADT^A17 (swap patients) -> a Bundle with two Patient+Encounter pairs, one per PID/PV1
 * group. Unlike every other ADT trigger, A17 carries two full patient/visit groups in a
 * single message (per the HL7v2 spec — the IG's own mapping pages don't call this out,
 * since they describe segment-to-resource-type mapping generically, not per-trigger
 * cardinality). Throws `FhirValidationError` when fewer than two PID segments are present.
 */
function adtA17ToFhir(message: Hl7Message, trail: MappingTrail): { bundle: Bundle; trail: MappingTrail } {
  const pids = findSegments(message, "PID");
  const pv1s = findSegments(message, "PV1");
  const evn = findSegment(message, "EVN");

  if (pids.length < 2) {
    throw new FhirValidationError("ADT^A17 (swap patients) message must contain two PID segments");
  }

  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [] };
  pids.forEach((pid, i) => {
    const patient = buildPatientFromPid(pid, trail, `patient-${i + 1}`);
    bundle.entry.push({ resource: patient });

    const encounter = buildEncounterFromPv1(pv1s[i], evn, patient, "in-progress", trail, `encounter-${i + 1}`);
    if (encounter) {
      bundle.entry.push({ resource: encounter });
    } else if (!pv1s[i]) {
      trail.warn(`No PV1 segment present for patient ${i + 1} — Encounter resource omitted`);
    }
  });

  for (const seg of message.segments) {
    if (!KNOWN_ADT_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  return { bundle, trail };
}

/** ADT -> a Bundle with a Patient and, if PV1 is present, an Encounter (ADT^A17 instead produces two Patient+Encounter pairs — see `adtA17ToFhir`). Throws `FhirValidationError` when PID is missing. */
export function adtToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const trigger = message.messageType.split("^")[1] ?? "A01";

  if (trigger === "A17") {
    return adtA17ToFhir(message, trail);
  }

  const pid = findSegment(message, "PID");
  const pv1 = findSegment(message, "PV1");
  const evn = findSegment(message, "EVN");

  if (!pid) {
    throw new FhirValidationError("ADT message is missing a required PID segment");
  }

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const encounter = buildEncounterFromPv1(pv1, evn, patient, statusForTrigger(trigger), trail, "encounter-1");
  if (encounter) {
    bundle.entry.push({ resource: encounter });
  } else if (!pv1) {
    trail.warn("No PV1 segment present — Encounter resource omitted");
  }

  for (const seg of message.segments) {
    if (!KNOWN_ADT_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  return { bundle, trail };
}

/** Shared Encounter -> PV1 field mapping, reused by both the single-patient and ADT^A17 two-patient reverse paths. */
function buildPv1FromEncounter(encounter: Encounter, trail: MappingTrail): Hl7Segment {
  const pv1Fields: Record<number, Hl7Field> = {
    1: field("1"),
    2: field(fhirEncounterClassToHl7(encounter.class?.code)),
  };
  trail.add("Encounter.class", "PV1-2", fhirEncounterClassToHl7(encounter.class?.code));

  const locationDisplay = encounter.location?.[0]?.location?.display;
  if (locationDisplay) {
    pv1Fields[3] = field(locationDisplay);
    trail.add("Encounter.location[0].location.display", "PV1-3", locationDisplay);
  }
  const attending = encounter.participant?.[0]?.individual?.display;
  if (attending) {
    const [given, ...rest] = attending.split(" ");
    pv1Fields[7] = field("", rest.join(" ") || given || "", rest.length ? given : "");
    trail.add("Encounter.participant[0].individual.display", "PV1-7", attending);
  }
  return segment("PV1", pv1Fields);
}

/**
 * Two Patients(+Encounters) -> an ADT^A17 message with two PID/PV1 groups. Each Encounter
 * is paired to its Patient by `Encounter.subject.reference`; a Patient with no matching
 * Encounter gets a PID with no PV1, and a warning.
 */
function fhirToAdtA17(bundle: Bundle, patients: Patient[], trail: MappingTrail): { message: Hl7Message; trail: MappingTrail } {
  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();

  const msh = buildMsh(trail, "ADT", "A17", controlId, now);
  const evn = segment("EVN", { 1: field("A17"), 2: field(now) });
  const segments: Hl7Segment[] = [msh, evn];

  patients.forEach((patient, i) => {
    const pidFields = buildPidFieldsFromPatient(patient, trail);
    segments.push(segment("PID", { 1: field(String(i + 1)), ...pidFields }));

    const encounter = bundle.entry.find(
      (e): e is { resource: Encounter; fullUrl?: string } =>
        e.resource.resourceType === "Encounter" && e.resource.subject?.reference === `Patient/${patient.id}`,
    )?.resource;
    if (encounter) {
      segments.push(buildPv1FromEncounter(encounter, trail));
    } else {
      trail.warn(`No Encounter resource referencing Patient/${patient.id} — PV1 segment omitted for that patient`);
    }
  });

  for (const entry of bundle.entry) {
    if (entry.resource.resourceType !== "Patient" && entry.resource.resourceType !== "Encounter") {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 ADT mapping and was skipped`);
    }
  }

  return { message: { segments, delimiters, messageType: "ADT^A17" }, trail };
}

/**
 * Patient(+Encounter) -> an ADT message. The trigger written to MSH-9/EVN-1 is derived
 * from the bundle itself, not passed in: two or more Patient resources routes to A17
 * (swap patients — see `fhirToAdtA17`); otherwise the single Encounter's `status` picks
 * the trigger via `triggerForStatus` (falling back to A01 the same way the previous
 * single-trigger version did for any status it couldn't map). PV1 is omitted, with a
 * warning, when no Encounter is present. Throws `FhirValidationError` when the bundle has
 * no Patient.
 */
export function fhirToAdt(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patients = bundle.entry
    .filter((e): e is { resource: Patient; fullUrl?: string } => e.resource.resourceType === "Patient")
    .map((e) => e.resource);

  if (patients.length === 0) {
    throw new FhirValidationError("Bundle must contain a Patient resource to translate to an ADT message");
  }
  if (patients.length >= 2) {
    return fhirToAdtA17(bundle, patients, trail);
  }

  const patient = patients[0]!;
  const encounter = bundle.entry.find(
    (e): e is { resource: Encounter; fullUrl?: string } => e.resource.resourceType === "Encounter",
  )?.resource;
  const messageTypeTrigger = triggerForStatus(encounter?.status);

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();

  const msh = buildMsh(trail, "ADT", messageTypeTrigger, controlId, now);

  const evnTime = encounter?.period?.start ? fhirDateTimeToHl7(encounter.period.start) : now;
  const evn = segment("EVN", { 1: field(messageTypeTrigger), 2: field(evnTime) });
  if (encounter?.period?.start) trail.add("Encounter.period.start", "EVN-2", evnTime ?? "");

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const segments = [msh, evn, pid];

  if (encounter) {
    segments.push(buildPv1FromEncounter(encounter, trail));
  } else {
    trail.warn("No Encounter resource in the bundle — PV1 segment omitted");
  }

  for (const entry of bundle.entry) {
    if (entry.resource.resourceType !== "Patient" && entry.resource.resourceType !== "Encounter") {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 ADT mapping and was skipped`);
    }
  }

  return { message: { segments, delimiters, messageType: `ADT^${messageTypeTrigger}` }, trail };
}
