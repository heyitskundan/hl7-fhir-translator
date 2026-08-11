import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import type { Bundle, DiagnosticReport, Observation } from "../src/fhir/types.js";

const ORU_R01 = [
  "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
  "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||F|||20240101130000",
  "OBX|2|NM|4544-3^Hematocrit^LN||42.0|%|41.0-53.0|N|||F|||20240101130000",
].join("\r");

describe("ORU^R01 -> FHIR", () => {
  const result = translateHl7ToFhir(ORU_R01);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient, a DiagnosticReport, and one Observation per OBX", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "DiagnosticReport", "Observation", "Observation"]);
  });

  it("maps the panel-level OBR into the DiagnosticReport", () => {
    const report = bundle.entry[1]!.resource as DiagnosticReport;
    expect(report.code.coding?.[0]).toEqual({ system: "http://loinc.org", code: "85025", display: "CBC" });
  });

  it("maps each OBX repetition into its own Observation with value, unit, range, and flag", () => {
    const hemoglobin = bundle.entry[2]!.resource as Observation;
    expect(hemoglobin.code.coding?.[0]?.code).toBe("718-7");
    expect(hemoglobin.valueQuantity).toEqual({ value: 14.5, unit: "g/dL" });
    expect(hemoglobin.referenceRange?.[0]).toEqual({ low: { value: 13.5 }, high: { value: 17.5 } });
    expect(hemoglobin.interpretation?.[0]?.coding?.[0]?.code).toBe("N");
  });

  it("links the DiagnosticReport to its Observations by reference", () => {
    const report = bundle.entry[1]!.resource as DiagnosticReport;
    expect(report.result).toEqual([{ reference: "Observation/observation-1" }, { reference: "Observation/observation-2" }]);
  });
});

describe("FHIR DiagnosticReport+Observations -> ORU^R01", () => {
  it("round-trips both OBX results", () => {
    const forward = translateHl7ToFhir(ORU_R01);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("ORU^R01");
    expect(reverse.translated).toContain("718-7^Hemoglobin^LN");
    expect(reverse.translated).toContain("14.5");
    expect(reverse.translated).toContain("4544-3^Hematocrit^LN");
  });
});

describe("malformed ORU input", () => {
  it("throws a typed error instead of guessing when OBX segments are absent", () => {
    const noResults = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
    ].join("\r");
    expect(() => translateHl7ToFhir(noResults)).toThrow();
  });
});
