import { describe, expect, it } from "vitest";
import { detectDirection, resolveDirection, runTranslation } from "../src/cli-core.js";

const ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r");

const FHIR_PATIENT = JSON.stringify({ resourceType: "Patient", id: "p1", name: [{ family: "Doe" }] });

describe("detectDirection", () => {
  it("detects hl7ToFhir from a message starting with MSH", () => {
    expect(detectDirection(ADT_A01)).toBe("hl7ToFhir");
  });

  it("detects fhirToHl7 from JSON input", () => {
    expect(detectDirection(FHIR_PATIENT)).toBe("fhirToHl7");
  });

  it("throws when the shape is ambiguous", () => {
    expect(() => detectDirection("not hl7 or json")).toThrow(/auto-detect/);
  });
});

describe("resolveDirection", () => {
  it("falls back to auto-detection when no direction is requested", () => {
    expect(resolveDirection(ADT_A01, undefined)).toBe("hl7ToFhir");
  });

  it("rejects an invalid explicit direction", () => {
    expect(() => resolveDirection(ADT_A01, "sideways")).toThrow(/must be "hl7ToFhir" or "fhirToHl7"/);
  });
});

describe("runTranslation", () => {
  it("returns just the translated string by default", () => {
    const { output } = runTranslation(ADT_A01, {});
    expect(JSON.parse(output).resourceType).toBe("Bundle");
  });

  it("returns the full result shape with --json", () => {
    const { output } = runTranslation(ADT_A01, { json: true });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("translated");
    expect(parsed).toHaveProperty("mappings");
    expect(parsed).toHaveProperty("warnings");
  });

  it("nests the FHIR Bundle as real JSON in --json mode, not an escaped string", () => {
    const { output } = runTranslation(ADT_A01, { json: true });
    const parsed = JSON.parse(output);
    expect(typeof parsed.translated).toBe("object");
    expect(parsed.translated.resourceType).toBe("Bundle");
  });

  it("respects an explicit --direction override", () => {
    const { result } = runTranslation(ADT_A01, { direction: "hl7ToFhir" });
    expect(result.warnings).toEqual([]);
  });
});
