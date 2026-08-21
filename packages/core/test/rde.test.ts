import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToRde } from "../src/mapping/rde.js";
import type { Bundle, Medication, MedicationRequest, MessageHeader } from "../src/fhir/types.js";

const RDE_O11 = [
  "MSH|^~\\&|HIS|HOSP|PHARM|PHARM|20240101130000||RDE^O11|MSG004|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "ORC|NW|ORD002",
  "RXO|314076^Lisinopril 10 MG Oral Tablet^RXNORM|10|20|mg^milligram^UCUM|TAB^Tablet^HL70166||||G||10|tab^tablet^UCUM|2|AB1234567||||10|mg^milligram^UCUM||||||5|mL^milliliter^UCUM",
  "RXR|PO|LA^Left Arm^HL70163||IVPUSH^IV Push^HL70162|INST^Take with food^HL70007",
].join("\r");

describe("RDE^O11 -> FHIR", () => {
  const result = translateHl7ToFhir(RDE_O11);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient, a Medication, a MedicationRequest, and a MessageHeader", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "Medication", "MedicationRequest", "MessageHeader"]);
  });

  it("maps RXO-1/RXO-5/RXO-18/RXO-25 into the referenced Medication", () => {
    const medication = bundle.entry.find((e) => e.resource.resourceType === "Medication")!.resource as Medication;
    expect(medication.code?.coding?.[0]).toEqual({ code: "314076", display: "Lisinopril 10 MG Oral Tablet" });
    expect(medication.form?.coding?.[0]).toEqual({ code: "TAB", display: "Tablet" });
    expect(medication.ingredient?.[0]?.strength?.numerator).toEqual({ value: 10, unit: "milligram", code: "mg" });
    expect(medication.ingredient?.[0]?.strength?.denominator).toEqual({ value: 5, unit: "milliliter", code: "mL" });
  });

  it("maps ORC-1 order control to MedicationRequest.status", () => {
    const mr = bundle.entry.find((e) => e.resource.resourceType === "MedicationRequest")!.resource as MedicationRequest;
    expect(mr.status).toBe("active");
    expect(mr.intent).toBe("order");
    expect(mr.medicationReference.reference).toBe("Medication/medication-1");
  });

  it("maps RXO-2/RXO-3/RXO-4 dose range and RXO-9/RXO-11/RXO-13/RXO-14", () => {
    const mr = bundle.entry.find((e) => e.resource.resourceType === "MedicationRequest")!.resource as MedicationRequest;
    expect(mr.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseRange).toEqual({ low: { value: 10, code: "mg" }, high: { value: 20, code: "mg" } });
    expect(mr.substitution?.allowedCodeableConcept?.coding?.[0]?.code).toBe("G");
    expect(mr.dispenseRequest?.quantity).toEqual({ value: 10, code: "tab", unit: "tablet" });
    expect(mr.dispenseRequest?.numberOfRepeatsAllowed).toBe(2);
    expect(mr.requester?.display).toBe("AB1234567");
  });

  it("maps RXR-1/RXR-2/RXR-4/RXR-5 onto the same dosageInstruction", () => {
    const mr = bundle.entry.find((e) => e.resource.resourceType === "MedicationRequest")!.resource as MedicationRequest;
    const dosage = mr.dosageInstruction?.[0];
    expect(dosage?.route?.coding?.[0]?.code).toBe("PO");
    expect(dosage?.site?.coding?.[0]).toEqual({ code: "LA", display: "Left Arm" });
    expect(dosage?.method?.coding?.[0]).toEqual({ code: "IVPUSH", display: "IV Push" });
    expect(dosage?.additionalInstruction?.[0]?.coding?.[0]).toEqual({ code: "INST", display: "Take with food" });
  });

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("HIS");
    expect(messageHeader.destination?.[0]?.name).toBe("PHARM");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "O11",
      display: "RDE^O11",
    });
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(10);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
  });
});

describe("malformed RDE input", () => {
  it("throws when PID is missing", () => {
    const hl7 = ["MSH|^~\\&|HIS|HOSP|PHARM|PHARM|20240101130000||RDE^O11|MSG004|P|2.5", "ORC|NW|ORD002", "RXO|314076^Lisinopril^RXNORM"].join(
      "\r",
    );
    expect(() => translateHl7ToFhir(hl7)).toThrow(/PID/);
  });

  it("throws when RXO is missing", () => {
    const hl7 = [
      "MSH|^~\\&|HIS|HOSP|PHARM|PHARM|20240101130000||RDE^O11|MSG004|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "ORC|NW|ORD002",
    ].join("\r");
    expect(() => translateHl7ToFhir(hl7)).toThrow(/RXO/);
  });
});

describe("FHIR Patient+Medication+MedicationRequest -> RDE^O11", () => {
  it("round-trips ORC/RXO/RXR back from a translated bundle", () => {
    const forward = translateHl7ToFhir(RDE_O11);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.split("\r")[0]).toContain("RDE^O11");
    const orcLine = reverse.translated.split("\r").find((l) => l.startsWith("ORC|"));
    const rxoLine = reverse.translated.split("\r").find((l) => l.startsWith("RXO|"));
    const rxrLine = reverse.translated.split("\r").find((l) => l.startsWith("RXR|"));
    expect(orcLine).toBe("ORC|NW");
    expect(rxoLine).toContain("314076^Lisinopril 10 MG Oral Tablet");
    expect(rxoLine).toContain("TAB^Tablet");
    expect(rxrLine).toContain("PO");
    expect(rxrLine).toContain("LA^Left Arm");
  });

  it("throws when the bundle has no Patient resource", () => {
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          resource: {
            resourceType: "MedicationRequest",
            id: "medicationrequest-1",
            status: "active",
            intent: "order",
            medicationReference: { reference: "Medication/medication-1" },
            subject: { reference: "Patient/patient-1" },
          },
        },
      ],
    };
    expect(() => fhirToRde(bundle)).toThrow(/Patient/);
  });

  it("throws when the bundle has no MedicationRequest resource", () => {
    // A Patient-only bundle routes to the ADT mapper (see registry.ts's detectTargetMessageType),
    // so this branch of fhirToRde is unreachable through translateFhirToHl7 — call it directly.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "patient-1" } }],
    };
    expect(() => fhirToRde(bundle)).toThrow(/MedicationRequest/);
  });
});
