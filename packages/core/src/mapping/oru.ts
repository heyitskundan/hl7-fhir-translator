import { findSegment, findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Bundle, DiagnosticReport, MessageHeader, Observation, Patient, Range } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import {
  CODE_SYSTEMS,
  MappingTrail,
  buildMsh,
  fhirDateTimeToHl7,
  hl7DateTimeToFhir,
  messageHeaderFromMsh,
  nextMessageControlId,
  nowHl7DateTime,
} from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";
import { cweToCodeableConcept, eiToIdentifier } from "./datatypes.js";
import { lookupVocabulary, reverseLookupVocabulary } from "./vocabulary.js";

const KNOWN_ORU_SEGMENTS = new Set(["MSH", "PID", "OBR", "OBX", "NTE"]);
const OBSERVATION_STATUS_TABLE = "table-hl70085-to-observation-status";
const REPORT_STATUS_TABLE = "table-hl70123-queries-to-diagnostic-report-status";
const INTERPRETATION_DISPLAY: Record<string, string> = {
  N: "Normal",
  H: "High",
  L: "Low",
  HH: "Critical high",
  LL: "Critical low",
  A: "Abnormal",
};

function parseReferenceRange(raw: string | undefined): Range | undefined {
  if (!raw) return undefined;
  const m = /^([\d.]+)\s*-\s*([\d.]+)$/.exec(raw.trim());
  if (!m) return undefined;
  return { low: { value: Number(m[1]) }, high: { value: Number(m[2]) } };
}

/** ORU^R01 -> a Bundle with a Patient, a DiagnosticReport, and one Observation per OBX. Throws `FhirValidationError` when PID, OBR, or every OBX is missing; an individual OBX missing its observation identifier (OBX-3) is skipped with a warning instead. */
export function oruToFhir(message: Hl7Message): { bundle: Bundle; trail: MappingTrail } {
  const trail = new MappingTrail();
  const pid = findSegment(message, "PID");
  const obr = findSegment(message, "OBR");
  const obxSegments = findSegments(message, "OBX");

  if (!pid) throw new FhirValidationError("ORU message is missing a required PID segment");
  if (!obr) throw new FhirValidationError("ORU message is missing a required OBR segment");
  if (obxSegments.length === 0) throw new FhirValidationError("ORU message has no OBX (result) segments");

  const patient = buildPatientFromPid(pid, trail);
  const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }] };

  const reportCode = getComponent(obr, 4, 1);
  const reportDisplay = getComponent(obr, 4, 2);
  const resultStatusCode = getField(obr, 25);
  const reportStatus = lookupVocabulary(REPORT_STATUS_TABLE, resultStatusCode);
  const report: DiagnosticReport = {
    resourceType: "DiagnosticReport",
    id: "report-1",
    status: (reportStatus?.code as DiagnosticReport["status"] | undefined) ?? "final",
    code: {
      coding: reportCode ? [{ system: CODE_SYSTEMS.loinc, code: reportCode, display: reportDisplay }] : undefined,
      text: reportDisplay,
    },
    subject: { reference: `Patient/${patient.id}` },
    result: [],
  };
  if (reportCode) trail.add("OBR-4", "DiagnosticReport.code", `${reportCode} (${reportDisplay ?? "n/a"})`);
  if (reportStatus?.code) {
    trail.add("OBR-25", "DiagnosticReport.status", reportStatus.code, `HL7 result status "${resultStatusCode}"`);
  }

  const orderIdentifiers = [];
  const placerOrderNumber = getComponent(obr, 2, 1);
  const fillerOrderNumber = getComponent(obr, 3, 1);
  if (placerOrderNumber) {
    orderIdentifiers.push({ value: placerOrderNumber, type: { coding: [{ code: "PLAC" }] } });
    trail.add("OBR-2", "DiagnosticReport.identifier", placerOrderNumber, "Placer order number");
  }
  if (fillerOrderNumber) {
    orderIdentifiers.push({ value: fillerOrderNumber, type: { coding: [{ code: "FILL" }] } });
    trail.add("OBR-3", "DiagnosticReport.identifier", fillerOrderNumber, "Filler order number");
  }
  if (orderIdentifiers.length > 0) report.identifier = orderIdentifiers;

  const category = getField(obr, 24);
  if (category) {
    report.category = [{ coding: [{ code: category }] }];
    trail.add("OBR-24", "DiagnosticReport.category[0]", category, "Diagnostic service section id");
  }

  const obrStart = hl7DateTimeToFhir(getField(obr, 7));
  const obrEnd = hl7DateTimeToFhir(getField(obr, 8));
  if (obrEnd && obrStart) {
    report.effectivePeriod = { start: obrStart, end: obrEnd };
    trail.add("OBR-7", "DiagnosticReport.effectivePeriod.start", obrStart);
    trail.add("OBR-8", "DiagnosticReport.effectivePeriod.end", obrEnd);
  } else if (obrStart) {
    report.effectiveDateTime = obrStart;
    trail.add("OBR-7", "DiagnosticReport.effectiveDateTime", obrStart);
  }

  const issued = hl7DateTimeToFhir(getField(obr, 22));
  if (issued) {
    report.issued = issued;
    trail.add("OBR-22", "DiagnosticReport.issued", issued);
  }

  const observations: Observation[] = [];
  obxSegments.forEach((obx, i) => {
    const obsCode = getComponent(obx, 3, 1);
    const obsDisplay = getComponent(obx, 3, 2);
    if (!obsCode) {
      trail.warn(`OBX segment #${i + 1} has no OBX-3 observation identifier and was skipped`);
      return;
    }
    const setId = getField(obx, 1) ?? String(i + 1);
    const resultStatusCode = getField(obx, 11);
    const resultStatus = lookupVocabulary(OBSERVATION_STATUS_TABLE, resultStatusCode);
    const observation: Observation = {
      resourceType: "Observation",
      id: `observation-${setId}`,
      status: (resultStatus?.code as Observation["status"] | undefined) ?? "final",
      code: { coding: [{ system: CODE_SYSTEMS.loinc, code: obsCode, display: obsDisplay }], text: obsDisplay },
      subject: { reference: `Patient/${patient.id}` },
    };
    trail.add(`OBX-3 (#${i + 1})`, `Observation[${i}].code`, `${obsCode} (${obsDisplay ?? "n/a"})`);
    trail.add(`OBX-1 (#${i + 1})`, `Observation[${i}].id`, observation.id ?? "");
    if (resultStatus?.code) {
      trail.add(`OBX-11 (#${i + 1})`, `Observation[${i}].status`, resultStatus.code, `HL7 result status "${resultStatusCode}"`);
    }

    const valueType = getField(obx, 2);
    const rawValue = getField(obx, 5);
    if (valueType === "NM" && rawValue !== undefined) {
      const unit = getField(obx, 6);
      observation.valueQuantity = { value: Number(rawValue), unit };
      trail.add(`OBX-2 (#${i + 1})`, `Observation[${i}].valueQuantity`, valueType);
      trail.add(`OBX-5 (#${i + 1})`, `Observation[${i}].valueQuantity.value`, rawValue);
      if (unit) trail.add(`OBX-6 (#${i + 1})`, `Observation[${i}].valueQuantity.unit`, unit);
    } else if (rawValue !== undefined) {
      observation.valueString = rawValue;
      trail.add(`OBX-2 (#${i + 1})`, `Observation[${i}].valueString`, valueType ?? "n/a");
      trail.add(`OBX-5 (#${i + 1})`, `Observation[${i}].valueString`, rawValue);
    }

    const range = parseReferenceRange(getField(obx, 7));
    if (range) {
      observation.referenceRange = [range];
      trail.add(`OBX-7 (#${i + 1})`, `Observation[${i}].referenceRange`, getField(obx, 7) ?? "");
    }

    const flag = getField(obx, 8);
    if (flag) {
      observation.interpretation = [
        { coding: [{ system: CODE_SYSTEMS.observationInterpretation, code: flag, display: INTERPRETATION_DISPLAY[flag] ?? flag }] },
      ];
      trail.add(`OBX-8 (#${i + 1})`, `Observation[${i}].interpretation`, flag);
    }

    const obsTime = hl7DateTimeToFhir(getField(obx, 14));
    if (obsTime) {
      observation.effectiveDateTime = obsTime;
      trail.add(`OBX-14 (#${i + 1})`, `Observation[${i}].effectiveDateTime`, obsTime);
    }

    const method = cweToCodeableConcept(obx.fields[17]);
    if (method) {
      observation.method = method;
      trail.add(`OBX-17 (#${i + 1})`, `Observation[${i}].method`, getComponent(obx, 17, 1) ?? "");
    }

    const bodySite = cweToCodeableConcept(obx.fields[20]);
    if (bodySite) {
      observation.bodySite = bodySite;
      trail.add(`OBX-20 (#${i + 1})`, `Observation[${i}].bodySite`, getComponent(obx, 20, 1) ?? "");
    }

    const obxIdentifier = eiToIdentifier(obx.fields[21]);
    if (obxIdentifier) {
      observation.identifier = [obxIdentifier];
      trail.add(`OBX-21 (#${i + 1})`, `Observation[${i}].identifier[0]`, obxIdentifier.value ?? "");
    }

    const category = cweToCodeableConcept(obx.fields[29]);
    if (category) {
      observation.category = [category];
      trail.add(`OBX-29 (#${i + 1})`, `Observation[${i}].category[0]`, getComponent(obx, 29, 1) ?? "");
    }

    // NTE segments immediately following an OBX annotate that OBX, per HL7v2 convention
    // (and the IG's own "Segment NTE to Observation Map") — not the message as a whole, the
    // way NTE works for ORM/OML's single ServiceRequest.
    const obxIndex = message.segments.indexOf(obx);
    const notes: NonNullable<Observation["note"]> = [];
    for (let j = obxIndex + 1; j < message.segments.length && message.segments[j]!.id === "NTE"; j++) {
      const nte = message.segments[j]!;
      const text = getField(nte, 3);
      if (!text) continue;
      const noteTime = hl7DateTimeToFhir(getField(nte, 6));
      notes.push({ text, ...(noteTime ? { time: noteTime } : {}) });
      trail.add(`NTE-3 (OBX #${i + 1}, note #${notes.length})`, `Observation[${i}].note[${notes.length - 1}].text`, text);
      if (noteTime) trail.add(`NTE-6 (OBX #${i + 1}, note #${notes.length})`, `Observation[${i}].note[${notes.length - 1}].time`, noteTime);
    }
    if (notes.length > 0) observation.note = notes;

    observations.push(observation);
    report.result?.push({ reference: `Observation/${observation.id}` });
  });

  bundle.entry.push({ resource: report });
  for (const obs of observations) bundle.entry.push({ resource: obs });

  for (const seg of message.segments) {
    if (!KNOWN_ORU_SEGMENTS.has(seg.id)) {
      trail.warn(`${seg.id} segment has no FHIR mapping for this message type and was skipped`);
    }
  }

  bundle.entry.push({ resource: messageHeaderFromMsh(message, trail) });

  return { bundle, trail };
}

/** DiagnosticReport+Observations -> an ORU^R01 message, one OBX per Observation numbered sequentially from 1 regardless of source id. Throws `FhirValidationError` when the bundle has no Patient or no DiagnosticReport. */
export function fhirToOru(bundle: Bundle): { message: Hl7Message; trail: MappingTrail } {
  const trail = new MappingTrail();
  const patient = bundle.entry.find((e) => e.resource.resourceType === "Patient")?.resource as Patient | undefined;
  const report = bundle.entry.find((e) => e.resource.resourceType === "DiagnosticReport")?.resource as DiagnosticReport | undefined;
  const observations = bundle.entry.filter((e) => e.resource.resourceType === "Observation").map((e) => e.resource as Observation);

  if (!patient) throw new FhirValidationError("Bundle must contain a Patient resource to translate to an ORU message");
  if (!report) throw new FhirValidationError("Bundle must contain a DiagnosticReport resource to translate to an ORU message");

  const delimiters = DEFAULT_DELIMITERS;
  const controlId = nextMessageControlId();
  const now = nowHl7DateTime();

  const messageHeader = bundle.entry.find((e) => e.resource.resourceType === "MessageHeader")?.resource as MessageHeader | undefined;
  const msh = buildMsh(trail, "ORU", "R01", controlId, now, messageHeader);

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const reportCoding = report.code.coding?.[0];
  const obrFields: Record<number, Hl7Field> = { 1: field("1") };
  if (reportCoding) {
    obrFields[4] = field(reportCoding.code ?? "", reportCoding.display ?? "", "LN");
    trail.add("DiagnosticReport.code", "OBR-4", `${reportCoding.code} (${reportCoding.display ?? "n/a"})`);
  }
  const placerId = report.identifier?.find((i) => i.type?.coding?.[0]?.code === "PLAC");
  if (placerId?.value) {
    obrFields[2] = field(placerId.value);
    trail.add("DiagnosticReport.identifier", "OBR-2", placerId.value);
  }
  const fillerId = report.identifier?.find((i) => i.type?.coding?.[0]?.code === "FILL");
  if (fillerId?.value) {
    obrFields[3] = field(fillerId.value);
    trail.add("DiagnosticReport.identifier", "OBR-3", fillerId.value);
  }
  if (report.effectivePeriod?.start) {
    const t = fhirDateTimeToHl7(report.effectivePeriod.start) ?? "";
    obrFields[7] = field(t);
    trail.add("DiagnosticReport.effectivePeriod.start", "OBR-7", t);
    if (report.effectivePeriod.end) {
      const endT = fhirDateTimeToHl7(report.effectivePeriod.end) ?? "";
      obrFields[8] = field(endT);
      trail.add("DiagnosticReport.effectivePeriod.end", "OBR-8", endT);
    }
  } else if (report.effectiveDateTime) {
    const t = fhirDateTimeToHl7(report.effectiveDateTime) ?? "";
    obrFields[7] = field(t);
    trail.add("DiagnosticReport.effectiveDateTime", "OBR-7", t);
  }
  const categoryCode = report.category?.[0]?.coding?.[0]?.code;
  if (categoryCode) {
    obrFields[24] = field(categoryCode);
    trail.add("DiagnosticReport.category[0]", "OBR-24", categoryCode);
  }
  if (report.issued) {
    const t = fhirDateTimeToHl7(report.issued) ?? "";
    obrFields[22] = field(t);
    trail.add("DiagnosticReport.issued", "OBR-22", t);
  }
  const reportStatusCode = reverseLookupVocabulary(REPORT_STATUS_TABLE, report.status);
  if (reportStatusCode) {
    obrFields[25] = field(reportStatusCode);
    trail.add("DiagnosticReport.status", "OBR-25", reportStatusCode);
  }
  const obr = segment("OBR", obrFields);

  const segments = [msh, pid, obr];

  observations.forEach((obs, i) => {
    const coding = obs.code.coding?.[0];
    const obxFields: Record<number, Hl7Field> = { 1: field(String(i + 1)) };
    if (obs.valueQuantity) {
      obxFields[2] = field("NM");
      obxFields[5] = field(String(obs.valueQuantity.value ?? ""));
      obxFields[6] = field(obs.valueQuantity.unit ?? "");
      trail.add(
        `Observation[${i}].valueQuantity`,
        `OBX-5 (#${i + 1})`,
        `${obs.valueQuantity.value} ${obs.valueQuantity.unit ?? ""}`.trim(),
      );
    } else if (obs.valueString) {
      obxFields[2] = field("ST");
      obxFields[5] = field(obs.valueString);
      trail.add(`Observation[${i}].valueString`, `OBX-5 (#${i + 1})`, obs.valueString);
    }
    if (coding) {
      obxFields[3] = field(coding.code ?? "", coding.display ?? "", "LN");
      trail.add(`Observation[${i}].code`, `OBX-3 (#${i + 1})`, `${coding.code} (${coding.display ?? "n/a"})`);
    }
    const range = obs.referenceRange?.[0];
    if (range?.low?.value !== undefined && range.high?.value !== undefined) {
      obxFields[7] = field(`${range.low.value}-${range.high.value}`);
      trail.add(`Observation[${i}].referenceRange`, `OBX-7 (#${i + 1})`, obxFields[7].raw);
    }
    const interp = obs.interpretation?.[0]?.coding?.[0]?.code;
    if (interp) {
      obxFields[8] = field(interp);
      trail.add(`Observation[${i}].interpretation`, `OBX-8 (#${i + 1})`, interp);
    }
    const resultStatusCode = reverseLookupVocabulary(OBSERVATION_STATUS_TABLE, obs.status) ?? "F";
    obxFields[11] = field(resultStatusCode);
    trail.add(`Observation[${i}].status`, `OBX-11 (#${i + 1})`, resultStatusCode);
    if (obs.effectiveDateTime) {
      const t = fhirDateTimeToHl7(obs.effectiveDateTime) ?? "";
      obxFields[14] = field(t);
      trail.add(`Observation[${i}].effectiveDateTime`, `OBX-14 (#${i + 1})`, t);
    }
    if (obs.method?.coding?.[0]?.code) {
      const methodCoding = obs.method.coding[0];
      obxFields[17] = field(methodCoding.code ?? "", methodCoding.display ?? "");
      trail.add(`Observation[${i}].method`, `OBX-17 (#${i + 1})`, methodCoding.code ?? "");
    }
    if (obs.bodySite?.coding?.[0]?.code) {
      const bodySiteCoding = obs.bodySite.coding[0];
      obxFields[20] = field(bodySiteCoding.code ?? "", bodySiteCoding.display ?? "");
      trail.add(`Observation[${i}].bodySite`, `OBX-20 (#${i + 1})`, bodySiteCoding.code ?? "");
    }
    if (obs.identifier?.[0]?.value) {
      obxFields[21] = field(obs.identifier[0].value);
      trail.add(`Observation[${i}].identifier[0]`, `OBX-21 (#${i + 1})`, obs.identifier[0].value);
    }
    if (obs.category?.[0]?.coding?.[0]?.code) {
      const categoryCoding = obs.category[0].coding[0];
      obxFields[29] = field(categoryCoding.code ?? "", categoryCoding.display ?? "");
      trail.add(`Observation[${i}].category[0]`, `OBX-29 (#${i + 1})`, categoryCoding.code ?? "");
    }
    segments.push(segment("OBX", obxFields));

    obs.note?.forEach((note, noteIndex) => {
      const nteFields: Record<number, Hl7Field> = { 1: field(String(noteIndex + 1)), 3: field(note.text) };
      trail.add(`Observation[${i}].note[${noteIndex}].text`, `NTE-3 (OBX #${i + 1}, note #${noteIndex + 1})`, note.text);
      if (note.time) {
        const t = fhirDateTimeToHl7(note.time) ?? "";
        nteFields[6] = field(t);
        trail.add(`Observation[${i}].note[${noteIndex}].time`, `NTE-6 (OBX #${i + 1}, note #${noteIndex + 1})`, t);
      }
      segments.push(segment("NTE", nteFields));
    });
  });

  for (const entry of bundle.entry) {
    if (!["Patient", "DiagnosticReport", "Observation", "MessageHeader"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 ORU mapping and was skipped`);
    }
  }

  return { message: { segments, delimiters, messageType: "ORU^R01" }, trail };
}
