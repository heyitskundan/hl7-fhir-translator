import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToMdm } from "../src/mapping/mdm.js";
import type { Bundle, DocumentReference, MessageHeader, Practitioner, Provenance } from "../src/fhir/types.js";

const MDM_T02 = [
  "MSH|^~\\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5",
  "EVN|T02|20240106140000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "TXA|1|18842-5^Discharge summary^LN||20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|||DOC0100|||||AU",
].join("\r");

describe("MDM^T02 -> FHIR", () => {
  const result = translateHl7ToFhir(MDM_T02);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient, a DocumentReference, and a Practitioner (the author)", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "DocumentReference", "Practitioner", "MessageHeader"]);
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

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("TRAN");
    expect(messageHeader.destination?.[0]?.name).toBe("HIS");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "T02",
      display: "MDM^T02",
    });
  });
});

const MDM_T02_WITH_EVN_DETAIL = [
  "MSH|^~\\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5",
  "EVN|T02|20240106140000||03|5678^Nguyen^Anh^^MD|20240106135500|HOSP",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "TXA|1|18842-5^Discharge summary^LN||20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|||DOC0100|||||AU",
].join("\r");

describe("EVN-2/4/5/6/7 -> Provenance (MDM^T02, only built when EVN-5 is present)", () => {
  it("builds a Provenance targeting the Patient, with a real operator Practitioner and Location", () => {
    const result = translateHl7ToFhir(MDM_T02_WITH_EVN_DETAIL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const provenance = bundle.entry.find((e) => e.resource.resourceType === "Provenance")!.resource as Provenance;
    expect(provenance.target).toEqual([{ reference: "Patient/patient-1" }]);
    expect(provenance.recorded).toBe("2024-01-06T14:00:00Z");
    expect(provenance.occurredDateTime).toBe("2024-01-06T13:55:00Z");
    expect(provenance.reason?.[0]?.coding?.[0]?.code).toBe("03");
    expect(provenance.agent[0]?.who?.display).toBe("Anh Nguyen");
    expect(provenance.location?.display).toBe("HOSP");
  });

  it("omits Provenance entirely when EVN-5 is absent", () => {
    const result = translateHl7ToFhir(MDM_T02);
    const bundle = JSON.parse(result.translated) as Bundle;
    expect(bundle.entry.some((e) => e.resource.resourceType === "Provenance")).toBe(false);
  });
});

describe("FHIR Provenance -> MDM^T02 EVN-2/4/5/6/7", () => {
  it("round-trips recorded/reason/operator/occurred/location back to EVN", () => {
    const forward = translateHl7ToFhir(MDM_T02_WITH_EVN_DETAIL);
    const reverse = translateFhirToHl7(forward.translated);
    const evnLine = reverse.translated.split("\r").find((l) => l.startsWith("EVN|"));
    expect(evnLine).toContain("|03|");
    expect(evnLine).toContain("Nguyen^Anh");
    expect(evnLine).toContain("20240106135500");
    expect(evnLine).toContain("HOSP");
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

describe("TXA-3/TXA-10/TXA-16/TXA-25 -> DocumentReference content/authenticator/identifier/description", () => {
  const MDM_WITH_EXTRAS = [
    "MSH|^~\\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5",
    "EVN|T02|20240106140000",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "TXA|1|18842-5^Discharge summary^LN|TX|20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|9012^Patel^Raj^^MD||DOC0100||||DOC-ALT-001|AU||||||||Discharge summary for admission 2024-01-06",
  ].join("\r");

  it("maps TXA-3 (HL7 Table 0191) to a real MIME content type instead of always text/plain", () => {
    const pdf = MDM_WITH_EXTRAS.replace("|TX|", "|PDF|");
    const result = translateHl7ToFhir(pdf);
    const bundle = JSON.parse(result.translated) as Bundle;
    const doc = bundle.entry[1]!.resource as DocumentReference;
    expect(doc.content[0]!.attachment.contentType).toBe("application/pdf");
  });

  it("falls back to text/plain when TXA-3 is unrecognized or absent", () => {
    const result = translateHl7ToFhir(MDM_T02);
    const bundle = JSON.parse(result.translated) as Bundle;
    const doc = bundle.entry[1]!.resource as DocumentReference;
    expect(doc.content[0]!.attachment.contentType).toBe("text/plain");
  });

  it("maps TXA-10 to authenticator, TXA-16 to identifier[0], and TXA-25 to description", () => {
    const result = translateHl7ToFhir(MDM_WITH_EXTRAS);
    const bundle = JSON.parse(result.translated) as Bundle;
    const doc = bundle.entry[1]!.resource as DocumentReference;
    expect(doc.authenticator?.display).toBe("Raj Patel");
    expect(doc.identifier?.[0]?.value).toBe("DOC-ALT-001");
    expect(doc.description).toBe("Discharge summary for admission 2024-01-06");
  });

  it("round-trips authenticator, identifier, and description back to TXA-10/16/25", () => {
    const forward = translateHl7ToFhir(MDM_WITH_EXTRAS);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("Patel");
    expect(reverse.translated).toContain("DOC-ALT-001");
    expect(reverse.translated).toContain("Discharge summary for admission 2024-01-06");
  });
});

describe("TXA-18 -> DocumentReference.securityLabel", () => {
  const MDM_WITH_SECURITY_LABEL = [
    "MSH|^~\\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5",
    "EVN|T02|20240106140000",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "TXA|1|18842-5^Discharge summary^LN|TX|20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|9012^Patel^Raj^^MD||DOC0100||||DOC-ALT-001|AU|R^Restricted^HL70272|||||||Discharge summary for admission 2024-01-06",
  ].join("\r");

  it("maps TXA-18 to securityLabel[0]", () => {
    const result = translateHl7ToFhir(MDM_WITH_SECURITY_LABEL);
    const bundle = JSON.parse(result.translated) as Bundle;
    const doc = bundle.entry[1]!.resource as DocumentReference;
    expect(doc.securityLabel?.[0]?.coding?.[0]).toEqual({ code: "R", display: "Restricted" });
  });

  it("round-trips securityLabel back to TXA-18", () => {
    const forward = translateHl7ToFhir(MDM_WITH_SECURITY_LABEL);
    const reverse = translateFhirToHl7(forward.translated);
    const txaLine = reverse.translated.split("\r").find((l) => l.startsWith("TXA|"));
    expect(txaLine).toContain("R^Restricted");
  });
});

describe("TXA-9/TXA-10 -> DocumentReference.author/.authenticator (real Practitioner resources)", () => {
  const MDM_WITH_AUTHOR_AND_AUTHENTICATOR = [
    "MSH|^~\\&|TRAN|HOSP|HIS|HOSP|20240106140000||MDM^T02|MSG013|P|2.5",
    "EVN|T02|20240106140000",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "TXA|1|18842-5^Discharge summary^LN|TX|20240106140000||20240106140000|||5678^Nguyen^Anh^^MD|9012^Patel^Raj^^MD",
  ].join("\r");

  it("builds distinct Practitioner resources for the author and the authenticator", () => {
    const result = translateHl7ToFhir(MDM_WITH_AUTHOR_AND_AUTHENTICATOR);
    const bundle = JSON.parse(result.translated) as Bundle;
    const doc = bundle.entry.find((e) => e.resource.resourceType === "DocumentReference")!.resource as DocumentReference;
    const practitioners = bundle.entry
      .filter((e): e is { resource: Practitioner } => e.resource.resourceType === "Practitioner")
      .map((e) => e.resource);
    expect(practitioners).toHaveLength(2);
    const author = practitioners.find((p) => `Practitioner/${p.id}` === doc.author?.[0]?.reference);
    const authenticator = practitioners.find((p) => `Practitioner/${p.id}` === doc.authenticator?.reference);
    expect(author?.name?.[0]).toEqual({ family: "Nguyen", given: ["Anh"] });
    expect(authenticator?.name?.[0]).toEqual({ family: "Patel", given: ["Raj"] });
  });

  it("round-trips both structured names back to TXA-9/TXA-10", () => {
    const forward = translateHl7ToFhir(MDM_WITH_AUTHOR_AND_AUTHENTICATOR);
    const reverse = translateFhirToHl7(forward.translated);
    const txaLine = reverse.translated.split("\r").find((l) => l.startsWith("TXA|"));
    expect(txaLine).toContain("Nguyen^Anh");
    expect(txaLine).toContain("Patel^Raj");
  });
});
