import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Bundle, Patient, ServiceRequest } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { CODE_SYSTEMS, MappingTrail, fhirDateTimeToHl7, hl7DateTimeToFhir, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";

const KNOWN_ORM_SEGMENTS = new Set(["MSH", "PID", "ORC", "OBR"]);

const ORDER_CONTROL_TO_STATUS: Record<string, ServiceRequest["status"]> = {
  NW: "active",
  CA: "revoked",
  CM: "completed",
};
const STATUS_TO_ORDER_CONTROL: Record<string, string> = { active: "NW", revoked: "CA", completed: "CM" };

export function ormToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const orc = findSegment(message, "ORC");
  const obr = findSegment(message, "OBR");

  if (!pid) throw new FhirValidationError("ORM message is missing a required PID segment");
  if (!obr) throw new FhirValidationError("ORM message is missing a required OBR segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const orderControl = getField(orc, 1);
  const code = getComponent(obr, 4, 1);
  const codeDisplay = getComponent(obr, 4, 2);
  const serviceRequest: ServiceRequest = {
    resourceType: "ServiceRequest",
    id: "servicerequest-1",
    status: (orderControl ? ORDER_CONTROL_TO_STATUS[orderControl] : undefined) ?? "active",
    intent: "order",
    code: { coding: code ? [{ system: CODE_SYSTEMS.loinc, code, display: codeDisplay }] : undefined, text: codeDisplay },
    subject: { reference: `Patient/${patient.id}` },
  };
  if (orderControl) trail.add("ORC-1", "ServiceRequest.status", serviceRequest.status, `HL7 order control "${orderControl}"`);
  if (code) trail.add("OBR-4", "ServiceRequest.code", `${code} (${codeDisplay ?? "n/a"})`);

  const authoredOn = hl7DateTimeToFhir(getField(orc, 9));
  if (authoredOn) {
    serviceRequest.authoredOn = authoredOn;
    trail.add("ORC-9", "ServiceRequest.authoredOn", authoredOn);
  }

  const occurrence = hl7DateTimeToFhir(getField(obr, 7));
  if (occurrence) {
    serviceRequest.occurrenceDateTime = occurrence;
    trail.add("OBR-7", "ServiceRequest.occurrenceDateTime", occurrence);
  }

  const requesterFamily = getComponent(orc, 12, 2) ?? getComponent(obr, 16, 2);
  const requesterGiven = getComponent(orc, 12, 3) ?? getComponent(obr, 16, 3);
  const requesterSource = getComponent(orc, 12, 2) ? "ORC-12" : "OBR-16";
  if (requesterFamily) {
    const display = [requesterGiven, requesterFamily].filter(Boolean).join(" ");
    serviceRequest.requester = { display };
    trail.add(requesterSource, "ServiceRequest.requester.display", display, "Ordering provider");
  }

  bundle.entry.push({ resource: serviceRequest });

  for (const seg of message.segments) {
    if (!KNOWN_ORM_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  return { bundle, trail };
}

export function fhirToOrm(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")?.resource as Patient | undefined;
  const serviceRequest = bundle.entry.find((e) => e.resource.resourceType === "ServiceRequest")?.resource as ServiceRequest | undefined;

  if (!patient) throw new FhirValidationError("Bundle must contain a Patient resource to translate to an ORM message");
  if (!serviceRequest) throw new FhirValidationError("Bundle must contain a ServiceRequest resource to translate to an ORM message");

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();
  const placerOrderNumber = `ORD${controlId.slice(-6)}`;

  const msh = segment("MSH", {
    2: field("^~\\&"),
    3: field("FHIR-TRANSLATOR"),
    4: field("HL7FHIR"),
    5: field("HIS"),
    6: field("HOSP"),
    7: field(now),
    9: field("ORM", "O01"),
    10: field(controlId),
    11: field("P"),
    12: field("2.5"),
  });
  trail.add("Bundle.type", "MSH-9", "ORM^O01");

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const orderControl = STATUS_TO_ORDER_CONTROL[serviceRequest.status] ?? "NW";
  const orcFields: Record<number, Hl7Field> = { 1: field(orderControl), 2: field(placerOrderNumber) };
  trail.add("ServiceRequest.status", "ORC-1", orderControl);
  if (serviceRequest.authoredOn) {
    const t = fhirDateTimeToHl7(serviceRequest.authoredOn) ?? "";
    orcFields[9] = field(t);
    trail.add("ServiceRequest.authoredOn", "ORC-9", t);
  }
  if (serviceRequest.requester?.display) {
    const [given, ...rest] = serviceRequest.requester.display.split(" ");
    orcFields[12] = field("", rest.join(" ") || given || "", rest.length ? given : "");
    trail.add("ServiceRequest.requester.display", "ORC-12", serviceRequest.requester.display);
  }
  const orc = segment("ORC", orcFields);

  const coding = serviceRequest.code.coding?.[0];
  const obrFields: Record<number, Hl7Field> = { 1: field("1"), 2: field(placerOrderNumber) };
  if (coding) {
    obrFields[4] = field(coding.code ?? "", coding.display ?? "", "LN");
    trail.add("ServiceRequest.code", "OBR-4", `${coding.code} (${coding.display ?? "n/a"})`);
  }
  if (serviceRequest.occurrenceDateTime) {
    const t = fhirDateTimeToHl7(serviceRequest.occurrenceDateTime) ?? "";
    obrFields[7] = field(t);
    trail.add("ServiceRequest.occurrenceDateTime", "OBR-7", t);
  }
  const obr = segment("OBR", obrFields);

  for (const entry of bundle.entry) {
    if (!["Patient", "ServiceRequest"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 ORM mapping and was skipped`);
    }
  }

  return { message: { segments: [msh, pid, orc, obr], delimiters, messageType: "ORM^O01" }, trail };
}
