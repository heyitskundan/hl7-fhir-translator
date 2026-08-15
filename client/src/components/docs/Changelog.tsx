export function Changelog() {
  return (
    <div>
      <h1 className="mb-2">Changelog</h1>
      <p className="mb-8" style={{ opacity: 0.85 }}>
        This package is pre-1.0 (<code>0.x</code>) — security fixes land on the latest published version; older 0.x versions are not
        separately patched. See GitHub Releases for the full history.
      </p>

      <div className="flex flex-col gap-6">
        <div id="v0-2-0" className="border-t pt-3" style={{ borderColor: "var(--color-divider)" }}>
          <div className="mb-2 flex items-baseline gap-3">
            <h3 className="m-0">v0.2.0</h3>
            <span className="text-muted text-sm">current release</span>
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
