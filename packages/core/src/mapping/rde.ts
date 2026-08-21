import { findSegment, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Message } from "../hl7/types.js";
import type { Bundle, Medication, MedicationRequest, MessageHeader, Patient } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { buildMsa, buildMsh, buildSft, messageHeaderFromMsh, MappingTrail, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";
import { medicationRequestToRxoRxr, rxoRxrToMedicationRequest } from "./medication.js";

const KNOWN_RDE_SEGMENTS = new Set(["MSH", "SFT", "MSA", "PID", "ORC", "RXO", "RXR"]);

/**
 * RDE^O11 -> a Bundle with a Patient, a Medication, and a MedicationRequest. The pharmacy
 * order's status comes from ORC-1 (order control), the same table `order.ts` uses for
 * ORM^O01/OML^O21. Throws `FhirValidationError` when PID or RXO is missing — RXO is this
 * message type's equivalent of ORM's required OBR.
 */
export function rdeToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const orc = findSegment(message, "ORC");
  const rxo = findSegment(message, "RXO");
  const rxr = findSegment(message, "RXR");

  if (!pid) throw new FhirValidationError("RDE message is missing a required PID segment");
  if (!rxo) throw new FhirValidationError("RDE message is missing a required RXO segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const orderControl = getField(orc, 1);
  const { medicationRequest, medication } = rxoRxrToMedicationRequest(orderControl, rxo, rxr, patient, trail);
  bundle.entry.push({ resource: medication });
  bundle.entry.push({ resource: medicationRequest });

  for (const seg of message.segments) {
    if (!KNOWN_RDE_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  bundle.entry.push({ resource: messageHeaderFromMsh(message, trail) });

  return { bundle, trail };
}

/** Medication+MedicationRequest -> an RDE^O11 message. Throws `FhirValidationError` when the bundle has no Patient or no MedicationRequest. */
export function fhirToRde(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")?.resource as Patient | undefined;
  const medicationRequest = bundle.entry.find((e) => e.resource.resourceType === "MedicationRequest")?.resource as
    | MedicationRequest
    | undefined;
  const medication = bundle.entry.find((e) => e.resource.resourceType === "Medication")?.resource as Medication | undefined;

  if (!patient) throw new FhirValidationError("Bundle must contain a Patient resource to translate to an RDE message");
  if (!medicationRequest) throw new FhirValidationError("Bundle must contain a MedicationRequest resource to translate to an RDE message");

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();

  const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")?.resource as MessageHeader | undefined;
  const msh = buildMsh(trail, "RDE", "O11", controlId, now, messageHeader);
  const sft = buildSft(trail, messageHeader);
  const msa = buildMsa(trail, messageHeader);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const orderControlByStatus: Record<MedicationRequest["status"], string> = {
    active: "NW",
    cancelled: "CA",
    completed: "CM",
    unknown: "NW",
  };
  const orc = segment("ORC", { 1: field(orderControlByStatus[medicationRequest.status]) });
  trail.add("MedicationRequest.status", "ORC-1", orderControlByStatus[medicationRequest.status]);

  const { rxo, rxr } = medicationRequestToRxoRxr(medicationRequest, medication, trail);

  for (const entry of bundle.entry) {
    if (!["Patient", "Medication", "MedicationRequest", "MessageHeader"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 RDE mapping and was skipped`);
    }
  }

  const segments = [msh, ...(sft ? [sft] : []), ...(msa ? [msa] : []), pid, orc, rxo, ...(rxr ? [rxr] : [])];
  return { message: { segments, delimiters, messageType: "RDE^O11" }, trail };
}
