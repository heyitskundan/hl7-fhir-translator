const muted = { opacity: 0.85 };

export function DataMapping() {
  return (
    <div>
      <h1 className="mb-2">Data Mapping &amp; Schemas</h1>
      <p style={muted}>
        Every row below is an explicit, unit-tested code path — the complete list of fields this package reads or writes. A field present
        in the input but absent from these tables is reported in <code>warnings[]</code>, never dropped silently.
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
      <table className="table">
        <thead>
          <tr>
            <th>HL7v2</th>
            <th>FHIR</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>ADT^A01</code> admission
            </td>
            <td>Patient + Encounter</td>
            <td className="text-muted">both</td>
          </tr>
          <tr>
            <td>
              <code>ADT^A08</code> update
            </td>
            <td>Patient + Encounter</td>
            <td className="text-muted">both</td>
          </tr>
          <tr>
            <td>
              <code>ORU^R01</code> lab result
            </td>
            <td>DiagnosticReport + Observation[]</td>
            <td className="text-muted">both</td>
          </tr>
          <tr>
            <td>
              <code>ORM^O01</code> order
            </td>
            <td>ServiceRequest</td>
            <td className="text-muted">both</td>
          </tr>
        </tbody>
      </table>

      <h2 id="adt" className="mt-8">
        ADT^A01 / ADT^A08 → Patient + Encounter
      </h2>
      <p style={muted}>
        Both trigger events share the same segments and mapping. Reads <code>MSH</code>, <code>EVN</code>, <code>PID</code>,{" "}
        <code>PV1</code>.
      </p>
      <div className="my-2 flex items-center gap-2">
        <span className="tag tag-neutral">PID → Patient</span>
        <span className="text-muted text-xs">shared by every message type below</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>HL7v2 field</th>
            <th>FHIR path</th>
            <th>PHI</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PID-3.1</code>
            </td>
            <td>Patient.identifier[0].value</td>
            <td>
              <span className="tag tag-accent">PHI</span>
            </td>
          </tr>
          <tr>
            <td>
              <code>PID-3.4</code>
            </td>
            <td>Patient.identifier[0].assigner.display</td>
            <td>
              <span className="tag tag-neutral">No</span>
            </td>
          </tr>
          <tr>
            <td>
              <code>PID-3.5</code>
            </td>
            <td>Patient.identifier[0].type.coding[0].code</td>
            <td>
              <span className="tag tag-neutral">No</span>
            </td>
          </tr>
          <tr>
            <td>
              <code>PID-5.1..3</code>
            </td>
            <td>Patient.name[0].family / given[]</td>
            <td>
              <span className="tag tag-accent">PHI</span>
            </td>
          </tr>
          <tr>
            <td>
              <code>PID-7</code>
            </td>
            <td>Patient.birthDate</td>
            <td>
              <span className="tag tag-accent">PHI</span>
            </td>
          </tr>
          <tr>
            <td>
              <code>PID-8</code>
            </td>
            <td>Patient.gender</td>
            <td>
              <span className="tag tag-neutral">No</span>
            </td>
          </tr>
          <tr>
            <td>
              <code>PID-11.1,3-6</code>
            </td>
            <td>Patient.address[0]</td>
            <td>
              <span className="tag tag-accent">PHI</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="my-2 mt-4">
        <span className="tag tag-neutral">PV1 → Encounter</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>HL7v2 field</th>
            <th>FHIR path</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>PV1-2</code>
            </td>
            <td>Encounter.class</td>
            <td className="text-muted">I→IMP, O→AMB, E→EMER, else UNK</td>
          </tr>
          <tr>
            <td>
              <code>PV1-3.1</code>
            </td>
            <td>Encounter.location[0].location.display</td>
            <td className="text-muted">Point of care only</td>
          </tr>
          <tr>
            <td>
              <code>PV1-7.2 / .3</code>
            </td>
            <td>Encounter.participant[0].individual.display</td>
            <td className="text-muted">Attending doctor name</td>
          </tr>
          <tr>
            <td>
              <code>EVN-2</code>
            </td>
            <td>Encounter.period.start</td>
            <td className="text-muted">Recorded event date/time</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-sm" style={muted}>
        <code>Encounter.status</code> is always <code>in-progress</code>; <code>participant[0].type</code> is always <code>ATND</code>.
      </p>

      <h2 id="oru" className="mt-8">
        ORU^R01 → DiagnosticReport + Observation[]
      </h2>
      <p style={muted}>
        Reads <code>MSH</code>, <code>PID</code> (mapping above), one <code>OBR</code> panel, one or more <code>OBX</code> results.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>HL7v2 field</th>
            <th>FHIR path</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>OBR-4.1 / .2</code>
            </td>
            <td>DiagnosticReport.code.coding[0]</td>
            <td className="text-muted">System = LOINC; panel name e.g. "CBC"</td>
          </tr>
          <tr>
            <td>
              <code>OBR-7</code>
            </td>
            <td>DiagnosticReport.effectiveDateTime</td>
            <td className="text-muted">Collection date-time</td>
          </tr>
          <tr>
            <td>
              <code>OBX-3.1 / .2</code>
            </td>
            <td>Observation[i].code.coding[0]</td>
            <td className="text-muted">Required — a missing OBX-3 is skipped with a warning</td>
          </tr>
          <tr>
            <td>
              <code>OBX-2 + OBX-5</code>
            </td>
            <td>Observation[i].valueQuantity / valueString</td>
            <td className="text-muted">Numeric (NM) → valueQuantity, else valueString</td>
          </tr>
          <tr>
            <td>
              <code>OBX-6</code>
            </td>
            <td>Observation[i].valueQuantity.unit</td>
            <td className="text-muted">Only alongside valueQuantity</td>
          </tr>
          <tr>
            <td>
              <code>OBX-7</code>
            </td>
            <td>Observation[i].referenceRange[0]</td>
            <td className="text-muted">"13.5-17.5" → {"{ low, high }"}</td>
          </tr>
          <tr>
            <td>
              <code>OBX-8</code>
            </td>
            <td>Observation[i].interpretation[0]</td>
            <td className="text-muted">System = v3-ObservationInterpretation</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-sm" style={muted}>
        <code>DiagnosticReport.status</code> and each <code>Observation.status</code> are always <code>final</code>. A message with zero
        OBX segments throws <code>FhirValidationError</code>.
      </p>

      <h2 id="orm" className="mt-8">
        ORM^O01 → ServiceRequest
      </h2>
      <p style={muted}>
        Reads <code>MSH</code>, <code>PID</code> (mapping above), <code>ORC</code>, <code>OBR</code>.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>HL7v2 field</th>
            <th>FHIR path</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>ORC-1</code>
            </td>
            <td>ServiceRequest.status</td>
            <td className="text-muted">NW→active, CA→revoked, CM→completed</td>
          </tr>
          <tr>
            <td>
              <code>ORC-9</code>
            </td>
            <td>ServiceRequest.authoredOn</td>
            <td className="text-muted">Date/time of transaction</td>
          </tr>
          <tr>
            <td>
              <code>ORC-12.2 / .3</code>
            </td>
            <td>ServiceRequest.requester.display</td>
            <td className="text-muted">Falls back to OBR-16 if ORC-12 absent</td>
          </tr>
          <tr>
            <td>
              <code>OBR-4.1 / .2</code>
            </td>
            <td>ServiceRequest.code.coding[0]</td>
            <td className="text-muted">System = LOINC</td>
          </tr>
          <tr>
            <td>
              <code>OBR-7</code>
            </td>
            <td>ServiceRequest.occurrenceDateTime</td>
            <td className="text-muted">Requested date/time</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-sm" style={muted}>
        <code>ServiceRequest.intent</code> is always <code>order</code>.
      </p>

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
          <tr>
            <td>LOINC</td>
            <td className="text-muted">Lab/order codes (OBR-4, OBX-3)</td>
          </tr>
          <tr>
            <td>HL7 v2 Table 0203</td>
            <td className="text-muted">Patient.identifier[].type</td>
          </tr>
          <tr>
            <td>HL7 v3 ActCode</td>
            <td className="text-muted">Encounter.class</td>
          </tr>
          <tr>
            <td>HL7 v3 ObservationInterpretation</td>
            <td className="text-muted">Observation.interpretation</td>
          </tr>
          <tr>
            <td>HL7 v3 ParticipationType</td>
            <td className="text-muted">Encounter.participant[].type</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-4" style={muted}>
        Full field-by-field detail, reverse (FHIR → HL7v2) tables, and worked examples for every message type are in{" "}
        <code>docs/MAPPING.md</code> in the repository.
      </p>
    </div>
  );
}
