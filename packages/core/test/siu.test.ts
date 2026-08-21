import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToSiu } from "../src/mapping/siu.js";
import type { Appointment, Bundle, MessageHeader, Patient } from "../src/fhir/types.js";

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
    expect(types).toEqual(["Patient", "Appointment", "MessageHeader"]);
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

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("SCH");
    expect(messageHeader.destination?.[0]?.name).toBe("HIS");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "S12",
      display: "SIU^S12",
    });
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

const SIU_S12_WITH_AIS_NTE = [
  "MSH|^~\\&|SCH|CLINIC|HIS|HOSP|20240104080000||SIU^S12|MSG011|P|2.5",
  "SCH|APT001|APT001|||||CHECKUP^Annual physical^L|ROUTINE^Routine appointment^L|30|MIN|^^^20240110090000^20240110093000||||||||||||||BOOKED",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "AIL|1||OFFICE1^Clinic Room 1",
  "AIP|1||1234^Smith^Jane^M^MD",
  "AIS|1||GENCHECK^General Checkup^L",
  "NTE|1||Please arrive 15 minutes early with insurance card",
].join("\r");

describe("AIS-3/NTE-3 -> Appointment.serviceType/.comment", () => {
  it("maps AIS-3 to serviceType and NTE-3 to comment", () => {
    const result = translateHl7ToFhir(SIU_S12_WITH_AIS_NTE);
    const bundle = JSON.parse(result.translated) as Bundle;
    const appt = bundle.entry.find((e) => e.resource.resourceType === "Appointment")!.resource as Appointment;
    expect(appt.serviceType?.[0]?.coding?.[0]).toEqual({ code: "GENCHECK", display: "General Checkup" });
    expect(appt.comment).toBe("Please arrive 15 minutes early with insurance card");
  });

  it("joins multiple NTE segments into one comment, newline-separated", () => {
    const withTwoNotes = [...SIU_S12_WITH_AIS_NTE.split("\r"), "NTE|2||Bring your ID"].join("\r");
    const result = translateHl7ToFhir(withTwoNotes);
    const bundle = JSON.parse(result.translated) as Bundle;
    const appt = bundle.entry.find((e) => e.resource.resourceType === "Appointment")!.resource as Appointment;
    expect(appt.comment).toBe("Please arrive 15 minutes early with insurance card\nBring your ID");
  });

  it("round-trips serviceType and comment back to AIS-3/NTE-3", () => {
    const forward = translateHl7ToFhir(SIU_S12_WITH_AIS_NTE);
    const reverse = translateFhirToHl7(forward.translated);
    const aisLine = reverse.translated.split("\r").find((l) => l.startsWith("AIS|"));
    expect(aisLine).toContain("GENCHECK^General Checkup");
    const nteLine = reverse.translated.split("\r").find((l) => l.startsWith("NTE|"));
    expect(nteLine).toContain("Please arrive 15 minutes early with insurance card");
  });

  it("omits AIS/NTE segments entirely when serviceType/comment aren't set", () => {
    const forward = translateHl7ToFhir(SIU_S12);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).not.toContain("AIS|");
    expect(reverse.translated).not.toContain("NTE|");
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

describe("SCH-1/SCH-2 -> Appointment.identifier", () => {
  it("maps placer and filler appointment IDs to two identifiers", () => {
    const result = translateHl7ToFhir(
      [
        "MSH|^~\\&|SCH|CLINIC|HIS|HOSP|20240104080000||SIU^S12|MSG011|P|2.5",
        "SCH|APT001|APT002|||||CHECKUP^Annual physical^L|ROUTINE^Routine appointment^L|30|MIN|^^^20240110090000^20240110093000||||||||||||||BOOKED",
        "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      ].join("\r"),
    );
    const bundle = JSON.parse(result.translated) as Bundle;
    const appt = bundle.entry.find((e) => e.resource.resourceType === "Appointment")!.resource as Appointment;
    expect(appt.identifier).toEqual([
      { value: "APT001", type: { coding: [{ code: "PLAC" }] } },
      { value: "APT002", type: { coding: [{ code: "FILL" }] } },
    ]);
  });

  it("round-trips both identifiers back to SCH-1/SCH-2 instead of synthesizing new ones", () => {
    const forward = translateHl7ToFhir(
      [
        "MSH|^~\\&|SCH|CLINIC|HIS|HOSP|20240104080000||SIU^S12|MSG011|P|2.5",
        "SCH|APT001|APT002|||||CHECKUP^Annual physical^L|ROUTINE^Routine appointment^L|30|MIN|^^^20240110090000^20240110093000||||||||||||||BOOKED",
        "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      ].join("\r"),
    );
    const reverse = translateFhirToHl7(forward.translated);
    const schLine = reverse.translated.split("\r").find((l) => l.startsWith("SCH|"));
    expect(schLine).toMatch(/^SCH\|APT001\|APT002\|/);
  });
});
