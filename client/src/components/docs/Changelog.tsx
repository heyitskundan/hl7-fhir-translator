export function Changelog() {
  return (
    <div>
      <h1 className="mb-2">Changelog</h1>
      <p className="mb-8" style={{ opacity: 0.85 }}>
        This package follows semantic versioning as of <code>v1.0.0</code>. See <code>SECURITY.md</code> for the support policy and GitHub
        Releases for the full history.
      </p>

      <div className="flex flex-col gap-6">
        <div id="v1-0-1" className="border-t pt-3" style={{ borderColor: "var(--color-divider)" }}>
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="m-0">v1.0.1</h3>
            <span className="text-muted text-sm">current release</span>
          </div>
          <div className="mb-2 flex gap-2">
            <span className="tag tag-accent">Added</span>
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5" style={{ opacity: 0.85 }}>
            <li>Full field-level segment coverage across every mapping direction (PID, PV1, PV2, DG1, NK1, IN1, OBR, OBX, SPM, RXA, TQ1, NTE detail fields), per the official IG's segment-level ConceptMaps</li>
            <li>New resource types: MessageHeader (from MSH, every message type), Provenance (from EVN, ADT + MDM), Device and PractitionerRole (from PRT, ORM/OML), and CareTeam (from ROL + IN3, ADT)</li>
            <li>
              Organization, Location, Practitioner, Coverage, and Procedure as real, referenced resources — upgrading several fields that were
              previously display-only References
            </li>
            <li>Appointment.serviceType (from AIS-3) and Appointment.comment (from NTE-3) in SIU^S12</li>
            <li>A data-driven vocabulary module (HL7 code-table lookups) replacing ad hoc inline switches</li>
            <li>Reusable HL7v2 datatype converters shared across every segment mapper</li>
            <li>ADT^A40 (merge patient) — MRG maps to a new Account resource, referencing the surviving Patient</li>
            <li>RDE^O11 (pharmacy order) — new Medication and MedicationRequest resource types, from RXO/RXR</li>
            <li>IAM (the newer alternate allergy segment) alongside AL1, both producing AllergyIntolerance</li>
            <li>SFT and MSA — software/version metadata and acknowledgment codes onto MessageHeader, for any message type</li>
          </ul>
        </div>

        <div id="v0-3-0" className="border-t pt-3" style={{ borderColor: "var(--color-divider)" }}>
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="m-0">v0.3.0</h3>
          </div>
          <div className="mb-2 flex gap-2">
            <span className="tag tag-accent">Added</span>
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5" style={{ opacity: 0.85 }}>
            <li>ADT^A02, A05, A06, A09, A11 trigger events, sharing ADT^A01's segment/field mapping</li>
            <li>ADT^A17 (swap patients) — two Patient+Encounter pairs from one message, with count-aware reverse routing</li>
          </ul>
        </div>

        <div id="v0-2-0" className="border-t pt-3" style={{ borderColor: "var(--color-divider)" }}>
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="m-0">v0.2.0</h3>
          </div>
          <div className="mb-2 flex gap-2">
            <span className="tag tag-accent">Added</span>
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5" style={{ opacity: 0.85 }}>
            <li>Bidirectional mapping for VXU^V04 (Immunization)</li>
            <li>Bidirectional mapping for SIU^S12 (Appointment)</li>
            <li>Bidirectional mapping for OML^O21 (ServiceRequest + Specimen)</li>
            <li>Bidirectional mapping for MDM^T02 (DocumentReference)</li>
            <li>A docs/code mapping audit test that fails CI if docs/MAPPING.md drifts from the implementation</li>
          </ul>
        </div>

        <div id="v0-1-0" className="border-t pt-3" style={{ borderColor: "var(--color-divider)" }}>
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="m-0">v0.1.0</h3>
          </div>
          <div className="mb-2 flex gap-2">
            <span className="tag tag-accent">Added</span>
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5" style={{ opacity: 0.85 }}>
            <li>Bidirectional mapping for ADT^A01 and ADT^A08 (Patient + Encounter)</li>
            <li>Bidirectional mapping for ORU^R01 (DiagnosticReport + Observation[])</li>
            <li>Bidirectional mapping for ORM^O01 (ServiceRequest)</li>
            <li>inspectInput auto-detection for HL7v2 and FHIR input</li>
            <li>CLI with stdin/stdout, file, and JSON output modes</li>
            <li>Dual ESM+CJS build with full TypeScript definitions</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
