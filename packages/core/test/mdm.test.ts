import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToMdm } from "../src/mapping/mdm.js";
import type { Bundle, DocumentReference } from "../src/fhir/types.js";

const MDM_T02 = [
  "MSH|^~\\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5",
  "EVN|T02|20240106140000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "TXA|1|18842-5^Discharge summary^LN||20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|||DOC0100|||||AU",
].join("\r");

describe("MDM^T02 -> FHIR", () => {
  const result = translateHl7ToFhir(MDM_T02);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient and a DocumentReference", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "DocumentReference"]);
  });

  it("maps TXA into a DocumentReference", () => {
    const doc = bundle.entry[1]!.resource as DocumentReference;
    expect(doc.status).toBe("current");
    expect(doc.docStatus).toBe("final");
    expect(doc.type?.coding?.[0]?.code).toBe("18842-5");
    expect(doc.type?.text).toBe("Discharge summary");
    expect(doc.date).toBe("2024-01-06T14:00:00Z");
    expect(doc.masterIdentifier?.value).toBe("DOC0100");
    expect(doc.author?.[0]?.display).toBe("Anh Nguyen");
    expect(doc.content[0]?.attachment.title).toBe("Discharge summary");
  });

  it("produces a non-empty, source-cited mapping trail", () => {
    expect(result.mappings.length).toBeGreaterThan(4);
    expect(result.mappings.every((m) => m.source && m.target && m.value)).toBe(true);
  });
});

describe("FHIR Patient+DocumentReference -> MDM^T02", () => {
  it("round-trips the key document fields", () => {
    const forward = translateHl7ToFhir(MDM_T02);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated.startsWith("MSH|^~\\&|")).toBe(true);
    expect(reverse.translated).toContain("MDM^T02");
    expect(reverse.translated).toContain("MRN12345");
    expect(reverse.translated).toContain("DOC0100");
    expect(reverse.translated).toContain("AU");
  });

  it("throws when the bundle has no DocumentReference resource", () => {
    // A Patient-only bundle routes to the ADT mapper (see registry.ts's detectTargetMessageType),
    // so this branch of fhirToMdm is unreachable through translateFhirToHl7 — call it directly.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "patient-1" } }],
    };
    expect(() => fhirToMdm(bundle)).toThrow(/DocumentReference/);
  });

  it("throws when the bundle has no Patient resource", () => {
    // A DocumentReference-only bundle still routes to the MDM mapper (see
    // registry.ts's detectTargetMessageType), so this branch is reachable through the public API.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "DocumentReference", id: "documentreference-1", status: "current", content: [] } }],
    };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow(/Patient/);
  });

  it.each([
    ["preliminary", "IP"],
    ["amended", "TR"],
  ] as const)("maps DocumentReference.docStatus %s back to completion status %s", (docStatus, completionStatus) => {
    const forward = translateHl7ToFhir(MDM_T02);
    const bundle = JSON.parse(forward.translated) as Bundle;
    const doc = bundle.entry[1]!.resource as DocumentReference;
    doc.docStatus = docStatus;
    const reverse = translateFhirToHl7(JSON.stringify(bundle));
    expect(reverse.mappings.find((m) => m.target === "TXA-17")?.value).toBe(completionStatus);
  });
});

describe("malformed MDM input", () => {
  it("throws a typed error instead of guessing when the TXA segment is absent", () => {
    const noTxa = [
      "MSH|^~\\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    ].join("\r");
    expect(() => translateHl7ToFhir(noTxa)).toThrow(/TXA/);
  });
});
