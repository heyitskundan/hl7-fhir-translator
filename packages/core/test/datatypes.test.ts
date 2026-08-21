import { describe, expect, it } from "vitest";
import type { Hl7Field } from "../src/hl7/types.js";
import {
  addressToXad,
  contactPointToXtn,
  cweToCodeableConcept,
  cweToCoding,
  cxToIdentifier,
  drToPeriodComponents,
  eiToIdentifier,
  hdToParts,
  humanNameToXpn,
  periodFrom,
  rpToAttachment,
  snToRange,
  xadToAddress,
  xcnToNameParts,
  xonToOrganizationParts,
  xpnToHumanName,
  xtnToContactPoint,
} from "../src/mapping/datatypes.js";

/** Builds a single-repetition Hl7Field from `^`-joined components, matching how the parser itself builds fields. */
function fieldOf(...components: string[]): Hl7Field {
  return { raw: components.join("^"), reps: [components] };
}

describe("XPN <-> HumanName", () => {
  it("reads family/given/middle/suffix/prefix from XPN components 1-5", () => {
    const name = xpnToHumanName(fieldOf("Doe", "John", "A", "Jr", "Dr"));
    expect(name).toEqual({ family: "Doe", given: ["John", "A"], suffix: ["Jr"], prefix: ["Dr"] });
  });

  it("returns undefined for an empty field", () => {
    expect(xpnToHumanName(undefined)).toBeUndefined();
    expect(xpnToHumanName(fieldOf(""))).toBeUndefined();
  });

  it("writes back to XPN component order", () => {
    expect(humanNameToXpn({ family: "Doe", given: ["John", "A"], suffix: ["Jr"], prefix: ["Dr"] })).toEqual([
      "Doe",
      "John",
      "A",
      "Jr",
      "Dr",
    ]);
    expect(humanNameToXpn(undefined)).toEqual(["", "", "", "", ""]);
  });
});

describe("XAD <-> Address", () => {
  it("reads street/other-designation/city/state/postalCode/country", () => {
    expect(xadToAddress(fieldOf("123 Main St", "Apt 4", "Springfield", "IL", "62701", "USA"))).toEqual({
      line: ["123 Main St", "Apt 4"],
      city: "Springfield",
      state: "IL",
      postalCode: "62701",
      country: "USA",
    });
  });

  it("returns undefined when both street and city are absent", () => {
    expect(xadToAddress(fieldOf("", "", "", "IL"))).toBeUndefined();
  });

  it("writes back street/city/state/postalCode/country (not the other-designation component)", () => {
    expect(addressToXad({ line: ["123 Main St"], city: "Springfield", state: "IL", postalCode: "62701", country: "USA" })).toEqual([
      "123 Main St",
      "",
      "Springfield",
      "IL",
      "62701",
      "USA",
    ]);
  });
});

describe("XTN <-> ContactPoint", () => {
  it("maps a phone number with use and equipment type", () => {
    expect(xtnToContactPoint(fieldOf("5551234567", "PRN", "PH"))).toEqual({ system: "phone", value: "5551234567", use: "home" });
  });

  it("maps an email address (component 4) preferentially over the legacy number", () => {
    expect(xtnToContactPoint(fieldOf("", "WPN", "Internet", "jdoe@example.com"))).toEqual({
      system: "email",
      value: "jdoe@example.com",
      use: "work",
    });
  });

  it("returns undefined when no value is present", () => {
    expect(xtnToContactPoint(fieldOf(""))).toBeUndefined();
  });

  it("round-trips a phone ContactPoint back to XTN parts", () => {
    expect(contactPointToXtn({ system: "phone", value: "5551234567", use: "home" })).toEqual({
      legacyNumber: "5551234567",
      use: "PRN",
      equipmentType: "PH",
      email: "",
    });
  });

  it("round-trips an email ContactPoint back to XTN parts", () => {
    expect(contactPointToXtn({ system: "email", value: "jdoe@example.com" })).toEqual({
      legacyNumber: "",
      use: "",
      equipmentType: "Internet",
      email: "jdoe@example.com",
    });
  });
});

describe("XCN -> name parts", () => {
  it("reads id number, family, given, middle, and builds a display name", () => {
    expect(xcnToNameParts(fieldOf("1234", "Smith", "Jane", "M"))).toEqual({
      idNumber: "1234",
      family: "Smith",
      given: "Jane",
      middle: "M",
      display: "Jane M Smith",
    });
  });
});

describe("XON -> organization parts", () => {
  it("reads organization name, id number, and organization identifier", () => {
    expect(xonToOrganizationParts(fieldOf("Springfield General", "", "5678", "", "", "", "", "", "", "ORG001"))).toEqual({
      name: "Springfield General",
      idNumber: "5678",
      identifier: "ORG001",
    });
  });
});

describe("CX -> Identifier", () => {
  it("reads id, assigning authority, and identifier type code", () => {
    expect(cxToIdentifier(fieldOf("MRN12345", "", "", "HOSP", "MR"))).toEqual({
      value: "MRN12345",
      assigner: { display: "HOSP" },
      type: { coding: [{ code: "MR" }] },
    });
  });

  it("returns undefined when the id component is absent", () => {
    expect(cxToIdentifier(fieldOf(""))).toBeUndefined();
  });
});

describe("EI -> Identifier", () => {
  it("uses the universal id as system when present", () => {
    expect(eiToIdentifier(fieldOf("DOC0100", "TRAN", "urn:oid:2.16.840.1", "ISO"))).toEqual({
      value: "DOC0100",
      system: "urn:oid:2.16.840.1",
    });
  });

  it("falls back to the namespace id as assigner when no universal id is present", () => {
    expect(eiToIdentifier(fieldOf("DOC0100", "TRAN"))).toEqual({ value: "DOC0100", system: undefined, assigner: { display: "TRAN" } });
  });
});

describe("HD -> parts", () => {
  it("reads namespace id, universal id, and universal id type", () => {
    expect(hdToParts(fieldOf("HOSP", "urn:oid:2.16.840.1", "ISO"))).toEqual({
      namespaceId: "HOSP",
      universalId: "urn:oid:2.16.840.1",
      universalIdType: "ISO",
    });
  });
});

describe("CWE/CE -> CodeableConcept / Coding", () => {
  it("builds a CodeableConcept from code + display", () => {
    expect(cweToCodeableConcept(fieldOf("85025", "CBC"))).toEqual({ coding: [{ code: "85025", display: "CBC" }], text: "CBC" });
  });

  it("builds a bare Coding from code + display", () => {
    expect(cweToCoding(fieldOf("85025", "CBC"))).toEqual({ code: "85025", display: "CBC" });
  });

  it("returns undefined when the code component is absent", () => {
    expect(cweToCodeableConcept(fieldOf(""))).toBeUndefined();
    expect(cweToCoding(fieldOf(""))).toBeUndefined();
  });
});

describe("SN -> Range", () => {
  it("parses a 'low-high' range", () => {
    expect(snToRange(fieldOf("", "13.5", "-", "17.5"))).toEqual({ low: { value: 13.5 }, high: { value: 17.5 } });
  });

  it("parses a single value with no separator", () => {
    expect(snToRange(fieldOf("", "13.5"))).toEqual({ low: { value: 13.5 } });
  });

  it("returns undefined for a comparator form (e.g. '>10'), which Range can't represent", () => {
    expect(snToRange(fieldOf(">", "10"))).toBeUndefined();
  });
});

describe("DR -> Period components", () => {
  it("reads start and end", () => {
    expect(drToPeriodComponents(fieldOf("20240101120000", "20240102120000"))).toEqual({
      start: "20240101120000",
      end: "20240102120000",
    });
  });
});

describe("periodFrom", () => {
  it("builds a Period from already-converted start/end", () => {
    expect(periodFrom("2024-01-01T12:00:00Z", "2024-01-02T12:00:00Z")).toEqual({
      start: "2024-01-01T12:00:00Z",
      end: "2024-01-02T12:00:00Z",
    });
  });

  it("returns undefined when both are absent", () => {
    expect(periodFrom(undefined, undefined)).toBeUndefined();
  });
});

describe("RP -> Attachment", () => {
  it("reads the type-of-data component as a contentType hint", () => {
    expect(rpToAttachment(fieldOf("POINTER123", "", "text/plain"))).toEqual({ contentType: "text/plain" });
  });

  it("returns undefined when the pointer component is absent", () => {
    expect(rpToAttachment(fieldOf(""))).toBeUndefined();
  });
});
