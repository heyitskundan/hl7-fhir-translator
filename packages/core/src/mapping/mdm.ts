import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Bundle, DocumentReference, Location, MessageHeader, Patient, Practitioner, Provenance } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import {
  CODE_SYSTEMS,
  MappingTrail,
  buildMsa,
  buildMsh,
  buildSft,
  evnFieldsFromProvenance,
  fhirDateTimeToHl7,
  hl7DateTimeToFhir,
  messageHeaderFromMsh,
  nextMessageControlId,
  nowHl7DateTime,
  practitionerFromNameParts,
  provenanceFromEvn,
  resolvePractitionerName,
} from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";
import { cweToCodeableConcept } from "./datatypes.js";

const KNOWN_MDM_SEGMENTS = new Set(["MSH", "SFT", "MSA", "EVN", "PID", "TXA"]);

const COMPLETION_STATUS_TO_DOC_STATUS: Record<string, DocumentReference["docStatus"]> = {
  AU: "final",
  TR: "final",
  DI: "preliminary",
  DO: "preliminary",
  IP: "preliminary",
  PA: "preliminary",
};
const DOC_STATUS_TO_COMPLETION_STATUS: Record<string, string> = { final: "AU", preliminary: "IP", amended: "TR" };

/**
 * HL7 Table 0191 (Document Content Presentation, TXA-3) -> a MIME content type. Not an
 * exhaustive table — the values actually seen in practice map to a handful of MIME types;
 * anything unrecognized falls back to `text/plain`, the same default used when TXA-3 is
 * absent entirely.
 */
const CONTENT_PRESENTATION_TO_MIME_TYPE: Record<string, string> = {
  TX: "text/plain",
  FT: "text/plain",
  PDF: "application/pdf",
  HD: "text/html",
  RTF: "application/rtf",
};

/** MDM^T02 -> a Bundle with a Patient and a DocumentReference built from TXA. Throws `FhirValidationError` when PID or TXA is missing. */
export function mdmToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const txa = findSegment(message, "TXA");
  const evn = findSegment(message, "EVN");

  if (!pid) throw new FhirValidationError("MDM message is missing a required PID segment");
  if (!txa) throw new FhirValidationError("MDM message is missing a required TXA segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const typeCode = getComponent(txa, 2, 1);
  const typeDisplay = getComponent(txa, 2, 2);
  const completionStatus = getField(txa, 17);
  const contentPresentation = getField(txa, 3);
  const contentType = (contentPresentation && CONTENT_PRESENTATION_TO_MIME_TYPE[contentPresentation]) ?? "text/plain";
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
    content: [{ attachment: { contentType, title: typeDisplay } }],
  };
  if (typeCode) trail.add("TXA-2", "DocumentReference.type", `${typeCode} (${typeDisplay ?? "n/a"})`);
  if (contentPresentation) {
    trail.add(
      "TXA-3",
      "DocumentReference.content[0].attachment.contentType",
      contentType,
      `HL7 document content presentation "${contentPresentation}"`,
    );
  }
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
  let author: Practitioner | undefined;
  if (originatorFamily) {
    const display = [originatorGiven, originatorFamily].filter(Boolean).join(" ");
    author = practitionerFromNameParts(originatorFamily, originatorGiven, "practitioner-author");
    docReference.author = [author ? { reference: `Practitioner/${author.id}`, display } : { display }];
    trail.add("TXA-9", "DocumentReference.author[0].display", display, "Originator");
  }

  const authenticatorFamily = getComponent(txa, 10, 2);
  const authenticatorGiven = getComponent(txa, 10, 3);
  let authenticator: Practitioner | undefined;
  if (authenticatorFamily) {
    const display = [authenticatorGiven, authenticatorFamily].filter(Boolean).join(" ");
    authenticator = practitionerFromNameParts(authenticatorFamily, authenticatorGiven, "practitioner-authenticator");
    docReference.authenticator = authenticator ? { reference: `Practitioner/${authenticator.id}`, display } : { display };
    trail.add("TXA-10", "DocumentReference.authenticator.display", display, "Authenticating provider");
  }

  const uniqueDocId = getField(txa, 16);
  if (uniqueDocId) {
    docReference.identifier = [{ value: uniqueDocId }];
    trail.add("TXA-16", "DocumentReference.identifier[0].value", uniqueDocId);
  }

  const description = getField(txa, 25);
  if (description) {
    docReference.description = description;
    trail.add("TXA-25", "DocumentReference.description", description);
  }

  const securityLabel = cweToCodeableConcept(txa.fields[18]);
  if (securityLabel) {
    docReference.securityLabel = [securityLabel];
    trail.add("TXA-18", "DocumentReference.securityLabel[0]", getComponent(txa, 18, 1) ?? "");
  }

  bundle.entry.push({ resource: docReference });
  if (author) bundle.entry.push({ resource: author });
  if (authenticator) bundle.entry.push({ resource: authenticator });

  const {
    provenance,
    practitioner: provenancePractitioner,
    location: provenanceLocation,
  } = provenanceFromEvn(evn, [{ reference: `Patient/${patient.id}` }], trail);
  if (provenance) {
    bundle.entry.push({ resource: provenance });
    if (provenancePractitioner) bundle.entry.push({ resource: provenancePractitioner });
    if (provenanceLocation) bundle.entry.push({ resource: provenanceLocation });
  }

  for (const seg of message.segments) {
    if (!KNOWN_MDM_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  bundle.entry.push({ resource: messageHeaderFromMsh(message, trail) });

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

  const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")?.resource as MessageHeader | undefined;
  const msh = buildMsh(trail, "MDM", "T02", controlId, now, messageHeader);
  const sft = buildSft(trail, messageHeader);
  const msa = buildMsa(trail, messageHeader);

  const evnPractitioners = bundle.entry
    .filter((e): e is { resource: Practitioner; fullUrl?: string } => e.resource.resourceType === "Practitioner")
    .map((e) => e.resource);
  const evnLocations = bundle.entry
    .filter((e): e is { resource: Location; fullUrl?: string } => e.resource.resourceType === "Location")
    .map((e) => e.resource);
  const provenance = bundle.entry.find((e) => e.resource.resourceType === "Provenance")?.resource as Provenance | undefined;
  const evn = segment("EVN", {
    1: field("T02"),
    2: field(now),
    ...evnFieldsFromProvenance(provenance, evnPractitioners, evnLocations, trail),
  });

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const txaFields: Record<number, Hl7Field> = { 1: field("1") };
  const coding = docReference.type?.coding?.[0];
  if (coding) {
    txaFields[2] = field(coding.code ?? "", coding.display ?? "", "LN");
    trail.add("DocumentReference.type", "TXA-2", `${coding.code} (${coding.display ?? "n/a"})`);
  }
  const contentType = docReference.content[0]?.attachment.contentType;
  if (contentType) {
    const contentPresentation = Object.entries(CONTENT_PRESENTATION_TO_MIME_TYPE).find(([, v]) => v === contentType)?.[0];
    if (contentPresentation) {
      txaFields[3] = field(contentPresentation);
      trail.add("DocumentReference.content[0].attachment.contentType", "TXA-3", contentPresentation);
    }
  }
  if (docReference.date) {
    const t = fhirDateTimeToHl7(docReference.date) ?? "";
    txaFields[6] = field(t);
    trail.add("DocumentReference.date", "TXA-6", t);
  }
  const practitioners = bundle.entry
    .filter((e): e is { resource: Practitioner; fullUrl?: string } => e.resource.resourceType === "Practitioner")
    .map((e) => e.resource);
  const author = resolvePractitionerName(docReference.author?.[0], practitioners);
  if (author?.family) {
    txaFields[9] = field("", author.family, author.given ?? "");
    trail.add("DocumentReference.author[0].display", "TXA-9", [author.given, author.family].filter(Boolean).join(" "));
  }
  if (docReference.masterIdentifier?.value) {
    txaFields[12] = field(docReference.masterIdentifier.value);
    trail.add("DocumentReference.masterIdentifier.value", "TXA-12", docReference.masterIdentifier.value);
  }
  const authenticator = resolvePractitionerName(docReference.authenticator, practitioners);
  if (authenticator?.family) {
    txaFields[10] = field("", authenticator.family, authenticator.given ?? "");
    trail.add("DocumentReference.authenticator.display", "TXA-10", [authenticator.given, authenticator.family].filter(Boolean).join(" "));
  }
  if (docReference.identifier?.[0]?.value) {
    txaFields[16] = field(docReference.identifier[0].value);
    trail.add("DocumentReference.identifier[0].value", "TXA-16", docReference.identifier[0].value);
  }
  if (docReference.description) {
    txaFields[25] = field(docReference.description);
    trail.add("DocumentReference.description", "TXA-25", docReference.description);
  }
  const securityLabelCoding = docReference.securityLabel?.[0]?.coding?.[0];
  if (securityLabelCoding?.code) {
    txaFields[18] = field(securityLabelCoding.code, securityLabelCoding.display ?? "");
    trail.add("DocumentReference.securityLabel[0]", "TXA-18", securityLabelCoding.code);
  }
  const completionStatus = docReference.docStatus ? (DOC_STATUS_TO_COMPLETION_STATUS[docReference.docStatus] ?? "IP") : "IP";
  txaFields[17] = field(completionStatus);
  if (docReference.docStatus) trail.add("DocumentReference.docStatus", "TXA-17", completionStatus);
  const txa = segment("TXA", txaFields);

  for (const entry of bundle.entry) {
    if (
      !["Patient", "DocumentReference", "Practitioner", "MessageHeader", "Provenance", "Location"].includes(entry.resource.resourceType)
    ) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 MDM mapping and was skipped`);
    }
  }

  return {
    message: {
      segments: [msh, ...(sft ? [sft] : []), ...(msa ? [msa] : []), evn, pid, txa],
      delimiters,
      messageType: "MDM^T02",
    },
    trail,
  };
}
