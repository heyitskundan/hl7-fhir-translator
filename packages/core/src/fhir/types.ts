/**
 * Minimal hand-rolled FHIR R4 types covering only what this translator produces
 * or consumes. Deliberately not a full FHIR type library — every field here is
 * one the mapping tables in ./mapping actually populate.
 *
 * A few fields below (`meta`, `Identifier.use`, `HumanName.use`) are part of the
 * standard FHIR shape but aren't currently read or written by any mapper — they're
 * kept for shape-completeness against the FHIR spec, not because this package uses them.
 *
 * Adding a new resource type (e.g. for a new segment mapping): 1) add its interface here,
 * scoped the same way — only the fields a mapper actually reads or writes, each with a
 * one-line comment noting which message type/segment produces or consumes it; 2) widen the
 * `FhirResource` union below to include it. That's the whole pattern; nothing else in this
 * file needs to change per resource type.
 */

/** A single code from a terminology system (e.g. LOINC, HL7 v3 ActCode). */
export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

/** A coded value with optional free-text fallback. */
export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

/** A business identifier (e.g. a medical record number), with its assigning authority and type. */
export interface Identifier {
  use?: string;
  type?: CodeableConcept;
  system?: string;
  value?: string;
  assigner?: { display?: string };
}

/** A person's name, split into family/given parts. */
export interface HumanName {
  use?: string;
  family?: string;
  given?: string[];
}

/** A postal address. */
export interface Address {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** A pointer to another resource (e.g. `"Patient/patient-1"`), with an optional display label. */
export interface Reference {
  reference?: string;
  display?: string;
}

/** A start/end time range. */
export interface Period {
  start?: string;
  end?: string;
}

/** A measured value with its unit. */
export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

/** A low/high bound, e.g. a lab reference range. */
export interface Range {
  low?: { value?: number; unit?: string };
  high?: { value?: number; unit?: string };
}

/** FHIR resource metadata. Present in the type for shape-completeness; not populated or read by any mapper. */
export interface Meta {
  profile?: string[];
}

/** A patient's demographics. Produced by the ADT/ORU/ORM mappers; consumed when translating FHIR to HL7v2. */
export interface Patient {
  resourceType: "Patient";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  name?: HumanName[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: Address[];
}

/** A clinical encounter (visit). Produced from/consumed for ADT^A01/A08. */
export interface Encounter {
  resourceType: "Encounter";
  id?: string;
  meta?: Meta;
  status: "planned" | "in-progress" | "finished" | "unknown";
  class: Coding;
  subject?: Reference;
  participant?: { individual?: Reference; type?: CodeableConcept[] }[];
  location?: { location: Reference }[];
  period?: Period;
}

/** A single lab/clinical result. Produced from/consumed for ORU^R01, one per HL7 OBX segment. */
export interface Observation {
  resourceType: "Observation";
  id?: string;
  meta?: Meta;
  status: "final" | "preliminary" | "amended" | "unknown";
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  valueQuantity?: Quantity;
  valueString?: string;
  referenceRange?: Range[];
  interpretation?: CodeableConcept[];
}

/** A lab/clinical report referencing its Observations. Produced from/consumed for ORU^R01's OBR segment. */
export interface DiagnosticReport {
  resourceType: "DiagnosticReport";
  id?: string;
  meta?: Meta;
  status: "final" | "preliminary" | "amended" | "unknown";
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  result?: Reference[];
}

/** An order/request. Produced from/consumed for ORM^O01. */
export interface ServiceRequest {
  resourceType: "ServiceRequest";
  id?: string;
  meta?: Meta;
  status: "active" | "completed" | "revoked" | "unknown";
  intent: "order" | "plan" | "proposal";
  code: CodeableConcept;
  subject?: Reference;
  requester?: Reference;
  authoredOn?: string;
  occurrenceDateTime?: string;
}

/** A vaccination event. Produced from/consumed for VXU^V04. */
export interface Immunization {
  resourceType: "Immunization";
  id?: string;
  meta?: Meta;
  status: "completed" | "entered-in-error" | "not-done";
  vaccineCode: CodeableConcept;
  patient?: Reference;
  occurrenceDateTime?: string;
  lotNumber?: string;
  expirationDate?: string;
  manufacturer?: { display?: string };
  doseQuantity?: Quantity;
  performer?: { actor?: Reference }[];
}

/** A scheduled visit/booking. Produced from/consumed for SIU^S12. */
export interface Appointment {
  resourceType: "Appointment";
  id?: string;
  meta?: Meta;
  status: "proposed" | "booked" | "cancelled" | "fulfilled" | "unknown";
  appointmentType?: CodeableConcept;
  reasonCode?: CodeableConcept[];
  description?: string;
  start?: string;
  end?: string;
  minutesDuration?: number;
  participant: { actor?: Reference; type?: CodeableConcept[]; status: "accepted" | "needs-action" }[];
}

/** A physical specimen collected for testing. Produced from/consumed for OML^O21's SPM segment. */
export interface Specimen {
  resourceType: "Specimen";
  id?: string;
  meta?: Meta;
  type?: CodeableConcept;
  subject?: Reference;
  collection?: { collectedDateTime?: string };
  request?: Reference[];
}

/** A binary/text attachment, e.g. a clinical document's content metadata. */
export interface Attachment {
  contentType?: string;
  title?: string;
  creation?: string;
}

/** A reference to a clinical document. Produced from/consumed for MDM^T02. */
export interface DocumentReference {
  resourceType: "DocumentReference";
  id?: string;
  meta?: Meta;
  status: "current" | "superseded" | "entered-in-error";
  docStatus?: "preliminary" | "final" | "amended";
  masterIdentifier?: Identifier;
  type?: CodeableConcept;
  subject?: Reference;
  date?: string;
  author?: Reference[];
  description?: string;
  content: { attachment: Attachment }[];
}

/** Any FHIR resource this package produces or consumes. */
export type FhirResource =
  Patient | Encounter | Observation | DiagnosticReport | ServiceRequest | Immunization | Appointment | Specimen | DocumentReference;

/** One resource entry within a Bundle. */
export interface BundleEntry {
  fullUrl?: string;
  resource: FhirResource;
}

/** A collection of FHIR resources — what `translateHl7ToFhir` returns and what `translateFhirToHl7` accepts. */
export interface Bundle {
  resourceType: "Bundle";
  type: "collection" | "message";
  entry: BundleEntry[];
}

/** Thrown when input parses but represents an unsupported message type, or is missing a required segment/resource. */
export class FhirValidationError extends Error {
  constructor(
    message: string,
    public readonly context?: string,
  ) {
    super(message);
    this.name = "FhirValidationError";
  }
}
