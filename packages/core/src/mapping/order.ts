import { getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Segment } from "../hl7/types.js";
import type { Patient, ServiceRequest } from "../fhir/types.js";
import { CODE_SYSTEMS, type MappingTrail, fhirDateTimeToHl7, hl7DateTimeToFhir } from "./common.js";

/** HL7 Table 0119 (Order Control), shared by any mapper that reads/writes ORC-1 (currently ORM^O01 and OML^O21). */
export const ORDER_CONTROL_TO_STATUS: Record<string, ServiceRequest["status"]> = {
  NW: "active",
  CA: "revoked",
  CM: "completed",
};
export const STATUS_TO_ORDER_CONTROL: Record<string, string> = { active: "NW", revoked: "CA", completed: "CM" };

/**
 * Builds a ServiceRequest from ORC/OBR — shared PID/ORC/OBR order logic between ORM^O01
 * and OML^O21 (OML adds a Specimen from SPM on top of this). The ordering provider is
 * read from ORC-12, falling back to OBR-16 when ORC-12 is absent.
 */
export function buildServiceRequestFromOrcObr(
  orc: Hl7Segment | undefined,
  obr: Hl7Segment,
  patient: Patient,
  trail: MappingTrail,
): ServiceRequest {
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

  return serviceRequest;
}

/**
 * Builds the ORC and OBR segments from a ServiceRequest — shared reverse-direction logic
 * between ORM^O01 and OML^O21. `placerOrderNumber` is written to both ORC-2 and OBR-2 so
 * the two segments (and, for OML, SPM-2) stay linked the way the forward direction
 * expects.
 */
export function buildOrcObrFromServiceRequest(
  serviceRequest: ServiceRequest,
  placerOrderNumber: string,
  trail: MappingTrail,
): { orc: Hl7Segment; obr: Hl7Segment } {
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

  return { orc, obr };
}
