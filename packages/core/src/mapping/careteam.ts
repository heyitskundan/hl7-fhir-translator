/**
 * ROL (+ IN3-21) <-> CareTeam, per the official IG's "Segment ROL to CareTeam Map" and
 * "Segment IN3 to CareTeam Map" (hl7.org/fhir/uv/v2mappings/ConceptMap-segment-rol-to-
 * careteam.html / -in3-to-careteam.html, fetched directly). `ROL` is a repeating segment —
 * one message can carry zero or more, each describing one team member — so this builds at
 * most one `CareTeam` per message, with one `participant` per `ROL` repetition plus, when
 * `IN3-21` (Case Manager) is present, one more member-less participant carrying just a
 * role text. `CareTeam.status` is always synthesized as `"active"` — neither segment
 * carries a status signal.
 */
import { findSegment, findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { CareTeam, CodeableConcept, ContactPoint, Organization, Patient, Period, Practitioner, Reference } from "../fhir/types.js";
import { cweToCodeableConcept, periodFrom, xcnToNameParts, xonToOrganizationParts, xtnToContactPoint } from "./datatypes.js";
import { fhirDateTimeToHl7, hl7DateTimeToFhir, practitionerFromNameParts, resolvePractitionerName, type MappingTrail } from "./common.js";

type CareTeamParticipant = { role?: CodeableConcept[]; member?: Reference; onBehalfOf?: Reference; period?: Period };

/** ROL segments (+ IN3-21) -> at most one CareTeam, plus the Practitioner/Organization resources its participants reference. Returns `{}` when neither ROL nor IN3-21 is present. */
export function rolToCareTeam(
  message: Hl7Message,
  patient: Patient,
  trail: MappingTrail,
): { careTeam?: CareTeam; practitioners: Practitioner[]; organizations: Organization[] } {
  const rolSegments = findSegments(message, "ROL");
  const in3 = findSegment(message, "IN3");
  const caseManager = in3 ? getField(in3, 21) : undefined;

  if (rolSegments.length === 0 && !caseManager) return { practitioners: [], organizations: [] };

  const practitioners: Practitioner[] = [];
  const organizations: Organization[] = [];
  const participants: CareTeamParticipant[] = [];
  const reasonCodes: CodeableConcept[] = [];
  const telecoms: ContactPoint[] = [];

  rolSegments.forEach((rol, i) => {
    const participant: CareTeamParticipant = {};

    const primaryRole = cweToCodeableConcept(rol.fields[3]);
    const providerType = cweToCodeableConcept(rol.fields[9]);
    const roles = [primaryRole, providerType].filter((r): r is CodeableConcept => r !== undefined);
    if (roles.length > 0) {
      participant.role = roles;
      trail.add("ROL-3", "CareTeam.participant[].role[0]", getComponent(rol, 3, 1) ?? "");
      if (providerType) trail.add("ROL-9", "CareTeam.participant[].role[1]", getComponent(rol, 9, 1) ?? "");
    }

    const { family, given } = xcnToNameParts(rol.fields[4]);
    const practitioner = practitionerFromNameParts(family, given, `practitioner-team-${i + 1}`);
    if (practitioner) {
      const display = [given, family].filter(Boolean).join(" ");
      practitioners.push(practitioner);
      participant.member = { reference: `Practitioner/${practitioner.id}`, display };
      trail.add("ROL-4", "CareTeam.participant[].member", display);
    }

    const periodStart = hl7DateTimeToFhir(getField(rol, 5));
    const periodEnd = hl7DateTimeToFhir(getField(rol, 6));
    if (periodStart || periodEnd) {
      participant.period = periodFrom(periodStart, periodEnd);
      if (periodStart) trail.add("ROL-5", "CareTeam.participant[].period.start", periodStart);
      if (periodEnd) trail.add("ROL-6", "CareTeam.participant[].period.end", periodEnd);
    }

    const { name: orgName } = xonToOrganizationParts(rol.fields[14]);
    if (orgName) {
      const organization: Organization = { resourceType: "Organization", id: `organization-team-${i + 1}`, name: orgName };
      organizations.push(organization);
      participant.onBehalfOf = { reference: `Organization/${organization.id}`, display: orgName };
      trail.add("ROL-14", "CareTeam.participant[].onBehalfOf", orgName);
    }

    participants.push(participant);

    const reasonCode = cweToCodeableConcept(rol.fields[8]);
    if (reasonCode) {
      reasonCodes.push(reasonCode);
      trail.add("ROL-8", "CareTeam.reasonCode[]", getComponent(rol, 8, 1) ?? "");
    }

    const telecom = xtnToContactPoint(rol.fields[12]);
    if (telecom) {
      telecoms.push(telecom);
      trail.add("ROL-12", "CareTeam.telecom[]", telecom.value ?? "");
    }
  });

  if (caseManager) {
    participants.push({ role: [{ text: caseManager }] });
    trail.add("IN3-21", "CareTeam.participant[].role[0].text", caseManager, "Case Manager");
  }

  const careTeam: CareTeam = {
    resourceType: "CareTeam",
    id: "careteam-1",
    status: "active",
    subject: { reference: `Patient/${patient.id}` },
  };
  if (participants.length > 0) careTeam.participant = participants;
  if (reasonCodes.length > 0) careTeam.reasonCode = reasonCodes;
  if (telecoms.length > 0) careTeam.telecom = telecoms;

  return { careTeam, practitioners, organizations };
}

/**
 * A CareTeam -> ROL segments (+ an IN3 segment), inverse of `rolToCareTeam`. A participant
 * with no `member` and a text-only `role[0]` (no `coding`) is treated as the Case Manager
 * entry and written back to `IN3-21` instead of a `ROL` segment. `CareTeam.reasonCode[0]`
 * and `telecom[0]` are written onto the first `ROL` segment only, since neither field is
 * per-participant on the FHIR side.
 */
export function careTeamToRolAndIn3(
  careTeam: CareTeam | undefined,
  practitioners: Practitioner[],
  organizations: Organization[],
  trail: MappingTrail,
): { rolSegments: Hl7Segment[]; in3?: Hl7Segment } {
  if (!careTeam?.participant) return { rolSegments: [] };

  const rolSegments: Hl7Segment[] = [];
  let in3: Hl7Segment | undefined;

  for (const participant of careTeam.participant) {
    if (!participant.member && participant.role?.[0]?.text && !participant.role[0].coding) {
      in3 = segment("IN3", { 1: field("1"), 21: field(participant.role[0].text) });
      trail.add("CareTeam.participant[].role[0].text", "IN3-21", participant.role[0].text);
      continue;
    }

    const fields: Record<number, Hl7Field> = { 1: field(String(rolSegments.length + 1)) };

    const [primaryRole, providerType] = participant.role ?? [];
    const primaryCoding = primaryRole?.coding?.[0];
    if (primaryCoding?.code) {
      fields[3] = field(primaryCoding.code, primaryCoding.display ?? "");
      trail.add("CareTeam.participant[].role[0]", "ROL-3", primaryCoding.code);
    }
    const providerCoding = providerType?.coding?.[0];
    if (providerCoding?.code) {
      fields[9] = field(providerCoding.code, providerCoding.display ?? "");
      trail.add("CareTeam.participant[].role[1]", "ROL-9", providerCoding.code);
    }

    const person = resolvePractitionerName(participant.member, practitioners);
    if (person?.family) {
      fields[4] = field("", person.family, person.given ?? "");
      trail.add("CareTeam.participant[].member", "ROL-4", [person.given, person.family].filter(Boolean).join(" "));
    }

    if (participant.period?.start) {
      const t = fhirDateTimeToHl7(participant.period.start) ?? "";
      fields[5] = field(t);
      trail.add("CareTeam.participant[].period.start", "ROL-5", t);
    }
    if (participant.period?.end) {
      const t = fhirDateTimeToHl7(participant.period.end) ?? "";
      fields[6] = field(t);
      trail.add("CareTeam.participant[].period.end", "ROL-6", t);
    }

    const orgName =
      organizations.find((o) => `Organization/${o.id}` === participant.onBehalfOf?.reference)?.name ?? participant.onBehalfOf?.display;
    if (orgName) {
      fields[14] = field(orgName);
      trail.add("CareTeam.participant[].onBehalfOf", "ROL-14", orgName);
    }

    if (rolSegments.length === 0) {
      const reasonCoding = careTeam.reasonCode?.[0]?.coding?.[0];
      if (reasonCoding?.code) {
        fields[8] = field(reasonCoding.code, reasonCoding.display ?? "");
        trail.add("CareTeam.reasonCode[0]", "ROL-8", reasonCoding.code);
      }
      const telecomValue = careTeam.telecom?.[0]?.value;
      if (telecomValue) {
        fields[12] = field(telecomValue);
        trail.add("CareTeam.telecom[0]", "ROL-12", telecomValue);
      }
    }

    rolSegments.push(segment("ROL", fields));
  }

  return { rolSegments, in3 };
}
