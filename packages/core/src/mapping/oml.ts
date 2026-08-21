import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type {
  Bundle,
  Device,
  Location,
  MessageHeader,
  Organization,
  Patient,
  Practitioner,
  PractitionerRole,
  ServiceRequest,
  Specimen,
} from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import {
  CODE_SYSTEMS,
  MappingTrail,
  buildMsh,
  fhirDateTimeToHl7,
  hl7DateTimeToFhir,
  messageHeaderFromMsh,
  nextMessageControlId,
  nowHl7DateTime,
} from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";
import { cweToCodeableConcept } from "./datatypes.js";
import {
  buildOrcObrFromServiceRequest,
  buildServiceRequestFromOrcObr,
  notesFromNte,
  nteSegmentsFromNotes,
  tq1SegmentFromServiceRequest,
  tq1ToServiceRequest,
} from "./order.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";
import { devicesToPrt, practitionerRolesToPrt, prtToDevices, prtToPractitionerRoles } from "./prt.js";

const KNOWN_OML_SEGMENTS = new Set(["MSH", "PID", "ORC", "OBR", "SPM", "NTE", "TQ1", "PRT"]);
const SPECIMEN_STATUS_TABLE = "table-hl70136-to-specimen-status";

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

  const { serviceRequest, practitioner } = buildServiceRequestFromOrcObr(orc, obr, patient, trail);
  notesFromNte(message, serviceRequest, trail);
  tq1ToServiceRequest(message, serviceRequest, trail);
  bundle.entry.push({ resource: serviceRequest });
  if (practitioner) bundle.entry.push({ resource: practitioner });

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
    specimen.collection = { ...specimen.collection, collectedDateTime: collected };
    trail.add("SPM-17", "Specimen.collection.collectedDateTime", collected);
  }

  const collectionMethod = cweToCodeableConcept(spm.fields[7]);
  if (collectionMethod) {
    specimen.collection = { ...specimen.collection, method: collectionMethod };
    trail.add("SPM-7", "Specimen.collection.method", getComponent(spm, 7, 1) ?? "");
  }

  const sourceSite = cweToCodeableConcept(spm.fields[8]);
  if (sourceSite) {
    specimen.collection = { ...specimen.collection, bodySite: sourceSite };
    trail.add("SPM-8", "Specimen.collection.bodySite", getComponent(spm, 8, 1) ?? "");
  }

  const receivedTime = hl7DateTimeToFhir(getField(spm, 18));
  if (receivedTime) {
    specimen.receivedTime = receivedTime;
    trail.add("SPM-18", "Specimen.receivedTime", receivedTime);
  }

  const availabilityCode = getField(spm, 20);
  const status = lookupVocabulary(SPECIMEN_STATUS_TABLE, availabilityCode)?.code as Specimen["status"] | undefined;
  if (status) {
    specimen.status = status;
    trail.add("SPM-20", "Specimen.status", status, `HL7 Table 0136 code "${availabilityCode}"`);
  }

  const condition = cweToCodeableConcept(spm.fields[24]);
  if (condition) {
    specimen.condition = [condition];
    trail.add("SPM-24", "Specimen.condition[0]", getComponent(spm, 24, 1) ?? "");
  }

  bundle.entry.push({ resource: specimen });

  for (const device of prtToDevices(message, trail)) {
    bundle.entry.push({ resource: device });
  }

  const { practitionerRoles, practitioners: rolePractitioners, organizations, locations } = prtToPractitionerRoles(message, trail);
  for (const role of practitionerRoles) bundle.entry.push({ resource: role });
  for (const p of rolePractitioners) bundle.entry.push({ resource: p });
  for (const o of organizations) bundle.entry.push({ resource: o });
  for (const l of locations) bundle.entry.push({ resource: l });

  for (const seg of message.segments) {
    if (!KNOWN_OML_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  bundle.entry.push({ resource: messageHeaderFromMsh(message, trail) });

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

  const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")?.resource as MessageHeader | undefined;
  const msh = buildMsh(trail, "OML", "O21", controlId, now, messageHeader);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const practitioners = bundle.entry
    .filter((e): e is { resource: Practitioner; fullUrl?: string } => e.resource.resourceType === "Practitioner")
    .map((e) => e.resource);
  const { orc, obr } = buildOrcObrFromServiceRequest(serviceRequest, placerOrderNumber, trail, practitioners);

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
  const methodCoding = specimen.collection?.method?.coding?.[0];
  if (methodCoding?.code) {
    spmFields[7] = field(methodCoding.code, methodCoding.display ?? "");
    trail.add("Specimen.collection.method", "SPM-7", methodCoding.code);
  }
  const bodySiteCoding = specimen.collection?.bodySite?.coding?.[0];
  if (bodySiteCoding?.code) {
    spmFields[8] = field(bodySiteCoding.code, bodySiteCoding.display ?? "");
    trail.add("Specimen.collection.bodySite", "SPM-8", bodySiteCoding.code);
  }
  if (specimen.receivedTime) {
    const t = fhirDateTimeToHl7(specimen.receivedTime) ?? "";
    spmFields[18] = field(t);
    trail.add("Specimen.receivedTime", "SPM-18", t);
  }
  if (specimen.status) {
    const availabilityCode = reverseLookupVocabulary(SPECIMEN_STATUS_TABLE, specimen.status);
    if (availabilityCode) {
      spmFields[20] = field(availabilityCode);
      trail.add("Specimen.status", "SPM-20", availabilityCode);
    }
  }
  const conditionCoding = specimen.condition?.[0]?.coding?.[0];
  if (conditionCoding?.code) {
    spmFields[24] = field(conditionCoding.code, conditionCoding.display ?? "");
    trail.add("Specimen.condition[0]", "SPM-24", conditionCoding.code);
  }
  const spm = segment("SPM", spmFields);
  const nteSegments = nteSegmentsFromNotes(serviceRequest, trail);
  const tq1Segment = tq1SegmentFromServiceRequest(serviceRequest, trail);

  const devices = bundle.entry
    .filter((e): e is { resource: Device; fullUrl?: string } => e.resource.resourceType === "Device")
    .map((e) => e.resource);
  const devicePrtSegments = devicesToPrt(devices, trail);

  const practitionerRoles = bundle.entry
    .filter((e): e is { resource: PractitionerRole; fullUrl?: string } => e.resource.resourceType === "PractitionerRole")
    .map((e) => e.resource);
  const organizations = bundle.entry
    .filter((e): e is { resource: Organization; fullUrl?: string } => e.resource.resourceType === "Organization")
    .map((e) => e.resource);
  const locations = bundle.entry
    .filter((e): e is { resource: Location; fullUrl?: string } => e.resource.resourceType === "Location")
    .map((e) => e.resource);
  const rolePrtSegments = practitionerRolesToPrt(practitionerRoles, practitioners, organizations, locations, trail);

  for (const entry of bundle.entry) {
    if (
      ![
        "Patient",
        "ServiceRequest",
        "Specimen",
        "Practitioner",
        "MessageHeader",
        "Device",
        "PractitionerRole",
        "Organization",
        "Location",
      ].includes(entry.resource.resourceType)
    ) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 OML mapping and was skipped`);
    }
  }

  const segments = [msh, pid, orc, obr, spm, ...(tq1Segment ? [tq1Segment] : []), ...nteSegments, ...devicePrtSegments, ...rolePrtSegments];
  return { message: { segments, delimiters, messageType: "OML^O21" }, trail };
}
