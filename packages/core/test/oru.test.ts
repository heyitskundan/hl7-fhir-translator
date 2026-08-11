import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToOru } from "../src/mapping/oru.js";
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

  it("throws when the PID segment is absent", () => {
    const noPid = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
      "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
      "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL",
    ].join("\r");
    expect(() => translateHl7ToFhir(noPid)).toThrow(/PID/);
  });

  it("throws when the OBR segment is absent", () => {
    const noObr = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL",
    ].join("\r");
    expect(() => translateHl7ToFhir(noObr)).toThrow(/OBR/);
  });

  it("skips an OBX with no observation identifier and warns instead of throwing", () => {
    const missingObx3 = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
      "OBX|1|NM||||14.5|g/dL",
      "OBX|2|NM|4544-3^Hematocrit^LN||42.0|%",
    ].join("\r");
    const result = translateHl7ToFhir(missingObx3);
    const bundle = JSON.parse(result.translated) as Bundle;
    expect(bundle.entry.filter((e) => e.resource.resourceType === "Observation")).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("OBX segment #1"))).toBe(true);
  });
});

describe("FHIR -> ORU^R01 error paths and value types", () => {
  it("throws when the bundle has no Patient resource", () => {
    const report: DiagnosticReport = {
      resourceType: "DiagnosticReport",
      id: "report-1",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "85025", display: "CBC" }] },
      subject: { reference: "Patient/patient-1" },
      result: [],
    };
    const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: report }] };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow(/Patient/);
  });

  it("throws when the bundle has no DiagnosticReport resource", () => {
    // A Patient-only bundle routes to the ADT mapper (see registry.ts's detectTargetMessageType),
    // so this branch of fhirToOru is unreachable through translateFhirToHl7 — call it directly.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "patient-1" } }],
    };
    expect(() => fhirToOru(bundle)).toThrow(/DiagnosticReport/);
  });

  it("writes a non-numeric Observation.valueString as OBX-5 with OBX-2 = ST", () => {
    const forward = translateHl7ToFhir(ORU_R01);
    const bundle = JSON.parse(forward.translated) as Bundle;
    const observation = bundle.entry.find((e) => e.resource.resourceType === "Observation")!.resource as Observation;
    delete observation.valueQuantity;
    observation.valueString = "Positive";
    const reverse = translateFhirToHl7(JSON.stringify(bundle));
    expect(reverse.translated).toContain("|ST|");
    expect(reverse.translated).toContain("Positive");
  });

  it("warns about an unmapped resource type and an unmapped segment instead of dropping them silently", () => {
    const forward = translateHl7ToFhir(ORU_R01 + "\rNK1|1|Doe^Jane|SPO");
    const bundle = JSON.parse(forward.translated) as Bundle;
    bundle.entry.push({ resource: { resourceType: "Encounter", id: "encounter-1", status: "in-progress", class: { code: "IMP" } } });
    const reverse = translateFhirToHl7(JSON.stringify(bundle));
    expect(reverse.warnings.some((w) => w.includes("Encounter"))).toBe(true);
    expect(forward.warnings.some((w) => w.includes("NK1"))).toBe(true);
  });
});
