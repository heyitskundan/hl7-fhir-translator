import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import type {
  AllergyIntolerance,
  Bundle,
  CareTeam,
  Condition,
  Coverage,
  Encounter,
  Location,
  MessageHeader,
  Organization,
  Patient,
  Practitioner,
  Procedure,
  Provenance,
  RelatedPerson,
} from "../src/fhir/types.js";

const ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "NK1|1|Doe^Jane|SPO",
  "GT1|1||Doe^John^A",
].join("\r");

describe("ADT^A01 -> FHIR", () => {
  const result = translateHl7ToFhir(ADT_A01);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient, an Encounter, a Location, a Practitioner, a RelatedPerson (from NK1), and a MessageHeader", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "Encounter", "Location", "Practitioner", "RelatedPerson", "MessageHeader"]);
  });

  it("maps PID demographics correctly", () => {
    const patient = bundle.entry[0]!.resource as Patient;
    expect(patient.identifier?.[0]?.value).toBe("MRN12345");
    expect(patient.name?.[0]).toEqual({ family: "Doe", given: ["John", "A"] });
    expect(patient.birthDate).toBe("1980-05-15");
    expect(patient.gender).toBe("male");
    expect(patient.address?.[0]?.city).toBe("Springfield");
  });

  it("maps PV1/EVN into an Encounter", () => {
    const encounter = bundle.entry[1]!.resource as Encounter;
    expect(encounter.class.code).toBe("IMP");
    expect(encounter.location?.[0]?.location?.display).toBe("ICU");
    expect(encounter.participant?.[0]?.individual?.display).toBe("Jane Smith");
    expect(encounter.period?.start).toBe("2024-01-01T12:00:00Z");
  });

  it("builds a Location resource from PV1-3, referenced from Encounter.location[0].location", () => {
    const encounter = bundle.entry[1]!.resource as Encounter;
    const location = bundle.entry.find((e) => e.resource.resourceType === "Location")!.resource as Location;
    expect(location.name).toBe("ICU");
    expect(encounter.location?.[0]?.location).toEqual({ reference: `Location/${location.id}`, display: "ICU" });
  });

  it("emits a warning for the unmapped GT1 segment instead of dropping it silently", () => {
    expect(result.warnings.some((w) => w.includes("GT1"))).toBe(true);
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(5);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
  });

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("HIS");
    expect(messageHeader.destination?.[0]?.name).toBe("ADT");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "A01",
      display: "ADT^A01",
    });
  });
});

describe("FHIR MessageHeader -> ADT^A01", () => {
  it("round-trips source/destination names back to MSH-3/MSH-5", () => {
    const forward = translateHl7ToFhir(ADT_A01);
    const reverse = translateFhirToHl7(forward.translated);
    const msh = reverse.translated.split("\r")[0]!.split("|");
    expect(msh[2]).toBe("HIS");
    expect(msh[4]).toBe("ADT");
  });
});

const ADT_A01_WITH_EVN_DETAIL = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000||01|7802^Rivera^Carlos^^RN|20240101115500|HOSP",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r");

describe("EVN-2/4/5/6/7 -> Provenance (only built when EVN-5 is present)", () => {
  it("builds a Provenance referencing the Patient and Encounter, with a real operator Practitioner and Location", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_EVN_DETAIL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const provenance = bundle.entry.find((e) => e.resource.resourceType === "Provenance")!.resource as Provenance;
    expect(provenance.target).toEqual([{ reference: "Patient/patient-1" }, { reference: "Encounter/encounter-1" }]);
    expect(provenance.recorded).toBe("2024-01-01T12:00:00Z");
    expect(provenance.occurredDateTime).toBe("2024-01-01T11:55:00Z");
    expect(provenance.reason?.[0]?.coding?.[0]?.code).toBe("01");
    expect(provenance.agent[0]?.who?.display).toBe("Carlos Rivera");
    expect(provenance.location?.display).toBe("HOSP");

    const operator = bundle.entry.find(
      (e) => e.resource.resourceType === "Practitioner" && `Practitioner/${e.resource.id}` === provenance.agent[0]?.who?.reference,
    )!.resource as Practitioner;
    expect(operator.name?.[0]).toEqual({ family: "Rivera", given: ["Carlos"] });
  });

  it("omits Provenance entirely when EVN-5 is absent, even if other EVN fields are present", () => {
    const result = translateHl7ToFhir(ADT_A01);
    const bundle = JSON.parse(result.translated) as Bundle;
    expect(bundle.entry.some((e) => e.resource.resourceType === "Provenance")).toBe(false);
  });
});

describe("FHIR Provenance -> ADT^A01 EVN-2/4/5/6/7", () => {
  it("round-trips recorded/reason/operator/occurred/location back to EVN", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_EVN_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const evnLine = reverse.translated.split("\r").find((l) => l.startsWith("EVN|"));
    expect(evnLine).toContain("|01|");
    expect(evnLine).toContain("Rivera^Carlos");
    expect(evnLine).toContain("20240101115500");
    expect(evnLine).toContain("HOSP");
  });
});

const ADT_A01_WITH_ROL_IN3 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "IN3|1||||||||||||||||||||Diane Okafor",
  "ROL|1|AD|PP^Primary Care Physician^HL70443|9012^Nguyen^Anh^^MD|20240101080000|20241231235959||FU^Follow-up^HL70443|IM^Internal Medicine^SCT|||5553219876^WPN^PH||Springfield Medical Group",
].join("\r");

describe("ROL-3/4/5/6/8/9/12/14 + IN3-21 -> CareTeam", () => {
  it("builds a CareTeam with one participant per ROL plus a Case Manager entry from IN3-21", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_ROL_IN3);
    const bundle = JSON.parse(result.translated) as Bundle;
    const careTeam = bundle.entry.find((e) => e.resource.resourceType === "CareTeam")!.resource as CareTeam;
    expect(careTeam.status).toBe("active");
    expect(careTeam.subject).toEqual({ reference: "Patient/patient-1" });
    expect(careTeam.participant).toHaveLength(2);
    const [rolParticipant, caseManager] = careTeam.participant!;
    expect(rolParticipant!.role).toEqual([
      { coding: [{ code: "PP", display: "Primary Care Physician" }], text: "Primary Care Physician" },
      { coding: [{ code: "IM", display: "Internal Medicine" }], text: "Internal Medicine" },
    ]);
    expect(rolParticipant!.member?.display).toBe("Anh Nguyen");
    expect(rolParticipant!.period).toEqual({ start: "2024-01-01T08:00:00Z", end: "2024-12-31T23:59:59Z" });
    expect(rolParticipant!.onBehalfOf?.display).toBe("Springfield Medical Group");
    expect(caseManager!.role?.[0]).toEqual({ text: "Diane Okafor" });
    expect(caseManager!.member).toBeUndefined();
    expect(careTeam.reasonCode?.[0]).toEqual({ coding: [{ code: "FU", display: "Follow-up" }], text: "Follow-up" });
    expect(careTeam.telecom?.[0]).toEqual({ system: "phone", value: "5553219876", use: "work" });
  });

  it("omits CareTeam entirely when neither ROL nor IN3-21 is present", () => {
    const result = translateHl7ToFhir(ADT_A01);
    const bundle = JSON.parse(result.translated) as Bundle;
    expect(bundle.entry.some((e) => e.resource.resourceType === "CareTeam")).toBe(false);
  });
});

describe("FHIR CareTeam -> ADT^A01 ROL + IN3-21", () => {
  it("round-trips participant and Case Manager fields back to ROL/IN3", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_ROL_IN3);
    const reverse = translateFhirToHl7(forward.translated);
    const rolLine = reverse.translated.split("\r").find((l) => l.startsWith("ROL|"));
    expect(rolLine).toContain("PP^Primary Care Physician");
    expect(rolLine).toContain("Nguyen^Anh");
    expect(rolLine).toContain("IM^Internal Medicine");
    expect(rolLine).toContain("Springfield Medical Group");
    expect(rolLine).toContain("FU^Follow-up");
    expect(rolLine).toContain("5553219876");
    const in3Line = reverse.translated.split("\r").find((l) => l.startsWith("IN3|"));
    expect(in3Line).toContain("Diane Okafor");
  });
});

const ADT_A01_WITH_PID_DETAIL = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA||5559876543^PRN^PH|||M^Married^HL70002|||123-45-6789|D1234567|||||2|||||N",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r");

describe("PID-13/16/19/20/25/30 -> Patient.telecom/.maritalStatus/.identifier/.multipleBirthInteger/.deceasedBoolean", () => {
  const result = translateHl7ToFhir(ADT_A01_WITH_PID_DETAIL);
  const bundle = JSON.parse(result.translated) as Bundle;
  const patient = bundle.entry[0]!.resource as Patient;

  it("maps PID-13 to telecom[0]", () => {
    expect(patient.telecom?.[0]).toEqual({ system: "phone", value: "5559876543", use: "home" });
  });

  it("maps PID-16 to maritalStatus via HL7 Table 0002", () => {
    expect(patient.maritalStatus?.coding?.[0]).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
      code: "M",
      display: "Married",
    });
  });

  it("maps PID-19/PID-20 to additional identifiers typed SS/DL", () => {
    expect(patient.identifier?.[1]).toEqual({ value: "123-45-6789", type: { coding: [{ code: "SS" }] } });
    expect(patient.identifier?.[2]).toEqual({ value: "D1234567", type: { coding: [{ code: "DL" }] } });
  });

  it("prefers PID-25 (birth order) over PID-24 when both could apply, producing multipleBirthInteger", () => {
    expect(patient.multipleBirthInteger).toBe(2);
    expect(patient.multipleBirthBoolean).toBeUndefined();
  });

  it("maps PID-30 'N' to deceasedBoolean false", () => {
    expect(patient.deceasedBoolean).toBe(false);
    expect(patient.deceasedDateTime).toBeUndefined();
  });
});

describe("PID-24/PID-29 -> Patient.multipleBirthBoolean/.deceasedDateTime (only read when PID-25/PID-30 are absent)", () => {
  const hl7 = [
    "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
    "EVN|A01|20240101120000",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M||||||||||||||||Y|||||20240215093000",
    "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  ].join("\r");

  it("falls back to PID-24 for multipleBirthBoolean and PID-29 for deceasedDateTime", () => {
    const result = translateHl7ToFhir(hl7);
    const bundle = JSON.parse(result.translated) as Bundle;
    const patient = bundle.entry[0]!.resource as Patient;
    expect(patient.multipleBirthBoolean).toBe(true);
    expect(patient.multipleBirthInteger).toBeUndefined();
    expect(patient.deceasedDateTime).toBe("2024-02-15T09:30:00Z");
    expect(patient.deceasedBoolean).toBeUndefined();
  });

  it("round-trips multipleBirthBoolean and deceasedDateTime back to PID-24/PID-29", () => {
    const forward = translateHl7ToFhir(hl7);
    const reverse = translateFhirToHl7(forward.translated);
    const pidLine = reverse.translated.split("\r").find((l) => l.startsWith("PID|"));
    expect(pidLine).toContain("|Y|");
    expect(pidLine).toContain("20240215093000");
  });
});

describe("FHIR Patient(PID detail) -> ADT^A01", () => {
  it("round-trips telecom, maritalStatus, SS/DL identifiers, multipleBirthInteger, and deceasedBoolean", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_PID_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const pidLine = reverse.translated.split("\r").find((l) => l.startsWith("PID|"));
    expect(pidLine).toContain("5559876543");
    expect(pidLine).toContain("|M|");
    expect(pidLine).toContain("123-45-6789");
    expect(pidLine).toContain("D1234567");
    expect(pidLine).toContain("|2|");
    expect(pidLine).toMatch(/\|N$/);
  });
});

const ADT_A01_WITH_PV1_DETAIL = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD|5678^Johnson^Mary^R^MD|||||||||||VN000123|||||||||||||||||||||||||20240101110000|20240103150000",
].join("\r");

describe("PV1-8/PV1-19/PV1-44/PV1-45 -> Encounter.participant/.identifier/.period", () => {
  const result = translateHl7ToFhir(ADT_A01_WITH_PV1_DETAIL);
  const bundle = JSON.parse(result.translated) as Bundle;
  const encounter = bundle.entry.find((e) => e.resource.resourceType === "Encounter")!.resource as Encounter;

  it("maps PV1-8 to a REF-typed participant alongside PV1-7's ATND-typed one, each referencing a Practitioner", () => {
    expect(encounter.participant?.[0]).toEqual({
      individual: { reference: "Practitioner/practitioner-attending", display: "Jane Smith" },
      type: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", code: "ATND", display: "attender" }] }],
    });
    expect(encounter.participant?.[1]).toEqual({
      individual: { reference: "Practitioner/practitioner-referring", display: "Mary Johnson" },
      type: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", code: "REF", display: "referrer" }] }],
    });
  });

  it("maps PV1-19 to identifier[0]", () => {
    expect(encounter.identifier?.[0]).toEqual({ value: "VN000123" });
  });

  it("prefers PV1-44/PV1-45 over EVN-2 for period.start/.end", () => {
    expect(encounter.period).toEqual({ start: "2024-01-01T11:00:00Z", end: "2024-01-03T15:00:00Z" });
  });
});

describe("FHIR Encounter(PV1 detail) -> ADT^A01", () => {
  it("round-trips referring doctor, visit number, and admit/discharge times", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_PV1_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const pv1Line = reverse.translated.split("\r").find((l) => l.startsWith("PV1|"));
    expect(pv1Line).toContain("Johnson^Mary");
    expect(pv1Line).toContain("VN000123");
    expect(pv1Line).toContain("20240101110000");
    expect(pv1Line).toContain("20240103150000");
  });
});

describe("NK1 -> RelatedPerson", () => {
  it("maps name and HL7 Table 0063 relationship code to v3-RoleCode", () => {
    const result = translateHl7ToFhir(ADT_A01);
    const bundle = JSON.parse(result.translated) as Bundle;
    const relatedPerson = bundle.entry.find((e) => e.resource.resourceType === "RelatedPerson")!.resource as RelatedPerson;
    expect(relatedPerson.name?.[0]).toEqual({ family: "Doe", given: ["Jane"] });
    expect(relatedPerson.relationship?.[0]?.coding?.[0]).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
      code: "SPS",
      display: "spouse",
    });
    expect(relatedPerson.patient.reference).toBe(`Patient/${bundle.entry[0]!.resource.id}`);
  });
});

describe("FHIR Patient+RelatedPerson -> ADT^A01", () => {
  it("round-trips name and relationship back to NK1", () => {
    const forward = translateHl7ToFhir(ADT_A01);
    const reverse = translateFhirToHl7(forward.translated);
    const nk1Lines = reverse.translated.split("\r").filter((l) => l.startsWith("NK1|"));
    expect(nk1Lines).toHaveLength(1);
    expect(nk1Lines[0]).toContain("Doe^Jane");
    expect(nk1Lines[0]).toContain("SPO");
  });
});

const ADT_A01_WITH_NK1_DETAIL = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "NK1|1|Doe^Jane^M|SPO|123 Main St^^Springfield^IL^62701^USA|5551234567^PRN^PH|||||||EMP009^^^HOSP|||F|19820310",
].join("\r");

describe("NK1-12/NK1-15/NK1-16 -> RelatedPerson.identifier/.gender/.birthDate", () => {
  it("maps the extra NK1 fields", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_NK1_DETAIL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const relatedPerson = bundle.entry.find((e) => e.resource.resourceType === "RelatedPerson")!.resource as RelatedPerson;
    expect(relatedPerson.identifier?.[0]).toEqual({ value: "EMP009", assigner: { display: "HOSP" } });
    expect(relatedPerson.gender).toBe("female");
    expect(relatedPerson.birthDate).toBe("1982-03-10");
  });

  it("round-trips the extra fields back to NK1-12/NK1-15/NK1-16", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_NK1_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const nk1Line = reverse.translated.split("\r").find((l) => l.startsWith("NK1|"));
    expect(nk1Line).toContain("EMP009");
    expect(nk1Line).toContain("|F|");
    expect(nk1Line).toContain("19820310");
  });
});

describe("FHIR Patient(+Encounter) -> ADT^A01", () => {
  it("round-trips the key demographic and encounter fields", () => {
    const forward = translateHl7ToFhir(ADT_A01);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.startsWith("MSH|^~\\&|")).toBe(true);
    expect(reverse.translated).toContain("ADT^A01");
    expect(reverse.translated).toContain("MRN12345");
    expect(reverse.translated).toContain("Doe^John^A");
    expect(reverse.translated).toContain("19800515");
  });

  it("throws when the bundle has no Patient resource", () => {
    const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [] };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow();
  });

  it("omits the PV1 segment and warns when the bundle has no Encounter resource", () => {
    const patientOnly: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "p1", name: [{ family: "Doe" }] } }],
    };
    const result = translateFhirToHl7(JSON.stringify(patientOnly));
    expect(result.translated).not.toContain("PV1|");
    expect(result.warnings.some((w) => w.includes("PV1"))).toBe(true);
  });
});

describe("malformed ADT input", () => {
  it("throws a typed error instead of guessing when the PID segment is absent", () => {
    const noPid = ["MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5", "EVN|A01|20240101120000"].join("\r");
    expect(() => translateHl7ToFhir(noPid)).toThrow(/PID/);
  });
});

/**
 * A02 (transfer), A06 (outpatient -> inpatient), and A09 (patient departing - tracking)
 * carry no HL7v2-encoded Encounter-level state change beyond what PV1 already maps
 * (location, class) — see the STATUS_FOR_TRIGGER comment in adt.ts — so they stay
 * "in-progress", same as A01/A08.
 */
describe.each([
  ["A02", "adt_a02"],
  ["A06", "adt_a06"],
  ["A09", "adt_a09"],
])("ADT^%s -> FHIR", (trigger, sampleName) => {
  it(`accepts the trigger and produces an in-progress Encounter`, () => {
    const hl7 = [
      `MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240107100000||ADT^${trigger}|MSG014|P|2.5`,
      `EVN|${trigger}|20240107100000`,
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
      "PV1|1|I|WARD3^305^A^^^HOSP||||1234^Smith^Jane^M^MD",
    ].join("\r");
    const result = translateHl7ToFhir(hl7);
    const bundle = JSON.parse(result.translated) as Bundle;
    const encounter = bundle.entry[1]!.resource as Encounter;
    expect(encounter.status).toBe("in-progress");
    expect(encounter.class.code).toBe("IMP");
    void sampleName; // sample file existence is exercised via mapping-audit.test.ts
  });
});

describe("ADT^A05 (pre-admit) -> FHIR", () => {
  it("produces a planned Encounter, not yet in-progress", () => {
    const A05 = [
      "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240108083000||ADT^A05|MSG015|P|2.5",
      "EVN|A05|20240108083000",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
      "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
    ].join("\r");
    const result = translateHl7ToFhir(A05);
    const bundle = JSON.parse(result.translated) as Bundle;
    const encounter = bundle.entry[1]!.resource as Encounter;
    expect(encounter.status).toBe("planned");
  });
});

describe("FHIR Encounter(status: planned) -> ADT^A05", () => {
  it("picks A05 as MSH-9's trigger from Encounter.status alone", () => {
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: { resourceType: "Patient", id: "patient-1", name: [{ family: "Doe" }] } },
        {
          resource: {
            resourceType: "Encounter",
            id: "encounter-1",
            status: "planned",
            class: { code: "IMP" },
            subject: { reference: "Patient/patient-1" },
          },
        },
      ],
    };
    const result = translateFhirToHl7(JSON.stringify(bundle));
    expect(result.translated).toContain("ADT^A05");
  });
});

describe("ADT^A11 (cancel admit) -> FHIR", () => {
  it("produces an entered-in-error Encounter", () => {
    const A11 = [
      "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240111090000||ADT^A11|MSG018|P|2.5",
      "EVN|A11|20240111090000",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
      "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
    ].join("\r");
    const result = translateHl7ToFhir(A11);
    const bundle = JSON.parse(result.translated) as Bundle;
    const encounter = bundle.entry[1]!.resource as Encounter;
    expect(encounter.status).toBe("entered-in-error");
  });
});

describe("FHIR Encounter(status: entered-in-error) -> ADT^A11", () => {
  it("picks A11 as MSH-9's trigger from Encounter.status alone", () => {
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: { resourceType: "Patient", id: "patient-1", name: [{ family: "Doe" }] } },
        {
          resource: {
            resourceType: "Encounter",
            id: "encounter-1",
            status: "entered-in-error",
            class: { code: "IMP" },
            subject: { reference: "Patient/patient-1" },
          },
        },
      ],
    };
    const result = translateFhirToHl7(JSON.stringify(bundle));
    expect(result.translated).toContain("ADT^A11");
  });
});

const ADT_A17 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240112143000||ADT^A17|MSG019|P|2.5",
  "EVN|A17|20240112143000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "PID|2||MRN67890^^^HOSP^MR||Roe^Richard^B||19750822|M|||789 Elm St^^Springfield^IL^62701^USA",
  "PV1|2|I|ICU^102^B^^^HOSP||||5678^Nguyen^Anh^^MD",
].join("\r");

describe("ADT^A17 (swap patients) -> FHIR", () => {
  const result = translateHl7ToFhir(ADT_A17);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces two Patient+Encounter+Location+Practitioner groups, one per PID/PV1 group, plus a MessageHeader", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual([
      "Patient",
      "Encounter",
      "Location",
      "Practitioner",
      "Patient",
      "Encounter",
      "Location",
      "Practitioner",
      "MessageHeader",
    ]);
  });

  it("maps each patient's own demographics and location, not a mix of the two", () => {
    const patients = bundle.entry.filter((e): e is { resource: Patient } => e.resource.resourceType === "Patient");
    const encounters = bundle.entry.filter((e): e is { resource: Encounter } => e.resource.resourceType === "Encounter");
    const [p1, p2] = patients.map((e) => e.resource);
    const [e1, e2] = encounters.map((e) => e.resource);
    expect(p1!.identifier?.[0]?.value).toBe("MRN12345");
    expect(p1!.name?.[0]?.family).toBe("Doe");
    expect(e1!.location?.[0]?.location?.display).toBe("ICU");
    expect(e1!.subject?.reference).toBe(`Patient/${p1!.id}`);

    expect(p2!.identifier?.[0]?.value).toBe("MRN67890");
    expect(p2!.name?.[0]?.family).toBe("Roe");
    expect(e2!.participant?.[0]?.individual?.display).toBe("Anh Nguyen");
    expect(e2!.subject?.reference).toBe(`Patient/${p2!.id}`);
  });

  it("throws when only one PID segment is present", () => {
    const oneSided = [
      "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240112143000||ADT^A17|MSG019|P|2.5",
      "EVN|A17|20240112143000",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "PV1|1|I|ICU^101^A^^^HOSP",
    ].join("\r");
    expect(() => translateHl7ToFhir(oneSided)).toThrow(/two PID segments/);
  });
});

describe("FHIR two Patients+Encounters -> ADT^A17", () => {
  it("round-trips both patients into two correctly paired PID/PV1 groups", () => {
    const forward = translateHl7ToFhir(ADT_A17);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("ADT^A17");
    const pidCount = (reverse.translated.match(/(^|\r)PID\|/g) ?? []).length;
    const pv1Count = (reverse.translated.match(/(^|\r)PV1\|/g) ?? []).length;
    expect(pidCount).toBe(2);
    expect(pv1Count).toBe(2);
    expect(reverse.translated).toContain("MRN12345");
    expect(reverse.translated).toContain("MRN67890");
  });
});

const ADT_A17_WITH_EVN_DETAIL = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240112143000||ADT^A17|MSG019|P|2.5",
  "EVN|A17|20240112143000||05|8891^Chen^Linda^^RN|20240112142900|HOSP",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP",
  "PID|2||MRN67890^^^HOSP^MR||Roe^Richard^B||19750822|M",
  "PV1|2|I|ICU^102^B^^^HOSP",
].join("\r");

describe("EVN-2/4/5/6/7 -> Provenance (ADT^A17, shared across both patients)", () => {
  it("builds a single Provenance targeting both patients and both encounters", () => {
    const result = translateHl7ToFhir(ADT_A17_WITH_EVN_DETAIL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const provenance = bundle.entry.find((e) => e.resource.resourceType === "Provenance")!.resource as Provenance;
    expect(provenance.target).toEqual([
      { reference: "Patient/patient-1" },
      { reference: "Encounter/encounter-1" },
      { reference: "Patient/patient-2" },
      { reference: "Encounter/encounter-2" },
    ]);
    expect(provenance.agent[0]?.who?.display).toBe("Linda Chen");
  });
});

const ADT_A01_WITH_ALLERGY = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "AL1|1|DA|1191^Aspirin^RXNORM|SV|Anaphylaxis|20230101",
  "AL1|2|FA|^Peanuts|MI|Hives",
].join("\r");

describe("AL1 -> AllergyIntolerance", () => {
  const result = translateHl7ToFhir(ADT_A01_WITH_ALLERGY);
  const bundle = JSON.parse(result.translated) as Bundle;
  const allergies = bundle.entry.map((e) => e.resource).filter((r): r is AllergyIntolerance => r.resourceType === "AllergyIntolerance");

  it("produces one AllergyIntolerance per AL1 segment, referencing the Patient", () => {
    expect(allergies).toHaveLength(2);
    const patient = bundle.entry[0]!.resource as Patient;
    expect(allergies[0]!.patient.reference).toBe(`Patient/${patient.id}`);
  });

  it("maps category, code, criticality, reaction text, and onset from the first AL1", () => {
    const first = allergies[0]!;
    expect(first.category).toEqual(["medication"]);
    expect(first.code?.coding?.[0]?.code).toBe("1191");
    expect(first.code?.coding?.[0]?.display).toBe("Aspirin");
    expect(first.criticality).toBe("high");
    expect(first.reaction?.[0]?.manifestation?.[0]?.text).toBe("Anaphylaxis");
    expect(first.onsetDateTime).toBe("2023-01-01");
  });

  it("defaults clinicalStatus to active, since AL1 carries no clinical-status signal", () => {
    expect(allergies[0]!.clinicalStatus?.coding?.[0]?.code).toBe("active");
  });

  it("maps a second AL1 (food allergy, mild) independently of the first", () => {
    const second = allergies[1]!;
    expect(second.category).toEqual(["food"]);
    expect(second.criticality).toBe("low");
    expect(second.reaction?.[0]?.manifestation?.[0]?.text).toBe("Hives");
    expect(second.onsetDateTime).toBeUndefined();
  });

  it("maps AL1-4 to reaction.severity alongside criticality (both are targets of the same field)", () => {
    expect(allergies[0]!.reaction?.[0]?.severity).toBe("severe");
    expect(allergies[1]!.reaction?.[0]?.severity).toBe("mild");
  });
});

describe("AL1-4 -> reaction.severity when there's no criticality mapping for the code", () => {
  it("still maps severity from a code (e.g. MO) absent from the criticality table", () => {
    const hl7 = [
      "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
      "EVN|A01|20240101120000",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
      "AL1|1|DA|1191^Aspirin^RXNORM|MO|Rash",
    ].join("\r");
    const result = translateHl7ToFhir(hl7);
    const bundle = JSON.parse(result.translated) as Bundle;
    const allergy = bundle.entry.find((e) => e.resource.resourceType === "AllergyIntolerance")!.resource as AllergyIntolerance;
    expect(allergy.criticality).toBeUndefined();
    expect(allergy.reaction?.[0]?.severity).toBe("moderate");
  });

  it("round-trips a severity-only value back to AL1-4", () => {
    const hl7 = [
      "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
      "EVN|A01|20240101120000",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
      "AL1|1|DA|1191^Aspirin^RXNORM|MO|Rash",
    ].join("\r");
    const forward = translateHl7ToFhir(hl7);
    const reverse = translateFhirToHl7(forward.translated);
    const al1Line = reverse.translated.split("\r").find((l) => l.startsWith("AL1|"));
    expect(al1Line).toContain("|MO|");
  });
});

describe("FHIR Patient+AllergyIntolerance -> ADT^A01", () => {
  it("round-trips category, code, criticality, reaction text, and onset back to AL1", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_ALLERGY);
    const reverse = translateFhirToHl7(forward.translated);
    const al1Lines = reverse.translated.split("\r").filter((l) => l.startsWith("AL1|"));
    expect(al1Lines).toHaveLength(2);
    expect(al1Lines[0]).toContain("DA");
    expect(al1Lines[0]).toContain("1191");
    expect(al1Lines[0]).toContain("SV");
    expect(al1Lines[0]).toContain("Anaphylaxis");
    expect(al1Lines[0]).toContain("20230101");
  });
});

// DG1-21 (confirmation status) is field position 21 — built via array positions rather than
// hand-counted pipes, since a wrong pipe count silently lands "D" in the wrong field.
function dg1Line(setId: string, code: string, onset: string, confirmationStatus?: string): string {
  const fields = new Array(21).fill("");
  fields[0] = setId;
  fields[2] = code;
  fields[4] = onset;
  if (confirmationStatus) fields[20] = confirmationStatus;
  return `DG1|${fields.join("|")}`;
}

const ADT_A01_WITH_DIAGNOSIS = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  dg1Line("1", "E119^Type 2 diabetes mellitus without complications^ICD10", "20240101120000", "A"),
  dg1Line("2", "J45^Asthma^ICD10", "20240102080000", "D"),
].join("\r");

describe("DG1 -> Condition", () => {
  const result = translateHl7ToFhir(ADT_A01_WITH_DIAGNOSIS);
  const bundle = JSON.parse(result.translated) as Bundle;
  const conditions = bundle.entry.map((e) => e.resource).filter((r): r is Condition => r.resourceType === "Condition");

  it("produces one Condition per DG1 segment, referencing the Patient", () => {
    expect(conditions).toHaveLength(2);
    const patient = bundle.entry[0]!.resource as Patient;
    expect(conditions[0]!.subject.reference).toBe(`Patient/${patient.id}`);
  });

  it("maps code and onsetDateTime from DG1-3/DG1-5", () => {
    const first = conditions[0]!;
    expect(first.code?.coding?.[0]?.code).toBe("E119");
    expect(first.code?.coding?.[0]?.display).toBe("Type 2 diabetes mellitus without complications");
    expect(first.onsetDateTime).toBe("2024-01-01T12:00:00Z");
  });

  it("leaves verificationStatus unset for a confirmation code other than 'D', per the IG's own note that only 'D' maps", () => {
    expect(conditions[0]!.verificationStatus).toBeUndefined();
  });

  it("maps DG1-21 'D' to verificationStatus entered-in-error", () => {
    expect(conditions[1]!.verificationStatus?.coding?.[0]?.code).toBe("entered-in-error");
  });
});

describe("FHIR Patient+Condition -> ADT^A01", () => {
  it("round-trips code, onset, and the 'D' verificationStatus back to DG1", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_DIAGNOSIS);
    const reverse = translateFhirToHl7(forward.translated);
    const dg1Lines = reverse.translated.split("\r").filter((l) => l.startsWith("DG1|"));
    expect(dg1Lines).toHaveLength(2);
    expect(dg1Lines[0]).toContain("E119");
    expect(dg1Lines[1]).toMatch(/\|D$/);
  });
});

function dg1LineWithAsserter(setId: string, code: string, onset: string, asserterFamily: string, asserterGiven: string): string {
  const fields = new Array(16).fill("");
  fields[0] = setId;
  fields[2] = code;
  fields[4] = onset;
  fields[15] = `9012^${asserterFamily}^${asserterGiven}^^MD`;
  return `DG1|${fields.join("|")}`;
}

const ADT_A01_WITH_DIAGNOSIS_ASSERTER = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  dg1LineWithAsserter("1", "E119^Type 2 diabetes mellitus without complications^ICD10", "20240101120000", "Nguyen", "Anh"),
].join("\r");

describe("DG1-16 -> Condition.asserter (a real Practitioner resource)", () => {
  it("builds a Practitioner from the diagnosing clinician, referenced from Condition.asserter", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_DIAGNOSIS_ASSERTER);
    const bundle = JSON.parse(result.translated) as Bundle;
    const condition = bundle.entry.find((e) => e.resource.resourceType === "Condition")!.resource as Condition;
    const practitioner = bundle.entry.find(
      (e): e is { resource: Practitioner } =>
        e.resource.resourceType === "Practitioner" && `Practitioner/${e.resource.id}` === condition.asserter?.reference,
    )!.resource;
    expect(practitioner.name?.[0]).toEqual({ family: "Nguyen", given: ["Anh"] });
    expect(condition.asserter).toEqual({ reference: `Practitioner/${practitioner.id}`, display: "Anh Nguyen" });
  });

  it("round-trips the asserter's structured name back to DG1-16", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_DIAGNOSIS_ASSERTER);
    const reverse = translateFhirToHl7(forward.translated);
    const dg1Line = reverse.translated.split("\r").find((l) => l.startsWith("DG1|"));
    expect(dg1Line).toContain("Nguyen^Anh");
  });
});

// DG1-6 (diagnosis type) and DG1-15 (diagnosis priority) are field positions 6 and 15 —
// built via array positions for the same reason dg1Line() above is.
function dg1LineWithTypeAndRank(setId: string, code: string, type: string, rank: string): string {
  const fields = new Array(15).fill("");
  fields[0] = setId;
  fields[2] = code;
  fields[5] = type;
  fields[14] = rank;
  return `DG1|${fields.join("|")}`;
}

const ADT_A01_WITH_ENCOUNTER_DIAGNOSIS = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  dg1LineWithTypeAndRank("1", "E119^Type 2 diabetes mellitus without complications^ICD10", "W^Working^HL70052", "1"),
].join("\r");

describe("DG1-6/DG1-15 -> Encounter.diagnosis", () => {
  it("maps diagnosis use and rank, referencing the matching Condition", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_ENCOUNTER_DIAGNOSIS);
    const bundle = JSON.parse(result.translated) as Bundle;
    const encounter = bundle.entry.find((e) => e.resource.resourceType === "Encounter")!.resource as Encounter;
    const condition = bundle.entry.find((e) => e.resource.resourceType === "Condition")!.resource as Condition;
    expect(encounter.diagnosis).toEqual([
      {
        condition: { reference: `Condition/${condition.id}` },
        use: { coding: [{ code: "W", display: "Working" }], text: "Working" },
        rank: 1,
      },
    ]);
  });

  it("round-trips diagnosis use and rank back to DG1-6/DG1-15", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_ENCOUNTER_DIAGNOSIS);
    const reverse = translateFhirToHl7(forward.translated);
    const dg1Line = reverse.translated.split("\r").find((l) => l.startsWith("DG1|"));
    expect(dg1Line).toContain("W^Working");
    expect(dg1Line).toMatch(/\|1$/);
  });

  it("omits Encounter.diagnosis when no DG1 has a type or priority", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_DIAGNOSIS);
    const bundle = JSON.parse(result.translated) as Bundle;
    const encounter = bundle.entry.find((e) => e.resource.resourceType === "Encounter")!.resource as Encounter;
    expect(encounter.diagnosis).toBeUndefined();
  });
});

function in1Line(
  setId: string,
  planId: string,
  payorName: string,
  policyHolderName: string,
  start: string,
  end: string,
  typeCode: string,
  typeDisplay: string,
  subscriberName: string,
  relationshipCode: string,
): string {
  const fields = new Array(17).fill("");
  fields[0] = setId;
  fields[1] = planId;
  fields[3] = payorName;
  fields[10] = policyHolderName;
  fields[11] = start;
  fields[12] = end;
  fields[14] = `${typeCode}^${typeDisplay}`;
  fields[15] = subscriberName;
  fields[16] = relationshipCode;
  return `IN1|${fields.join("|")}`;
}

const ADT_A01_WITH_COVERAGE = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  in1Line(
    "1",
    "PLAN001",
    "Blue Cross",
    "ACME Corp Group",
    "20240101",
    "20241231",
    "HMO",
    "Health Maintenance Organization",
    "Doe^John^A",
    "SEL",
  ),
].join("\r");

describe("IN1 -> Coverage", () => {
  const result = translateHl7ToFhir(ADT_A01_WITH_COVERAGE);
  const bundle = JSON.parse(result.translated) as Bundle;
  const coverage = bundle.entry.find((e) => e.resource.resourceType === "Coverage")!.resource as Coverage;

  it("always sets status active and beneficiary to the Patient, since IN1 carries no status field", () => {
    expect(coverage.status).toBe("active");
    const patient = bundle.entry[0]!.resource as Patient;
    expect(coverage.beneficiary.reference).toBe(`Patient/${patient.id}`);
  });

  it("maps identifier, payor, policyHolder, period, type, subscriber, and relationship", () => {
    expect(coverage.identifier?.[0]?.value).toBe("PLAN001");
    expect(coverage.payor[0]?.display).toBe("Blue Cross");
    expect(coverage.policyHolder?.display).toBe("ACME Corp Group");
    expect(coverage.period?.start).toBe("2024-01-01");
    expect(coverage.period?.end).toBe("2024-12-31");
    expect(coverage.type?.coding?.[0]?.code).toBe("HMO");
    expect(coverage.subscriber?.display).toBe("John Doe");
    expect(coverage.relationship?.coding?.[0]).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
      code: "ONESELF",
      display: "self",
    });
  });
});

describe("FHIR Patient+Coverage -> ADT^A01", () => {
  it("round-trips identifier, payor, and relationship back to IN1", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_COVERAGE);
    const reverse = translateFhirToHl7(forward.translated);
    const in1Lines = reverse.translated.split("\r").filter((l) => l.startsWith("IN1|"));
    expect(in1Lines).toHaveLength(1);
    expect(in1Lines[0]).toContain("PLAN001");
    expect(in1Lines[0]).toContain("Blue Cross");
    expect(in1Lines[0]).toContain("SEL");
  });
});

const ADT_A01_WITH_PAYOR_ADDRESS = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "IN1|1|PLAN001||Blue Cross|1 Insurance Plaza^^Chicago^IL^60601^USA",
].join("\r");

describe("IN1-4/IN1-5 -> a real Organization resource (Coverage.payor references it)", () => {
  it("builds an Organization from the payor name and address, referenced from Coverage.payor", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_PAYOR_ADDRESS);
    const bundle = JSON.parse(result.translated) as Bundle;
    const coverage = bundle.entry.find((e) => e.resource.resourceType === "Coverage")!.resource as Coverage;
    const organization = bundle.entry.find((e) => e.resource.resourceType === "Organization")!.resource as Organization;
    expect(organization.name).toBe("Blue Cross");
    expect(organization.address?.[0]).toEqual({
      line: ["1 Insurance Plaza"],
      city: "Chicago",
      state: "IL",
      postalCode: "60601",
      country: "USA",
    });
    expect(coverage.payor[0]).toEqual({ reference: `Organization/${organization.id}`, display: "Blue Cross" });
  });

  it("round-trips the Organization's name and address back to IN1-4/IN1-5", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_PAYOR_ADDRESS);
    const reverse = translateFhirToHl7(forward.translated);
    const in1Line = reverse.translated.split("\r").find((l) => l.startsWith("IN1|"));
    expect(in1Line).toContain("Blue Cross");
    expect(in1Line).toContain("1 Insurance Plaza^^Chicago^IL^60601^USA");
  });
});

function pr1Line(setId: string, code: string, performedDate: string, location: string): string {
  const fields = new Array(23).fill("");
  fields[0] = setId;
  fields[2] = code;
  fields[4] = performedDate;
  fields[22] = location;
  return `PR1|${fields.join("|")}`;
}

const ADT_A01_WITH_PROCEDURE = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  pr1Line("1", "89050^Appendectomy^CPT", "20240101110000", "OR1"),
].join("\r");

describe("PR1 -> Procedure", () => {
  const result = translateHl7ToFhir(ADT_A01_WITH_PROCEDURE);
  const bundle = JSON.parse(result.translated) as Bundle;
  const procedure = bundle.entry.find((e) => e.resource.resourceType === "Procedure")!.resource as Procedure;

  it("always sets status unknown, per the IG's own guidance that status depends on message context", () => {
    expect(procedure.status).toBe("unknown");
  });

  it("maps code, performedDateTime, and location", () => {
    expect(procedure.code?.coding?.[0]?.code).toBe("89050");
    expect(procedure.code?.coding?.[0]?.display).toBe("Appendectomy");
    expect(procedure.performedDateTime).toBe("2024-01-01T11:00:00Z");
    expect(procedure.location?.display).toBe("OR1");
    expect(procedure.subject.reference).toBe(`Patient/${(bundle.entry[0]!.resource as Patient).id}`);
  });
});

describe("FHIR Patient+Procedure -> ADT^A01", () => {
  it("round-trips code and location back to PR1", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_PROCEDURE);
    const reverse = translateFhirToHl7(forward.translated);
    const pr1Lines = reverse.translated.split("\r").filter((l) => l.startsWith("PR1|"));
    expect(pr1Lines).toHaveLength(1);
    expect(pr1Lines[0]).toContain("89050");
    expect(pr1Lines[0]).toContain("OR1");
  });
});

function pr1LineWithCategoryAndReason(setId: string, code: string, performedDate: string, category: string, reason: string): string {
  const fields = new Array(23).fill("");
  fields[0] = setId;
  fields[2] = code;
  fields[4] = performedDate;
  fields[5] = category;
  fields[14] = reason;
  return `PR1|${fields.join("|")}`;
}

const ADT_A01_WITH_PROCEDURE_DETAIL = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  pr1LineWithCategoryAndReason("1", "89050^Appendectomy^CPT", "20240101110000", "S^Surgical^HL70230", "K35.80^Acute appendicitis^ICD10"),
].join("\r");

describe("PR1-6/PR1-15 -> Procedure.category/.reasonCode", () => {
  it("maps the extra PR1 fields", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_PROCEDURE_DETAIL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const procedure = bundle.entry.find((e) => e.resource.resourceType === "Procedure")!.resource as Procedure;
    expect(procedure.category?.coding?.[0]).toEqual({ code: "S", display: "Surgical" });
    expect(procedure.reasonCode?.[0]?.coding?.[0]).toEqual({ code: "K35.80", display: "Acute appendicitis" });
  });

  it("round-trips category and reasonCode back to PR1-6/PR1-15", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_PROCEDURE_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const pr1Line = reverse.translated.split("\r").find((l) => l.startsWith("PR1|"));
    expect(pr1Line).toContain("S^Surgical");
    expect(pr1Line).toContain("K35.80^Acute appendicitis");
  });
});

const ADT_A01_WITH_PD1_PV2 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PD1|||FAMILY PRACTICE ASSOCIATES|9012^Nguyen^Anh^^MD",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "PV2|||CHKUP^Annual checkup",
].join("\r");

describe("PD1 -> Patient.generalPractitioner", () => {
  it("maps the org name (PD1-3) and practitioner name (PD1-4) as separate references", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_PD1_PV2);
    const bundle = JSON.parse(result.translated) as Bundle;
    const patient = bundle.entry[0]!.resource as Patient;
    expect(patient.generalPractitioner).toEqual([{ display: "FAMILY PRACTICE ASSOCIATES" }, { display: "Anh Nguyen" }]);
  });
});

describe("PV2 -> Encounter.reasonCode", () => {
  it("maps PV2-3 to reasonCode[0]", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_PD1_PV2);
    const bundle = JSON.parse(result.translated) as Bundle;
    const encounter = bundle.entry[1]!.resource as Encounter;
    expect(encounter.reasonCode?.[0]?.coding?.[0]).toEqual({ code: "CHKUP", display: "Annual checkup" });
  });
});

describe("FHIR Patient(generalPractitioner)+Encounter(reasonCode) -> ADT^A01", () => {
  it("round-trips both back to PD1 and PV2", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_PD1_PV2);
    const reverse = translateFhirToHl7(forward.translated);
    const pd1Line = reverse.translated.split("\r").find((l) => l.startsWith("PD1|"));
    const pv2Line = reverse.translated.split("\r").find((l) => l.startsWith("PV2|"));
    expect(pd1Line).toContain("FAMILY PRACTICE ASSOCIATES");
    expect(pd1Line).toContain("Nguyen");
    expect(pv2Line).toContain("CHKUP");
  });
});

const ADT_A01_WITH_PV2_PRIORITY = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "PV2|||CHKUP^Annual checkup||||||||||||||||||||||R^Routine^HL70360",
].join("\r");

describe("PV2-25 -> Encounter.priority", () => {
  it("maps PV2-25 alongside PV2-3", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_PV2_PRIORITY);
    const bundle = JSON.parse(result.translated) as Bundle;
    const encounter = bundle.entry.find((e) => e.resource.resourceType === "Encounter")!.resource as Encounter;
    expect(encounter.priority?.coding?.[0]).toEqual({ code: "R", display: "Routine" });
  });

  it("round-trips priority back to PV2-25", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_PV2_PRIORITY);
    const reverse = translateFhirToHl7(forward.translated);
    const pv2Line = reverse.translated.split("\r").find((l) => l.startsWith("PV2|"));
    expect(pv2Line).toContain("R^Routine");
  });
});

const ADT_A01_WITH_SFT_MSA = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "SFT|Acme Health^^^^^XX^^^12345|3.2.1|OrderEntry",
  "MSA|AA|MSG000",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r");

describe("SFT-2/SFT-3 -> MessageHeader.source.version/.source.software", () => {
  it("maps SFT-2/SFT-3 onto the same MessageHeader MSH already produces", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_SFT_MSA);
    const bundle = JSON.parse(result.translated) as Bundle;
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.version).toBe("3.2.1");
    expect(messageHeader.source.software).toBe("OrderEntry");
  });

  it("round-trips version/software back to SFT-2/SFT-3", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_SFT_MSA);
    const reverse = translateFhirToHl7(forward.translated);
    const sftLine = reverse.translated.split("\r").find((l) => l.startsWith("SFT|"));
    expect(sftLine).toBe("SFT||3.2.1|OrderEntry");
  });
});

describe("MSA-1/MSA-2 -> MessageHeader.response", () => {
  it("maps the HL70008 ack code to a FHIR response-code and carries the control id", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_SFT_MSA);
    const bundle = JSON.parse(result.translated) as Bundle;
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.response).toEqual({ code: "ok", identifier: "MSG000" });
  });

  it("round-trips response back to MSA-1/MSA-2", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_SFT_MSA);
    const reverse = translateFhirToHl7(forward.translated);
    const msaLine = reverse.translated.split("\r").find((l) => l.startsWith("MSA|"));
    expect(msaLine).toBe("MSA|AA|MSG000");
  });
});

const ADT_A01_WITH_IAM = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "IAM|1|DA|7980^Penicillin^RXNORM||Rash||MRN12345^^^HOSP^MR||||20230101",
].join("\r");

describe("IAM -> AllergyIntolerance", () => {
  it("produces an AllergyIntolerance carrying an identifier (IAM-7), distinguishing it from an AL1-sourced one", () => {
    const result = translateHl7ToFhir(ADT_A01_WITH_IAM);
    const bundle = JSON.parse(result.translated) as Bundle;
    const allergy = bundle.entry.find((e) => e.resource.resourceType === "AllergyIntolerance")!.resource as AllergyIntolerance;
    expect(allergy.code?.coding?.[0]?.code).toBe("7980");
    expect(allergy.reaction?.[0]?.manifestation?.[0]?.text).toBe("Rash");
    expect(allergy.onsetDateTime).toBe("2023-01-01");
    expect(allergy.identifier?.[0]?.value).toBe("MRN12345");
  });

  it("round-trips back to an IAM segment, not AL1", () => {
    const forward = translateHl7ToFhir(ADT_A01_WITH_IAM);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.split("\r").some((l) => l.startsWith("IAM|"))).toBe(true);
    expect(reverse.translated.split("\r").some((l) => l.startsWith("AL1|"))).toBe(false);
  });
});

const ADT_A40 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A40|MSG001|P|2.5",
  "EVN|A40|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "MRG|||MRN99999^^^HOSP^MR",
].join("\r");

describe("ADT^A40 (merge patient) -> FHIR", () => {
  it("produces a Patient and an Account carrying the retired identifier from MRG-3", () => {
    const result = translateHl7ToFhir(ADT_A40);
    const bundle = JSON.parse(result.translated) as Bundle;
    const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")!.resource as Patient;
    const account = bundle.entry.find((e) => e.resource.resourceType === "Account")!.resource as { status: string; subject?: { reference?: string }[]; identifier?: { value?: string }[] };
    expect(account.status).toBe("unknown");
    expect(account.subject?.[0]?.reference).toBe(`Patient/${patient.id}`);
    expect(account.identifier?.[0]?.value).toBe("MRN99999");
  });
});

describe("FHIR Patient+Account -> ADT^A40", () => {
  it("round-trips back to MRG-3, and derives the A40 trigger from the Account resource's presence", () => {
    const forward = translateHl7ToFhir(ADT_A40);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.split("\r")[0]).toContain("ADT^A40");
    const mrgLine = reverse.translated.split("\r").find((l) => l.startsWith("MRG|"));
    expect(mrgLine).toBe("MRG|||MRN99999");
  });
});
