import type { Direction } from "./types.js";

export interface Sample {
  label: string;
  direction: Direction;
  content: string;
}

const ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r");

const ADT_A08 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240102091500||ADT^A08|MSG005|P|2.5",
  "EVN|A08|20240102091500",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||456 Oak Ave^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^102^B^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r");

const ORU_R01 = [
  "MSH|^~\\&|LIS|LAB|HIS|HOSP|20240101130000||ORU^R01|MSG002|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "OBR|1|ORD001|LAB001|85025^CBC^LN|||20240101120000",
  "OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.5-17.5|N|||F|||20240101130000",
  "OBX|2|NM|4544-3^Hematocrit^LN||42.0|%|41.0-53.0|N|||F|||20240101130000",
].join("\r");

const ORM_O01 = [
  "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
  "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
].join("\r");

const FHIR_PATIENT_ENCOUNTER = JSON.stringify(
  {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: {
          resourceType: "Patient",
          id: "patient-1",
          identifier: [
            {
              value: "MRN12345",
              assigner: { display: "HOSP" },
              type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] },
            },
          ],
          name: [{ family: "Doe", given: ["John", "A"] }],
          gender: "male",
          birthDate: "1980-05-15",
          address: [{ line: ["123 Main St"], city: "Springfield", state: "IL", postalCode: "62701", country: "USA" }],
        },
      },
      {
        resource: {
          resourceType: "Encounter",
          id: "encounter-1",
          status: "in-progress",
          class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" },
          subject: { reference: "Patient/patient-1", display: "Doe" },
          location: [{ location: { display: "ICU" } }],
          participant: [{ individual: { display: "Jane Smith" } }],
          period: { start: "2024-01-01T12:00:00Z" },
        },
      },
    ],
  },
  null,
  2,
);

export const SAMPLES: Sample[] = [
  { label: "ADT^A01 — Patient admission (HL7 → FHIR)", direction: "hl7ToFhir", content: ADT_A01 },
  { label: "ADT^A08 — Patient update (HL7 → FHIR)", direction: "hl7ToFhir", content: ADT_A08 },
  { label: "ORU^R01 — Lab result panel (HL7 → FHIR)", direction: "hl7ToFhir", content: ORU_R01 },
  { label: "ORM^O01 — Lab order (HL7 → FHIR)", direction: "hl7ToFhir", content: ORM_O01 },
  { label: "Patient + Encounter Bundle (FHIR → HL7)", direction: "fhirToHl7", content: FHIR_PATIENT_ENCOUNTER },
];
