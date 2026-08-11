import { parseHl7Message } from "./hl7/parser.js";
import { serializeHl7Message } from "./hl7/serializer.js";
import type { Bundle, FhirResource } from "./fhir/types.js";
import { FhirValidationError } from "./fhir/types.js";
import { hl7ToFhirByMessageType, fhirToHl7ByResourceType } from "./mapping/registry.js";
import type { TranslationResult } from "./types.js";

function asBundle(parsed: unknown): Bundle {
  if (typeof parsed !== "object" || parsed === null || !("resourceType" in parsed)) {
    throw new FhirValidationError("Input is not a valid FHIR JSON resource or Bundle");
  }
  const obj = parsed as { resourceType: string };
  if (obj.resourceType === "Bundle") {
    const bundle = parsed as Bundle;
    if (!Array.isArray(bundle.entry)) {
      throw new FhirValidationError('Bundle is missing its "entry" array');
    }
    return bundle;
  }
  return { resourceType: "Bundle", type: "collection", entry: [{ resource: parsed as FhirResource }] };
}

/** Deterministically translates a raw HL7v2 message into a FHIR R4 Bundle (JSON, pretty-printed). */
export function translateHl7ToFhir(rawHl7: string): TranslationResult {
  const message = parseHl7Message(rawHl7);
  const { bundle, trail } = hl7ToFhirByMessageType(message);
  return {
    translated: JSON.stringify(bundle, null, 2),
    mappings: trail.mappings,
    warnings: trail.warnings,
  };
}

/** Deterministically translates a raw FHIR R4 resource or Bundle (JSON string) into an HL7v2 message. */
export function translateFhirToHl7(rawFhirJson: string): TranslationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawFhirJson);
  } catch {
    throw new FhirValidationError("Input is not valid JSON");
  }
  const bundle = asBundle(parsed);
  const { message, trail } = fhirToHl7ByResourceType(bundle);
  return {
    translated: serializeHl7Message(message),
    mappings: trail.mappings,
    warnings: trail.warnings,
  };
}
