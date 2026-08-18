import type { Hl7Message } from "../hl7/types.js";
import type { Bundle } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import type { MappingTrail } from "./common.js";
import { adtToFhir, fhirToAdt } from "./adt.js";
import { oruToFhir, fhirToOru } from "./oru.js";
import { ormToFhir, fhirToOrm } from "./orm.js";
import { vxuToFhir, fhirToVxu } from "./vxu.js";
import { siuToFhir, fhirToSiu } from "./siu.js";
import { omlToFhir, fhirToOml } from "./oml.js";
import { mdmToFhir, fhirToMdm } from "./mdm.js";

/** One HL7v2 message type (category^trigger) this package knows how to translate, in both directions. */
export interface SupportedMessageType {
  category: string;
  trigger: string;
  description: string;
}

/** The complete, authoritative list of HL7v2 message types this package can translate. */
export const SUPPORTED_MESSAGE_TYPES: SupportedMessageType[] = [
  { category: "ADT", trigger: "A01", description: "Patient admission" },
  { category: "ADT", trigger: "A02", description: "Patient transfer" },
  { category: "ADT", trigger: "A05", description: "Pre-admit a patient" },
  { category: "ADT", trigger: "A06", description: "Change an outpatient to an inpatient" },
  { category: "ADT", trigger: "A08", description: "Patient information update" },
  { category: "ADT", trigger: "A09", description: "Patient departing — tracking" },
  { category: "ADT", trigger: "A11", description: "Cancel admit / cancel visit" },
  { category: "ADT", trigger: "A17", description: "Swap patients" },
  { category: "ORU", trigger: "R01", description: "Unsolicited observation / lab result" },
  { category: "ORM", trigger: "O01", description: "General order" },
  { category: "VXU", trigger: "V04", description: "Unsolicited vaccination record update" },
  { category: "SIU", trigger: "S12", description: "Appointment scheduling — new appointment" },
  { category: "OML", trigger: "O21", description: "Laboratory order" },
  { category: "MDM", trigger: "T02", description: "Document notification — original document" },
];

/** True if `category^trigger` is one this package can translate, per SUPPORTED_MESSAGE_TYPES. */
export function isSupportedMessageType(category: string, trigger: string): boolean {
  return SUPPORTED_MESSAGE_TYPES.some((t) => t.category === category && t.trigger === trigger);
}

/**
 * One reverse-routing rule: if every resource type in `requires` appears at least
 * `minCount` times (default 1) in the bundle, route to `category` (and `trigger`, for
 * message types where more than one trigger shares the same resource shape — this only
 * picks a *display default* for `inspectInput`'s preview; the actual mapper for a
 * multi-trigger category, e.g. ADT, derives the real trigger itself from the resource
 * content it's given, not from this table).
 *
 * `ROUTING_RULES` is checked top to bottom, first match wins. Ordering invariant,
 * enforced by `assertRoutingRulesAreOrderedBySpecificity` below (checked once at module
 * load, not per call): if rule A's `requires` set is a subset of rule B's `requires` set
 * (or they require the same set but B has a higher `minCount`), B must appear before A.
 * This is what "most specific first" meant in the old if/else chain — encoding it as a
 * checked invariant over resource-type *sets and counts* (rather than a single resource
 * type per branch) means a message type that shares resource types with another (e.g. a
 * future type producing both `ServiceRequest` and `MedicationRequest`, or — like
 * ADT^A17's patient swap — two of the same resource type) can be disambiguated by
 * requiring more, without the ordering becoming a guessing game as more rules are added.
 */
interface RoutingRule {
  category: string;
  trigger?: string;
  requires: readonly string[];
  minCount?: number;
}

const ROUTING_RULES: readonly RoutingRule[] = [
  { category: "OML", requires: ["Specimen"] },
  { category: "ORM", requires: ["ServiceRequest"] },
  { category: "ORU", requires: ["DiagnosticReport"] },
  { category: "VXU", requires: ["Immunization"] },
  { category: "SIU", requires: ["Appointment"] },
  { category: "MDM", requires: ["DocumentReference"] },
  { category: "ADT", trigger: "A17", requires: ["Patient"], minCount: 2 },
  { category: "ADT", trigger: "A01", requires: ["Patient"] },
];

function specificityKey(rule: RoutingRule): string {
  return [...rule.requires].sort().join(",");
}

function assertRoutingRulesAreOrderedBySpecificity(rules: readonly RoutingRule[]): void {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const earlier = rules[i]!;
      const later = rules[j]!;
      const earlierFields = new Set(earlier.requires);
      const laterMoreFields = later.requires.length > earlierFields.size && later.requires.every((t) => earlierFields.has(t));
      const sameFieldsHigherMinCount = specificityKey(earlier) === specificityKey(later) && (later.minCount ?? 1) > (earlier.minCount ?? 1);
      if (laterMoreFields || sameFieldsHigherMinCount) {
        throw new Error(
          `ROUTING_RULES ordering bug: rule for "${later.category}^${later.trigger ?? ""}" (requires: ${later.requires.join(", ")}, minCount: ${later.minCount ?? 1}) ` +
            `is more specific than earlier rule for "${earlier.category}^${earlier.trigger ?? ""}" but appears after it — it would never match.`,
        );
      }
    }
  }
}
assertRoutingRulesAreOrderedBySpecificity(ROUTING_RULES);

/**
 * Pure, non-throwing lookup from the FHIR resource types present in a bundle to the
 * HL7v2 message type they'd translate to. Shared by the throwing router below and by
 * `inspectInput` (../inspect.js), which needs the same rule without an exception on a
 * miss. Takes the resource-type list with duplicates preserved (not deduplicated), since
 * some rules (e.g. ADT^A17) are count-sensitive.
 */
export function detectTargetMessageType(resourceTypes: readonly string[]): SupportedMessageType | undefined {
  const counts = new Map<string, number>();
  for (const t of resourceTypes) counts.set(t, (counts.get(t) ?? 0) + 1);
  const rule = ROUTING_RULES.find((r) => r.requires.every((t) => (counts.get(t) ?? 0) >= (r.minCount ?? 1)));
  if (!rule) return undefined;
  return SUPPORTED_MESSAGE_TYPES.find((t) => t.category === rule.category && (rule.trigger === undefined || t.trigger === rule.trigger));
}

/** Routes a parsed HL7v2 message to the mapper for its MSH-9 message type. */
export function hl7ToFhirByMessageType(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const [category, trigger] = message.messageType.split("^");
  switch (category) {
    case "ADT": {
      const adtTriggers = SUPPORTED_MESSAGE_TYPES.filter((t) => t.category === "ADT").map((t) => t.trigger);
      if (!trigger || !adtTriggers.includes(trigger)) {
        throw new FhirValidationError(`Unsupported ADT trigger event "${trigger}". Supported: ${adtTriggers.join(", ")}.`);
      }
      return adtToFhir(message);
    }
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
    case "VXU":
      if (trigger !== "V04") {
        throw new FhirValidationError(`Unsupported VXU trigger event "${trigger}". Supported: V04.`);
      }
      return vxuToFhir(message);
    case "SIU":
      if (trigger !== "S12") {
        throw new FhirValidationError(`Unsupported SIU trigger event "${trigger}". Supported: S12.`);
      }
      return siuToFhir(message);
    case "OML":
      if (trigger !== "O21") {
        throw new FhirValidationError(`Unsupported OML trigger event "${trigger}". Supported: O21.`);
      }
      return omlToFhir(message);
    case "MDM":
      if (trigger !== "T02") {
        throw new FhirValidationError(`Unsupported MDM trigger event "${trigger}". Supported: T02.`);
      }
      return mdmToFhir(message);
    default:
      throw new FhirValidationError(
        `Unsupported HL7v2 message type "${message.messageType}". Supported: ${SUPPORTED_MESSAGE_TYPES.map((t) => `${t.category}^${t.trigger}`).join(", ")}.`,
      );
  }
}

/** Routes a FHIR bundle to the reverse mapper based on which resource types it contains. */
export function fhirToHl7ByResourceType(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const types = bundle.entry.map((e) => e.resource.resourceType);
  const target = detectTargetMessageType(types);
  if (target?.category === "OML") return fhirToOml(bundle);
  if (target?.category === "ORM") return fhirToOrm(bundle);
  if (target?.category === "ORU") return fhirToOru(bundle);
  if (target?.category === "VXU") return fhirToVxu(bundle);
  if (target?.category === "SIU") return fhirToSiu(bundle);
  if (target?.category === "MDM") return fhirToMdm(bundle);
  if (target?.category === "ADT") return fhirToAdt(bundle);
  throw new FhirValidationError(
    "Bundle must contain a Patient, DiagnosticReport, ServiceRequest, Specimen, Immunization, Appointment, or DocumentReference resource to determine the target HL7v2 message type.",
  );
}
