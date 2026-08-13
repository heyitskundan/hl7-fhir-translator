import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToSiu } from "../src/mapping/siu.js";
import type { Appointment, Bundle, Patient } from "../src/fhir/types.js";

const SIU_S12 = [
  "MSH|^~\\&|SCH|CLINIC|HIS|HOSP|20240104080000||SIU^S12|MSG011|P|2.5",
  "SCH|APT001|APT001|||||CHECKUP^Annual physical^L|ROUTINE^Routine appointment^L|30|MIN|^^^20240110090000^20240110093000||||||||||||||BOOKED",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "AIL|1||OFFICE1^Clinic Room 1",
  "AIP|1||1234^Smith^Jane^M^MD",
].join("\r");

describe("SIU^S12 -> FHIR", () => {
  const result = translateHl7ToFhir(SIU_S12);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient and an Appointment", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "Appointment"]);
  });

  it("maps PID demographics correctly", () => {
    const patient = bundle.entry[0]!.resource as Patient;
    expect(patient.identifier?.[0]?.value).toBe("MRN12345");
  });

  it("maps SCH/AIL/AIP into an Appointment", () => {
    const appt = bundle.entry[1]!.resource as Appointment;
    expect(appt.status).toBe("booked");
    expect(appt.reasonCode?.[0]?.text).toBe("Annual physical");
    expect(appt.appointmentType?.coding?.[0]?.code).toBe("ROUTINE");
    expect(appt.minutesDuration).toBe(30);
    expect(appt.start).toBe("2024-01-10T09:00:00Z");
    expect(appt.end).toBe("2024-01-10T09:30:00Z");
    const displays = appt.participant.map((p) => p.actor?.display).filter(Boolean);
    expect(displays).toContain("Clinic Room 1");
    expect(displays).toContain("Jane Smith");
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(5);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
  });
});

describe("FHIR Patient+Appointment -> SIU^S12", () => {
  it("round-trips the key scheduling fields", () => {
    const forward = translateHl7ToFhir(SIU_S12);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.startsWith("MSH|^~\\&|")).toBe(true);
    expect(reverse.translated).toContain("SIU^S12");
    expect(reverse.translated).toContain("MRN12345");
    expect(reverse.translated).toContain("BOOKED");
  });

  it("throws when the bundle has no Appointment resource", () => {
    // A Patient-only bundle routes to the ADT mapper (see registry.ts's detectTargetMessageType),
    // so this branch of fhirToSiu is unreachable through translateFhirToHl7 — call it directly.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "patient-1" } }],
    };
    expect(() => fhirToSiu(bundle)).toThrow(/Appointment/);
  });

  it("throws when the bundle has no Patient resource", () => {
    // An Appointment-only bundle still routes to the SIU mapper (see
    // registry.ts's detectTargetMessageType), so this branch is reachable through the public API.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Appointment", id: "appointment-1", status: "booked", participant: [] } }],
    };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow(/Patient/);
  });

  it.each([
    ["cancelled", "CANCELLED"],
    ["fulfilled", "COMPLETE"],
    ["proposed", "PENDING"],
  ] as const)("maps Appointment.status %s back to filler status %s", (status, fillerStatus) => {
    const forward = translateHl7ToFhir(SIU_S12);
    const bundle = JSON.parse(forward.translated) as Bundle;
    const appt = bundle.entry[1]!.resource as Appointment;
    appt.status = status;
    const reverse = translateFhirToHl7(JSON.stringify(bundle));
    expect(reverse.mappings.find((m) => m.target === "SCH-25")?.value).toBe(fillerStatus);
  });
});

describe("malformed SIU input", () => {
  it("throws a typed error instead of guessing when the SCH segment is absent", () => {
    const noSch = [
      "MSH|^~\\&|SCH|CLINIC|HIS|HOSP|20240104080000||SIU^S12|MSG011|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    ].join("\r");
    expect(() => translateHl7ToFhir(noSch)).toThrow(/SCH/);
  });
});
