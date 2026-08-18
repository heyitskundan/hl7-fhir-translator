import type { ReactNode } from "react";

const muted = { opacity: 0.85 };

/**
 * Renders inline `backtick` spans as <code>, matching the convention docs/MAPPING.md
 * already uses for field/path tokens — this lets the data below stay plain strings
 * instead of JSX, so adding a message type or a field row is a data change, not a new
 * hand-written block of markup.
 */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
  );
}

interface SupportedType {
  hl7: string;
  label: string;
  fhir: string;
}

const SUPPORTED_TYPES: SupportedType[] = [
  { hl7: "ADT^A01", label: "admission", fhir: "Patient + Encounter" },
  { hl7: "ADT^A02", label: "transfer", fhir: "Patient + Encounter" },
  { hl7: "ADT^A05", label: "pre-admit", fhir: "Patient + Encounter (planned)" },
  { hl7: "ADT^A06", label: "outpatient → inpatient", fhir: "Patient + Encounter" },
  { hl7: "ADT^A08", label: "update", fhir: "Patient + Encounter" },
  { hl7: "ADT^A09", label: "departing, tracking", fhir: "Patient + Encounter" },
  { hl7: "ADT^A11", label: "cancel admit", fhir: "Patient + Encounter (entered-in-error)" },
  { hl7: "ADT^A17", label: "swap patients", fhir: "2× Patient + Encounter" },
  { hl7: "ORU^R01", label: "lab result", fhir: "DiagnosticReport + Observation[]" },
  { hl7: "ORM^O01", label: "order", fhir: "ServiceRequest" },
  { hl7: "VXU^V04", label: "immunization", fhir: "Immunization" },
  { hl7: "SIU^S12", label: "appointment", fhir: "Appointment" },
  { hl7: "OML^O21", label: "lab order", fhir: "ServiceRequest + Specimen" },
  { hl7: "MDM^T02", label: "document", fhir: "DocumentReference" },
];

interface FieldRow {
  hl7: string;
  fhir: string;
  /** Third-column content. A boolean renders as a PHI/No tag; a string renders as a muted note. */
  note: string | boolean;
}

interface SegmentTable {
  /** Tag shown above the table, e.g. "PV1 → Encounter". Omitted for a section's sole table. */
  label?: string;
  labelNote?: string;
  thirdColumn: "phi" | "notes";
  rows: FieldRow[];
}

interface MessageTypeSection {
  id: string;
  title: string;
  description: string;
  tables: SegmentTable[];
  footnote?: string;
}

const PID_TO_PATIENT: SegmentTable = {
  label: "PID → Patient",
  labelNote: "shared by every message type below",
  thirdColumn: "phi",
  rows: [
    { hl7: "PID-3.1", fhir: "Patient.identifier[0].value", note: true },
    { hl7: "PID-3.4", fhir: "Patient.identifier[0].assigner.display", note: false },
    { hl7: "PID-3.5", fhir: "Patient.identifier[0].type.coding[0].code", note: false },
    { hl7: "PID-5.1..3", fhir: "Patient.name[0].family / given[]", note: true },
    { hl7: "PID-7", fhir: "Patient.birthDate", note: true },
    { hl7: "PID-8", fhir: "Patient.gender", note: false },
    { hl7: "PID-11.1,3-6", fhir: "Patient.address[0]", note: true },
  ],
};

const MESSAGE_TYPE_SECTIONS: MessageTypeSection[] = [
  {
    id: "adt",
    title: "ADT^A01 / A02 / A05 / A06 / A08 / A09 / A11 → Patient + Encounter",
    description:
      "All seven trigger events share the same segments and field mapping. Reads `MSH`, `EVN`, `PID`, `PV1`. The official IG's ADT pages map segments to resource types generically and don't specify a per-trigger status rule — the status table below is this package's own reading of the HL7v2 trigger semantics.",
    tables: [
      PID_TO_PATIENT,
      {
        label: "PV1 → Encounter",
        thirdColumn: "notes",
        rows: [
          { hl7: "PV1-2", fhir: "Encounter.class", note: "I→IMP, O→AMB, E→EMER, else UNK" },
          { hl7: "PV1-3.1", fhir: "Encounter.location[0].location.display", note: "Point of care only" },
          { hl7: "PV1-7.2 / .3", fhir: "Encounter.participant[0].individual.display", note: "Attending doctor name" },
          { hl7: "EVN-2", fhir: "Encounter.period.start", note: "Recorded event date/time" },
        ],
      },
      {
        label: "MSH-9 trigger → Encounter.status",
        thirdColumn: "notes",
        rows: [
          { hl7: "A05", fhir: "Encounter.status", note: "planned — admission hasn't happened yet" },
          { hl7: "A11", fhir: "Encounter.status", note: "entered-in-error — admit message sent in error" },
          { hl7: "A01, A02, A06, A08, A09", fhir: "Encounter.status", note: "in-progress (default)" },
        ],
      },
    ],
    footnote: "`participant[0].type` is always `ATND`.",
  },
  {
    id: "adt-a17",
    title: "ADT^A17 → 2× Patient + Encounter",
    description:
      "Structurally different from every other ADT trigger: HL7v2 uses A17 to report two patients swapping locations in one message, so it carries two `PID`/`PV1` groups. Each field maps exactly like A01 above, applied once per group. `Encounter.status` is always `in-progress`; a message with fewer than two `PID` segments throws.",
    tables: [
      {
        thirdColumn: "notes",
        rows: [
          { hl7: "PID (×2)", fhir: "Patient[0], Patient[1]", note: "Same PID→Patient mapping as A01, per patient" },
          { hl7: "PV1 (×2)", fhir: "Encounter[0], Encounter[1]", note: "Same PV1→Encounter mapping as A01, per patient" },
        ],
      },
    ],
    footnote:
      "Reverse routing (FHIR → HL7v2) picks A17 when a bundle contains 2+ `Patient` resources — resource-type presence alone can't distinguish it from a single-patient A01 bundle, so this is the one place routing counts occurrences instead of just checking presence.",
  },
  {
    id: "oru",
    title: "ORU^R01 → DiagnosticReport + Observation[]",
    description: "Reads `MSH`, `PID` (mapping above), one `OBR` panel, one or more `OBX` results.",
    tables: [
      {
        thirdColumn: "notes",
        rows: [
          { hl7: "OBR-4.1 / .2", fhir: "DiagnosticReport.code.coding[0]", note: 'System = LOINC; panel name e.g. "CBC"' },
          { hl7: "OBR-7", fhir: "DiagnosticReport.effectiveDateTime", note: "Collection date-time" },
          { hl7: "OBX-3.1 / .2", fhir: "Observation[i].code.coding[0]", note: "Required — a missing OBX-3 is skipped with a warning" },
          {
            hl7: "OBX-2 + OBX-5",
            fhir: "Observation[i].valueQuantity / valueString",
            note: "Numeric (NM) → valueQuantity, else valueString",
          },
          { hl7: "OBX-6", fhir: "Observation[i].valueQuantity.unit", note: "Only alongside valueQuantity" },
          { hl7: "OBX-7", fhir: "Observation[i].referenceRange[0]", note: '"13.5-17.5" → { low, high }' },
          { hl7: "OBX-8", fhir: "Observation[i].interpretation[0]", note: "System = v3-ObservationInterpretation" },
        ],
      },
    ],
    footnote:
      "`DiagnosticReport.status` and each `Observation.status` are always `final`. A message with zero OBX segments throws `FhirValidationError`.",
  },
  {
    id: "orm",
    title: "ORM^O01 → ServiceRequest",
    description: "Reads `MSH`, `PID` (mapping above), `ORC`, `OBR`.",
    tables: [
      {
        thirdColumn: "notes",
        rows: [
          { hl7: "ORC-1", fhir: "ServiceRequest.status", note: "NW→active, CA→revoked, CM→completed" },
          { hl7: "ORC-9", fhir: "ServiceRequest.authoredOn", note: "Date/time of transaction" },
          { hl7: "ORC-12.2 / .3", fhir: "ServiceRequest.requester.display", note: "Falls back to OBR-16 if ORC-12 absent" },
          { hl7: "OBR-4.1 / .2", fhir: "ServiceRequest.code.coding[0]", note: "System = LOINC" },
          { hl7: "OBR-7", fhir: "ServiceRequest.occurrenceDateTime", note: "Requested date/time" },
        ],
      },
    ],
    footnote: "`ServiceRequest.intent` is always `order`.",
  },
  {
    id: "vxu",
    title: "VXU^V04 → Immunization",
    description: "Reads `MSH`, `PID` (mapping above), `RXA`.",
    tables: [
      {
        thirdColumn: "notes",
        rows: [
          { hl7: "RXA-20", fhir: "Immunization.status", note: "CP/PA→completed, RE/NA→not-done, else completed" },
          { hl7: "RXA-5.1 / .2", fhir: "Immunization.vaccineCode.coding[0]", note: "System = CVX" },
          { hl7: "RXA-3", fhir: "Immunization.occurrenceDateTime", note: "Administration date/time" },
          { hl7: "RXA-6 / RXA-7.1", fhir: "Immunization.doseQuantity", note: "Value + unit; unit only set alongside value" },
          { hl7: "RXA-15 / RXA-16", fhir: "Immunization.lotNumber / expirationDate", note: "RXA-16: YYYYMMDD → YYYY-MM-DD" },
          { hl7: "RXA-17.2", fhir: "Immunization.manufacturer.display", note: "—" },
          { hl7: "RXA-10.2 / .3", fhir: "Immunization.performer[0].actor.display", note: "Administering provider name" },
        ],
      },
    ],
    footnote: "`Immunization.patient` is always a reference to the Patient built from `PID`.",
  },
  {
    id: "siu",
    title: "SIU^S12 → Appointment",
    description: "Reads `MSH`, `SCH`, `PID` (mapping above), `AIL` (location), `AIP` (personnel).",
    tables: [
      {
        thirdColumn: "notes",
        rows: [
          { hl7: "SCH-25", fhir: "Appointment.status", note: "BOOKED/CANCELLED/COMPLETE/PENDING, else booked" },
          { hl7: "SCH-7", fhir: "Appointment.reasonCode[0].coding[0]", note: "—" },
          { hl7: "SCH-8", fhir: "Appointment.appointmentType.coding[0]", note: "System = v2-0276" },
          {
            hl7: "SCH-9 / SCH-10",
            fhir: "Appointment.minutesDuration",
            note: "SCH-10 (units) read only to annotate the trail, not converted",
          },
          { hl7: "SCH-11.4 / .5", fhir: "Appointment.start / .end", note: "4th/5th component of the SCH-11 timing quantity" },
          { hl7: "AIL-3.2", fhir: "Appointment.participant[].actor.display", note: "Scheduled location name" },
          { hl7: "AIP-3.2 / .3", fhir: "Appointment.participant[].actor.display", note: "Scheduled practitioner name" },
        ],
      },
    ],
    footnote:
      '`Appointment.participant[0]` is always a reference to the Patient built from `PID`, with `status: "accepted"`; the location and practitioner are appended as additional participants, also accepted — this package doesn\'t track pending invitations.',
  },
  {
    id: "oml",
    title: "OML^O21 → ServiceRequest + Specimen",
    description:
      "What distinguishes a lab order from a general order (`ORM^O01` above): it carries a `SPM` (specimen) segment. Reads `MSH`, `PID`, `ORC`, `OBR` (mapping same as ORM above), plus `SPM`.",
    tables: [
      {
        thirdColumn: "notes",
        rows: [
          { hl7: "SPM-4.1 / .2", fhir: "Specimen.type.coding[0]", note: "System = v2-0487" },
          { hl7: "SPM-17", fhir: "Specimen.collection.collectedDateTime", note: "—" },
        ],
      },
    ],
    footnote:
      "`Specimen.subject` references the same Patient as the ServiceRequest; `Specimen.request[0]` references the ServiceRequest built from `ORC`/`OBR`.",
  },
  {
    id: "mdm",
    title: "MDM^T02 → DocumentReference",
    description: "Reads `MSH`, `EVN`, `PID` (mapping above), `TXA`.",
    tables: [
      {
        thirdColumn: "notes",
        rows: [
          { hl7: "TXA-2.1 / .2", fhir: "DocumentReference.type.coding[0]", note: "System = LOINC" },
          { hl7: "TXA-17", fhir: "DocumentReference.docStatus", note: "AU/TR→final, DI/DO/IP/PA→preliminary, absent→omitted" },
          { hl7: "TXA-6", fhir: "DocumentReference.date", note: "Also copied to content[0].attachment.creation" },
          { hl7: "TXA-12", fhir: "DocumentReference.masterIdentifier.value", note: "Unique document number" },
          { hl7: "TXA-9.2 / .3", fhir: "DocumentReference.author[0].display", note: "Originator name" },
        ],
      },
    ],
    footnote:
      "`DocumentReference.status` is always `current`; `content[0].attachment.contentType` is always `text/plain` since `TXA` carries no content-type field and no actual document bytes.",
  },
];

const TERMINOLOGY_SYSTEMS: { system: string; usedFor: string }[] = [
  { system: "LOINC", usedFor: "Lab/order codes (OBR-4, OBX-3)" },
  { system: "HL7 v2 Table 0203", usedFor: "Patient.identifier[].type" },
  { system: "HL7 v3 ActCode", usedFor: "Encounter.class" },
  { system: "HL7 v3 ObservationInterpretation", usedFor: "Observation.interpretation" },
  { system: "HL7 v3 ParticipationType", usedFor: "Encounter.participant[].type" },
  { system: "CVX", usedFor: "Immunization.vaccineCode (RXA-5)" },
  { system: "HL7 v2 Table 0276", usedFor: "Appointment.appointmentType (SCH-8)" },
  { system: "HL7 v2 Table 0487", usedFor: "Specimen.type (SPM-4)" },
];

function SummaryTable() {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>HL7v2</th>
          <th>FHIR</th>
          <th>Direction</th>
        </tr>
      </thead>
      <tbody>
        {SUPPORTED_TYPES.map((t) => (
          <tr key={t.hl7}>
            <td>
              <code>{t.hl7}</code> {t.label}
            </td>
            <td>{t.fhir}</td>
            <td className="text-muted">both</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldTable({ table }: { table: SegmentTable }) {
  return (
    <>
      {table.label && (
        <div className="my-2 mt-4 flex items-center gap-2">
          <span className="tag tag-neutral">{table.label}</span>
          {table.labelNote && <span className="text-muted text-xs">{table.labelNote}</span>}
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>HL7v2 field</th>
            <th>FHIR path</th>
            <th>{table.thirdColumn === "phi" ? "PHI" : "Notes"}</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.hl7}>
              <td>
                <code>{row.hl7}</code>
              </td>
              <td>{row.fhir}</td>
              <td className={table.thirdColumn === "notes" ? "text-muted" : undefined}>
                {table.thirdColumn === "phi" ? (
                  <span className={row.note ? "tag tag-accent" : "tag tag-neutral"}>{row.note ? "PHI" : "No"}</span>
                ) : (
                  row.note
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function MessageTypeSectionBlock({ section }: { section: MessageTypeSection }) {
  return (
    <>
      <h2 id={section.id} className="mt-8">
        {section.title}
      </h2>
      <p style={muted}>{renderInline(section.description)}</p>
      {section.tables.map((table, i) => (
        <FieldTable key={table.label ?? i} table={table} />
      ))}
      {section.footnote && (
        <p className="mt-2 text-sm" style={muted}>
          {renderInline(section.footnote)}
        </p>
      )}
    </>
  );
}

export function DataMapping() {
  return (
    <div>
      <h1 className="mb-2">Data Mapping &amp; Schemas</h1>
      <p style={muted}>
        Every row below is an explicit, unit-tested code path — the complete list of fields this package reads or writes. A field present in
        the input but absent from these tables is reported in <code>warnings[]</code>, never dropped silently.
      </p>
      <p className="text-sm" style={muted}>
        Mappings follow HL7's official{" "}
        <a href="https://build.fhir.org/ig/HL7/v2-to-fhir/" target="_blank" rel="noreferrer">
          v2-to-FHIR implementation guide
        </a>
        , implemented as a hand-written JavaScript/TypeScript library.
      </p>

      <h2 id="supported" className="mt-8">
        Supported message types
      </h2>
      <SummaryTable />

      {MESSAGE_TYPE_SECTIONS.map((section) => (
        <MessageTypeSectionBlock key={section.id} section={section} />
      ))}

      <h2 id="terminology" className="mt-8">
        Terminology systems
      </h2>
      <table className="table">
        <thead>
          <tr>
            <th>System</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          {TERMINOLOGY_SYSTEMS.map((t) => (
            <tr key={t.system}>
              <td>{t.system}</td>
              <td className="text-muted">{t.usedFor}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-4" style={muted}>
        Full field-by-field detail, reverse (FHIR → HL7v2) tables, and worked examples for every message type are in{" "}
        <code>docs/MAPPING.md</code> in the repository.
      </p>
    </div>
  );
}
