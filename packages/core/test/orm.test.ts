import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import type { Bundle, ServiceRequest } from "../src/fhir/types.js";

const ORM_O01 = [
  "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
  "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
].join("\r");

describe("ORM^O01 -> FHIR", () => {
  const result = translateHl7ToFhir(ORM_O01);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient and a ServiceRequest", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "ServiceRequest"]);
  });

  it("maps ORC-1 order control to ServiceRequest.status", () => {
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.status).toBe("active");
    expect(sr.intent).toBe("order");
  });

  it("maps OBR-4 to the ServiceRequest code and ORC-12 to the requester", () => {
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.code.coding?.[0]).toEqual({ system: "http://loinc.org", code: "85025", display: "CBC" });
    expect(sr.requester?.display).toBe("Jane Smith");
  });
});

describe("FHIR ServiceRequest -> ORM^O01", () => {
  it("round-trips the order code and status", () => {
    const forward = translateHl7ToFhir(ORM_O01);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("ORM^O01");
    expect(reverse.translated).toContain("NW");
    expect(reverse.translated).toContain("85025^CBC^LN");
  });
});

describe("unsupported message types", () => {
  it("throws a typed error naming the unsupported trigger, not a silent best-effort guess", () => {
    const unsupported = "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A03|MSG004|P|2.5\rPID|1||MRN1";
    expect(() => translateHl7ToFhir(unsupported)).toThrow(/A03/);
  });
});
