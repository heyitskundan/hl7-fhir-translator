import { Hl7ParseError } from "./hl7/types.js";
import { parseHl7Message } from "./hl7/parser.js";
import { detectTargetMessageType, isSupportedMessageType, SUPPORTED_MESSAGE_TYPES } from "./mapping/registry.js";
import type { TranslationDirection } from "./types.js";

/** Input was recognized as an HL7v2 message. */
export interface DetectedHl7 {
  kind: "hl7";
  /** e.g. "ADT^A01" */
  messageType: string;
  category: string;
  trigger: string;
  supported: boolean;
  description?: string;
}

/** Input was recognized as FHIR JSON. */
export interface DetectedFhir {
  kind: "fhir";
  /** Every resourceType found (a bare resource yields a single-element array). */
  resourceTypes: string[];
  /** The HL7v2 message type this would translate to, if determinable. */
  targetMessageType?: string;
  supported: boolean;
}

/** Input didn't parse, or its shape didn't match either HL7v2 or FHIR JSON. */
export interface DetectedUnknown {
  kind: "unknown";
  reason: string;
}

/** The result of `inspectInput`. */
export interface DetectionResult {
  /** "unknown" when the input's shape doesn't look like either HL7v2 or JSON. */
  direction: TranslationDirection | "unknown";
  detail: DetectedHl7 | DetectedFhir | DetectedUnknown;
}

/**
 * Identifies what kind of translation an input would trigger — not just the direction
 * (HL7v2 vs FHIR), but the specific HL7v2 message type or FHIR resource kind — without
 * throwing and without performing the translation. Safe to call on every keystroke for a
 * live "here's what I detected" preview; unsupported or malformed input is reported in
 * the result, not thrown.
 */
export function inspectInput(input: string): DetectionResult {
  const trimmed = input.trim();

  if (trimmed.startsWith("MSH")) {
    try {
      const message = parseHl7Message(input);
      const [category = "", trigger = ""] = message.messageType.split("^");
      const supported = isSupportedMessageType(category, trigger);
      const description = SUPPORTED_MESSAGE_TYPES.find((t) => t.category === category && t.trigger === trigger)?.description;
      return {
        direction: "hl7ToFhir",
        detail: { kind: "hl7", messageType: message.messageType, category, trigger, supported, description },
      };
    } catch (error) {
      const reason = error instanceof Hl7ParseError ? error.message : "Could not parse as HL7v2";
      return { direction: "hl7ToFhir", detail: { kind: "unknown", reason } };
    }
  }

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return { direction: "fhirToHl7", detail: { kind: "unknown", reason: "Input is not valid JSON" } };
    }

    if (typeof parsed !== "object" || parsed === null || !("resourceType" in parsed)) {
      return { direction: "fhirToHl7", detail: { kind: "unknown", reason: 'JSON has no "resourceType"' } };
    }

    const obj = parsed as { resourceType: string; entry?: { resource?: { resourceType?: string } }[] };
    const resourceTypes =
      obj.resourceType === "Bundle"
        ? (obj.entry ?? []).map((e) => e.resource?.resourceType).filter((t): t is string => !!t)
        : [obj.resourceType];

    const target = detectTargetMessageType(new Set(resourceTypes));
    return {
      direction: "fhirToHl7",
      detail: {
        kind: "fhir",
        resourceTypes,
        targetMessageType: target ? `${target.category}^${target.trigger}` : undefined,
        supported: target !== undefined,
      },
    };
  }

  return { direction: "unknown", detail: { kind: "unknown", reason: "Input doesn't start with MSH or {" } };
}
