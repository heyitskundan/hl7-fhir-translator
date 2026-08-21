import { describe, expect, it } from "vitest";
import { translateFhirToHl7, translateHl7ToFhir } from "../src/translate.js";
import { fhirToOrm } from "../src/mapping/orm.js";
import type { Bundle, Device, Location, MessageHeader, Organization, PractitionerRole, ServiceRequest } from "../src/fhir/types.js";

const ORM_O01 = [
  "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
  "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
].join("\r");

describe("ORM^O01 -> FHIR", () => {
  const result = translateHl7ToFhir(ORM_O01);
  const bundle = JSON.parse(result.translated) as Bundle;

  it("produces a Bundle with a Patient, a ServiceRequest, and a Practitioner", () => {
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types).toEqual(["Patient", "ServiceRequest", "Practitioner", "MessageHeader"]);
  });

  it("maps ORC-1 order control to ServiceRequest.status", () => {
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.status).toBe("active");
    expect(sr.intent).toBe("order");
  });

  it("maps OBR-4 to the ServiceRequest code and ORC-12 to the requester", () => {
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.code.coding?.[0]).toEqual({ system: "http://loinc.org", code: "85025", display: "CBC" });
    expect(sr.requester?.display).toBe("Jane Smith");
  });

  it("maps MSH-3/MSH-5/MSH-9 into a MessageHeader", () => {
    const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")!.resource as MessageHeader;
    expect(messageHeader.source.name).toBe("HIS");
    expect(messageHeader.destination?.[0]?.name).toBe("LIS");
    expect(messageHeader.eventCoding).toEqual({
      system: "http://terminology.hl7.org/CodeSystem/v2-0003",
      code: "O01",
      display: "ORM^O01",
    });
  });
});

describe("FHIR ServiceRequest -> ORM^O01", () => {
  it("round-trips the order code and status", () => {
    const forward = translateHl7ToFhir(ORM_O01);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("ORM^O01");
    expect(reverse.translated).toContain("NW");
    expect(reverse.translated).toContain("85025^CBC^LN");
  });
});

describe("unsupported message types", () => {
  it("throws a typed error naming the unsupported trigger, not a silent best-effort guess", () => {
    const unsupported = "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A03|MSG004|P|2.5\rPID|1||MRN1";
    expect(() => translateHl7ToFhir(unsupported)).toThrow(/A03/);
  });
});

describe("malformed ORM input", () => {
  it("throws when the PID segment is absent", () => {
    const noPid = ["MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5", "ORC|NW|ORD001", "OBR|1|ORD001||85025^CBC^LN"].join(
      "\r",
    );
    expect(() => translateHl7ToFhir(noPid)).toThrow(/PID/);
  });

  it("throws when the OBR segment is absent", () => {
    const noObr = ["MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5", "PID|1||MRN12345^^^HOSP^MR", "ORC|NW|ORD001"].join(
      "\r",
    );
    expect(() => translateHl7ToFhir(noObr)).toThrow(/OBR/);
  });

  it("falls back to OBR-16 for the ordering provider when ORC-12 is absent", () => {
    const noOrc12 = [
      "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "ORC|NW|ORD001",
      "OBR|1|ORD001||85025^CBC^LN|||20240101110000|||||||||1234^Smith^Jane^M^MD",
    ].join("\r");
    const result = translateHl7ToFhir(noOrc12);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.requester?.display).toBe("Jane Smith");
  });
});

describe("FHIR -> ORM^O01 error paths and status mapping", () => {
  it("throws when the bundle has no Patient resource", () => {
    const sr: ServiceRequest = {
      resourceType: "ServiceRequest",
      id: "servicerequest-1",
      status: "active",
      intent: "order",
      code: { coding: [{ system: "http://loinc.org", code: "85025", display: "CBC" }] },
      subject: { reference: "Patient/patient-1" },
    };
    const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: sr }] };
    expect(() => translateFhirToHl7(JSON.stringify(bundle))).toThrow(/Patient/);
  });

  it("throws when the bundle has no ServiceRequest resource", () => {
    // A Patient-only bundle routes to the ADT mapper (see registry.ts's detectTargetMessageType),
    // so this branch of fhirToOrm is unreachable through translateFhirToHl7 — call it directly.
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Patient", id: "patient-1" } }],
    };
    expect(() => fhirToOrm(bundle)).toThrow(/ServiceRequest/);
  });

  it.each([
    ["revoked", "CA"],
    ["completed", "CM"],
  ] as const)("maps ServiceRequest.status %s back to order control %s", (status, orderControl) => {
    const forward = translateHl7ToFhir(ORM_O01);
    const bundle = JSON.parse(forward.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    sr.status = status;
    const reverse = translateFhirToHl7(JSON.stringify(bundle));
    expect(reverse.translated).toContain(`ORC|${orderControl}|`);
  });
});

describe("OBR-2/OBR-3/OBR-31 -> ServiceRequest.identifier/.reasonCode", () => {
  const ORM_WITH_IDENTIFIERS_AND_REASON = [
    "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
    "OBR|1|ORD001|FIL9001|85025^CBC^LN|||20240101110000||||||||||||||||||||||||789.0^Abdominal pain^ICD9",
  ].join("\r");

  it("maps OBR-2 and OBR-3 to two identifiers (placer/filler)", () => {
    const result = translateHl7ToFhir(ORM_WITH_IDENTIFIERS_AND_REASON);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.identifier).toEqual([
      { value: "ORD001", type: { coding: [{ code: "PLAC" }] } },
      { value: "FIL9001", type: { coding: [{ code: "FILL" }] } },
    ]);
  });

  it("maps OBR-31 to reasonCode[0]", () => {
    const result = translateHl7ToFhir(ORM_WITH_IDENTIFIERS_AND_REASON);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.reasonCode?.[0]?.coding?.[0]).toEqual({ code: "789.0", display: "Abdominal pain" });
  });

  it("round-trips reasonCode back to OBR-31 (identifier is not round-tripped, since OBR-2/3 are already used for placer/filler linking)", () => {
    const forward = translateHl7ToFhir(ORM_WITH_IDENTIFIERS_AND_REASON);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("789.0");
    expect(reverse.translated).toContain("Abdominal pain");
  });
});

describe("ORC-33 -> ServiceRequest.identifier (alternate placer order number)", () => {
  const ORM_WITH_ALT_PLACER = [
    "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD|||||||||||||||||||||ALT-ORD001",
    "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
  ].join("\r");

  it("appends an untyped identifier for ORC-33, distinct from the typed PLAC/FILL ones", () => {
    const result = translateHl7ToFhir(ORM_WITH_ALT_PLACER);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.identifier).toContainEqual({ value: "ALT-ORD001" });
  });

  it("round-trips the untyped identifier back to ORC-33", () => {
    const forward = translateHl7ToFhir(ORM_WITH_ALT_PLACER);
    const reverse = translateFhirToHl7(forward.translated);
    const orcLine = reverse.translated.split("\r").find((l) => l.startsWith("ORC|"));
    expect(orcLine).toMatch(/\|ALT-ORD001$/);
  });
});

describe("NTE -> ServiceRequest.note", () => {
  const ORM_WITH_NOTE = [
    "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
    "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
    "NTE|1||Patient fasting for 12 hours prior to draw",
    "NTE|2||Second note",
  ].join("\r");

  it("maps every NTE-3 to one ServiceRequest.note entry", () => {
    const result = translateHl7ToFhir(ORM_WITH_NOTE);
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.note).toEqual([{ text: "Patient fasting for 12 hours prior to draw" }, { text: "Second note" }]);
  });

  it("round-trips notes back to NTE segments", () => {
    const forward = translateHl7ToFhir(ORM_WITH_NOTE);
    const reverse = translateFhirToHl7(forward.translated);
    const nteLines = reverse.translated.split("\r").filter((l) => l.startsWith("NTE|"));
    expect(nteLines).toHaveLength(2);
    expect(nteLines[0]).toContain("Patient fasting for 12 hours prior to draw");
    expect(nteLines[1]).toContain("Second note");
  });
});

describe("TQ1-9 -> ServiceRequest.priority", () => {
  const ormWithTq1 = (priorityCode: string) =>
    [
      "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
      "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
      "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
      "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
      `TQ1|1||||||||${priorityCode}`,
    ].join("\r");

  it.each([
    ["S", "stat"],
    ["A", "asap"],
    ["R", "routine"],
  ] as const)("maps HL70485 code %s to priority %s", (hl7Code, priority) => {
    const result = translateHl7ToFhir(ormWithTq1(hl7Code));
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.priority).toBe(priority);
  });

  it("leaves priority unset for a code with no FHIR mapping (e.g. Preop)", () => {
    const result = translateHl7ToFhir(ormWithTq1("P"));
    const bundle = JSON.parse(result.translated) as Bundle;
    const sr = bundle.entry[1]!.resource as ServiceRequest;
    expect(sr.priority).toBeUndefined();
  });

  it("round-trips priority back to a TQ1 segment", () => {
    const forward = translateHl7ToFhir(ormWithTq1("A"));
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).toContain("TQ1|1||||||||A");
  });

  it("omits TQ1 entirely when priority isn't set", () => {
    const forward = translateHl7ToFhir(ORM_O01);
    const reverse = translateFhirToHl7(forward.translated);
    expect(reverse.translated).not.toContain("TQ1|");
  });
});

describe("PRT-10/16/17/18/19/20/21/22 -> Device (only built when PRT-10 or PRT-16 is present)", () => {
  const ORM_WITH_PRT = [
    "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
    "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
    "PRT||||||||||AUTO123^Automated Analyzer||||||01234567890128|20230101|20260101|LOT4455|SN998877||ANALYZER^Analyzer^SCT",
  ].join("\r");

  it("builds a Device from the PRT repetition describing one", () => {
    const result = translateHl7ToFhir(ORM_WITH_PRT);
    const bundle = JSON.parse(result.translated) as Bundle;
    const device = bundle.entry.find((e) => e.resource.resourceType === "Device")!.resource as Device;
    expect(device.identifier?.[0]?.value).toBe("AUTO123");
    expect(device.udiCarrier?.[0]?.deviceIdentifier).toBe("01234567890128");
    expect(device.manufactureDate).toBe("2023-01-01");
    expect(device.expirationDate).toBe("2026-01-01");
    expect(device.lotNumber).toBe("LOT4455");
    expect(device.serialNumber).toBe("SN998877");
    expect(device.type?.coding?.[0]).toEqual({ code: "ANALYZER", display: "Analyzer" });
  });

  it("produces no Device when no PRT segment describes one", () => {
    const result = translateHl7ToFhir(ORM_O01);
    const bundle = JSON.parse(result.translated) as Bundle;
    expect(bundle.entry.some((e) => e.resource.resourceType === "Device")).toBe(false);
  });

  it("round-trips the device fields back to a PRT segment", () => {
    const forward = translateHl7ToFhir(ORM_WITH_PRT);
    const reverse = translateFhirToHl7(forward.translated);
    const prtLine = reverse.translated.split("\r").find((l) => l.startsWith("PRT|"));
    expect(prtLine).toContain("AUTO123");
    expect(prtLine).toContain("01234567890128");
    expect(prtLine).toContain("LOT4455");
    expect(prtLine).toContain("SN998877");
    expect(prtLine).toContain("ANALYZER^Analyzer");
  });
});

describe("PRT-4/5/6/8/9/11/12/15 -> PractitionerRole (only built when PRT-5 is present)", () => {
  const ORM_WITH_PRT_ROLE = [
    "MSH|^~\\&|HIS|HOSP|LIS|LAB|20240101110000||ORM^O01|MSG003|P|2.5",
    "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
    "ORC|NW|ORD001|||||||20240101110000|||1234^Smith^Jane^M^MD",
    "OBR|1|ORD001||85025^CBC^LN|||20240101110000",
    "PRT||||CONSULT^Consulting Provider^HL70912|7788^Patel^Rita^^MD|CARD^Cardiology^SCT||Central Lab Services|LAB2^Central Lab Services||20240101100000|20240101120000|||5551112222^WPN^PH",
  ].join("\r");

  it("builds a PractitionerRole referencing a real Practitioner, Organization, and Location", () => {
    const result = translateHl7ToFhir(ORM_WITH_PRT_ROLE);
    const bundle = JSON.parse(result.translated) as Bundle;
    const role = bundle.entry.find((e) => e.resource.resourceType === "PractitionerRole")!.resource as PractitionerRole;
    expect(role.code?.[0]?.coding?.[0]).toEqual({ code: "CONSULT", display: "Consulting Provider" });
    expect(role.practitioner?.display).toBe("Rita Patel");
    expect(role.specialty?.[0]?.coding?.[0]).toEqual({ code: "CARD", display: "Cardiology" });
    expect(role.organization?.display).toBe("Central Lab Services");
    expect(role.location?.[0]?.display).toBe("LAB2");
    expect(role.period).toEqual({ start: "2024-01-01T10:00:00Z", end: "2024-01-01T12:00:00Z" });
    expect(role.telecom?.[0]).toEqual({ system: "phone", value: "5551112222", use: "work" });

    const org = bundle.entry.find((e) => e.resource.resourceType === "Organization")!.resource as Organization;
    expect(org.name).toBe("Central Lab Services");
    const loc = bundle.entry.find((e) => e.resource.resourceType === "Location")!.resource as Location;
    expect(loc.name).toBe("LAB2");
  });

  it("produces no PractitionerRole when no PRT segment carries a Person field", () => {
    const result = translateHl7ToFhir(ORM_O01);
    const bundle = JSON.parse(result.translated) as Bundle;
    expect(bundle.entry.some((e) => e.resource.resourceType === "PractitionerRole")).toBe(false);
  });

  it("round-trips the role fields back to a PRT segment", () => {
    const forward = translateHl7ToFhir(ORM_WITH_PRT_ROLE);
    const reverse = translateFhirToHl7(forward.translated);
    const prtLine = reverse.translated.split("\r").find((l) => l.startsWith("PRT|") && l.includes("Patel"));
    expect(prtLine).toContain("CONSULT^Consulting Provider");
    expect(prtLine).toContain("Patel^Rita");
    expect(prtLine).toContain("CARD^Cardiology");
    expect(prtLine).toContain("Central Lab Services");
    expect(prtLine).toContain("LAB2");
    expect(prtLine).toContain("20240101100000");
    expect(prtLine).toContain("20240101120000");
    expect(prtLine).toContain("5551112222");
  });
});
