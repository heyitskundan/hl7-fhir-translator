import { describe, expect, it } from "vitest";
import { VOCABULARY, lookupVocabulary, reverseLookupVocabulary } from "../src/mapping/vocabulary.js";

describe("VOCABULARY structural invariants", () => {
  it("has no empty tables", () => {
    for (const [tableId, table] of Object.entries(VOCABULARY)) {
      expect(Object.keys(table).length, `table "${tableId}" has no entries`).toBeGreaterThan(0);
    }
  });

  it("every mapping has a non-empty code", () => {
    for (const [tableId, table] of Object.entries(VOCABULARY)) {
      for (const [hl7Code, mapping] of Object.entries(table)) {
        expect(mapping.code, `${tableId}.${hl7Code} has an empty target code`).toBeTruthy();
      }
    }
  });

  it("covers at least 60 tables and 2000 codes (regression floor, not an exact count — the IG can add tables)", () => {
    const tableCount = Object.keys(VOCABULARY).length;
    const codeCount = Object.values(VOCABULARY).reduce((sum, t) => sum + Object.keys(t).length, 0);
    expect(tableCount).toBeGreaterThanOrEqual(60);
    expect(codeCount).toBeGreaterThanOrEqual(2000);
  });
});

describe("lookupVocabulary", () => {
  it("maps HL7 Table 0001 (Administrative Sex) to AdministrativeGender", () => {
    expect(lookupVocabulary("table-hl70001-to-administrative-gender", "M")).toEqual({
      code: "male",
      display: "Male",
      system: "http://hl7.org/fhir/administrative-gender",
    });
    expect(lookupVocabulary("table-hl70001-to-administrative-gender", "F")?.code).toBe("female");
  });

  it("returns undefined for an unknown code in a known table", () => {
    expect(lookupVocabulary("table-hl70001-to-administrative-gender", "ZZ")).toBeUndefined();
  });

  it("returns undefined for an unknown table", () => {
    expect(lookupVocabulary("not-a-real-table", "M")).toBeUndefined();
  });

  it("returns undefined for an empty/undefined code", () => {
    expect(lookupVocabulary("table-hl70001-to-administrative-gender", undefined)).toBeUndefined();
    expect(lookupVocabulary("table-hl70001-to-administrative-gender", "")).toBeUndefined();
  });

  it("disambiguates a table with more than one FHIR target by ConceptMap id (HL70004 -> both Encounter.status and v3-ActCode)", () => {
    const toActCode = lookupVocabulary("table-hl70004-to-v3-actcode", "I");
    expect(toActCode?.system).toBe("http://terminology.hl7.org/CodeSystem/v3-ActCode");
  });
});

describe("reverseLookupVocabulary", () => {
  it("finds an HL7v2 code that maps to a given FHIR code", () => {
    const hl7Code = reverseLookupVocabulary("table-hl70001-to-administrative-gender", "female");
    expect(lookupVocabulary("table-hl70001-to-administrative-gender", hl7Code)?.code).toBe("female");
  });

  it("returns undefined when no HL7v2 code maps to the given FHIR code", () => {
    expect(reverseLookupVocabulary("table-hl70001-to-administrative-gender", "not-a-real-code")).toBeUndefined();
  });
});
