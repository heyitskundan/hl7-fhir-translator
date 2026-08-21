import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToOml } from "../src/mapping/oml.js";
import type { Bundle, Device, MessageHeader, Patient, ServiceRequest, Specimen } from "../src/fhir/types.js";

const OML_O21 = [
  "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240105100000||OML^O21|MSG012|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "ORC|NW|ORD020|||||||20240105100000|||^Smith^Jane^M^MD",
  "OBR|1|ORD020||1558-6^Glucose^LN|||20240105100000",
  "SPM|1|ORD020||SER^Serum^HL70487|||||||||||||20240105101500",
].join("\r");

describe("OML^O21 -> FHIR", () => {
  const result = translateHl7ToFhir(OML_O21);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient, a ServiceRequest, a Practitioner, and a Specimen", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "ServiceRequest", "Practitioner", "Specimen", "MessageHeader"]);
  });

  it("maps ORC/OBR into a ServiceRequest", () => {
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.status).toBe("active");
    expect(sr.code.coding?.[0]?.code).toBe("1558-6");
    expect(sr.requester?.display).toBe("Jane Smith");
  });

  it("maps SPM into a Specimen referencing the ServiceRequest", () => {
    const specimen = bundle.entry.find((e) => e.resource.resourceType === "Specimen")!.resource as Specimen;
    expect(specimen.type?.coding?.[0]).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0487",
      code: "SER",
      display: "Serum",
    });
    expect(specimen.collection?.collectedDateTime).toBe("2024-01-05T10:15:00Z");
    expect(specimen.request?.[0]?.reference).toBe("ServiceRequest/servicerequest-1");
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(5);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
  });

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("LIS");
    expect(messageHeader.destination?.[0]?.name).toBe("HIS");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "O21",
      display: "OML^O21",
    });
  });
});

describe("FHIR Patient+ServiceRequest+Specimen -> OML^O21", () => {
  it("round-trips the key order and specimen fields", () => {
    const forward = translateHl7ToFhir(OML_O21);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.startsWith("MSH|^~\\&|")).toBe(true);
    expect(reverse.translated).toContain("OML^O21");
    expect(reverse.translated).toContain("MRN12345");
    expect(reverse.translated).toContain("SER^Serum^HL70487");
  });

  it("is distinguished from ORM^O01 by the presence of a Specimen resource", () => {
    const forward = translateHl7ToFhir(OML_O21);
    const bundle = JSON.parse(forward.translated) as Bundle;
    const withoutSpecimen: Bundle = { ...bundle, entry: bundle.entry.filter((e) => e.resource.resourceType !== "Specimen") };
    const reverse = translateFhirToHl7(JSON.stringify(withoutSpecimen));
    expect(reverse.translated).toContain("ORM^O01");
  });

  it("throws when the bundle has no Specimen resource", () => {
    // A Patient+ServiceRequest bundle with no Specimen routes to the ORM mapper (see
    // registry.ts's detectTargetMessageType), so this branch of fhirToOml is unreachable
    // through translateFhirToHl7 — call it directly.
    const patient: Patient = { resourceType: "Patient", id: "patient-1", name: [{ family: "Doe" }] };
    const sr: ServiceRequest = {
      resourceType: "ServiceRequest",
      id: "servicerequest-1",
      status: "active",
      intent: "order",
      code: { text: "Glucose" },
    };
    const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }, { resource: sr }] };
    expect(() => fhirToOml(bundle)).toThrow(/Specimen/);
  });

  it("throws when the bundle has no Patient resource", () => {
    // A Specimen (with or without a Patient) still routes to the OML mapper (see
    // registry.ts's detectTargetMessageType), so this branch is reachable through the public API.
    const sr: ServiceRequest = { resourceType: "ServiceRequest", id: "servicerequest-1", status: "active", intent: "order", code: {} };
    const specimen: Specimen = { resourceType: "Specimen", id: "specimen-1" };
    const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: sr }, { resource: specimen }] };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow(/Patient/);
  });

  it.each([
    ["revoked", "CA"],
    ["completed", "CM"],
  ] as const)("maps ServiceRequest.status %s back to order control %s", (status, orderControl) => {
    const forward = translateHl7ToFhir(OML_O21);
    const bundle = JSON.parse(forward.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    sr.status = status;
    const reverse = translateFhirToHl7(JSON.stringify(bundle));
    expect(reverse.translated).toContain(`ORC|${orderControl}|`);
  });
});

describe("malformed OML input", () => {
  it("throws a typed error instead of guessing when the SPM segment is absent", () => {
    const noSpm = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240105100000||OML^O21|MSG012|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "ORC|NW|ORD020|||||||20240105100000",
      "OBR|1|ORD020||1558-6^Glucose^LN|||20240105100000",
    ].join("\r");
    expect(() => translateHl7ToFhir(noSpm)).toThrow(/SPM/);
  });

  it("falls back to OBR-16 for the ordering provider when ORC-12 is absent", () => {
    const noOrc12 = [
      "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240105100000||OML^O21|MSG012|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "ORC|NW|ORD020",
      "OBR|1|ORD020||1558-6^Glucose^LN|||20240105100000|||||||||1234^Smith^Jane^M^MD",
      "SPM|1|ORD020||SER^Serum^HL70487|||||||||||||20240105101500",
    ].join("\r");
    const result = translateHl7ToFhir(noOrc12);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.requester?.display).toBe("Jane Smith");
  });
});

describe("NTE -> ServiceRequest.note", () => {
  const OML_WITH_NOTE = [
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240105100000||OML^O21|MSG012|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD020|||||||20240105100000|||^Smith^Jane^M^MD",
    "OBR|1|ORD020||1558-6^Glucose^LN|||20240105100000",
    "SPM|1|ORD020||SER^Serum^HL70487|||||||||||||20240105101500",
    "NTE|1||Draw from left arm, patient on anticoagulants",
    "NTE|2||Second note",
  ].join("\r");

  it("maps every NTE-3 to one ServiceRequest.note entry", () => {
    const result = translateHl7ToFhir(OML_WITH_NOTE);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.note).toEqual([{ text: "Draw from left arm, patient on anticoagulants" }, { text: "Second note" }]);
  });

  it("round-trips notes back to NTE segments", () => {
    const forward = translateHl7ToFhir(OML_WITH_NOTE);
    const reverse = translateFhirToHl7(forward.translated);
    const nteLines = reverse.translated.split("\r").filter((l) => l.startsWith("NTE|"));
    expect(nteLines).toHaveLength(2);
    expect(nteLines[0]).toContain("Draw from left arm, patient on anticoagulants");
    expect(nteLines[1]).toContain("Second note");
  });
});

describe("TQ1-9 -> ServiceRequest.priority", () => {
  const OML_WITH_TQ1 = [
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240105100000||OML^O21|MSG012|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD020|||||||20240105100000|||^Smith^Jane^M^MD",
    "OBR|1|ORD020||1558-6^Glucose^LN|||20240105100000",
    "SPM|1|ORD020||SER^Serum^HL70487|||||||||||||20240105101500",
    "TQ1|1||||||||S",
  ].join("\r");

  it("maps TQ1-9 to ServiceRequest.priority", () => {
    const result = translateHl7ToFhir(OML_WITH_TQ1);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.priority).toBe("stat");
  });

  it("round-trips priority back to a TQ1 segment", () => {
    const forward = translateHl7ToFhir(OML_WITH_TQ1);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("TQ1|1||||||||S");
  });
});

describe("SPM-7/8/18/20/24 -> Specimen.collection.method/.bodySite/.receivedTime/.status/.condition", () => {
  const OML_WITH_SPECIMEN_DETAIL = [
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240105100000||OML^O21|MSG012|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD020|||||||20240105100000|||^Smith^Jane^M^MD",
    "OBR|1|ORD020||1558-6^Glucose^LN|||20240105100000",
    "SPM|1|ORD020||SER^Serum^HL70487|||VEN^Venipuncture^SCT|65205^Left arm vein^SCT|||||||||20240105101500|20240105103000||Y||||SAT^Satisfactory^v2-0493",
  ].join("\r");

  it("maps the extra SPM fields onto Specimen", () => {
    const result = translateHl7ToFhir(OML_WITH_SPECIMEN_DETAIL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const specimen = bundle.entry.find((e) => e.resource.resourceType === "Specimen")!.resource as Specimen;
    expect(specimen.collection?.method?.coding?.[0]).toEqual({ code: "VEN", display: "Venipuncture" });
    expect(specimen.collection?.bodySite?.coding?.[0]).toEqual({ code: "65205", display: "Left arm vein" });
    expect(specimen.receivedTime).toBe("2024-01-05T10:30:00Z");
    expect(specimen.status).toBe("available");
    expect(specimen.condition?.[0]?.coding?.[0]).toEqual({ code: "SAT", display: "Satisfactory" });
  });

  it("round-trips the extra fields back to SPM-7/8/18/20/24", () => {
    const forward = translateHl7ToFhir(OML_WITH_SPECIMEN_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const spmLine = reverse.translated.split("\r").find((l) => l.startsWith("SPM|"));
    expect(spmLine).toContain("VEN^Venipuncture");
    expect(spmLine).toContain("65205^Left arm vein");
    expect(spmLine).toContain("20240105103000");
    expect(spmLine).toContain("Y");
    expect(spmLine).toContain("SAT^Satisfactory");
  });
});

describe("PRT-10/16/17/18/19/20/21/22 -> Device (only built when PRT-10 or PRT-16 is present)", () => {
  const OML_WITH_PRT = [
    "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240105100000||OML^O21|MSG012|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD020|||||||20240105100000|||^Smith^Jane^M^MD",
    "OBR|1|ORD020||1558-6^Glucose^LN|||20240105100000",
    "SPM|1|ORD020||SER^Serum^HL70487|||||||||||||20240105101500",
    "PRT||||||||||GLU200^Glucose Analyzer||||||00987654321098|20220601|20270601|LOT7788|SN112233||ANALYZER^Analyzer^SCT",
  ].join("\r");

  it("builds a Device from the PRT repetition describing one", () => {
    const result = translateHl7ToFhir(OML_WITH_PRT);
    const bundle = JSON.parse(result.translated) as Bundle;
    const device = bundle.entry.find((e) => e.resource.resourceType === "Device")!.resource as Device;
    expect(device.identifier?.[0]?.value).toBe("GLU200");
    expect(device.udiCarrier?.[0]?.deviceIdentifier).toBe("00987654321098");
    expect(device.lotNumber).toBe("LOT7788");
    expect(device.serialNumber).toBe("SN112233");
    expect(device.type?.coding?.[0]).toEqual({ code: "ANALYZER", display: "Analyzer" });
  });

  it("produces no Device when no PRT segment describes one", () => {
    const result = translateHl7ToFhir(OML_O21);
    const bundle = JSON.parse(result.translated) as Bundle;
    expect(bundle.entry.some((e) => e.resource.resourceType === "Device")).toBe(false);
  });

  it("round-trips the device fields back to a PRT segment", () => {
    const forward = translateHl7ToFhir(OML_WITH_PRT);
    const reverse = translateFhirToHl7(forward.translated);
    const prtLine = reverse.translated.split("\r").find((l) => l.startsWith("PRT|"));
    expect(prtLine).toContain("GLU200");
    expect(prtLine).toContain("00987654321098");
    expect(prtLine).toContain("LOT7788");
    expect(prtLine).toContain("SN112233");
    expect(prtLine).toContain("ANALYZER^Analyzer");
  });
});
