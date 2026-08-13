import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Bundle, Immunization, Patient } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { CODE_SYSTEMS, MappingTrail, buildMsh, fhirDateTimeToHl7, hl7DateTimeToFhir, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";

const KNOWN_VXU_SEGMENTS = new Set(["MSH", "PID", "RXA"]);

const COMPLETION_STATUS_TO_STATUS: Record<string, Immunization["status"]> = {
  CP: "completed",
  PA: "completed",
  RE: "not-done",
  NA: "not-done",
};
const STATUS_TO_COMPLETION_STATUS: Record<string, string> = { completed: "CP", "not-done": "RE", "entered-in-error": "NA" };

/** VXU^V04 -> a Bundle with a Patient and an Immunization built from RXA. Throws `FhirValidationError` when PID or RXA is missing. */
export function vxuToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const rxa = findSegment(message, "RXA");

  if (!pid) throw new FhirValidationError("VXU message is missing a required PID segment");
  if (!rxa) throw new FhirValidationError("VXU message is missing a required RXA segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const completionStatus = getField(rxa, 20);
  const vaccineCode = getComponent(rxa, 5, 1);
  const vaccineDisplay = getComponent(rxa, 5, 2);
  const immunization: Immunization = {
    resourceType: "Immunization",
    id: "immunization-1",
    status: (completionStatus ? COMPLETION_STATUS_TO_STATUS[completionStatus] : undefined) ?? "completed",
    vaccineCode: {
      coding: vaccineCode ? [{ system: CODE_SYSTEMS.cvx, code: vaccineCode, display: vaccineDisplay }] : undefined,
      text: vaccineDisplay,
    },
    patient: { reference: `Patient/${patient.id}` },
  };
  if (completionStatus) trail.add("RXA-20", "Immunization.status", immunization.status, `HL7 completion status "${completionStatus}"`);
  if (vaccineCode) trail.add("RXA-5", "Immunization.vaccineCode", `${vaccineCode} (${vaccineDisplay ?? "n/a"})`);

  const occurrence = hl7DateTimeToFhir(getField(rxa, 3));
  if (occurrence) {
    immunization.occurrenceDateTime = occurrence;
    trail.add("RXA-3", "Immunization.occurrenceDateTime", occurrence);
  }

  const amount = getField(rxa, 6);
  const unit = getComponent(rxa, 7, 1);
  if (amount) {
    immunization.doseQuantity = { value: Number(amount), unit };
    trail.add("RXA-6", "Immunization.doseQuantity.value", amount);
    if (unit) trail.add("RXA-7", "Immunization.doseQuantity.unit", unit);
  }

  const lotNumber = getField(rxa, 15);
  if (lotNumber) {
    immunization.lotNumber = lotNumber;
    trail.add("RXA-15", "Immunization.lotNumber", lotNumber);
  }

  const expiration = hl7DateTimeToFhir(getField(rxa, 16));
  if (expiration) {
    immunization.expirationDate = expiration.substring(0, 10);
    trail.add("RXA-16", "Immunization.expirationDate", immunization.expirationDate);
  }

  const manufacturer = getComponent(rxa, 17, 2);
  if (manufacturer) {
    immunization.manufacturer = { display: manufacturer };
    trail.add("RXA-17", "Immunization.manufacturer.display", manufacturer);
  }

  const performerFamily = getComponent(rxa, 10, 2);
  const performerGiven = getComponent(rxa, 10, 3);
  if (performerFamily) {
    const display = [performerGiven, performerFamily].filter(Boolean).join(" ");
    immunization.performer = [{ actor: { display } }];
    trail.add("RXA-10", "Immunization.performer[0].actor.display", display, "Administering provider");
  }

  bundle.entry.push({ resource: immunization });

  for (const seg of message.segments) {
    if (!KNOWN_VXU_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  return { bundle, trail };
}

/** Patient+Immunization -> a VXU^V04 message. Throws `FhirValidationError` when the bundle has no Patient or no Immunization. */
export function fhirToVxu(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")?.resource as Patient | undefined;
  const immunization = bundle.entry.find((e) => e.resource.resourceType === "Immunization")?.resource as Immunization | undefined;

  if (!patient) throw new FhirValidationError("Bundle must contain a Patient resource to translate to a VXU message");
  if (!immunization) throw new FhirValidationError("Bundle must contain an Immunization resource to translate to a VXU message");

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();

  const msh = buildMsh(trail, "VXU", "V04", controlId, now);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const rxaFields: Record<number, Hl7Field> = { 1: field("0"), 2: field("1") };
  if (immunization.occurrenceDateTime) {
    const t = fhirDateTimeToHl7(immunization.occurrenceDateTime) ?? "";
    rxaFields[3] = field(t);
    trail.add("Immunization.occurrenceDateTime", "RXA-3", t);
  }
  const coding = immunization.vaccineCode.coding?.[0];
  if (coding) {
    rxaFields[5] = field(coding.code ?? "", coding.display ?? "", "CVX");
    trail.add("Immunization.vaccineCode", "RXA-5", `${coding.code} (${coding.display ?? "n/a"})`);
  }
  if (immunization.doseQuantity?.value !== undefined) {
    rxaFields[6] = field(String(immunization.doseQuantity.value));
    rxaFields[7] = field(immunization.doseQuantity.unit ?? "");
    trail.add("Immunization.doseQuantity", "RXA-6", `${immunization.doseQuantity.value} ${immunization.doseQuantity.unit ?? ""}`.trim());
  }
  if (immunization.performer?.[0]?.actor?.display) {
    const display = immunization.performer[0]!.actor!.display!;
    const [given, ...rest] = display.split(" ");
    rxaFields[10] = field("", rest.join(" ") || given || "", rest.length ? given : "");
    trail.add("Immunization.performer[0].actor.display", "RXA-10", display);
  }
  if (immunization.lotNumber) {
    rxaFields[15] = field(immunization.lotNumber);
    trail.add("Immunization.lotNumber", "RXA-15", immunization.lotNumber);
  }
  if (immunization.expirationDate) {
    const t = fhirDateTimeToHl7(immunization.expirationDate) ?? "";
    rxaFields[16] = field(t);
    trail.add("Immunization.expirationDate", "RXA-16", t);
  }
  if (immunization.manufacturer?.display) {
    rxaFields[17] = field("", immunization.manufacturer.display, "MVX");
    trail.add("Immunization.manufacturer.display", "RXA-17", immunization.manufacturer.display);
  }
  const completionStatus = STATUS_TO_COMPLETION_STATUS[immunization.status] ?? "CP";
  rxaFields[20] = field(completionStatus);
  trail.add("Immunization.status", "RXA-20", completionStatus);
  const rxa = segment("RXA", rxaFields);

  for (const entry of bundle.entry) {
    if (!["Patient", "Immunization"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 VXU mapping and was skipped`);
    }
  }

  return { message: { segments: [msh, pid, rxa], delimiters, messageType: "VXU^V04" }, trail };
}
