import { findSegment, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Appointment, Bundle, Patient } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { CODE_SYSTEMS, MappingTrail, buildMsh, fhirDateTimeToHl7, hl7DateTimeToFhir, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";

const KNOWN_SIU_SEGMENTS = new Set(["MSH", "SCH", "PID", "AIL", "AIP"]);

const FILLER_STATUS_TO_APPOINTMENT_STATUS: Record<string, Appointment["status"]> = {
  BOOKED: "booked",
  CANCELLED: "cancelled",
  COMPLETE: "fulfilled",
  PENDING: "proposed",
};
const APPOINTMENT_STATUS_TO_FILLER_STATUS: Record<string, string> = {
  booked: "BOOKED",
  cancelled: "CANCELLED",
  fulfilled: "COMPLETE",
  proposed: "PENDING",
};

/** SIU^S12 -> a Bundle with a Patient and an Appointment built from SCH (+AIL location, AIP practitioner). Throws `FhirValidationError` when SCH or PID is missing. */
export function siuToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const sch = findSegment(message, "SCH");
  const pid = findSegment(message, "PID");
  const ail = findSegment(message, "AIL");
  const aip = findSegment(message, "AIP");

  if (!sch) throw new FhirValidationError("SIU message is missing a required SCH segment");
  if (!pid) throw new FhirValidationError("SIU message is missing a required PID segment");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const fillerStatus = getField(sch, 25);
  const appointment: Appointment = {
    resourceType: "Appointment",
    id: "appointment-1",
    status: (fillerStatus ? FILLER_STATUS_TO_APPOINTMENT_STATUS[fillerStatus] : undefined) ?? "booked",
    participant: [{ actor: { reference: `Patient/${patient.id}` }, status: "accepted" }],
  };
  if (fillerStatus) trail.add("SCH-25", "Appointment.status", appointment.status, `HL7 filler status code "${fillerStatus}"`);

  const reasonCode = getComponent(sch, 7, 1);
  const reasonDisplay = getComponent(sch, 7, 2);
  if (reasonCode) {
    appointment.reasonCode = [{ coding: [{ code: reasonCode, display: reasonDisplay }], text: reasonDisplay }];
    trail.add("SCH-7", "Appointment.reasonCode[0]", `${reasonCode} (${reasonDisplay ?? "n/a"})`);
  }

  const typeCode = getComponent(sch, 8, 1);
  const typeDisplay = getComponent(sch, 8, 2);
  if (typeCode) {
    appointment.appointmentType = {
      coding: [{ system: CODE_SYSTEMS.appointmentType, code: typeCode, display: typeDisplay }],
      text: typeDisplay,
    };
    trail.add("SCH-8", "Appointment.appointmentType", `${typeCode} (${typeDisplay ?? "n/a"})`);
  }

  const duration = getField(sch, 9);
  if (duration) {
    appointment.minutesDuration = Number(duration);
    trail.add("SCH-9", "Appointment.minutesDuration", duration, `Units "${getField(sch, 10) ?? "n/a"}"`);
  }

  const start = hl7DateTimeToFhir(getComponent(sch, 11, 4));
  if (start) {
    appointment.start = start;
    trail.add("SCH-11", "Appointment.start", start);
  }
  const end = hl7DateTimeToFhir(getComponent(sch, 11, 5));
  if (end) {
    appointment.end = end;
    trail.add("SCH-11", "Appointment.end", end);
  }

  const locationDisplay = getComponent(ail, 3, 2) ?? getComponent(ail, 3, 1);
  if (locationDisplay) {
    appointment.participant.push({ actor: { display: locationDisplay }, status: "accepted" });
    trail.add("AIL-3", "Appointment.participant[].actor.display", locationDisplay, "Scheduled location");
  } else if (!ail) {
    trail.warn("No AIL segment present — location participant omitted");
  }

  const practitionerFamily = getComponent(aip, 3, 2);
  const practitionerGiven = getComponent(aip, 3, 3);
  if (practitionerFamily) {
    const display = [practitionerGiven, practitionerFamily].filter(Boolean).join(" ");
    appointment.participant.push({ actor: { display }, status: "accepted" });
    trail.add("AIP-3", "Appointment.participant[].actor.display", display, "Scheduled practitioner");
  } else if (!aip) {
    trail.warn("No AIP segment present — practitioner participant omitted");
  }

  bundle.entry.push({ resource: appointment });

  for (const seg of message.segments) {
    if (!KNOWN_SIU_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  return { bundle, trail };
}

/** Patient+Appointment -> a SIU^S12 message. Throws `FhirValidationError` when the bundle has no Patient or no Appointment. */
export function fhirToSiu(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")?.resource as Patient | undefined;
  const appointment = bundle.entry.find((e) => e.resource.resourceType === "Appointment")?.resource as Appointment | undefined;

  if (!patient) throw new FhirValidationError("Bundle must contain a Patient resource to translate to a SIU message");
  if (!appointment) throw new FhirValidationError("Bundle must contain an Appointment resource to translate to a SIU message");

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();

  const msh = buildMsh(trail, "SIU", "S12", controlId, now);

  const schFields: Record<number, Hl7Field> = { 1: field(`APT${controlId.slice(-6)}`), 2: field(`APT${controlId.slice(-6)}`) };
  const reasonCoding = appointment.reasonCode?.[0]?.coding?.[0];
  if (reasonCoding) {
    schFields[7] = field(reasonCoding.code ?? "", reasonCoding.display ?? "");
    trail.add("Appointment.reasonCode[0]", "SCH-7", `${reasonCoding.code} (${reasonCoding.display ?? "n/a"})`);
  }
  const typeCoding = appointment.appointmentType?.coding?.[0];
  if (typeCoding) {
    schFields[8] = field(typeCoding.code ?? "", typeCoding.display ?? "");
    trail.add("Appointment.appointmentType", "SCH-8", `${typeCoding.code} (${typeCoding.display ?? "n/a"})`);
  }
  if (appointment.minutesDuration !== undefined) {
    schFields[9] = field(String(appointment.minutesDuration));
    schFields[10] = field("MIN");
    trail.add("Appointment.minutesDuration", "SCH-9", String(appointment.minutesDuration));
  }
  if (appointment.start || appointment.end) {
    const startHl7 = appointment.start ? (fhirDateTimeToHl7(appointment.start) ?? "") : "";
    const endHl7 = appointment.end ? (fhirDateTimeToHl7(appointment.end) ?? "") : "";
    schFields[11] = field("", "", "", startHl7, endHl7);
    if (appointment.start) trail.add("Appointment.start", "SCH-11", startHl7);
    if (appointment.end) trail.add("Appointment.end", "SCH-11", endHl7);
  }
  const fillerStatus = APPOINTMENT_STATUS_TO_FILLER_STATUS[appointment.status] ?? "BOOKED";
  schFields[25] = field(fillerStatus);
  trail.add("Appointment.status", "SCH-25", fillerStatus);
  const sch = segment("SCH", schFields);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const segments = [msh, sch, pid];

  // The first non-patient participant (if any) is written back as the AIL location; any
  // further participants (e.g. a practitioner) can't be distinguished from a location by
  // shape alone and are warned about instead of guessed at.
  const [locationParticipant, ...extraParticipants] = appointment.participant.filter((p) => !p.actor?.reference);
  if (locationParticipant?.actor?.display) {
    segments.push(segment("AIL", { 1: field("1"), 3: field("", locationParticipant.actor.display) }));
    trail.add("Appointment.participant[].actor.display", "AIL-3", locationParticipant.actor.display);
  }
  for (const extra of extraParticipants) {
    trail.warn(
      `Additional Appointment.participant "${extra.actor?.display ?? "unknown"}" has no unambiguous HL7v2 AIL/AIP mapping and was skipped`,
    );
  }

  for (const entry of bundle.entry) {
    if (!["Patient", "Appointment"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 SIU mapping and was skipped`);
    }
  }

  return { message: { segments, delimiters, messageType: "SIU^S12" }, trail };
}
