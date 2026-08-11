import { findSegment, findSegments, getComponent, getField } from "../hl7/parser.js";
import { field, segment } from "../hl7/serializer.js";
import { DEFAULT_DELIMITERS, type Hl7Field, type Hl7Message } from "../hl7/types.js";
import type { Bundle, DiagnosticReport, Observation, Patient, Range } from "../fhir/types.js";
import { FhirValidationError } from "../fhir/types.js";
import { CODE_SYSTEMS, MappingTrail, fhirDateTimeToHl7, hl7DateTimeToFhir, nextMessageControlId, nowHl7DateTime } from "./common.js";
import { buildPatientFromPid, buildPidFieldsFromPatient } from "./adt.js";

const KNOWN_ORU_SEGMENTS = new Set(["MSH", "PID", "OBR", "OBX"]);
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
  const report: DiagnosticReport = {
    resourceType: "DiagnosticReport",
    id: "report-1",
    status: "final",
    code: {
      coding: reportCode ? [{ system: CODE_SYSTEMS.loinc, code: reportCode, display: reportDisplay }] : undefined,
      text: reportDisplay,
    },
    subject: { reference: `Patient/${patient.id}` },
    result: [],
  };
  if (reportCode) trail.add("OBR-4", "DiagnosticReport.code", `${reportCode} (${reportDisplay ?? "n/a"})`);

  const obrTime = hl7DateTimeToFhir(getField(obr, 7));
  if (obrTime) {
    report.effectiveDateTime = obrTime;
    trail.add("OBR-7", "DiagnosticReport.effectiveDateTime", obrTime);
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
    const observation: Observation = {
      resourceType: "Observation",
      id: `observation-${setId}`,
      status: "final",
      code: { coding: [{ system: CODE_SYSTEMS.loinc, code: obsCode, display: obsDisplay }], text: obsDisplay },
      subject: { reference: `Patient/${patient.id}` },
    };
    trail.add(`OBX-3 (#${i + 1})`, `Observation[${i}].code`, `${obsCode} (${obsDisplay ?? "n/a"})`);

    const valueType = getField(obx, 2);
    const rawValue = getField(obx, 5);
    if (valueType === "NM" && rawValue !== undefined) {
      observation.valueQuantity = { value: Number(rawValue), unit: getField(obx, 6) };
      trail.add(`OBX-5 (#${i + 1})`, `Observation[${i}].valueQuantity`, `${rawValue} ${getField(obx, 6) ?? ""}`.trim());
    } else if (rawValue !== undefined) {
      observation.valueString = rawValue;
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

  const msh = segment("MSH", {
    2: field("^~\\&"),
    3: field("FHIR-TRANSLATOR"),
    4: field("HL7FHIR"),
    5: field("HIS"),
    6: field("HOSP"),
    7: field(now),
    9: field("ORU", "R01"),
    10: field(controlId),
    11: field("P"),
    12: field("2.5"),
  });
  trail.add("Bundle.type", "MSH-9", "ORU^R01");

  const pidFields = buildPidFieldsFromPatient(patient, trail);
  const pid = segment("PID", { 1: field("1"), ...pidFields });

  const reportCoding = report.code.coding?.[0];
  const obrFields: Record<number, Hl7Field> = { 1: field("1") };
  if (reportCoding) {
    obrFields[4] = field(reportCoding.code ?? "", reportCoding.display ?? "", "LN");
    trail.add("DiagnosticReport.code", "OBR-4", `${reportCoding.code} (${reportCoding.display ?? "n/a"})`);
  }
  if (report.effectiveDateTime) {
    const t = fhirDateTimeToHl7(report.effectiveDateTime) ?? "";
    obrFields[7] = field(t);
    trail.add("DiagnosticReport.effectiveDateTime", "OBR-7", t);
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
    obxFields[11] = field("F");
    if (obs.effectiveDateTime) {
      const t = fhirDateTimeToHl7(obs.effectiveDateTime) ?? "";
      obxFields[14] = field(t);
      trail.add(`Observation[${i}].effectiveDateTime`, `OBX-14 (#${i + 1})`, t);
    }
    segments.push(segment("OBX", obxFields));
  });

  for (const entry of bundle.entry) {
    if (!["Patient", "DiagnosticReport", "Observation"].includes(entry.resource.resourceType)) {
      trail.warn(`${entry.resource.resourceType} resource has no HL7v2 ORU mapping and was skipped`);
    }
  }

  return { message: { segments, delimiters, messageType: "ORU^R01" }, trail };
}
