import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Bundle, Patient, ServiceRequest, Specimen } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { CODE_SYSTEMS, MappingTrail, buildMsh, fhirDateTimeToHl7, hl7DateTimeToFhir, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";
import { buildOrcObrFromServiceRequest, buildServiceRequestFromOrcObr } from "./order.js";

const KNOWN_OML_SEGMENTS = new Set(["MSH", "PID", "ORC", "OBR", "SPM"]);

/** OML^O21 -> a Bundle with a Patient, a ServiceRequest, and a Specimen built from SPM. The ordering provider is read from ORC-12, falling back to OBR-16 when ORC-12 is absent. Throws `FhirValidationError` when PID, OBR, or SPM is missing — SPM is what distinguishes a lab order (OML^O21) from a general order (ORM^O01). */
export function omlToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const orc = findSegment(message, "ORC");
  const obr = findSegment(message, "OBR");
  const spm = findSegment(message, "SPM");

  if (!pid) throw new FhirValidationError("OML message is missing a required PID segment");
  if (!obr) throw new FhirValidationError("OML message is missing a required OBR segment");
  if (!spm) throw new FhirValidationError("OML message is missing a required SPM segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const serviceRequest = buildServiceRequestFromOrcObr(orc, obr, patient, trail);
  bundle.entry.push({ resource: serviceRequest });

  const specimenType = getComponent(spm, 4, 1);
  const specimenTypeDisplay = getComponent(spm, 4, 2);
  const specimen: Specimen = {
    resourceType: "Specimen",
    id: "specimen-1",
    type: {
      coding: specimenType ? [{ system: CODE_SYSTEMS.specimenType, code: specimenType, display: specimenTypeDisplay }] : undefined,
      text: specimenTypeDisplay,
    },
    subject: { reference: `Patient/${patient.id}` },
    request: [{ reference: `ServiceRequest/${serviceRequest.id}` }],
  };
  if (specimenType) trail.add("SPM-4", "Specimen.type", `${specimenType} (${specimenTypeDisplay ?? "n/a"})`);

  const collected = hl7DateTimeToFhir(getField(spm, 17));
  if (collected) {
    specimen.collection = { collectedDateTime: collected };
    trail.add("SPM-17", "Specimen.collection.collectedDateTime", collected);
  }

  bundle.entry.push({ resource: specimen });

  for (const seg of message.segments) {
    if (!KNOWN_OML_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  return { bundle, trail };
}

/** ServiceRequest+Specimen -> an OML^O21 message; a placer order number is synthesized and written to ORC-2, OBR-2, and SPM-2 to keep the three segments linked. Throws `FhirValidationError` when the bundle has no Patient, ServiceRequest, or Specimen. */
export function fhirToOml(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")?.resource as Patient | undefined;
  const serviceRequest = bundle.entry.find((e) => e.resource.resourceType === "ServiceRequest")?.resource as ServiceRequest | undefined;
  const specimen = bundle.entry.find((e) => e.resource.resourceType === "Specimen")?.resource as Specimen | undefined;

  if (!patient) throw new FhirValidationError("Bundle must contain a Patient resource to translate to an OML message");
  if (!serviceRequest) throw new FhirValidationError("Bundle must contain a ServiceRequest resource to translate to an OML message");
  if (!specimen) throw new FhirValidationError("Bundle must contain a Specimen resource to translate to an OML message");

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();
  const placerOrderNumber = `ORD${controlId.slice(-6)}`;

  const msh = buildMsh(trail, "OML", "O21", controlId, now);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const { orc, obr } = buildOrcObrFromServiceRequest(serviceRequest, placerOrderNumber, trail);

  const spmCoding = specimen.type?.coding?.[0];
  const spmFields: Record<number, Hl7Field> = { 1: field("1"), 2: field(placerOrderNumber) };
  if (spmCoding) {
    spmFields[4] = field(spmCoding.code ?? "", spmCoding.display ?? "", "HL70487");
    trail.add("Specimen.type", "SPM-4", `${spmCoding.code} (${spmCoding.display ?? "n/a"})`);
  }
  if (specimen.collection?.collectedDateTime) {
    const t = fhirDateTimeToHl7(specimen.collection.collectedDateTime) ?? "";
    spmFields[17] = field(t);
    trail.add("Specimen.collection.collectedDateTime", "SPM-17", t);
  }
  const spm = segment("SPM", spmFields);

  for (const entry of bundle.entry) {
    if (!["Patient", "ServiceRequest", "Specimen"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 OML mapping and was skipped`);
    }
  }

  return { message: { segments: [msh, pid, orc, obr, spm], delimiters, messageType: "OML^O21" }, trail };
}
