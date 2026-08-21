/**
 * IN1 <-> Coverage, per the official IG's "Segment IN1 to Coverage Map"
 * (hl7.org/fhir/uv/v2mappings/ConceptMap-segment-in1-to-coverage.html, fetched directly).
 * IN1 can repeat (a patient can carry more than one insurance plan, ordered by IN1-1); this
 * produces zero or more `Coverage` resources (plus zero or more `Organization` resources
 * for `IN1-4`/`IN1-5`, referenced from `Coverage.payor`), wired into the ADT mappers the
 * same way `allergy.ts`/AL1, `condition.ts`/DG1, and `relatedperson.ts`/NK1 are.
 *
 * `policyHolder` and `subscriber` stay display-only References — this package doesn't
 * produce a `Practitioner`/`Organization` for those, matching how `Encounter.participant`
 * already handles attending-doctor references elsewhere in this codebase. `payor` is the
 * one exception: the IG's own map nests `Organization.name`/`.address` inside the `payor`
 * target, so it gets a real resource rather than a display-only Reference.
 */
import { findSegments, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Coverage, Organization, Patient } from "../fhir/types.js";
import { cweToCodeableConcept, cxToIdentifier, periodFrom, xadToAddress, xonToOrganizationParts, xpnToHumanName } from "./datatypes.js";
import { fhirDateTimeToHl7, hl7DateTimeToFhir, type MappingTrail } from "./common.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";

const RELATIONSHIP_TABLE = "table-hl70063-to-v3-rolecode";

/** IN1 segments -> zero or more Coverage resources (each with `beneficiary` set to `patient`) plus zero or more Organization resources for their payors, one pair per segment. */
export function in1ToCoverages(
  message: Hl7Message,
  patient: Patient,
  trail: MappingTrail,
): { coverages: Coverage[]; organizations: Organization[] } {
  const coverages: Coverage[] = [];
  const organizations: Organization[] = [];
  findSegments(message, "IN1").forEach((in1, i) => {
    const { coverage, organization } = buildOneCoverage(in1, patient, trail, `coverage-${i + 1}`, `organization-${i + 1}`);
    coverages.push(coverage);
    if (organization) organizations.push(organization);
  });
  return { coverages, organizations };
}

function buildOneCoverage(
  in1: Hl7Segment,
  patient: Patient,
  trail: MappingTrail,
  id: string,
  organizationId: string,
): { coverage: Coverage; organization?: Organization } {
  const coverage: Coverage = {
    resourceType: "Coverage",
    id,
    status: "active",
    beneficiary: { reference: `Patient/${patient.id}` },
    payor: [],
  };

  const identifier = cxToIdentifier(in1.fields[2]);
  if (identifier) {
    coverage.identifier = [identifier];
    trail.add("IN1-2", "Coverage.identifier[0]", identifier.value ?? "");
  }

  let organization: Organization | undefined;
  const payorName = xonToOrganizationParts(in1.fields[4]).name;
  if (payorName) {
    organization = { resourceType: "Organization", id: organizationId, name: payorName };
    trail.add("IN1-4", "Organization.name", payorName);
    const payorAddress = xadToAddress(in1.fields[5]);
    if (payorAddress) {
      organization.address = [payorAddress];
      trail.add("IN1-5", "Organization.address[0]", payorAddress.line?.[0] ?? "");
    }
    coverage.payor = [{ reference: `Organization/${organizationId}`, display: payorName }];
    trail.add("IN1-4", "Coverage.payor[0].display", payorName);
  }

  const policyHolderName = xonToOrganizationParts(in1.fields[11]).name;
  if (policyHolderName) {
    coverage.policyHolder = { display: policyHolderName };
    trail.add("IN1-11", "Coverage.policyHolder.display", policyHolderName);
  }

  const start = hl7DateTimeToFhir(getField(in1, 12));
  const end = hl7DateTimeToFhir(getField(in1, 13));
  if (start || end) {
    coverage.period = periodFrom(start, end);
    if (start) trail.add("IN1-12", "Coverage.period.start", start);
    if (end) trail.add("IN1-13", "Coverage.period.end", end);
  }

  const type = cweToCodeableConcept(in1.fields[15]);
  if (type) {
    coverage.type = type;
    trail.add("IN1-15", "Coverage.type", type.coding?.[0]?.code ?? "");
  }

  const subscriberName = xpnToHumanName(in1.fields[16]);
  if (subscriberName) {
    const display = [subscriberName.given?.[0], subscriberName.family].filter(Boolean).join(" ");
    coverage.subscriber = { display };
    trail.add("IN1-16", "Coverage.subscriber.display", display);
  }

  const relationshipCode = getField(in1, 17);
  const relationship = lookupVocabulary(RELATIONSHIP_TABLE, relationshipCode);
  if (relationship?.code) {
    coverage.relationship = { coding: [{ system: relationship.system, code: relationship.code, display: relationship.display }] };
    trail.add("IN1-17", "Coverage.relationship", relationship.code, `HL7 relationship "${relationshipCode}"`);
  }

  return { coverage, organization };
}

/** Coverage resources -> IN1 segments, in bundle order (IN1-1's set-id is 1-indexed by position). `organizations` supplies IN1-4/IN1-5 for each Coverage's payor, matched by reference. */
export function coveragesToIn1(coverages: Coverage[], trail: MappingTrail, organizations: Organization[] = []): Hl7Segment[] {
  return coverages.map((coverage, i) => {
    const fields: Record<number, ReturnType<typeof field>> = { 1: field(String(i + 1)) };

    if (coverage.identifier?.[0]?.value) {
      fields[2] = field(coverage.identifier[0].value);
      trail.add("Coverage.identifier[0]", "IN1-2", coverage.identifier[0].value);
    }
    const payorRef = coverage.payor[0]?.reference;
    const payorOrg = payorRef ? organizations.find((o) => `Organization/${o.id}` === payorRef) : undefined;
    const payorName = payorOrg?.name ?? coverage.payor[0]?.display;
    if (payorName) {
      fields[4] = field(payorName);
      trail.add(payorOrg ? "Organization.name" : "Coverage.payor[0].display", "IN1-4", payorName);
    }
    const payorAddress = payorOrg?.address?.[0];
    if (payorAddress) {
      fields[5] = field(
        payorAddress.line?.[0] ?? "",
        "",
        payorAddress.city ?? "",
        payorAddress.state ?? "",
        payorAddress.postalCode ?? "",
        payorAddress.country ?? "",
      );
      trail.add("Organization.address[0]", "IN1-5", [payorAddress.line?.[0], payorAddress.city].filter(Boolean).join(", "));
    }
    if (coverage.policyHolder?.display) {
      fields[11] = field(coverage.policyHolder.display);
      trail.add("Coverage.policyHolder.display", "IN1-11", coverage.policyHolder.display);
    }
    if (coverage.period?.start) {
      const hl7Date = fhirDateTimeToHl7(coverage.period.start) ?? "";
      fields[12] = field(hl7Date);
      trail.add("Coverage.period.start", "IN1-12", hl7Date);
    }
    if (coverage.period?.end) {
      const hl7Date = fhirDateTimeToHl7(coverage.period.end) ?? "";
      fields[13] = field(hl7Date);
      trail.add("Coverage.period.end", "IN1-13", hl7Date);
    }
    const typeCode = coverage.type?.coding?.[0];
    if (typeCode?.code) {
      fields[15] = field(typeCode.code, typeCode.display ?? "");
      trail.add("Coverage.type", "IN1-15", typeCode.code);
    }
    if (coverage.subscriber?.display) {
      const [given, ...rest] = coverage.subscriber.display.split(" ");
      fields[16] = field(rest.join(" ") || given || "", rest.length ? given : "");
      trail.add("Coverage.subscriber.display", "IN1-16", coverage.subscriber.display);
    }
    const relationshipCode = coverage.relationship?.coding?.[0]?.code;
    if (relationshipCode) {
      const hl7Code = reverseLookupVocabulary(RELATIONSHIP_TABLE, relationshipCode);
      if (hl7Code) {
        fields[17] = field(hl7Code);
        trail.add("Coverage.relationship", "IN1-17", hl7Code);
      }
    }

    return segment("IN1", fields);
  });
}
