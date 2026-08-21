/**
 * PRT <-> Device/PractitionerRole, per the official IG's "Segment PRT to Device Map" and
 * "Segment PRT to PractitionerRole Map" (hl7.org/fhir/uv/v2mappings/
 * ConceptMap-segment-prt-to-device.html / -to-practitionerrole.html, fetched directly). PRT
 * is a repeating, multi-purpose participant segment — a single message can carry one PRT
 * per person, organization, location, or device participant. This package dispatches each
 * repetition by which identifying field is populated: `PRT-10`/`PRT-16` (device fields)
 * build a `Device`, `PRT-5` (Person, XCN) builds a `PractitionerRole`. The `PRT`-to-
 * `CareTeam` map, and `PRT-14`'s address, aren't implemented — see the interface doc
 * comments in `fhir/types.ts` for why.
 */
import { findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import type { Hl7Field, Hl7Message, Hl7Segment } from "../hl7/types.js";
import type { Device, Location, Organization, Practitioner, PractitionerRole } from "../fhir/types.js";
import { cweToCodeableConcept, periodFrom, xcnToNameParts, xonToOrganizationParts, xtnToContactPoint } from "./datatypes.js";
import { fhirDateTimeToHl7, hl7DateTimeToFhir, practitionerFromNameParts, resolvePractitionerName, type MappingTrail } from "./common.js";

/** PRT segments -> zero or more Device resources, one per repetition where PRT-10 or PRT-16 is present. */
export function prtToDevices(message: Hl7Message, trail: MappingTrail): Device[] {
  const prtSegments = findSegments(message, "PRT").filter((prt) => getField(prt, 10) || getField(prt, 16));
  return prtSegments.map((prt, i) => buildOneDevice(prt, trail, `device-${i + 1}`));
}

function buildOneDevice(prt: Hl7Segment, trail: MappingTrail, id: string): Device {
  const device: Device = { resourceType: "Device", id };

  const deviceCode = getComponent(prt, 10, 1);
  const deviceDisplay = getComponent(prt, 10, 2);
  if (deviceCode) {
    device.identifier = [{ value: deviceCode }];
    trail.add("PRT-10", "Device.identifier[0].value", deviceCode, deviceDisplay ? `"${deviceDisplay}"` : undefined);
  }

  const udi = getField(prt, 16);
  if (udi) {
    device.udiCarrier = [{ deviceIdentifier: udi }];
    trail.add("PRT-16", "Device.udiCarrier[0].deviceIdentifier", udi);
  }

  const manufactureDate = hl7DateTimeToFhir(getField(prt, 17));
  if (manufactureDate) {
    device.manufactureDate = manufactureDate;
    trail.add("PRT-17", "Device.manufactureDate", manufactureDate);
  }

  const expirationDate = hl7DateTimeToFhir(getField(prt, 18));
  if (expirationDate) {
    device.expirationDate = expirationDate;
    trail.add("PRT-18", "Device.expirationDate", expirationDate);
  }

  const lotNumber = getField(prt, 19);
  if (lotNumber) {
    device.lotNumber = lotNumber;
    trail.add("PRT-19", "Device.lotNumber", lotNumber);
  }

  const serialNumber = getField(prt, 20);
  if (serialNumber) {
    device.serialNumber = serialNumber;
    trail.add("PRT-20", "Device.serialNumber", serialNumber);
  }

  const distinctIdentifier = getField(prt, 21);
  if (distinctIdentifier) {
    device.distinctIdentifier = distinctIdentifier;
    trail.add("PRT-21", "Device.distinctIdentifier", distinctIdentifier);
  }

  const type = cweToCodeableConcept(prt.fields[22]);
  if (type) {
    device.type = type;
    trail.add("PRT-22", "Device.type", getComponent(prt, 22, 1) ?? "");
  }

  return device;
}

/** Device resources -> PRT segments, inverse of `prtToDevices`. PRT-1 is written as a repetition counter, per the segment's own field 1 (Participation Instance ID) convention used elsewhere in this codebase's segment builders. */
export function devicesToPrt(devices: Device[], trail: MappingTrail): Hl7Segment[] {
  return devices.map((device, i) => {
    const fields: Record<number, Hl7Field> = { 1: field(String(i + 1)) };

    const identifier = device.identifier?.[0]?.value;
    if (identifier) {
      fields[10] = field(identifier);
      trail.add("Device.identifier[0].value", "PRT-10", identifier);
    }

    const udi = device.udiCarrier?.[0]?.deviceIdentifier;
    if (udi) {
      fields[16] = field(udi);
      trail.add("Device.udiCarrier[0].deviceIdentifier", "PRT-16", udi);
    }

    if (device.manufactureDate) {
      const t = fhirDateTimeToHl7(device.manufactureDate) ?? "";
      fields[17] = field(t);
      trail.add("Device.manufactureDate", "PRT-17", t);
    }

    if (device.expirationDate) {
      const t = fhirDateTimeToHl7(device.expirationDate) ?? "";
      fields[18] = field(t);
      trail.add("Device.expirationDate", "PRT-18", t);
    }

    if (device.lotNumber) {
      fields[19] = field(device.lotNumber);
      trail.add("Device.lotNumber", "PRT-19", device.lotNumber);
    }

    if (device.serialNumber) {
      fields[20] = field(device.serialNumber);
      trail.add("Device.serialNumber", "PRT-20", device.serialNumber);
    }

    if (device.distinctIdentifier) {
      fields[21] = field(device.distinctIdentifier);
      trail.add("Device.distinctIdentifier", "PRT-21", device.distinctIdentifier);
    }

    const typeCoding = device.type?.coding?.[0];
    if (typeCoding?.code) {
      fields[22] = field(typeCoding.code, typeCoding.display ?? "");
      trail.add("Device.type", "PRT-22", typeCoding.code);
    }

    return segment("PRT", fields);
  });
}

/**
 * PRT segments -> zero or more PractitionerRole resources (plus the Practitioner/
 * Organization/Location each one references), one per repetition where PRT-5 (Person,
 * XCN) is present. `PRT-7` (Organization Unit Type, nested on the referenced
 * Organization) isn't mapped — this package's `Organization` shape doesn't carry a
 * `type`, and adding one for this single field alone isn't worth the interface change.
 */
export function prtToPractitionerRoles(
  message: Hl7Message,
  trail: MappingTrail,
): { practitionerRoles: PractitionerRole[]; practitioners: Practitioner[]; organizations: Organization[]; locations: Location[] } {
  const prtSegments = findSegments(message, "PRT").filter((prt) => getComponent(prt, 5, 2));
  const practitioners: Practitioner[] = [];
  const organizations: Organization[] = [];
  const locations: Location[] = [];
  const practitionerRoles = prtSegments.map((prt, i) => {
    const { role, practitioner, organization, location } = buildOnePractitionerRole(prt, trail, i + 1);
    if (practitioner) practitioners.push(practitioner);
    if (organization) organizations.push(organization);
    if (location) locations.push(location);
    return role;
  });
  return { practitionerRoles, practitioners, organizations, locations };
}

function buildOnePractitionerRole(
  prt: Hl7Segment,
  trail: MappingTrail,
  i: number,
): { role: PractitionerRole; practitioner?: Practitioner; organization?: Organization; location?: Location } {
  const role: PractitionerRole = { resourceType: "PractitionerRole", id: `practitionerrole-${i}` };

  const roleCode = cweToCodeableConcept(prt.fields[4]);
  if (roleCode) {
    role.code = [roleCode];
    trail.add("PRT-4", "PractitionerRole.code[0]", getComponent(prt, 4, 1) ?? "");
  }

  const { family, given } = xcnToNameParts(prt.fields[5]);
  const practitioner = practitionerFromNameParts(family, given, `practitioner-role-${i}`);
  if (practitioner) {
    const display = [given, family].filter(Boolean).join(" ");
    role.practitioner = { reference: `Practitioner/${practitioner.id}`, display };
    trail.add("PRT-5", "PractitionerRole.practitioner", display);
  }

  const specialty = cweToCodeableConcept(prt.fields[6]);
  if (specialty) {
    role.specialty = [specialty];
    trail.add("PRT-6", "PractitionerRole.specialty[0]", getComponent(prt, 6, 1) ?? "");
  }

  const { name: orgName } = xonToOrganizationParts(prt.fields[8]);
  let organization: Organization | undefined;
  if (orgName) {
    organization = { resourceType: "Organization", id: `organization-role-${i}`, name: orgName };
    role.organization = { reference: `Organization/${organization.id}`, display: orgName };
    trail.add("PRT-8", "PractitionerRole.organization.display", orgName);
  }

  const locationName = getComponent(prt, 9, 1);
  let location: Location | undefined;
  if (locationName) {
    location = { resourceType: "Location", id: `location-role-${i}`, name: locationName };
    role.location = [{ reference: `Location/${location.id}`, display: locationName }];
    trail.add("PRT-9", "PractitionerRole.location[0].display", locationName, "Point of care");
  }

  const periodStart = hl7DateTimeToFhir(getField(prt, 11));
  const periodEnd = hl7DateTimeToFhir(getField(prt, 12));
  if (periodStart || periodEnd) {
    role.period = periodFrom(periodStart, periodEnd);
    if (periodStart) trail.add("PRT-11", "PractitionerRole.period.start", periodStart);
    if (periodEnd) trail.add("PRT-12", "PractitionerRole.period.end", periodEnd);
  }

  const telecom = xtnToContactPoint(prt.fields[15]);
  if (telecom) {
    role.telecom = [telecom];
    trail.add("PRT-15", "PractitionerRole.telecom[0]", telecom.value ?? "");
  }

  return { role, practitioner, organization, location };
}

/** PractitionerRole resources -> PRT segments, inverse of `prtToPractitionerRoles`. */
export function practitionerRolesToPrt(
  roles: PractitionerRole[],
  practitioners: Practitioner[],
  organizations: Organization[],
  locations: Location[],
  trail: MappingTrail,
): Hl7Segment[] {
  return roles.map((role, i) => {
    const fields: Record<number, Hl7Field> = { 1: field(String(i + 1)) };

    const roleCoding = role.code?.[0]?.coding?.[0];
    if (roleCoding?.code) {
      fields[4] = field(roleCoding.code, roleCoding.display ?? "");
      trail.add("PractitionerRole.code[0]", "PRT-4", roleCoding.code);
    }

    const person = resolvePractitionerName(role.practitioner, practitioners);
    if (person?.family) {
      fields[5] = field("", person.family, person.given ?? "");
      trail.add("PractitionerRole.practitioner", "PRT-5", [person.given, person.family].filter(Boolean).join(" "));
    }

    const specialtyCoding = role.specialty?.[0]?.coding?.[0];
    if (specialtyCoding?.code) {
      fields[6] = field(specialtyCoding.code, specialtyCoding.display ?? "");
      trail.add("PractitionerRole.specialty[0]", "PRT-6", specialtyCoding.code);
    }

    const orgName = organizations.find((o) => `Organization/${o.id}` === role.organization?.reference)?.name ?? role.organization?.display;
    if (orgName) {
      fields[8] = field(orgName);
      trail.add("PractitionerRole.organization.display", "PRT-8", orgName);
    }

    const locationName = locations.find((l) => `Location/${l.id}` === role.location?.[0]?.reference)?.name ?? role.location?.[0]?.display;
    if (locationName) {
      fields[9] = field(locationName);
      trail.add("PractitionerRole.location[0].display", "PRT-9", locationName);
    }

    if (role.period?.start) {
      const t = fhirDateTimeToHl7(role.period.start) ?? "";
      fields[11] = field(t);
      trail.add("PractitionerRole.period.start", "PRT-11", t);
    }
    if (role.period?.end) {
      const t = fhirDateTimeToHl7(role.period.end) ?? "";
      fields[12] = field(t);
      trail.add("PractitionerRole.period.end", "PRT-12", t);
    }

    const telecom = role.telecom?.[0];
    if (telecom?.value) {
      fields[15] = field(telecom.value);
      trail.add("PractitionerRole.telecom[0]", "PRT-15", telecom.value);
    }

    return segment("PRT", fields);
  });
}
