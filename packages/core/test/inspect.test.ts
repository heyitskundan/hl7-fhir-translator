import { describe, expect, it } from "vitest";
import { inspectInput } from "../src/inspect.js";

const ADT_A01 = ["MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5", "PID|1||MRN12345^^^HOSP^MR||Doe^John^A"].join("\r");

const UNSUPPORTED_TRIGGER = "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A03|MSG004|P|2.5\rPID|1||MRN1";

const FHIR_PATIENT_ENCOUNTER = JSON.stringify({
  resourceType: "Bundle",
  type: "collection",
  entry: [{ resource: { resourceType: "Patient" } }, { resource: { resourceType: "Encounter" } }],
});

const FHIR_SERVICE_REQUEST = JSON.stringify({ resourceType: "ServiceRequest", status: "active", intent: "order" });

describe("inspectInput", () => {
  it("detects a supported HL7v2 message type with its description", () => {
    const result = inspectInput(ADT_A01);
    expect(result.direction).toBe("hl7ToFhir");
    expect(result.detail).toEqual({
      kind: "hl7",
      messageType: "ADT^A01",
      category: "ADT",
      trigger: "A01",
      supported: true,
      description: "Patient admission",
    });
  });

  it("detects a well-formed but unsupported HL7v2 trigger event without throwing", () => {
    const result = inspectInput(UNSUPPORTED_TRIGGER);
    expect(result.direction).toBe("hl7ToFhir");
    expect(result.detail).toMatchObject({ kind: "hl7", messageType: "ADT^A03", supported: false });
  });

  it("reports malformed HL7v2 as unknown instead of throwing", () => {
    const result = inspectInput("MSH");
    expect(result.direction).toBe("hl7ToFhir");
    expect(result.detail.kind).toBe("unknown");
  });

  it("detects a FHIR bundle's resource types and the HL7v2 type it would produce", () => {
    const result = inspectInput(FHIR_PATIENT_ENCOUNTER);
    expect(result.direction).toBe("fhirToHl7");
    expect(result.detail).toEqual({
      kind: "fhir",
      resourceTypes: ["Patient", "Encounter"],
      targetMessageType: "ADT^A01",
      supported: true,
    });
  });

  it("detects a bare (non-Bundle) FHIR resource", () => {
    const result = inspectInput(FHIR_SERVICE_REQUEST);
    expect(result.direction).toBe("fhirToHl7");
    expect(result.detail).toEqual({
      kind: "fhir",
      resourceTypes: ["ServiceRequest"],
      targetMessageType: "ORM^O01",
      supported: true,
    });
  });

  it("reports a FHIR resource type this package can't translate as unsupported, not thrown", () => {
    const result = inspectInput(JSON.stringify({ resourceType: "Practitioner" }));
    expect(result.direction).toBe("fhirToHl7");
    expect(result.detail).toMatchObject({ kind: "fhir", supported: false, targetMessageType: undefined });
  });

  it("reports invalid JSON as unknown instead of throwing", () => {
    const result = inspectInput("{ not json");
    expect(result.direction).toBe("fhirToHl7");
    expect(result.detail.kind).toBe("unknown");
  });

  it("reports input matching neither shape as direction unknown", () => {
    const result = inspectInput("just some text");
    expect(result.direction).toBe("unknown");
    expect(result.detail.kind).toBe("unknown");
  });
});
