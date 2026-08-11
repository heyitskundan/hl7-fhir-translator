import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectDirection, formatDetection, resolveDirection, runTranslation } from "../src/cli-core.js";
import { main } from "../src/cli.js";

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

describe("formatDetection", () => {
  it("renders a supported HL7v2 detection with its description", () => {
    const line = formatDetection({
      direction: "hl7ToFhir",
      detail: { kind: "hl7", messageType: "ADT^A01", category: "ADT", trigger: "A01", supported: true, description: "Patient admission" },
    });
    expect(line).toBe("hl7ToFhir — HL7v2 ADT^A01 (Patient admission), supported");
  });

  it("renders an unsupported HL7v2 trigger without a description", () => {
    const line = formatDetection({
      direction: "hl7ToFhir",
      detail: { kind: "hl7", messageType: "ADT^A03", category: "ADT", trigger: "A03", supported: false },
    });
    expect(line).toBe("hl7ToFhir — HL7v2 ADT^A03, NOT supported");
  });

  it("renders a supported FHIR detection with its target message type", () => {
    const line = formatDetection({
      direction: "fhirToHl7",
      detail: { kind: "fhir", resourceTypes: ["Patient", "Encounter"], targetMessageType: "ADT^A01", supported: true },
    });
    expect(line).toBe("fhirToHl7 — FHIR [Patient, Encounter], supported, would produce ADT^A01");
  });

  it("renders an unsupported FHIR resource type", () => {
    const line = formatDetection({ direction: "fhirToHl7", detail: { kind: "fhir", resourceTypes: ["Practitioner"], supported: false } });
    expect(line).toBe("fhirToHl7 — FHIR [Practitioner], NOT supported");
  });

  it("renders an unknown-shape result with its reason", () => {
    const line = formatDetection({ direction: "unknown", detail: { kind: "unknown", reason: "Input doesn't start with MSH or {" } });
    expect(line).toBe("unknown (direction: unknown) — Input doesn't start with MSH or {");
  });
});

describe("main (CLI entrypoint)", () => {
  let dir: string;
  let stdout: string[];
  let stderr: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hl7-fhir-translator-cli-test-"));
    stdout = [];
    stderr = [];
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(chunk.toString());
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints the help text and exits without reading any input", () => {
    main(["--help"]);
    expect(stdout.join("")).toContain("hl7-fhir-translator — deterministic HL7v2 <-> FHIR R4 translation");
  });

  it("reads a file with -i and writes the translated Bundle to stdout", () => {
    const inFile = join(dir, "in.hl7");
    writeFileSync(inFile, ADT_A01);
    main(["-i", inFile]);
    expect(JSON.parse(stdout.join("")).resourceType).toBe("Bundle");
  });

  it("writes the full result shape to stdout with --json", () => {
    const inFile = join(dir, "in.hl7");
    writeFileSync(inFile, ADT_A01);
    main(["-i", inFile, "--json"]);
    const parsed = JSON.parse(stdout.join(""));
    expect(parsed).toHaveProperty("mappings");
    expect(typeof parsed.translated).toBe("object");
  });

  it("prints the detection summary and does not translate when --detect is passed", () => {
    const inFile = join(dir, "in.hl7");
    writeFileSync(inFile, ADT_A01);
    main(["-i", inFile, "--detect"]);
    expect(stdout.join("")).toContain("hl7ToFhir — HL7v2 ADT^A01");
  });

  it("writes to the file given by -o instead of stdout", () => {
    const inFile = join(dir, "in.hl7");
    const outFile = join(dir, "out.json");
    writeFileSync(inFile, ADT_A01);
    main(["-i", inFile, "-o", outFile]);
    expect(stdout).toEqual([]);
    expect(JSON.parse(readFileSync(outFile, "utf8")).resourceType).toBe("Bundle");
  });

  it("prints each warning to stderr, prefixed", () => {
    const inFile = join(dir, "in.hl7");
    writeFileSync(inFile, ADT_A01 + "\rNK1|1|Doe^Jane|SPO");
    main(["-i", inFile]);
    expect(stderr.some((line) => line.startsWith("warning: ") && line.includes("NK1"))).toBe(true);
  });

  it("throws instead of silently exiting when the input file doesn't exist", () => {
    expect(() => main(["-i", join(dir, "does-not-exist.hl7")])).toThrow();
  });
});
