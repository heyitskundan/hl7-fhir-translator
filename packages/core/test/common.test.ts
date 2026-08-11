import { describe, expect, it } from "vitest";
import {
  fhirDateTimeToHl7,
  fhirEncounterClassToHl7,
  fhirGenderToHl7,
  hl7DateTimeToFhir,
  hl7GenderToFhir,
  hl7NameToFhirGiven,
  hl7PatientClassToFhir,
  MappingTrail,
} from "../src/mapping/common.js";

describe("hl7GenderToFhir", () => {
  it("maps every HL7 administrative sex code", () => {
    expect(hl7GenderToFhir("M")).toBe("male");
    expect(hl7GenderToFhir("F")).toBe("female");
    expect(hl7GenderToFhir("O")).toBe("other");
    expect(hl7GenderToFhir("U")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(hl7GenderToFhir("m")).toBe("male");
  });

  it("falls back to unknown for an unrecognized or missing code", () => {
    expect(hl7GenderToFhir("X")).toBe("unknown");
    expect(hl7GenderToFhir(undefined)).toBe("unknown");
  });
});

describe("fhirGenderToHl7", () => {
  it("maps every FHIR AdministrativeGender value", () => {
    expect(fhirGenderToHl7("male")).toBe("M");
    expect(fhirGenderToHl7("female")).toBe("F");
    expect(fhirGenderToHl7("other")).toBe("O");
    expect(fhirGenderToHl7("unknown")).toBe("U");
  });

  it("falls back to U for an unrecognized or missing value", () => {
    expect(fhirGenderToHl7("nonbinary")).toBe("U");
    expect(fhirGenderToHl7(undefined)).toBe("U");
  });
});

describe("hl7PatientClassToFhir", () => {
  it("maps every HL7 patient class code", () => {
    expect(hl7PatientClassToFhir("I")).toEqual({ code: "IMP", display: "inpatient encounter" });
    expect(hl7PatientClassToFhir("O")).toEqual({ code: "AMB", display: "ambulatory" });
    expect(hl7PatientClassToFhir("E")).toEqual({ code: "EMER", display: "emergency" });
  });

  it("is case-insensitive", () => {
    expect(hl7PatientClassToFhir("i")).toEqual({ code: "IMP", display: "inpatient encounter" });
  });

  it("falls back to UNK for an unrecognized or missing code", () => {
    expect(hl7PatientClassToFhir("Z")).toEqual({ code: "UNK", display: "unknown" });
    expect(hl7PatientClassToFhir(undefined)).toEqual({ code: "UNK", display: "unknown" });
  });
});

describe("fhirEncounterClassToHl7", () => {
  it("maps every v3-ActCode encounter class back to its HL7 patient class", () => {
    expect(fhirEncounterClassToHl7("IMP")).toBe("I");
    expect(fhirEncounterClassToHl7("AMB")).toBe("O");
    expect(fhirEncounterClassToHl7("EMER")).toBe("E");
  });

  it("falls back to I for an unrecognized or missing code", () => {
    expect(fhirEncounterClassToHl7("UNK")).toBe("I");
    expect(fhirEncounterClassToHl7(undefined)).toBe("I");
  });
});

describe("hl7NameToFhirGiven", () => {
  it("combines given and middle name into the FHIR given[] array", () => {
    expect(hl7NameToFhirGiven("John", "A")).toEqual(["John", "A"]);
  });

  it("omits whichever of given/middle is absent", () => {
    expect(hl7NameToFhirGiven("John", undefined)).toEqual(["John"]);
    expect(hl7NameToFhirGiven(undefined, "A")).toEqual(["A"]);
  });

  it("returns undefined when neither is present, not an empty array", () => {
    expect(hl7NameToFhirGiven(undefined, undefined)).toBeUndefined();
  });
});

describe("hl7DateTimeToFhir / fhirDateTimeToHl7", () => {
  it("round-trips a date-only value", () => {
    expect(hl7DateTimeToFhir("20240101")).toBe("2024-01-01");
    expect(fhirDateTimeToHl7("2024-01-01")).toBe("20240101");
  });

  it("round-trips a full date-time value", () => {
    expect(hl7DateTimeToFhir("20240101120000")).toBe("2024-01-01T12:00:00Z");
    expect(fhirDateTimeToHl7("2024-01-01T12:00:00Z")).toBe("20240101120000");
  });

  it("returns undefined for missing or unparseable input", () => {
    expect(hl7DateTimeToFhir(undefined)).toBeUndefined();
    expect(hl7DateTimeToFhir("not-a-date")).toBeUndefined();
    expect(fhirDateTimeToHl7(undefined)).toBeUndefined();
    expect(fhirDateTimeToHl7("not-a-date")).toBeUndefined();
  });
});

describe("MappingTrail", () => {
  it("records a mapping with an optional note", () => {
    const trail = new MappingTrail();
    trail.add("PID-8", "Patient.gender", "male", 'HL7 code "M"');
    expect(trail.mappings).toEqual([{ source: "PID-8", target: "Patient.gender", value: "male", note: 'HL7 code "M"' }]);
  });

  it("omits the note property entirely when none is given", () => {
    const trail = new MappingTrail();
    trail.add("PID-7", "Patient.birthDate", "1980-05-15");
    expect(trail.mappings[0]).not.toHaveProperty("note");
  });

  it("silently skips an empty or missing value instead of recording a blank mapping", () => {
    const trail = new MappingTrail();
    trail.add("PID-11", "Patient.address[0]", "");
    expect(trail.mappings).toEqual([]);
  });

  it("collects warnings separately from mappings", () => {
    const trail = new MappingTrail();
    trail.warn("NK1 segment has no FHIR mapping for this message type and was skipped");
    expect(trail.warnings).toHaveLength(1);
    expect(trail.mappings).toEqual([]);
  });
});
