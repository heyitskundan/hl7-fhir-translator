import type { Hl7Message } from "../hl7/types.js";
import type { Bundle } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import type { MappingTrail } from "./common.js";
import { adtToFhir, fhirToAdt } from "./adt.js";
import { oruToFhir, fhirToOru } from "./oru.js";
import { ormToFhir, fhirToOrm } from "./orm.js";

/** One HL7v2 message type (category^trigger) this package knows how to translate, in both directions. */
export interface SupportedMessageType {
  category: string;
  trigger: string;
  description: string;
}

/** The complete, authoritative list of HL7v2 message types this package can translate. */
export const SUPPORTED_MESSAGE_TYPES: SupportedMessageType[] = [
  { category: "ADT", trigger: "A01", description: "Patient admission" },
  { category: "ADT", trigger: "A08", description: "Patient information update" },
  { category: "ORU", trigger: "R01", description: "Unsolicited observation / lab result" },
  { category: "ORM", trigger: "O01", description: "General order" },
];

/** True if `category^trigger` is one this package can translate, per SUPPORTED_MESSAGE_TYPES. */
export function isSupportedMessageType(category: string, trigger: string): boolean {
  return SUPPORTED_MESSAGE_TYPES.some((t) => t.category === category && t.trigger === trigger);
}

/**
 * Pure, non-throwing lookup from the FHIR resource types present in a bundle to the
 * HL7v2 message type they'd translate to. Shared by the throwing router below and by
 * `inspectInput` (../inspect.js), which needs the same rule without an exception on a
 * miss.
 */
export function detectTargetMessageType(resourceTypes: ReadonlySet<string>): SupportedMessageType | undefined {
  if (resourceTypes.has("ServiceRequest")) return SUPPORTED_MESSAGE_TYPES.find((t) => t.category === "ORM");
  if (resourceTypes.has("DiagnosticReport")) return SUPPORTED_MESSAGE_TYPES.find((t) => t.category === "ORU");
  if (resourceTypes.has("Patient")) return SUPPORTED_MESSAGE_TYPES.find((t) => t.category === "ADT" && t.trigger === "A01");
  return undefined;
}

/** Routes a parsed HL7v2 message to the mapper for its MSH-9 message type. */
export function hl7ToFhirByMessageType(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const [category, trigger] = message.messageType.split("^");
  switch (category) {
    case "ADT":
      if (trigger !== "A01" && trigger !== "A08") {
        throw new FhirValidationError(`Unsupported ADT trigger event "${trigger}". Supported: A01, A08.`);
      }
      return adtToFhir(message);
    case "ORU":
      if (trigger !== "R01") {
        throw new FhirValidationError(`Unsupported ORU trigger event "${trigger}". Supported: R01.`);
      }
      return oruToFhir(message);
    case "ORM":
      if (trigger !== "O01") {
        throw new FhirValidationError(`Unsupported ORM trigger event "${trigger}". Supported: O01.`);
      }
      return ormToFhir(message);
    default:
      throw new FhirValidationError(
        `Unsupported HL7v2 message type "${message.messageType}". Supported: ${SUPPORTED_MESSAGE_TYPES.map((t) => `${t.category}^${t.trigger}`).join(", ")}.`,
      );
  }
}

/** Routes a FHIR bundle to the reverse mapper based on which resource types it contains. */
export function fhirToHl7ByResourceType(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const types = new Set(bundle.entry.map((e) => e.resource.resourceType));
  const target = detectTargetMessageType(types);
  if (target?.category === "ORM") return fhirToOrm(bundle);
  if (target?.category === "ORU") return fhirToOru(bundle);
  if (target?.category === "ADT") return fhirToAdt(bundle, target.trigger);
  throw new FhirValidationError(
    "Bundle must contain a Patient, DiagnosticReport, or ServiceRequest resource to determine the target HL7v2 message type.",
  );
}
