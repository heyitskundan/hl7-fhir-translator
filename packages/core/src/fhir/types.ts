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
  prefix?: string[];
  suffix?: string[];
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

/** A phone number, email address, or other contact channel. Produced from HL7v2's XTN datatype (e.g. `PID-13`/`PID-14`, `NK1-5`/`NK1-6`). */
export interface ContactPoint {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: "home" | "work" | "temp" | "old" | "mobile";
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

/** A low/high bound, e.g. a lab reference range or a dose range (`code` covers the unit-as-coded-value case a plain dose amount needs, e.g. RXO-4). */
export interface Range {
  low?: { value?: number; unit?: string; code?: string };
  high?: { value?: number; unit?: string; code?: string };
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
  telecom?: ContactPoint[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  deceasedBoolean?: boolean;
  deceasedDateTime?: string;
  address?: Address[];
  maritalStatus?: CodeableConcept;
  multipleBirthBoolean?: boolean;
  multipleBirthInteger?: number;
  generalPractitioner?: Reference[];
}

/** A clinical encounter (visit). Produced from/consumed for the ADT message types. */
export interface Encounter {
  resourceType: "Encounter";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  status: "planned" | "in-progress" | "finished" | "entered-in-error" | "unknown";
  class: Coding;
  subject?: Reference;
  participant?: { individual?: Reference; type?: CodeableConcept[] }[];
  location?: { location: Reference }[];
  period?: Period;
  reasonCode?: CodeableConcept[];
  diagnosis?: { condition: Reference; use?: CodeableConcept; rank?: number }[];
  priority?: CodeableConcept;
}

/** A single lab/clinical result. Produced from/consumed for ORU^R01, one per HL7 OBX segment. */
export interface Observation {
  resourceType: "Observation";
  id?: string;
  meta?: Meta;
  status: "final" | "preliminary" | "amended" | "corrected" | "entered-in-error" | "cancelled" | "unknown";
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  valueQuantity?: Quantity;
  valueString?: string;
  referenceRange?: Range[];
  interpretation?: CodeableConcept[];
  method?: CodeableConcept;
  bodySite?: CodeableConcept;
  category?: CodeableConcept[];
  identifier?: Identifier[];
  note?: { text: string; time?: string }[];
}

/** A lab/clinical report referencing its Observations. Produced from/consumed for ORU^R01's OBR segment. */
export interface DiagnosticReport {
  resourceType: "DiagnosticReport";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  status: "registered" | "partial" | "preliminary" | "final" | "amended" | "corrected" | "cancelled" | "unknown";
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject?: Reference;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  issued?: string;
  result?: Reference[];
}

/** An order/request. Produced from/consumed for ORM^O01. */
export interface ServiceRequest {
  resourceType: "ServiceRequest";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  status: "active" | "completed" | "revoked" | "unknown";
  intent: "order" | "plan" | "proposal";
  priority?: "routine" | "urgent" | "asap" | "stat";
  code: CodeableConcept;
  subject?: Reference;
  requester?: Reference;
  authoredOn?: string;
  occurrenceDateTime?: string;
  reasonCode?: CodeableConcept[];
  note?: { text: string }[];
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
  statusReason?: CodeableConcept;
  reasonCode?: CodeableConcept[];
  recorded?: string;
  location?: { display?: string };
}

/** A scheduled visit/booking. Produced from/consumed for SIU^S12. */
export interface Appointment {
  resourceType: "Appointment";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  status: "proposed" | "booked" | "cancelled" | "fulfilled" | "unknown";
  appointmentType?: CodeableConcept;
  reasonCode?: CodeableConcept[];
  description?: string;
  start?: string;
  end?: string;
  minutesDuration?: number;
  participant: { actor?: Reference; type?: CodeableConcept[]; status: "accepted" | "needs-action" }[];
  comment?: string;
  serviceType?: CodeableConcept[];
}

/** A physical specimen collected for testing. Produced from/consumed for OML^O21's SPM segment. */
export interface Specimen {
  resourceType: "Specimen";
  id?: string;
  meta?: Meta;
  status?: "available" | "unavailable" | "unsatisfactory" | "entered-in-error";
  type?: CodeableConcept;
  subject?: Reference;
  collection?: { collectedDateTime?: string; method?: CodeableConcept; bodySite?: CodeableConcept };
  receivedTime?: string;
  condition?: CodeableConcept[];
  request?: Reference[];
}

/** A documented allergy or intolerance. Produced from/consumed for `AL1` segments (any message type carrying one, currently the ADT mappers). */
export interface AllergyIntolerance {
  resourceType: "AllergyIntolerance";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  clinicalStatus?: CodeableConcept;
  category?: ("food" | "medication" | "environment" | "biologic")[];
  criticality?: "low" | "high" | "unable-to-assess";
  code?: CodeableConcept;
  patient: Reference;
  onsetDateTime?: string;
  reaction?: { manifestation: CodeableConcept[]; severity?: "mild" | "moderate" | "severe" }[];
}

/** A diagnosis. Produced from/consumed for `DG1` segments (any message type carrying one, currently the ADT mappers). */
export interface Condition {
  resourceType: "Condition";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  verificationStatus?: CodeableConcept;
  code?: CodeableConcept;
  subject: Reference;
  onsetDateTime?: string;
  recordedDate?: string;
  asserter?: Reference;
}

/** A person connected to a patient in a non-professional relationship (next of kin, emergency contact, guardian). Produced from/consumed for `NK1` segments (any message type carrying one, currently the ADT mappers). */
export interface RelatedPerson {
  resourceType: "RelatedPerson";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  patient: Reference;
  relationship?: CodeableConcept[];
  name?: HumanName[];
  telecom?: ContactPoint[];
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: Address[];
  period?: Period;
}

/** An insurance/payment coverage. Produced from/consumed for `IN1` segments (any message type carrying one, currently the ADT mappers). */
export interface Coverage {
  resourceType: "Coverage";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  status: "active" | "cancelled" | "draft" | "entered-in-error";
  type?: CodeableConcept;
  policyHolder?: Reference;
  subscriber?: Reference;
  beneficiary: Reference;
  relationship?: CodeableConcept;
  period?: Period;
  payor: Reference[];
}

/** A payor/insurer or other organization. Currently produced only from `IN1-4`/`IN1-5` (insurance company name/address), referenced from `Coverage.payor`. */
export interface Organization {
  resourceType: "Organization";
  id?: string;
  meta?: Meta;
  name?: string;
  address?: Address[];
}

/** A physical place. Currently produced only from `PV1-3`'s point-of-care component, referenced from `Encounter.location[].location`. */
export interface Location {
  resourceType: "Location";
  id?: string;
  meta?: Meta;
  name?: string;
}

/** A person providing care — a physician, nurse, etc. Currently produced from XCN person-name fields (e.g. `PV1-7` attending doctor, `PV1-8` referring doctor, `DG1-16` diagnosing clinician) that were previously display-only References. */
export interface Practitioner {
  resourceType: "Practitioner";
  id?: string;
  meta?: Meta;
  name?: HumanName[];
}

/**
 * Metadata about a message instance. Produced from/consumed for `MSH` (any message type),
 * per the official IG's "Segment MSH to MessageHeader Map". `source.endpoint`/
 * `destination[].endpoint` are FHIR-required but HL7v2 gives no real URI for them (`MSH-3`/
 * `MSH-5` are application *names*, not endpoints) — this package synthesizes a
 * `urn:hl7v2:<application>` placeholder rather than inventing a URL that doesn't exist.
 * `source.version`/`source.software` and `response` are additionally produced from/consumed
 * for `SFT`/`MSA` (any message type carrying one), per the IG's "Segment SFT to
 * MessageHeader Map" and "Segment MSA to MessageHeader Map".
 */
export interface MessageHeader {
  resourceType: "MessageHeader";
  id?: string;
  meta?: Meta;
  eventCoding?: Coding;
  source: { name?: string; endpoint: string; version?: string; software?: string };
  destination?: { name?: string; endpoint: string }[];
  response?: { identifier?: string; code: "ok" | "transient-error" | "fatal-error" };
}

/**
 * A record of who did what, when, to produce/change a resource. Produced from/consumed for
 * `EVN` (any message type carrying one — currently the ADT and MDM mappers), per the
 * official IG's "Segment EVN to Provenance Map". FHIR requires `agent` to be non-empty with
 * each entry's `who` present, but `EVN-5` (Operator ID) is the only source for that — so
 * this package only builds a `Provenance` resource when `EVN-5` is present, rather than
 * synthesizing a placeholder agent to satisfy the cardinality.
 */
export interface Provenance {
  resourceType: "Provenance";
  id?: string;
  meta?: Meta;
  target: Reference[];
  recorded?: string;
  occurredDateTime?: string;
  activity?: CodeableConcept;
  reason?: CodeableConcept[];
  location?: Reference;
  agent: { type?: CodeableConcept; who?: Reference }[];
}

/**
 * A piece of physical equipment. Produced from/consumed for `PRT` segments where `PRT-10`
 * or `PRT-16` (the device-identifying fields) are present — a `PRT` segment repeats once
 * per participant of any kind (person, organization, location, device), so only the
 * repetitions describing a device build one of these. This package doesn't replicate
 * FHIR's full `udiCarrier` component structure (`deviceIdentifier`/`carrierHRF`/etc.) since
 * `PRT-16` is a single UDI string with no further HL7v2-side decomposition to draw from.
 */
export interface Device {
  resourceType: "Device";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  type?: CodeableConcept;
  udiCarrier?: { deviceIdentifier?: string }[];
  manufactureDate?: string;
  expirationDate?: string;
  lotNumber?: string;
  serialNumber?: string;
  distinctIdentifier?: string;
}

/**
 * A specific role a person plays for an organization — e.g. "the ordering provider for
 * this order" as distinct from `Practitioner`, which just identifies the person. Produced
 * from/consumed for `PRT` segments where `PRT-5` (Person) is present, per the official IG's
 * "Segment PRT to PractitionerRole Map". `PRT-14` (the participant's address) isn't mapped
 * — carrying it would mean extending `Practitioner` beyond its current name-only shape, for
 * a field this package doesn't otherwise need.
 */
export interface PractitionerRole {
  resourceType: "PractitionerRole";
  id?: string;
  meta?: Meta;
  practitioner?: Reference;
  organization?: Reference;
  code?: CodeableConcept[];
  specialty?: CodeableConcept[];
  location?: Reference[];
  telecom?: ContactPoint[];
  period?: Period;
}

/**
 * A group of practitioners/organizations jointly responsible for a patient's care. Produced
 * from/consumed for `ROL` segments (one `CareTeam` per message, one `participant` per `ROL`
 * repetition) plus `IN3-21` (Case Manager), per the official IG's "Segment ROL to CareTeam
 * Map" and "Segment IN3 to CareTeam Map". `status` is always synthesized as `"active"` —
 * neither segment carries a status signal. The `PRT`-to-`CareTeam` map isn't implemented:
 * it would need the same person/org/role dispatch `PRT`-to-`PractitionerRole` already
 * covers, for a resource that's otherwise redundant with it here.
 */
export interface CareTeam {
  resourceType: "CareTeam";
  id?: string;
  meta?: Meta;
  status?: "active";
  subject?: Reference;
  participant?: { role?: CodeableConcept[]; member?: Reference; onBehalfOf?: Reference; period?: Period }[];
  reasonCode?: CodeableConcept[];
  telecom?: ContactPoint[];
}

/** A procedure performed on a patient. Produced from/consumed for `PR1` segments (any message type carrying one, currently the ADT mappers). */
export interface Procedure {
  resourceType: "Procedure";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  status: "completed" | "in-progress" | "not-done" | "unknown";
  code?: CodeableConcept;
  category?: CodeableConcept;
  subject: Reference;
  performedDateTime?: string;
  performedPeriod?: Period;
  location?: Reference;
  reasonCode?: CodeableConcept[];
}

/**
 * The financial/administrative record a merged-away patient identity folds into. Produced
 * from/consumed for `MRG` (currently the ADT^A40 mapper), per the official IG's "Segment
 * MRG to Account Map". `status` is always synthesized as `"unknown"` — the IG's own mapping
 * notes MRG carries no status signal, since the prior account may already be active or
 * inactive and only the implementer's own system would know which.
 */
export interface Account {
  resourceType: "Account";
  id?: string;
  meta?: Meta;
  status: "active" | "inactive" | "unknown";
  subject?: Reference[];
  identifier?: Identifier[];
}

/**
 * A drug product. Produced from/consumed for `RXO` (currently the RDE^O11 mapper),
 * referenced from `MedicationRequest.medicationReference`, per the official IG's "Segment
 * RXO to MedicationRequest Map".
 */
export interface Medication {
  resourceType: "Medication";
  id?: string;
  meta?: Meta;
  code?: CodeableConcept;
  form?: CodeableConcept;
  ingredient?: { strength?: { numerator?: Quantity; denominator?: Quantity } }[];
}

/**
 * A pharmacy order. Produced from/consumed for `RXO`/`RXR` (currently the RDE^O11 mapper),
 * per the official IG's "Segment RXO to MedicationRequest Map" and "Segment RXR to
 * MedicationRequest Map". `requester` stays a display-only Reference — RXO-14 carries only
 * a DEA number, with no name to build a real `Practitioner` from.
 */
export interface MedicationRequest {
  resourceType: "MedicationRequest";
  id?: string;
  meta?: Meta;
  status: "active" | "completed" | "cancelled" | "unknown";
  intent: "order";
  medicationReference: Reference;
  subject: Reference;
  dosageInstruction?: {
    doseAndRate?: { type?: CodeableConcept; doseRange?: Range }[];
    route?: CodeableConcept;
    site?: CodeableConcept;
    method?: CodeableConcept;
    additionalInstruction?: CodeableConcept[];
  }[];
  dispenseRequest?: { quantity?: Quantity; numberOfRepeatsAllowed?: number };
  substitution?: { allowedCodeableConcept?: CodeableConcept };
  requester?: Reference;
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
  identifier?: Identifier[];
  type?: CodeableConcept;
  subject?: Reference;
  date?: string;
  author?: Reference[];
  authenticator?: Reference;
  description?: string;
  securityLabel?: CodeableConcept[];
  content: { attachment: Attachment }[];
}

/** Any FHIR resource this package produces or consumes. */
export type FhirResource =
  | Patient
  | Encounter
  | Observation
  | DiagnosticReport
  | ServiceRequest
  | Immunization
  | Appointment
  | Specimen
  | DocumentReference
  | AllergyIntolerance
  | Condition
  | RelatedPerson
  | Coverage
  | Organization
  | Location
  | Practitioner
  | MessageHeader
  | Procedure
  | Provenance
  | Device
  | PractitionerRole
  | CareTeam
  | Account
  | Medication
  | MedicationRequest;

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
