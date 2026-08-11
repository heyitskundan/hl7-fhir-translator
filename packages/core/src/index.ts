export { parseHl7Message, findSegment, findSegments, getField, getComponent, getRepetitions } from "./hl7/parser.js";
export { serializeHl7Message } from "./hl7/serializer.js";
export type { Hl7Message, Hl7Segment, Hl7Field, Hl7Delimiters } from "./hl7/types.js";
export { Hl7ParseError } from "./hl7/types.js";

export type {
  Bundle,
  BundleEntry,
  FhirResource,
  Patient,
  Encounter,
  Observation,
  DiagnosticReport,
  ServiceRequest,
  Coding,
  CodeableConcept,
  Identifier,
  HumanName,
  Address,
  Reference,
  Period,
  Quantity,
  Range,
  Meta,
} from "./fhir/types.js";
export { FhirValidationError } from "./fhir/types.js";

export { translateHl7ToFhir, translateFhirToHl7 } from "./translate.js";
export { SUPPORTED_MESSAGE_TYPES } from "./mapping/registry.js";
export type { SupportedMessageType } from "./mapping/registry.js";
export type { Mapping, TranslationResult, TranslationDirection } from "./types.js";

export { inspectInput } from "./inspect.js";
export type { DetectionResult, DetectedHl7, DetectedFhir, DetectedUnknown } from "./inspect.js";
