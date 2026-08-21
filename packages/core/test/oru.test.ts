import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToOru } from "../src/mapping/oru.js";
import type { Bundle, DiagnosticReport, MessageHeader, Observation } from "../src/fhir/types.js";

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
    expect(types).toEqual(["Patient", "DiagnosticReport", "Observation", "Observation", "MessageHeader"]);
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

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("LIS");
    expect(messageHeader.destination?.[0]?.name).toBe("HIS");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "R01",
      display: "ORU^R01",
    });
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

describe("OBX-11 -> Observation.status", () => {
  it.each([
    ["A", "amended"],
    ["C", "corrected"],
    ["D", "entered-in-error"],
    ["F", "final"],
    ["P", "preliminary"],
    ["X", "cancelled"],
  ] as const)("maps HL7 result status %s to %s", (hl7Status, fhirStatus) => {
    const hl7 = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
      `OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||${hl7Status}`,
    ].join("\r");
    const result = translateHl7ToFhir(hl7);
    const bundle = JSON.parse(result.translated) as Bundle;
    const obs = bundle.entry[2]!.resource as Observation;
    expect(obs.status).toBe(fhirStatus);
  });

  it("falls back to final when OBX-11 is absent, same as the prior hardcoded default", () => {
    const hl7 = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
      "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N",
    ].join("\r");
    const result = translateHl7ToFhir(hl7);
    const bundle = JSON.parse(result.translated) as Bundle;
    const obs = bundle.entry[2]!.resource as Observation;
    expect(obs.status).toBe("final");
  });
});

describe("OBX-17 -> Observation.method", () => {
  it("maps the method code", () => {
    const result = translateHl7ToFhir(
      [
        "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
        "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
        "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
        "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||F|||20240101130000|||Spectrophotometry",
      ].join("\r"),
    );
    const bundle = JSON.parse(result.translated) as Bundle;
    const obs = bundle.entry[2]!.resource as Observation;
    expect(obs.method?.coding?.[0]?.code).toBe("Spectrophotometry");
  });
});

describe("FHIR Observation.status/.method -> OBX-11/OBX-17", () => {
  it("round-trips a non-default status and a method back to OBX", () => {
    const forward = translateHl7ToFhir(
      [
        "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
        "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
        "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
        "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||P|||20240101130000|||Spectrophotometry",
      ].join("\r"),
    );
    const reverse = translateFhirToHl7(forward.translated);
    const obxLine = reverse.translated.split("\r").find((l) => l.startsWith("OBX|1|"));
    expect(obxLine).toContain("|P|");
    expect(obxLine).toContain("Spectrophotometry");
  });
});

describe("OBX-20/OBX-21/OBX-29 -> Observation.bodySite/.identifier/.category", () => {
  const OBX_WITH_EXTRA_FIELDS = [
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
    "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||F|||20240101130000|||Spectrophotometry|||65205^Left arm vein^SCT|OBSID001^HOSP||||||||96945^Chem/Hem^v2-0936",
  ].join("\r");

  it("maps OBX-20 to bodySite, OBX-21 to identifier, and OBX-29 to category", () => {
    const result = translateHl7ToFhir(OBX_WITH_EXTRA_FIELDS);
    const bundle = JSON.parse(result.translated) as Bundle;
    const obs = bundle.entry[2]!.resource as Observation;
    expect(obs.bodySite?.coding?.[0]).toEqual({ code: "65205", display: "Left arm vein" });
    expect(obs.identifier?.[0]).toEqual({ value: "OBSID001", assigner: { display: "HOSP" } });
    expect(obs.category?.[0]?.coding?.[0]).toEqual({ code: "96945", display: "Chem/Hem" });
  });

  it("round-trips bodySite/identifier/category back to OBX-20/OBX-21/OBX-29", () => {
    const forward = translateHl7ToFhir(OBX_WITH_EXTRA_FIELDS);
    const reverse = translateFhirToHl7(forward.translated);
    const obxLine = reverse.translated.split("\r").find((l) => l.startsWith("OBX|1|"));
    expect(obxLine).toContain("65205^Left arm vein");
    expect(obxLine).toContain("OBSID001");
    expect(obxLine).toContain("96945^Chem/Hem");
  });
});

describe("NTE -> Observation.note (annotates the immediately preceding OBX)", () => {
  const ORU_WITH_NTE = [
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
    "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||F|||20240101130000",
    "NTE|1||Hemolyzed specimen, repeat draw recommended|||20240101131500",
    "OBX|2|NM|4544-3^Hematocrit^LN||42.0|%|41.0-53.0|N|||F|||20240101130000",
  ].join("\r");

  it("attaches the note only to the OBX it immediately follows, not to every Observation", () => {
    const result = translateHl7ToFhir(ORU_WITH_NTE);
    const bundle = JSON.parse(result.translated) as Bundle;
    const observations = bundle.entry.filter((e): e is { resource: Observation } => e.resource.resourceType === "Observation");
    expect(observations[0]!.resource.note).toEqual([{ text: "Hemolyzed specimen, repeat draw recommended", time: "2024-01-01T13:15:00Z" }]);
    expect(observations[1]!.resource.note).toBeUndefined();
  });

  it("round-trips the note back to an NTE segment placed right after that OBX", () => {
    const forward = translateHl7ToFhir(ORU_WITH_NTE);
    const reverse = translateFhirToHl7(forward.translated);
    const lines = reverse.translated.split("\r");
    const obx1Index = lines.findIndex((l) => l.startsWith("OBX|1|"));
    expect(lines[obx1Index + 1]).toContain("Hemolyzed specimen, repeat draw recommended");
    expect(lines[obx1Index + 1]).toContain("20240101131500");
  });
});

describe("OBR-2/3/8/22/24/25 -> DiagnosticReport.identifier/.effectivePeriod.end/.issued/.category/.status", () => {
  const ORU_WITH_REPORT_DETAIL = [
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000|20240101123000||||||||||||||20240101140000||CH|F",
    "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||F|||20240101130000",
  ].join("\r");

  it("maps the extra OBR fields", () => {
    const result = translateHl7ToFhir(ORU_WITH_REPORT_DETAIL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const report = bundle.entry.find((e) => e.resource.resourceType === "DiagnosticReport")!.resource as DiagnosticReport;
    expect(report.identifier).toEqual([
      { value: "ORD001", type: { coding: [{ code: "PLAC" }] } },
      { value: "LAB001", type: { coding: [{ code: "FILL" }] } },
    ]);
    expect(report.effectivePeriod).toEqual({ start: "2024-01-01T12:00:00Z", end: "2024-01-01T12:30:00Z" });
    expect(report.issued).toBe("2024-01-01T14:00:00Z");
    expect(report.category?.[0]?.coding?.[0]).toEqual({ code: "CH" });
    expect(report.status).toBe("final");
  });

  it("maps OBR-25 result status codes to real DiagnosticReport.status values", () => {
    const result = translateHl7ToFhir(ORU_WITH_REPORT_DETAIL.replace("|CH|F", "|CH|P"));
    const bundle = JSON.parse(result.translated) as Bundle;
    const report = bundle.entry.find((e) => e.resource.resourceType === "DiagnosticReport")!.resource as DiagnosticReport;
    expect(report.status).toBe("preliminary");
  });

  it("round-trips the extra fields back to OBR-2/3/8/22/24/25", () => {
    const forward = translateHl7ToFhir(ORU_WITH_REPORT_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const obrLine = reverse.translated.split("\r").find((l) => l.startsWith("OBR|"));
    expect(obrLine).toContain("ORD001");
    expect(obrLine).toContain("LAB001");
    expect(obrLine).toContain("20240101123000");
    expect(obrLine).toContain("20240101140000");
    expect(obrLine).toContain("|CH|");
    expect(obrLine).toMatch(/\|F$/);
  });
});
