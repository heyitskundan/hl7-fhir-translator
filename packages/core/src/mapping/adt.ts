import { findSegment, findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message, type Hl7Segment } from "../hl7/types.js";
import type {
  AllergyIntolerance,
  Bundle,
  CareTeam,
  Condition,
  Coverage,
  Encounter,
  Location,
  MessageHeader,
  Organization,
  Patient,
  Practitioner,
  Procedure,
  Provenance,
  Reference,
  RelatedPerson,
} from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import {
  CODE_SYSTEMS,
  MappingTrail,
  buildMsh,
  evnFieldsFromProvenance,
  fhirDateTimeToHl7,
  fhirEncounterClassToHl7,
  fhirGenderToHl7,
  hl7DateTimeToFhir,
  hl7GenderToFhir,
  hl7NameToFhirGiven,
  hl7PatientClassToFhir,
  messageHeaderFromMsh,
  nextMessageControlId,
  nowHl7DateTime,
  practitionerFromNameParts,
  provenanceFromEvn,
  resolvePractitionerName,
} from "./common.js";
import { al1ToAllergyIntolerances, allergyIntolerancesToAl1 } from "./allergy.js";
import { conditionsToDg1, dg1ToConditions, dg1ToEncounterDiagnoses } from "./condition.js";
import { nk1ToRelatedPersons, relatedPersonsToNk1 } from "./relatedperson.js";
import { coveragesToIn1, in1ToCoverages } from "./coverage.js";
import { careTeamToRolAndIn3, rolToCareTeam } from "./careteam.js";
import { pr1ToProcedures, proceduresToPr1 } from "./procedure.js";
import { cweToCodeableConcept, xtnToContactPoint } from "./datatypes.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";

const KNOWN_ADT_SEGMENTS = new Set(["MSH", "EVN", "PID", "PV1", "AL1", "DG1", "NK1", "IN1", "IN3", "PR1", "PD1", "PV2", "ROL"]);
const MARITAL_STATUS_TABLE = "table-hl70002-to-v3-maritalstatus";
/** ADT^A17 has no clear per-patient ownership for a repeating optional segment like AL1 in a two-patient swap message, so it's deliberately not attached to either patient there — if present, it's warned about like any other unmapped segment for that trigger, rather than silently guessed at. */
const KNOWN_ADT_A17_SEGMENTS = new Set(["MSH", "EVN", "PID", "PV1"]);

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

  const telecoms = [pid.fields[13], pid.fields[14], pid.fields[40]]
    .map((f) => xtnToContactPoint(f))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  if (telecoms.length > 0) {
    patient.telecom = telecoms;
    trail.add("PID-13", "Patient.telecom", telecoms.map((t) => t.value).join(", "));
  }

  const maritalCode = getComponent(pid, 16, 1);
  const maritalStatus = lookupVocabulary(MARITAL_STATUS_TABLE, maritalCode);
  if (maritalStatus?.code) {
    patient.maritalStatus = { coding: [{ system: maritalStatus.system, code: maritalStatus.code, display: maritalStatus.display }] };
    trail.add("PID-16", "Patient.maritalStatus", maritalStatus.code, `HL7 marital status "${maritalCode}"`);
  }

  const ssn = getField(pid, 19);
  if (ssn) {
    patient.identifier = [...(patient.identifier ?? []), { value: ssn, type: { coding: [{ code: "SS" }] } }];
    trail.add("PID-19", "Patient.identifier", ssn, "SSN");
  }

  const driversLicense = getComponent(pid, 20, 1);
  if (driversLicense) {
    patient.identifier = [...(patient.identifier ?? []), { value: driversLicense, type: { coding: [{ code: "DL" }] } }];
    trail.add("PID-20", "Patient.identifier", driversLicense, "Driver's license number");
  }

  const multipleBirthIndicator = getField(pid, 24);
  const birthOrder = getField(pid, 25);
  if (birthOrder) {
    patient.multipleBirthInteger = Number(birthOrder);
    trail.add("PID-25", "Patient.multipleBirthInteger", birthOrder);
  } else if (multipleBirthIndicator) {
    patient.multipleBirthBoolean = multipleBirthIndicator === "Y";
    trail.add("PID-24", "Patient.multipleBirthBoolean", String(patient.multipleBirthBoolean), `HL7 code "${multipleBirthIndicator}"`);
  }

  const deathDateTime = hl7DateTimeToFhir(getField(pid, 29));
  const deathIndicator = getField(pid, 30);
  if (deathDateTime) {
    patient.deceasedDateTime = deathDateTime;
    trail.add("PID-29", "Patient.deceasedDateTime", deathDateTime);
  } else if (deathIndicator) {
    patient.deceasedBoolean = deathIndicator === "Y";
    trail.add("PID-30", "Patient.deceasedBoolean", String(patient.deceasedBoolean), `HL7 code "${deathIndicator}"`);
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
  if (patient.telecom?.[0]?.value) {
    pidFields[13] = field(patient.telecom[0].value);
    trail.add("Patient.telecom", "PID-13", patient.telecom[0].value);
  }
  if (patient.maritalStatus?.coding?.[0]?.code) {
    const hl7Code = reverseLookupVocabulary(MARITAL_STATUS_TABLE, patient.maritalStatus.coding[0].code);
    if (hl7Code) {
      pidFields[16] = field(hl7Code);
      trail.add("Patient.maritalStatus", "PID-16", hl7Code);
    }
  }
  const ssn = patient.identifier?.find((i) => i.type?.coding?.[0]?.code === "SS");
  if (ssn?.value) {
    pidFields[19] = field(ssn.value);
    trail.add("Patient.identifier", "PID-19", ssn.value);
  }
  const driversLicense = patient.identifier?.find((i) => i.type?.coding?.[0]?.code === "DL");
  if (driversLicense?.value) {
    pidFields[20] = field(driversLicense.value);
    trail.add("Patient.identifier", "PID-20", driversLicense.value);
  }
  if (patient.multipleBirthInteger !== undefined) {
    pidFields[25] = field(String(patient.multipleBirthInteger));
    trail.add("Patient.multipleBirthInteger", "PID-25", String(patient.multipleBirthInteger));
  } else if (patient.multipleBirthBoolean !== undefined) {
    const code = patient.multipleBirthBoolean ? "Y" : "N";
    pidFields[24] = field(code);
    trail.add("Patient.multipleBirthBoolean", "PID-24", code);
  }
  if (patient.deceasedDateTime) {
    const t = fhirDateTimeToHl7(patient.deceasedDateTime) ?? "";
    pidFields[29] = field(t);
    trail.add("Patient.deceasedDateTime", "PID-29", t);
  } else if (patient.deceasedBoolean !== undefined) {
    const code = patient.deceasedBoolean ? "Y" : "N";
    pidFields[30] = field(code);
    trail.add("Patient.deceasedBoolean", "PID-30", code);
  }
  return pidFields;
}

/**
 * PD1-3/PD1-4 -> Patient.generalPractitioner, per the official IG's "Segment PD1 to
 * Patient Map" (fetched directly). Mutates `patient` in place since PD1 is a single,
 * non-repeating segment attached to one PID, unlike AL1/DG1/NK1/IN1/PR1. Most of PD1's
 * other IG-mapped fields target FHIR extensions, which this package doesn't produce
 * anywhere else, so they're intentionally not implemented here either.
 */
function applyPd1ToPatient(patient: Patient, pd1: Hl7Segment | undefined, trail: MappingTrail): void {
  if (!pd1) return;
  const gp: { reference?: string; display?: string }[] = [];

  const orgName = getComponent(pd1, 3, 1);
  if (orgName) {
    gp.push({ display: orgName });
    trail.add("PD1-3", "Patient.generalPractitioner", orgName);
  }

  const practitionerFamily = getComponent(pd1, 4, 2);
  const practitionerGiven = getComponent(pd1, 4, 3);
  if (practitionerFamily) {
    const display = [practitionerGiven, practitionerFamily].filter(Boolean).join(" ");
    gp.push({ display });
    trail.add("PD1-4", "Patient.generalPractitioner", display);
  }

  if (gp.length > 0) patient.generalPractitioner = gp;
}

/**
 * PV2-3 -> Encounter.reasonCode, per the official IG's "Segment PV2 to Encounter Map"
 * (fetched directly). Mutates `encounter` in place, same non-repeating-segment pattern as
 * `applyPd1ToPatient`. PV2's other IG-mapped fields target FHIR extensions or elements
 * (`length`, `priority`, `text.div`, `meta.security`) this package's minimal `Encounter`
 * type doesn't carry, so they're intentionally not implemented here either.
 */
function applyPv2ToEncounter(encounter: Encounter, pv2: Hl7Segment | undefined, trail: MappingTrail): void {
  if (!pv2) return;
  const reasonCode = getComponent(pv2, 3, 1);
  const reasonDisplay = getComponent(pv2, 3, 2);
  if (reasonCode) {
    encounter.reasonCode = [{ coding: [{ code: reasonCode, display: reasonDisplay }], text: reasonDisplay }];
    trail.add("PV2-3", "Encounter.reasonCode[0]", reasonCode);
  }

  const priority = cweToCodeableConcept(pv2.fields[25]);
  if (priority) {
    encounter.priority = priority;
    trail.add("PV2-25", "Encounter.priority", getComponent(pv2, 25, 1) ?? "");
  }
}

/** Shared PV1(+EVN) -> Encounter (plus a Location resource for PV1-3, and Practitioner resources for PV1-7/PV1-8, when present) mapping. Returns `{}` (mirroring the caller's existing silent-omission behavior) when PV1 or PV1-2 is absent. */
function buildEncounterFromPv1(
  pv1: Hl7Segment | undefined,
  evn: Hl7Segment | undefined,
  patient: Patient,
  status: Encounter["status"],
  trail: MappingTrail,
  id: string,
  locationId: string,
  practitionerIdPrefix: string,
): { encounter?: Encounter; location?: Location; practitioners: Practitioner[] } {
  const practitioners: Practitioner[] = [];
  const patientClass = getField(pv1, 2);
  if (!pv1 || !patientClass) return { practitioners };

  const cls = hl7PatientClassToFhir(patientClass);
  const encounter: Encounter = {
    resourceType: "Encounter",
    id,
    status,
    class: { system: CODE_SYSTEMS.actCode, code: cls.code, display: cls.display },
    subject: { reference: `Patient/${patient.id}`, display: patient.name?.[0]?.family },
  };
  trail.add("PV1-2", "Encounter.class", cls.code, `HL7 patient class "${patientClass}"`);

  const locationName = getComponent(pv1, 3, 1);
  let location: Location | undefined;
  if (locationName) {
    location = { resourceType: "Location", id: locationId, name: locationName };
    encounter.location = [{ location: { reference: `Location/${locationId}`, display: locationName } }];
    trail.add("PV1-3", "Encounter.location[0].location.display", locationName, "Point of care");
  }

  const attendingFamily = getComponent(pv1, 7, 2);
  const attendingGiven = getComponent(pv1, 7, 3);
  if (attendingFamily) {
    const display = [attendingGiven, attendingFamily].filter(Boolean).join(" ");
    const attendingId = `${practitionerIdPrefix}-attending`;
    const attending = practitionerFromNameParts(attendingFamily, attendingGiven, attendingId);
    if (attending) practitioners.push(attending);
    encounter.participant = [
      {
        individual: attending ? { reference: `Practitioner/${attendingId}`, display } : { display },
        type: [{ coding: [{ system: CODE_SYSTEMS.encounterParticipantType, code: "ATND", display: "attender" }] }],
      },
    ];
    trail.add("PV1-7", "Encounter.participant[0].individual.display", display, "Attending doctor");
  }

  const referringFamily = getComponent(pv1, 8, 2);
  const referringGiven = getComponent(pv1, 8, 3);
  if (referringFamily) {
    const display = [referringGiven, referringFamily].filter(Boolean).join(" ");
    const referringId = `${practitionerIdPrefix}-referring`;
    const referring = practitionerFromNameParts(referringFamily, referringGiven, referringId);
    if (referring) practitioners.push(referring);
    encounter.participant = [
      ...(encounter.participant ?? []),
      {
        individual: referring ? { reference: `Practitioner/${referringId}`, display } : { display },
        type: [{ coding: [{ system: CODE_SYSTEMS.encounterParticipantType, code: "REF", display: "referrer" }] }],
      },
    ];
    trail.add(
      "PV1-8",
      `Encounter.participant[${(encounter.participant?.length ?? 1) - 1}].individual.display`,
      display,
      "Referring doctor",
    );
  }

  const visitNumber = getComponent(pv1, 19, 1);
  if (visitNumber) {
    encounter.identifier = [{ value: visitNumber }];
    trail.add("PV1-19", "Encounter.identifier[0].value", visitNumber);
  }

  // PV1-44/PV1-45 are the IG's actual source for Encounter.period (Admit/Discharge
  // Date/Time) — EVN-2 below is this package's own fallback for messages that don't
  // populate them, not an IG-specified mapping (EVN's own IG target is Provenance, not
  // Encounter), so PV1-44 takes precedence when present.
  const admitTime = hl7DateTimeToFhir(getField(pv1, 44));
  const dischargeTime = hl7DateTimeToFhir(getField(pv1, 45));
  if (admitTime) {
    encounter.period = { start: admitTime, ...(dischargeTime ? { end: dischargeTime } : {}) };
    trail.add("PV1-44", "Encounter.period.start", admitTime);
    if (dischargeTime) trail.add("PV1-45", "Encounter.period.end", dischargeTime);
  } else {
    const eventTime = getField(evn, 2);
    const fhirEventTime = hl7DateTimeToFhir(eventTime);
    if (fhirEventTime) {
      encounter.period = { start: fhirEventTime };
      trail.add("EVN-2", "Encounter.period.start", fhirEventTime);
    }
  }

  return { encounter, location, practitioners };
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
  const provenanceTargets: Reference[] = [];
  pids.forEach((pid, i) => {
    const patient = buildPatientFromPid(pid, trail, `patient-${i + 1}`);
    bundle.entry.push({ resource: patient });
    provenanceTargets.push({ reference: `Patient/${patient.id}` });

    const { encounter, location, practitioners } = buildEncounterFromPv1(
      pv1s[i],
      evn,
      patient,
      "in-progress",
      trail,
      `encounter-${i + 1}`,
      `location-${i + 1}`,
      `practitioner-${i + 1}`,
    );
    if (encounter) {
      bundle.entry.push({ resource: encounter });
      provenanceTargets.push({ reference: `Encounter/${encounter.id}` });
      if (location) bundle.entry.push({ resource: location });
      for (const practitioner of practitioners) bundle.entry.push({ resource: practitioner });
    } else if (!pv1s[i]) {
      trail.warn(`No PV1 segment present for patient ${i + 1} — Encounter resource omitted`);
    }
  });

  const {
    provenance,
    practitioner: provenancePractitioner,
    location: provenanceLocation,
  } = provenanceFromEvn(evn, provenanceTargets, trail);
  if (provenance) {
    bundle.entry.push({ resource: provenance });
    if (provenancePractitioner) bundle.entry.push({ resource: provenancePractitioner });
    if (provenanceLocation) bundle.entry.push({ resource: provenanceLocation });
  }

  for (const seg of message.segments) {
    if (!KNOWN_ADT_A17_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  bundle.entry.push({ resource: messageHeaderFromMsh(message, trail) });

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
  const pd1 = findSegment(message, "PD1");
  const pv2 = findSegment(message, "PV2");

  if (!pid) {
    throw new FhirValidationError("ADT message is missing a required PID segment");
  }

  const patient = buildPatientFromPid(pid, trail);
  applyPd1ToPatient(patient, pd1, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const { encounter, location, practitioners } = buildEncounterFromPv1(
    pv1,
    evn,
    patient,
    statusForTrigger(trigger),
    trail,
    "encounter-1",
    "location-1",
    "practitioner",
  );
  if (encounter) {
    applyPv2ToEncounter(encounter, pv2, trail);
    bundle.entry.push({ resource: encounter });
    if (location) bundle.entry.push({ resource: location });
    for (const practitioner of practitioners) bundle.entry.push({ resource: practitioner });
  } else if (!pv1) {
    trail.warn("No PV1 segment present — Encounter resource omitted");
  }

  for (const allergy of al1ToAllergyIntolerances(message, patient, trail)) {
    bundle.entry.push({ resource: allergy });
  }

  const { conditions, practitioners: dg1Practitioners } = dg1ToConditions(message, patient, trail);
  for (const condition of conditions) {
    bundle.entry.push({ resource: condition });
  }
  for (const practitioner of dg1Practitioners) {
    bundle.entry.push({ resource: practitioner });
  }
  if (encounter) {
    const diagnoses = dg1ToEncounterDiagnoses(message, conditions, trail);
    if (diagnoses) encounter.diagnosis = diagnoses;
  }

  for (const relatedPerson of nk1ToRelatedPersons(message, patient, trail)) {
    bundle.entry.push({ resource: relatedPerson });
  }

  const { coverages: in1Coverages, organizations: in1Organizations } = in1ToCoverages(message, patient, trail);
  for (const coverage of in1Coverages) {
    bundle.entry.push({ resource: coverage });
  }
  for (const organization of in1Organizations) {
    bundle.entry.push({ resource: organization });
  }

  for (const procedure of pr1ToProcedures(message, patient, trail)) {
    bundle.entry.push({ resource: procedure });
  }

  const { careTeam, practitioners: careTeamPractitioners, organizations: careTeamOrganizations } = rolToCareTeam(message, patient, trail);
  if (careTeam) {
    bundle.entry.push({ resource: careTeam });
    for (const p of careTeamPractitioners) bundle.entry.push({ resource: p });
    for (const o of careTeamOrganizations) bundle.entry.push({ resource: o });
  }

  const provenanceTargets = [{ reference: `Patient/${patient.id}` }];
  if (encounter) provenanceTargets.push({ reference: `Encounter/${encounter.id}` });
  const {
    provenance,
    practitioner: provenancePractitioner,
    location: provenanceLocation,
  } = provenanceFromEvn(evn, provenanceTargets, trail);
  if (provenance) {
    bundle.entry.push({ resource: provenance });
    if (provenancePractitioner) bundle.entry.push({ resource: provenancePractitioner });
    if (provenanceLocation) bundle.entry.push({ resource: provenanceLocation });
  }

  for (const seg of message.segments) {
    if (!KNOWN_ADT_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  bundle.entry.push({ resource: messageHeaderFromMsh(message, trail) });

  return { bundle, trail };
}

/** Shared Encounter -> PV1 field mapping, reused by both the single-patient and ADT^A17 two-patient reverse paths. */

function buildPv1FromEncounter(encounter: Encounter, practitioners: Practitioner[], trail: MappingTrail): Hl7Segment {
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
  const attendingIndex = encounter.participant?.findIndex((p) => p.type?.[0]?.coding?.[0]?.code === "ATND") ?? -1;
  const attendingParticipant = attendingIndex >= 0 ? encounter.participant?.[attendingIndex] : undefined;
  const attending = resolvePractitionerName(attendingParticipant?.individual, practitioners);
  if (attending?.family) {
    pv1Fields[7] = field("", attending.family, attending.given ?? "");
    trail.add(
      `Encounter.participant[${attendingIndex}].individual.display`,
      "PV1-7",
      [attending.given, attending.family].filter(Boolean).join(" "),
    );
  }
  const referringIndex = encounter.participant?.findIndex((p) => p.type?.[0]?.coding?.[0]?.code === "REF") ?? -1;
  const referringParticipant = referringIndex >= 0 ? encounter.participant?.[referringIndex] : undefined;
  const referring = resolvePractitionerName(referringParticipant?.individual, practitioners);
  if (referring?.family) {
    pv1Fields[8] = field("", referring.family, referring.given ?? "");
    trail.add(
      `Encounter.participant[${referringIndex}].individual.display`,
      "PV1-8",
      [referring.given, referring.family].filter(Boolean).join(" "),
    );
  }
  if (encounter.identifier?.[0]?.value) {
    pv1Fields[19] = field(encounter.identifier[0].value);
    trail.add("Encounter.identifier[0].value", "PV1-19", encounter.identifier[0].value);
  }
  if (encounter.period?.start) {
    const t = fhirDateTimeToHl7(encounter.period.start) ?? "";
    pv1Fields[44] = field(t);
    trail.add("Encounter.period.start", "PV1-44", t);
    if (encounter.period.end) {
      const endT = fhirDateTimeToHl7(encounter.period.end) ?? "";
      pv1Fields[45] = field(endT);
      trail.add("Encounter.period.end", "PV1-45", endT);
    }
  }
  return segment("PV1", pv1Fields);
}

/** Patient.generalPractitioner -> a PD1 segment, inverse of `applyPd1ToPatient`. Returns undefined when there's nothing to write. */
function buildPd1FromPatient(patient: Patient, trail: MappingTrail): Hl7Segment | undefined {
  const gp = patient.generalPractitioner;
  if (!gp || gp.length === 0) return undefined;
  const pd1Fields: Record<number, Hl7Field> = {};
  const orgDisplay = gp[0]?.display;
  if (orgDisplay) {
    pd1Fields[3] = field(orgDisplay);
    trail.add("Patient.generalPractitioner", "PD1-3", orgDisplay);
  }
  const practitionerDisplay = gp[1]?.display;
  if (practitionerDisplay) {
    const [given, ...rest] = practitionerDisplay.split(" ");
    pd1Fields[4] = field("", rest.join(" ") || given || "", rest.length ? given : "");
    trail.add("Patient.generalPractitioner", "PD1-4", practitionerDisplay);
  }
  return Object.keys(pd1Fields).length > 0 ? segment("PD1", pd1Fields) : undefined;
}

/** Encounter.reasonCode -> a PV2 segment, inverse of `applyPv2ToEncounter`. Returns undefined when there's nothing to write. */
function buildPv2FromEncounter(encounter: Encounter, trail: MappingTrail): Hl7Segment | undefined {
  const coding = encounter.reasonCode?.[0]?.coding?.[0];
  const priorityCoding = encounter.priority?.coding?.[0];
  if (!coding?.code && !priorityCoding?.code) return undefined;
  const pv2Fields: Record<number, ReturnType<typeof field>> = {};
  if (coding?.code) {
    pv2Fields[3] = field(coding.code, coding.display ?? "");
    trail.add("Encounter.reasonCode[0]", "PV2-3", coding.code);
  }
  if (priorityCoding?.code) {
    pv2Fields[25] = field(priorityCoding.code, priorityCoding.display ?? "");
    trail.add("Encounter.priority", "PV2-25", priorityCoding.code);
  }
  return segment("PV2", pv2Fields);
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

  const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")?.resource as MessageHeader | undefined;
  const msh = buildMsh(trail, "ADT", "A17", controlId, now, messageHeader);

  const practitioners = bundle.entry
    .filter((e): e is { resource: Practitioner; fullUrl?: string } => e.resource.resourceType === "Practitioner")
    .map((e) => e.resource);
  const locations = bundle.entry
    .filter((e): e is { resource: Location; fullUrl?: string } => e.resource.resourceType === "Location")
    .map((e) => e.resource);
  const provenance = bundle.entry.find((e) => e.resource.resourceType === "Provenance")?.resource as Provenance | undefined;
  const evn = segment("EVN", { 1: field("A17"), 2: field(now), ...evnFieldsFromProvenance(provenance, practitioners, locations, trail) });
  const segments: Hl7Segment[] = [msh, evn];

  patients.forEach((patient, i) => {
    const pidFields = buildPidFieldsFromPatient(patient, trail);
    segments.push(segment("PID", { 1: field(String(i + 1)), ...pidFields }));

    const encounter = bundle.entry.find(
      (e): e is { resource: Encounter; fullUrl?: string } =>
        e.resource.resourceType === "Encounter" && e.resource.subject?.reference === `Patient/${patient.id}`,
    )?.resource;
    if (encounter) {
      segments.push(buildPv1FromEncounter(encounter, practitioners, trail));
    } else {
      trail.warn(`No Encounter resource referencing Patient/${patient.id} — PV1 segment omitted for that patient`);
    }
  });

  for (const entry of bundle.entry) {
    if (!["Patient", "Encounter", "Location", "Practitioner", "MessageHeader", "Provenance"].includes(entry.resource.resourceType)) {
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

  const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")?.resource as MessageHeader | undefined;
  const msh = buildMsh(trail, "ADT", messageTypeTrigger, controlId, now, messageHeader);

  const practitioners = bundle.entry
    .filter((e): e is { resource: Practitioner; fullUrl?: string } => e.resource.resourceType === "Practitioner")
    .map((e) => e.resource);
  const locations = bundle.entry
    .filter((e): e is { resource: Location; fullUrl?: string } => e.resource.resourceType === "Location")
    .map((e) => e.resource);
  const provenance = bundle.entry.find((e) => e.resource.resourceType === "Provenance")?.resource as Provenance | undefined;

  const evnTime = encounter?.period?.start ? fhirDateTimeToHl7(encounter.period.start) : now;
  const evnFields: Record<number, Hl7Field> = { 1: field(messageTypeTrigger), 2: field(evnTime) };
  if (encounter?.period?.start) trail.add("Encounter.period.start", "EVN-2", evnTime ?? "");
  Object.assign(evnFields, evnFieldsFromProvenance(provenance, practitioners, locations, trail));
  const evn = segment("EVN", evnFields);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const segments = [msh, evn, pid];

  const pd1 = buildPd1FromPatient(patient, trail);
  if (pd1) segments.push(pd1);

  if (encounter) {
    segments.push(buildPv1FromEncounter(encounter, practitioners, trail));
    const pv2 = buildPv2FromEncounter(encounter, trail);
    if (pv2) segments.push(pv2);
  } else {
    trail.warn("No Encounter resource in the bundle — PV1 segment omitted");
  }

  const allergies = bundle.entry
    .filter((e): e is { resource: AllergyIntolerance; fullUrl?: string } => e.resource.resourceType === "AllergyIntolerance")
    .map((e) => e.resource);
  segments.push(...allergyIntolerancesToAl1(allergies, trail));

  const conditions = bundle.entry
    .filter((e): e is { resource: Condition; fullUrl?: string } => e.resource.resourceType === "Condition")
    .map((e) => e.resource);
  segments.push(...conditionsToDg1(conditions, trail, encounter, practitioners));

  const relatedPersons = bundle.entry
    .filter((e): e is { resource: RelatedPerson; fullUrl?: string } => e.resource.resourceType === "RelatedPerson")
    .map((e) => e.resource);
  segments.push(...relatedPersonsToNk1(relatedPersons, trail));

  const coverages = bundle.entry
    .filter((e): e is { resource: Coverage; fullUrl?: string } => e.resource.resourceType === "Coverage")
    .map((e) => e.resource);
  const organizations = bundle.entry
    .filter((e): e is { resource: Organization; fullUrl?: string } => e.resource.resourceType === "Organization")
    .map((e) => e.resource);
  segments.push(...coveragesToIn1(coverages, trail, organizations));

  const procedures = bundle.entry
    .filter((e): e is { resource: Procedure; fullUrl?: string } => e.resource.resourceType === "Procedure")
    .map((e) => e.resource);
  segments.push(...proceduresToPr1(procedures, trail));

  const careTeam = bundle.entry.find((e) => e.resource.resourceType === "CareTeam")?.resource as CareTeam | undefined;
  const { rolSegments, in3 } = careTeamToRolAndIn3(careTeam, practitioners, organizations, trail);
  segments.push(...rolSegments);
  if (in3) segments.push(in3);

  const adtHandledResourceTypes = new Set([
    "Patient",
    "Encounter",
    "AllergyIntolerance",
    "Condition",
    "RelatedPerson",
    "Coverage",
    "Organization",
    "Location",
    "Practitioner",
    "Procedure",
    "MessageHeader",
    "Provenance",
    "CareTeam",
  ]);
  for (const entry of bundle.entry) {
    if (!adtHandledResourceTypes.has(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 ADT mapping and was skipped`);
    }
  }

  return { message: { segments, delimiters, messageType: `ADT^${messageTypeTrigger}` }, trail };
}
