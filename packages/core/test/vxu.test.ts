import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToVxu } from "../src/mapping/vxu.js";
import type { Bundle, Immunization, MessageHeader, Patient, Practitioner } from "../src/fhir/types.js";

const VXU_V04 = [
  "MSH|^~\\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "RXA|0|1|20240103090000||08^Hepatitis B pediatric^CVX|0.5|mL^milliliter^UCUM|||1234^Smith^Jane^M^MD|||||LOT12345|20250601|MSD^Merck^MVX|||CP",
  "OBX|1|CE|64994-7^Vaccine funding^LN||V01^Public^HL70396",
].join("\r");

describe("VXU^V04 -> FHIR", () => {
  const result = translateHl7ToFhir(VXU_V04);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient, an Immunization, and a Practitioner", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "Immunization", "Practitioner", "MessageHeader"]);
  });

  it("maps PID demographics correctly", () => {
    const patient = bundle.entry[0]!.resource as Patient;
    expect(patient.identifier?.[0]?.value).toBe("MRN12345");
    expect(patient.name?.[0]).toEqual({ family: "Doe", given: ["John", "A"] });
  });

  it("maps RXA into an Immunization", () => {
    const imm = bundle.entry[1]!.resource as Immunization;
    expect(imm.status).toBe("completed");
    expect(imm.vaccineCode.coding?.[0]).toEqual({
      system: "http://hl7.org/fhir/sid/cvx",
      code: "08",
      display: "Hepatitis B pediatric",
    });
    expect(imm.occurrenceDateTime).toBe("2024-01-03T09:00:00Z");
    expect(imm.doseQuantity).toEqual({ value: 0.5, unit: "mL" });
    expect(imm.lotNumber).toBe("LOT12345");
    expect(imm.expirationDate).toBe("2025-06-01");
    expect(imm.manufacturer?.display).toBe("Merck");
    expect(imm.performer?.[0]?.actor?.display).toBe("Jane Smith");
  });

  it("emits a warning for the unmapped OBX segment instead of dropping it silently", () => {
    expect(result.warnings.some((w) => w.includes("OBX"))).toBe(true);
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(5);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
  });

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("VIS");
    expect(messageHeader.destination?.[0]?.name).toBe("HIS");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "V04",
      display: "VXU^V04",
    });
  });
});

describe("FHIR Patient+Immunization -> VXU^V04", () => {
  it("round-trips the key vaccine fields", () => {
    const forward = translateHl7ToFhir(VXU_V04);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.startsWith("MSH|^~\\&|")).toBe(true);
    expect(reverse.translated).toContain("VXU^V04");
    expect(reverse.translated).toContain("MRN12345");
    expect(reverse.translated).toContain("08^Hepatitis B pediatric^CVX");
    expect(reverse.translated).toContain("LOT12345");
  });

  it("throws when the bundle has no Immunization resource", () => {
    // A Patient-only bundle routes to the ADT mapper (see registry.ts's detectTargetMessageType),
    // so this branch of fhirToVxu is unreachable through translateFhirToHl7 — call it directly.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "patient-1" } }],
    };
    expect(() => fhirToVxu(bundle)).toThrow(/Immunization/);
  });

  it("throws when the bundle has no Patient resource", () => {
    // An Immunization-only bundle still routes to the VXU mapper (see
    // registry.ts's detectTargetMessageType), so this branch is reachable through the public API.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Immunization", id: "immunization-1", status: "completed", vaccineCode: {} } }],
    };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow(/Patient/);
  });

  it.each([
    ["not-done", "RE"],
    ["entered-in-error", "NA"],
  ] as const)("maps Immunization.status %s back to completion status %s", (status, completionStatus) => {
    const forward = translateHl7ToFhir(VXU_V04);
    const bundle = JSON.parse(forward.translated) as Bundle;
    const imm = bundle.entry[1]!.resource as Immunization;
    imm.status = status;
    const reverse = translateFhirToHl7(JSON.stringify(bundle));
    expect(reverse.mappings.find((m) => m.target === "RXA-20")?.value).toBe(completionStatus);
  });
});

describe("malformed VXU input", () => {
  it("throws a typed error instead of guessing when the RXA segment is absent", () => {
    const noRxa = [
      "MSH|^~\\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    ].join("\r");
    expect(() => translateHl7ToFhir(noRxa)).toThrow(/RXA/);
  });
});

describe("RXA-18/RXA-19/RXA-22 -> Immunization.statusReason/.reasonCode/.recorded", () => {
  const VXU_WITH_REASON = [
    "MSH|^~\\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "RXA|0|1|20240103090000||08^Hepatitis B pediatric^CVX|0.5|mL^milliliter^UCUM|||1234^Smith^Jane^M^MD|||||LOT12345|20250601|MSD^Merck^MVX||01^Routine immunization^HL70162|CP||20240103090000",
  ].join("\r");

  it("maps RXA-19 to reasonCode[0] and RXA-22 to recorded", () => {
    const result = translateHl7ToFhir(VXU_WITH_REASON);
    const bundle = JSON.parse(result.translated) as Bundle;
    const imm = bundle.entry[1]!.resource as Immunization;
    expect(imm.reasonCode?.[0]?.coding?.[0]).toEqual({ code: "01", display: "Routine immunization" });
    expect(imm.recorded).toBe("2024-01-03T09:00:00Z");
  });

  it("maps RXA-18 to statusReason when present", () => {
    const notDone = [
      "MSH|^~\\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "RXA|0|1|20240103090000||08^Hepatitis B pediatric^CVX|0.5|mL^milliliter^UCUM|||1234^Smith^Jane^M^MD||||||||01114^Patient refusal^NIP0006||RE",
    ].join("\r");
    const result = translateHl7ToFhir(notDone);
    const bundle = JSON.parse(result.translated) as Bundle;
    const imm = bundle.entry[1]!.resource as Immunization;
    expect(imm.statusReason?.coding?.[0]).toEqual({ code: "01114", display: "Patient refusal" });
  });

  it("round-trips reasonCode and recorded back to RXA-19/RXA-22", () => {
    const forward = translateHl7ToFhir(VXU_WITH_REASON);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("01");
    expect(reverse.translated).toContain("Routine immunization");
    expect(reverse.translated).toContain("20240103090000");
  });
});

describe("RXA-27 -> Immunization.location", () => {
  const VXU_WITH_LOCATION = [
    "MSH|^~\\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "RXA|0|1|20240103090000||08^Hepatitis B pediatric^CVX|0.5|mL^milliliter^UCUM|||1234^Smith^Jane^M^MD|||||LOT12345|20250601|MSD^Merck^MVX||01^Routine immunization^HL70162|CP||20240103090000|||||PEDS^Pediatric Clinic^HOSP",
  ].join("\r");

  it("maps the point-of-care component to location.display", () => {
    const result = translateHl7ToFhir(VXU_WITH_LOCATION);
    const bundle = JSON.parse(result.translated) as Bundle;
    const imm = bundle.entry[1]!.resource as Immunization;
    expect(imm.location?.display).toBe("PEDS");
  });

  it("round-trips location back to RXA-27", () => {
    const forward = translateHl7ToFhir(VXU_WITH_LOCATION);
    const reverse = translateFhirToHl7(forward.translated);
    const rxaLine = reverse.translated.split("\r").find((l) => l.startsWith("RXA|"));
    expect(rxaLine).toContain("PEDS");
  });
});

describe("RXA-10 -> Immunization.performer (a real Practitioner resource)", () => {
  const VXU_WITH_PERFORMER = [
    "MSH|^~\\&|VIS|CLINIC|HIS|HOSP|20240103090000||VXU^V04|MSG010|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "RXA|0|1|20240103090000||08^Hepatitis B pediatric^CVX|0.5|mL^milliliter^UCUM|||1234^Smith^Jane^M^MD",
  ].join("\r");

  it("builds a Practitioner from the administering provider, referenced from Immunization.performer[0].actor", () => {
    const result = translateHl7ToFhir(VXU_WITH_PERFORMER);
    const bundle = JSON.parse(result.translated) as Bundle;
    const imm = bundle.entry.find((e) => e.resource.resourceType === "Immunization")!.resource as Immunization;
    const practitioner = bundle.entry.find((e) => e.resource.resourceType === "Practitioner")!.resource as Practitioner;
    expect(practitioner.name?.[0]).toEqual({ family: "Smith", given: ["Jane"] });
    expect(imm.performer?.[0]?.actor).toEqual({ reference: `Practitioner/${practitioner.id}`, display: "Jane Smith" });
  });

  it("round-trips the performer's structured name back to RXA-10", () => {
    const forward = translateHl7ToFhir(VXU_WITH_PERFORMER);
    const reverse = translateFhirToHl7(forward.translated);
    const rxaLine = reverse.translated.split("\r").find((l) => l.startsWith("RXA|"));
    expect(rxaLine).toContain("Smith^Jane");
  });
});
