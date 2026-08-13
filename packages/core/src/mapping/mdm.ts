import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Bundle, DocumentReference, Patient } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { CODE_SYSTEMS, MappingTrail, buildMsh, fhirDateTimeToHl7, hl7DateTimeToFhir, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";

const KNOWN_MDM_SEGMENTS = new Set(["MSH", "EVN", "PID", "TXA"]);

const COMPLETION_STATUS_TO_DOC_STATUS: Record<string, DocumentReference["docStatus"]> = {
  AU: "final",
  TR: "final",
  DI: "preliminary",
  DO: "preliminary",
  IP: "preliminary",
  PA: "preliminary",
};
const DOC_STATUS_TO_COMPLETION_STATUS: Record<string, string> = { final: "AU", preliminary: "IP", amended: "TR" };

/** MDM^T02 -> a Bundle with a Patient and a DocumentReference built from TXA. Throws `FhirValidationError` when PID or TXA is missing. */
export function mdmToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const txa = findSegment(message, "TXA");

  if (!pid) throw new FhirValidationError("MDM message is missing a required PID segment");
  if (!txa) throw new FhirValidationError("MDM message is missing a required TXA segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const typeCode = getComponent(txa, 2, 1);
  const typeDisplay = getComponent(txa, 2, 2);
  const completionStatus = getField(txa, 17);
  const docReference: DocumentReference = {
    resourceType: "DocumentReference",
    id: "documentreference-1",
    status: "current",
    docStatus: completionStatus ? COMPLETION_STATUS_TO_DOC_STATUS[completionStatus] : undefined,
    type: {
      coding: typeCode ? [{ system: CODE_SYSTEMS.documentType, code: typeCode, display: typeDisplay }] : undefined,
      text: typeDisplay,
    },
    subject: { reference: `Patient/${patient.id}` },
    content: [{ attachment: { contentType: "text/plain", title: typeDisplay } }],
  };
  if (typeCode) trail.add("TXA-2", "DocumentReference.type", `${typeCode} (${typeDisplay ?? "n/a"})`);
  if (completionStatus && docReference.docStatus) {
    trail.add("TXA-17", "DocumentReference.docStatus", docReference.docStatus, `HL7 completion status "${completionStatus}"`);
  }

  const originationDate = hl7DateTimeToFhir(getField(txa, 6));
  if (originationDate) {
    docReference.date = originationDate;
    docReference.content[0]!.attachment.creation = originationDate;
    trail.add("TXA-6", "DocumentReference.date", originationDate);
  }

  const uniqueDocNumber = getField(txa, 12);
  if (uniqueDocNumber) {
    docReference.masterIdentifier = { value: uniqueDocNumber };
    trail.add("TXA-12", "DocumentReference.masterIdentifier.value", uniqueDocNumber);
  }

  const originatorFamily = getComponent(txa, 9, 2);
  const originatorGiven = getComponent(txa, 9, 3);
  if (originatorFamily) {
    const display = [originatorGiven, originatorFamily].filter(Boolean).join(" ");
    docReference.author = [{ display }];
    trail.add("TXA-9", "DocumentReference.author[0].display", display, "Originator");
  }

  bundle.entry.push({ resource: docReference });

  for (const seg of message.segments) {
    if (!KNOWN_MDM_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  return { bundle, trail };
}

/** Patient+DocumentReference -> an MDM^T02 message. Throws `FhirValidationError` when the bundle has no Patient or no DocumentReference. */
export function fhirToMdm(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")?.resource as Patient | undefined;
  const docReference = bundle.entry.find((e) => e.resource.resourceType === "DocumentReference")?.resource as DocumentReference | undefined;

  if (!patient) throw new FhirValidationError("Bundle must contain a Patient resource to translate to an MDM message");
  if (!docReference) throw new FhirValidationError("Bundle must contain a DocumentReference resource to translate to an MDM message");

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();

  const msh = buildMsh(trail, "MDM", "T02", controlId, now);

  const evn = segment("EVN", { 1: field("T02"), 2: field(now) });

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const txaFields: Record<number, Hl7Field> = { 1: field("1") };
  const coding = docReference.type?.coding?.[0];
  if (coding) {
    txaFields[2] = field(coding.code ?? "", coding.display ?? "", "LN");
    trail.add("DocumentReference.type", "TXA-2", `${coding.code} (${coding.display ?? "n/a"})`);
  }
  if (docReference.date) {
    const t = fhirDateTimeToHl7(docReference.date) ?? "";
    txaFields[6] = field(t);
    trail.add("DocumentReference.date", "TXA-6", t);
  }
  if (docReference.author?.[0]?.display) {
    const display = docReference.author[0]!.display!;
    const [given, ...rest] = display.split(" ");
    txaFields[9] = field("", rest.join(" ") || given || "", rest.length ? given : "");
    trail.add("DocumentReference.author[0].display", "TXA-9", display);
  }
  if (docReference.masterIdentifier?.value) {
    txaFields[12] = field(docReference.masterIdentifier.value);
    trail.add("DocumentReference.masterIdentifier.value", "TXA-12", docReference.masterIdentifier.value);
  }
  const completionStatus = docReference.docStatus ? (DOC_STATUS_TO_COMPLETION_STATUS[docReference.docStatus] ?? "IP") : "IP";
  txaFields[17] = field(completionStatus);
  if (docReference.docStatus) trail.add("DocumentReference.docStatus", "TXA-17", completionStatus);
  const txa = segment("TXA", txaFields);

  for (const entry of bundle.entry) {
    if (!["Patient", "DocumentReference"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 MDM mapping and was skipped`);
    }
  }

  return { message: { segments: [msh, evn, pid, txa], delimiters, messageType: "MDM^T02" }, trail };
}
