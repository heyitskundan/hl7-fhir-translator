import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import type { Bundle, Encounter, Patient } from "../src/fhir/types.js";

const ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "NK1|1|Doe^Jane|SPO",
].join("\r");

describe("ADT^A01 -> FHIR", () => {
  const result = translateHl7ToFhir(ADT_A01);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient and an Encounter", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "Encounter"]);
  });

  it("maps PID demographics correctly", () => {
    const patient = bundle.entry[0]!.resource as Patient;
    expect(patient.identifier?.[0]?.value).toBe("MRN12345");
    expect(patient.name?.[0]).toEqual({ family: "Doe", given: ["John", "A"] });
    expect(patient.birthDate).toBe("1980-05-15");
    expect(patient.gender).toBe("male");
    expect(patient.address?.[0]?.city).toBe("Springfield");
  });

  it("maps PV1/EVN into an Encounter", () => {
    const encounter = bundle.entry[1]!.resource as Encounter;
    expect(encounter.class.code).toBe("IMP");
    expect(encounter.location?.[0]?.location?.display).toBe("ICU");
    expect(encounter.participant?.[0]?.individual?.display).toBe("Jane Smith");
    expect(encounter.period?.start).toBe("2024-01-01T12:00:00Z");
  });

  it("emits a warning for the unmapped NK1 segment instead of dropping it silently", () => {
    expect(result.warnings.some((w) => w.includes("NK1"))).toBe(true);
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(5);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
  });
});

describe("FHIR Patient(+Encounter) -> ADT^A01", () => {
  it("round-trips the key demographic and encounter fields", () => {
    const forward = translateHl7ToFhir(ADT_A01);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.startsWith("MSH|^~\\&|")).toBe(true);
    expect(reverse.translated).toContain("ADT^A01");
    expect(reverse.translated).toContain("MRN12345");
    expect(reverse.translated).toContain("Doe^John^A");
    expect(reverse.translated).toContain("19800515");
  });

  it("throws when the bundle has no Patient resource", () => {
    const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [] };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow();
  });
});
