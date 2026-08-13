import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToOml } from "../src/mapping/oml.js";
import type { Bundle, Patient, ServiceRequest, Specimen } from "../src/fhir/types.js";

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

  it("produces a Bundle with a Patient, a ServiceRequest, and a Specimen", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "ServiceRequest", "Specimen"]);
  });

  it("maps ORC/OBR into a ServiceRequest", () => {
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.status).toBe("active");
    expect(sr.code.coding?.[0]?.code).toBe("1558-6");
    expect(sr.requester?.display).toBe("Jane Smith");
  });

  it("maps SPM into a Specimen referencing the ServiceRequest", () => {
    const specimen = bundle.entry[2]!.resource as Specimen;
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
