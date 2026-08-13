import { describe, expect, it } from "vitest";
import { translate, TranslateError } from "../src/api.js";

const VALID_ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
].join("\r");

describe("translate", () => {
  it("translates a valid HL7v2 message to a FHIR bundle", () => {
    const result = translate(VALID_ADT_A01, "hl7ToFhir");
    expect(result.translated).toContain('"resourceType": "Bundle"');
    expect(result.mappings.length).toBeGreaterThan(0);
  });

  it("wraps a malformed HL7v2 message as TranslateError", () => {
    expect(() => translate("not a valid message", "hl7ToFhir")).toThrow(TranslateError);
  });

  it("wraps an unsupported FHIR resource as TranslateError", () => {
    const json = JSON.stringify({ resourceType: "Practitioner" });
    expect(() => translate(json, "fhirToHl7")).toThrow(TranslateError);
  });

  it("carries the underlying error message on the thrown TranslateError", () => {
    try {
      translate("garbage", "hl7ToFhir");
      expect.unreachable("translate should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TranslateError);
      expect((err as TranslateError).message.length).toBeGreaterThan(0);
    }
  });
});
