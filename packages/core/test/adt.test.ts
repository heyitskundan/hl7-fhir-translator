import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import type { Bundle, Encounter, Patient } from "../src/fhir/types.js";

const ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
  "NK1|1|Doe^Jane|SPO",
].join("\r");

describe("ADT^A01 -> FHIR", () => {
  const result = translateHl7ToFhir(ADT_A01);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient and an Encounter", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "Encounter"]);
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

  it("emits a warning for the unmapped NK1 segment instead of dropping it silently", () => {
    expect(result.warnings.some((w) => w.includes("NK1"))).toBe(true);
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(5);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
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

  it("produces two Patient+Encounter pairs, one per PID/PV1 group", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "Encounter", "Patient", "Encounter"]);
  });

  it("maps each patient's own demographics and location, not a mix of the two", () => {
    const [p1, e1, p2, e2] = bundle.entry.map((e) => e.resource) as [Patient, Encounter, Patient, Encounter];
    expect(p1.identifier?.[0]?.value).toBe("MRN12345");
    expect(p1.name?.[0]?.family).toBe("Doe");
    expect(e1.location?.[0]?.location?.display).toBe("ICU");
    expect(e1.subject?.reference).toBe(`Patient/${p1.id}`);

    expect(p2.identifier?.[0]?.value).toBe("MRN67890");
    expect(p2.name?.[0]?.family).toBe("Roe");
    expect(e2.participant?.[0]?.individual?.display).toBe("Anh Nguyen");
    expect(e2.subject?.reference).toBe(`Patient/${p2.id}`);
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
