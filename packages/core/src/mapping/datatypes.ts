/**
 * Reusable HL7v2 datatype -> FHIR converters, each named after the HL7v2 datatype it reads
 * (per the HL7v2.x spec's own component numbering — XPN.1, XAD.1, etc., independent of
 * which segment/field a caller reads it from). Segment mappers call these instead of
 * re-deriving component-splitting logic per field, the way `adt.ts`'s `buildPatientFromPid`
 * originally did inline for `PID-5` (XPN) and `PID-11` (XAD) before this file existed.
 *
 * Each converter takes the raw `Hl7Field` (from `getRawField`), not a segment+field number
 * — that's what makes them reusable across different segments that happen to carry the same
 * datatype (e.g. XPN appears in `PID-5`, `NK1-2`, `TXA-9`'s XCN, etc.).
 *
 * Where a datatype's target FHIR type depends on which field it's being read into (e.g. CWE
 * can become a `CodeableConcept`, a `Coding`, or a `Quantity.unit` depending on context —
 * see the IG's per-field CWE mapping pages), that selection is the caller's job, not this
 * file's: these converters produce the datatype's natural FHIR shape for HumanName/Address/
 * etc., and callers that need something else (e.g. a bare `Coding`) build it from the same
 * component reads via the smaller primitive helpers.
 */
import type { Address, Attachment, CodeableConcept, Coding, ContactPoint, HumanName, Identifier, Period, Range } from "../fhir/types.js";
import type { Hl7Field } from "../hl7/types.js";

function comp(f: Hl7Field | undefined, n: number, rep = 0): string | undefined {
  const v = f?.reps[rep]?.[n - 1];
  return v === undefined || v === "" ? undefined : v;
}

/** XPN (Extended Person Name) -> FHIR HumanName. Components: 1 family, 2 given, 3 middle, 4 suffix, 5 prefix, 7 name type code. */
export function xpnToHumanName(f: Hl7Field | undefined): HumanName | undefined {
  const family = comp(f, 1);
  const given = comp(f, 2);
  const middle = comp(f, 3);
  const suffix = comp(f, 4);
  const prefix = comp(f, 5);
  if (!family && !given) return undefined;
  const givenParts = [given, middle].filter((p): p is string => !!p);
  return {
    family,
    given: givenParts.length > 0 ? givenParts : undefined,
    prefix: prefix ? [prefix] : undefined,
    suffix: suffix ? [suffix] : undefined,
  };
}

/** FHIR HumanName -> XPN components 1-5, in HL7v2 component order (family, given, middle, suffix, prefix). */
export function humanNameToXpn(name: HumanName | undefined): [string, string, string, string, string] {
  if (!name) return ["", "", "", "", ""];
  return [name.family ?? "", name.given?.[0] ?? "", name.given?.[1] ?? "", name.suffix?.[0] ?? "", name.prefix?.[0] ?? ""];
}

/** XAD (Extended Address) -> FHIR Address. Components: 1 street, 2 other designation, 3 city, 4 state, 5 postal code, 6 country. */
export function xadToAddress(f: Hl7Field | undefined): Address | undefined {
  const street = comp(f, 1);
  const otherDesignation = comp(f, 2);
  const city = comp(f, 3);
  const state = comp(f, 4);
  const postalCode = comp(f, 5);
  const country = comp(f, 6);
  if (!street && !city) return undefined;
  const line = [street, otherDesignation].filter((p): p is string => !!p);
  return { line: line.length > 0 ? line : undefined, city, state, postalCode, country };
}

/** FHIR Address -> XAD components 1/3/4/5/6 (street/city/state/postalCode/country); component 2 (other designation) is not round-tripped since Address.line[] doesn't distinguish it from the street line. */
export function addressToXad(addr: Address | undefined): [string, string, string, string, string, string] {
  if (!addr) return ["", "", "", "", "", ""];
  return [addr.line?.[0] ?? "", "", addr.city ?? "", addr.state ?? "", addr.postalCode ?? "", addr.country ?? ""];
}

const XTN_USE: Record<string, ContactPoint["use"]> = { PRN: "home", WPN: "work", ORN: "temp", NET: "home" };
const XTN_SYSTEM: Record<string, ContactPoint["system"]> = { PH: "phone", FX: "fax", CP: "phone", Internet: "email", X400: "email" };

/** XTN (Extended Telecommunication Number) -> FHIR ContactPoint. Components: 2 use code (Table 0201), 3 equipment type (Table 0202), 4 email address, 1 legacy formatted phone number (used as `value` when 4 is absent). */
export function xtnToContactPoint(f: Hl7Field | undefined): ContactPoint | undefined {
  const legacyNumber = comp(f, 1);
  const useCode = comp(f, 2);
  const equipmentType = comp(f, 3);
  const email = comp(f, 4);
  const value = email ?? legacyNumber;
  if (!value) return undefined;
  return {
    system: equipmentType ? XTN_SYSTEM[equipmentType] : email ? "email" : undefined,
    value,
    use: useCode ? XTN_USE[useCode] : undefined,
  };
}

/** FHIR ContactPoint -> XTN components 2 (use), 3 (equipment type), 4 (email) or 1 (legacy number), inverse of `xtnToContactPoint`'s lookups. */
export function contactPointToXtn(cp: ContactPoint | undefined): {
  legacyNumber: string;
  use: string;
  equipmentType: string;
  email: string;
} {
  if (!cp) return { legacyNumber: "", use: "", equipmentType: "", email: "" };
  const useCode = Object.entries(XTN_USE).find(([, v]) => v === cp.use)?.[0] ?? "";
  const isEmail = cp.system === "email";
  const equipmentType = Object.entries(XTN_SYSTEM).find(([, v]) => v === cp.system)?.[0] ?? "";
  return {
    legacyNumber: isEmail ? "" : (cp.value ?? ""),
    use: useCode,
    equipmentType,
    email: isEmail ? (cp.value ?? "") : "",
  };
}

/** XCN (Extended Composite ID Number and Name) -> a display name, family/given split. Components: 1 ID number, 2 family, 3 given, 4 middle. Shared by any segment referencing a person by XCN (ORC-12, PV1-7, RXA-10, PRT, ROL, ...). */
export function xcnToNameParts(f: Hl7Field | undefined): {
  idNumber?: string;
  family?: string;
  given?: string;
  middle?: string;
  display?: string;
} {
  const idNumber = comp(f, 1);
  const family = comp(f, 2);
  const given = comp(f, 3);
  const middle = comp(f, 4);
  const display = [given, middle, family].filter(Boolean).join(" ") || undefined;
  return { idNumber, family, given, middle, display };
}

/** XON (Extended Composite Name and ID for Organizations) -> FHIR-shaped organization fields. Components: 1 organization name, 3 id number, 10 organization identifier (assigning-authority-scoped id). */
export function xonToOrganizationParts(f: Hl7Field | undefined): { name?: string; idNumber?: string; identifier?: string } {
  return { name: comp(f, 1), idNumber: comp(f, 3), identifier: comp(f, 10) };
}

/** CX (Extended Composite ID with Check Digit) -> FHIR Identifier. Components: 1 id, 4 assigning authority (HD.1), 5 identifier type code. */
export function cxToIdentifier(f: Hl7Field | undefined): Identifier | undefined {
  const value = comp(f, 1);
  if (!value) return undefined;
  const assigner = comp(f, 4);
  const typeCode = comp(f, 5);
  return {
    value,
    ...(assigner ? { assigner: { display: assigner } } : {}),
    ...(typeCode ? { type: { coding: [{ code: typeCode }] } } : {}),
  };
}

/** EI (Entity Identifier) -> FHIR Identifier. Components: 1 entity identifier, 2 namespace id, 3 universal id, 4 universal id type. `system` is built from the universal id when present (per EI.3/.4), else the namespace id is used as the assigner display. */
export function eiToIdentifier(f: Hl7Field | undefined): Identifier | undefined {
  const value = comp(f, 1);
  if (!value) return undefined;
  const namespaceId = comp(f, 2);
  const universalId = comp(f, 3);
  return {
    value,
    system: universalId,
    ...(namespaceId && !universalId ? { assigner: { display: namespaceId } } : {}),
  };
}

/** HD (Hierarchic Designator) -> a system URI candidate and display name. Components: 1 namespace id, 2 universal id, 3 universal id type. */
export function hdToParts(f: Hl7Field | undefined): { namespaceId?: string; universalId?: string; universalIdType?: string } {
  return { namespaceId: comp(f, 1), universalId: comp(f, 2), universalIdType: comp(f, 3) };
}

/** CWE/CE (Coded [With Exceptions] Element) -> a FHIR CodeableConcept, using only the identifier/text components (1/2) — the coding-system component (3) is a local HL7v2 table name, not a FHIR system URI, so callers that know the real FHIR terminology URI for a given field should set `.coding[0].system` themselves; this only returns `code`/`display`/`text` in shape. */
export function cweToCodeableConcept(f: Hl7Field | undefined): CodeableConcept | undefined {
  const code = comp(f, 1);
  const display = comp(f, 2);
  if (!code) return undefined;
  return { coding: [{ code, display }], text: display };
}

/** CWE/CE -> a bare FHIR Coding (no CodeableConcept wrapper), for fields that map directly to a `Coding` rather than a `CodeableConcept`. */
export function cweToCoding(f: Hl7Field | undefined): Coding | undefined {
  const code = comp(f, 1);
  if (!code) return undefined;
  return { code, display: comp(f, 2) };
}

/** SN (Structured Numeric) -> FHIR Range, for a "num1-num2" comparator-free range (the common case, e.g. reference ranges). Components: 2 num1, 3 separator/suffix (expected "-"), 4 num2. Falls back to undefined for comparator forms (">", "<", etc.) since Range has no comparator field — `Quantity.comparator` is the correct target for those and is the caller's responsibility to build directly. */
export function snToRange(f: Hl7Field | undefined): Range | undefined {
  const comparator = comp(f, 1);
  const num1 = comp(f, 2);
  const separator = comp(f, 3);
  const num2 = comp(f, 4);
  if (comparator || !num1) return undefined;
  const low = Number(num1);
  if (Number.isNaN(low)) return undefined;
  if (separator === "-" && num2) {
    const high = Number(num2);
    if (Number.isNaN(high)) return { low: { value: low } };
    return { low: { value: low }, high: { value: high } };
  }
  return { low: { value: low } };
}

/** DR (Date/Time Range) -> FHIR Period. Components: 1 range start date/time, 2 range end date/time (both raw HL7 DTM strings — pass through `hl7DateTimeToFhir` from `./common.js` to convert). */
export function drToPeriodComponents(f: Hl7Field | undefined): { start?: string; end?: string } {
  return { start: comp(f, 1), end: comp(f, 2) };
}

/** Builds a FHIR Period directly from DR components already converted to FHIR date/dateTime strings (caller applies `hl7DateTimeToFhir` first, since this file doesn't import that conversion to stay a pure component-splitting layer). */
export function periodFrom(start: string | undefined, end: string | undefined): Period | undefined {
  if (!start && !end) return undefined;
  return { start, end };
}

/** RP (Reference Pointer) -> FHIR Attachment (url only — RP points at externally-stored content, it doesn't carry the bytes). Components: 1 pointer, 3 type of data (used as a rough contentType hint when present). */
export function rpToAttachment(f: Hl7Field | undefined): Attachment | undefined {
  const pointer = comp(f, 1);
  if (!pointer) return undefined;
  return { contentType: comp(f, 3) };
}
