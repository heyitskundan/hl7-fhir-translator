/** One field-level translation step: what HL7v2/FHIR source produced what target value. */
export interface Mapping {
  source: string;
  target: string;
  value: string;
  note?: string;
}

/** Which way a translation runs. */
export type TranslationDirection = "hl7ToFhir" | "fhirToHl7";

/** What `translateHl7ToFhir`/`translateFhirToHl7` return. */
export interface TranslationResult {
  /** FHIR JSON (a Bundle) or an HL7v2 message string, depending on direction. */
  translated: string;
  /** One entry per field actually translated. */
  mappings: Mapping[];
  /** Segments/fields present in the input with no mapping. */
  warnings: string[];
}
