import { findSegment } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Message } from "../hl7/types.js";
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
} from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { MappingTrail, buildMsh, messageHeaderFromMsh, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";
import {
  buildOrcObrFromServiceRequest,
  buildServiceRequestFromOrcObr,
  notesFromNte,
  nteSegmentsFromNotes,
  tq1SegmentFromServiceRequest,
  tq1ToServiceRequest,
} from "./order.js";
import { devicesToPrt, practitionerRolesToPrt, prtToDevices, prtToPractitionerRoles } from "./prt.js";

const KNOWN_ORM_SEGMENTS = new Set(["MSH", "PID", "ORC", "OBR", "NTE", "TQ1", "PRT"]);

/** ORM^O01 -> a Bundle with a Patient and a ServiceRequest. The ordering provider is read from ORC-12, falling back to OBR-16 when ORC-12 is absent. Throws `FhirValidationError` when PID or OBR is missing. */
export function ormToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const orc = findSegment(message, "ORC");
  const obr = findSegment(message, "OBR");

  if (!pid) throw new FhirValidationError("ORM message is missing a required PID segment");
  if (!obr) throw new FhirValidationError("ORM message is missing a required OBR segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const { serviceRequest, practitioner } = buildServiceRequestFromOrcObr(orc, obr, patient, trail);
  notesFromNte(message, serviceRequest, trail);
  tq1ToServiceRequest(message, serviceRequest, trail);
  bundle.entry.push({ resource: serviceRequest });
  if (practitioner) bundle.entry.push({ resource: practitioner });

  for (const device of prtToDevices(message, trail)) {
    bundle.entry.push({ resource: device });
  }

  const { practitionerRoles, practitioners, organizations, locations } = prtToPractitionerRoles(message, trail);
  for (const role of practitionerRoles) bundle.entry.push({ resource: role });
  for (const p of practitioners) bundle.entry.push({ resource: p });
  for (const o of organizations) bundle.entry.push({ resource: o });
  for (const l of locations) bundle.entry.push({ resource: l });

  for (const seg of message.segments) {
    if (!KNOWN_ORM_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  bundle.entry.push({ resource: messageHeaderFromMsh(message, trail) });

  return { bundle, trail };
}

/** ServiceRequest -> an ORM^O01 message; a placer order number is synthesized and written to both ORC-2 and OBR-2 to keep the two segments linked. Throws `FhirValidationError` when the bundle has no Patient or no ServiceRequest. */
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

  const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")?.resource as MessageHeader | undefined;
  const msh = buildMsh(trail, "ORM", "O01", controlId, now, messageHeader);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const practitioners = bundle.entry
    .filter((e): e is { resource: Practitioner; fullUrl?: string } => e.resource.resourceType === "Practitioner")
    .map((e) => e.resource);
  const { orc, obr } = buildOrcObrFromServiceRequest(serviceRequest, placerOrderNumber, trail, practitioners);
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
      !["Patient", "ServiceRequest", "Practitioner", "MessageHeader", "Device", "PractitionerRole", "Organization", "Location"].includes(
        entry.resource.resourceType,
      )
    ) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 ORM mapping and was skipped`);
    }
  }

  const segments = [msh, pid, orc, obr, ...(tq1Segment ? [tq1Segment] : []), ...nteSegments, ...devicePrtSegments, ...rolePrtSegments];
  return { message: { segments, delimiters, messageType: "ORM^O01" }, trail };
}
