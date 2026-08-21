import { findSegment, findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Patient, Practitioner, ServiceRequest } from "../fhir/types.js";
import { cweToCodeableConcept } from "./datatypes.js";
import {
  CODE_SYSTEMS,
  type MappingTrail,
  fhirDateTimeToHl7,
  hl7DateTimeToFhir,
  practitionerFromNameParts,
  resolvePractitionerName,
} from "./common.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";

const TQ1_PRIORITY_TABLE = "table-hl70485-to-request-priority";

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
  practitionerId = "practitioner-requester",
): { serviceRequest: ServiceRequest; practitioner?: Practitioner } {
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

  const placerOrderNumber = getComponent(obr, 2, 1);
  const fillerOrderNumber = getComponent(obr, 3, 1);
  const orderIdentifiers = [];
  if (placerOrderNumber) {
    orderIdentifiers.push({ value: placerOrderNumber, type: { coding: [{ code: "PLAC" }] } });
    trail.add("OBR-2", "ServiceRequest.identifier", placerOrderNumber, "Placer order number");
  }
  if (fillerOrderNumber) {
    orderIdentifiers.push({ value: fillerOrderNumber, type: { coding: [{ code: "FILL" }] } });
    trail.add("OBR-3", "ServiceRequest.identifier", fillerOrderNumber, "Filler order number");
  }
  const alternatePlacerOrderNumber = getComponent(orc, 33, 1);
  if (alternatePlacerOrderNumber) {
    orderIdentifiers.push({ value: alternatePlacerOrderNumber });
    trail.add("ORC-33", "ServiceRequest.identifier", alternatePlacerOrderNumber, "Alternate placer order number");
  }
  if (orderIdentifiers.length > 0) serviceRequest.identifier = orderIdentifiers;

  const reasonCode = cweToCodeableConcept(obr.fields[31]);
  if (reasonCode) {
    serviceRequest.reasonCode = [reasonCode];
    trail.add("OBR-31", "ServiceRequest.reasonCode[0]", getComponent(obr, 31, 1) ?? "");
  }

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
  let practitioner: Practitioner | undefined;
  if (requesterFamily) {
    const display = [requesterGiven, requesterFamily].filter(Boolean).join(" ");
    practitioner = practitionerFromNameParts(requesterFamily, requesterGiven, practitionerId);
    serviceRequest.requester = practitioner ? { reference: `Practitioner/${practitionerId}`, display } : { display };
    trail.add(requesterSource, "ServiceRequest.requester.display", display, "Ordering provider");
  }

  return { serviceRequest, practitioner };
}

/**
 * Builds the ORC and OBR segments from a ServiceRequest — shared reverse-direction logic
 * between ORM^O01 and OML^O21. `placerOrderNumber` is written to both ORC-2 and OBR-2 so
 * the two segments (and, for OML, SPM-2) stay linked the way the forward direction
 * expects — `ServiceRequest.identifier` itself isn't round-tripped back into OBR-2/3,
 * since those fields are already used here for that placer/filler linking role rather than
 * carrying arbitrary identifiers back out.
 */
export function buildOrcObrFromServiceRequest(
  serviceRequest: ServiceRequest,
  placerOrderNumber: string,
  trail: MappingTrail,
  practitioners: Practitioner[] = [],
): { orc: Hl7Segment; obr: Hl7Segment } {
  const orderControl = STATUS_TO_ORDER_CONTROL[serviceRequest.status] ?? "NW";
  const orcFields: Record<number, Hl7Field> = { 1: field(orderControl), 2: field(placerOrderNumber) };
  trail.add("ServiceRequest.status", "ORC-1", orderControl);
  if (serviceRequest.authoredOn) {
    const t = fhirDateTimeToHl7(serviceRequest.authoredOn) ?? "";
    orcFields[9] = field(t);
    trail.add("ServiceRequest.authoredOn", "ORC-9", t);
  }
  const requester = resolvePractitionerName(serviceRequest.requester, practitioners);
  if (requester?.family) {
    orcFields[12] = field("", requester.family, requester.given ?? "");
    trail.add("ServiceRequest.requester.display", "ORC-12", [requester.given, requester.family].filter(Boolean).join(" "));
  }
  const alternatePlacerOrderNumber = serviceRequest.identifier?.find((i) => !i.type)?.value;
  if (alternatePlacerOrderNumber) {
    orcFields[33] = field(alternatePlacerOrderNumber);
    trail.add("ServiceRequest.identifier", "ORC-33", alternatePlacerOrderNumber);
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
  const reasonCoding = serviceRequest.reasonCode?.[0]?.coding?.[0];
  if (reasonCoding?.code) {
    obrFields[31] = field(reasonCoding.code, reasonCoding.display ?? "");
    trail.add("ServiceRequest.reasonCode[0]", "OBR-31", reasonCoding.code);
  }
  const obr = segment("OBR", obrFields);

  return { orc, obr };
}

/**
 * NTE segments -> ServiceRequest.note[], per the official IG's "Segment NTE to
 * ServiceRequest Map" (NTE-3 -> note.text). NTE is a repeating segment; every NTE in the
 * message is treated as a note on the single ServiceRequest an ORM^O01/OML^O21 message
 * carries — unlike AL1/DG1/NK1/etc. on ADT, there's only ever one ServiceRequest here, so
 * there's no per-segment ownership ambiguity to work around.
 */
export function notesFromNte(message: Hl7Message, serviceRequest: ServiceRequest, trail: MappingTrail): void {
  const notes = findSegments(message, "NTE")
    .map((nte) => getField(nte, 3))
    .filter((text): text is string => !!text);
  if (notes.length > 0) {
    serviceRequest.note = notes.map((text) => ({ text }));
    notes.forEach((text, i) => trail.add(`NTE-3 (#${i + 1})`, `ServiceRequest.note[${i}].text`, text));
  }
}

/** ServiceRequest.note[] -> NTE segments, inverse of `notesFromNte`. */
export function nteSegmentsFromNotes(serviceRequest: ServiceRequest, trail: MappingTrail): Hl7Segment[] {
  return (serviceRequest.note ?? []).map((note, i) => {
    trail.add(`ServiceRequest.note[${i}].text`, `NTE-3 (#${i + 1})`, note.text);
    return segment("NTE", { 1: field(String(i + 1)), 3: field(note.text) });
  });
}

/**
 * TQ1-9 -> ServiceRequest.priority, per the official IG's "Segment TQ1 to ServiceRequest
 * Map" (table HL70485 -> FHIR request-priority). Only the first TQ1 in the message is read
 * — the IG's own map treats TQ1 as describing a single timing/priority for the order, and
 * this package doesn't yet model the segment's repeat-pattern/timing fields (TQ1-2 through
 * TQ1-8, TQ1-13, TQ1-14), which the IG maps into a FHIR `Timing` structure
 * (`occurrenceTiming`) that would collide with the `occurrenceDateTime` this package already
 * populates from `OBR-7` — a FHIR choice-type field can only hold one of the two at once.
 * TQ1-11 (free-text instruction) is also left unmapped here for the same reason `note[]` is
 * already owned by `NTE-3` (see `notesFromNte`): mapping both into the same array would make
 * round-tripping ambiguous about which segment a given note came from.
 */
export function tq1ToServiceRequest(message: Hl7Message, serviceRequest: ServiceRequest, trail: MappingTrail): void {
  const tq1 = findSegment(message, "TQ1");
  const priorityCode = getField(tq1, 9);
  const priority = lookupVocabulary(TQ1_PRIORITY_TABLE, priorityCode)?.code as ServiceRequest["priority"] | undefined;
  if (priority) {
    serviceRequest.priority = priority;
    trail.add("TQ1-9", "ServiceRequest.priority", priority, `HL7 Table 0485 code "${priorityCode}"`);
  }
}

/** ServiceRequest.priority -> a TQ1 segment, inverse of `tq1ToServiceRequest`. Returns `undefined` when priority isn't set. */
export function tq1SegmentFromServiceRequest(serviceRequest: ServiceRequest, trail: MappingTrail): Hl7Segment | undefined {
  if (!serviceRequest.priority) return undefined;
  const code = reverseLookupVocabulary(TQ1_PRIORITY_TABLE, serviceRequest.priority);
  if (!code) return undefined;
  trail.add("ServiceRequest.priority", "TQ1-9", code);
  return segment("TQ1", { 1: field("1"), 9: field(code) });
}
