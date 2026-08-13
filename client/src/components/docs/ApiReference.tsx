import { CodeBlock } from "./CodeBlock.js";

const muted = { opacity: 0.85 };

export function ApiReference() {
  return (
    <div>
      <h1 className="mb-2">API Reference</h1>
      <p style={muted}>
        Every symbol below is exported from the package root — <code>import {"{ X }"} from "hl7-fhir-translator"</code>. This is the
        complete list.
      </p>

      <h2 id="inspect" className="mt-8">
        Inspection
      </h2>
      <div id="inspectInput" className="mb-6">
        <code className="text-sm font-semibold">inspectInput(input: string): DetectionResult</code>
        <p className="mt-2 text-sm" style={muted}>
          Identifies direction and the specific HL7v2 message type or FHIR resource kind — synchronously, safe to call on every keystroke
          in a UI. Always returns a result, never throws.
        </p>
      </div>
      <CodeBlock
        lang="js"
        code={`import { inspectInput } from "hl7-fhir-translator";

const hl7Message = "MSH|^~\\\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5";

inspectInput(hl7Message);
// { direction: "hl7ToFhir",
//   detail: { kind: "hl7", messageType: "ADT^A01", category: "ADT", trigger: "A01",
//              supported: true, description: "Patient admission" } }

inspectInput("something else entirely");
// { direction: "unknown", detail: { kind: "unknown", reason: "Input doesn't start with MSH or {" } }`}
      />

      <h2 id="translate" className="mt-8">
        Translation
      </h2>
      <div id="translateHl7ToFhir" className="mb-4">
        <code className="text-sm font-semibold">translateHl7ToFhir(rawHl7: string): TranslationResult</code>
        <p className="mt-2 text-sm" style={muted}>
          Parses a raw HL7v2 message and returns a FHIR R4 <code>Bundle</code> as a pretty-printed JSON string, keyed off{" "}
          <code>MSH-9</code> to select the mapper. Throws <code>Hl7ParseError</code> for malformed HL7, <code>FhirValidationError</code>{" "}
          for a well-formed but unsupported or incomplete message.
        </p>
      </div>
      <CodeBlock
        lang="js"
        code={`import { translateHl7ToFhir } from "hl7-fhir-translator";

const rawHl7Message = "MSH|^~\\\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5\\rPID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M";

const result = translateHl7ToFhir(rawHl7Message);

result.translated; // FHIR R4 Bundle, pretty-printed JSON string
result.mappings;   // [{ source: "PID-3", target: "Patient.identifier[0].value", value: "MRN12345" }, ...]
result.warnings;   // segments/fields with no FHIR mapping`}
      />

      <div id="translateFhirToHl7" className="mb-6">
        <code className="text-sm font-semibold">translateFhirToHl7(rawFhirJson: string): TranslationResult</code>
        <p className="mt-2 text-sm" style={muted}>
          Parses a FHIR R4 resource or <code>Bundle</code> (JSON string) and returns an HL7v2 message string. A bare resource is
          auto-wrapped in a <code>Bundle</code>. The target message type is inferred from which resource types are present, checked most
          specific first: <code>Specimen</code> → <code>OML^O21</code>, <code>ServiceRequest</code> → <code>ORM^O01</code>,{" "}
          <code>DiagnosticReport</code> → <code>ORU^R01</code>, <code>Immunization</code> → <code>VXU^V04</code>,{" "}
          <code>Appointment</code> → <code>SIU^S12</code>, <code>DocumentReference</code> → <code>MDM^T02</code>, else{" "}
          <code>Patient</code> → <code>ADT^A01</code>.
        </p>
      </div>
      <CodeBlock
        lang="js"
        code={`import { translateFhirToHl7 } from "hl7-fhir-translator";

// A bare resource is accepted and auto-wrapped in a Bundle
const patientJson = JSON.stringify({
  resourceType: "Patient",
  name: [{ family: "Doe", given: ["John"] }],
  gender: "male",
  birthDate: "1980-05-15",
});

const result = translateFhirToHl7(patientJson);
result.translated; // "MSH|^~\\&|FHIR-TRANSLATOR|...\\rPID|1||...\\r..."`}
      />

      <h2 id="types" className="mt-8">
        Result &amp; detection types
      </h2>
      <CodeBlock
        lang="ts"
        code={`interface Mapping {
  source: string;   // e.g. "PID-3" or "Patient.identifier[0].value"
  target: string;
  value: string;
  note?: string;
}

interface TranslationResult {
  translated: string;   // FHIR JSON (a Bundle) or an HL7v2 message string
  mappings: Mapping[];  // one entry per field actually translated
  warnings: string[];   // segments/fields present in the input with no mapping
}

interface DetectionResult {
  direction: "hl7ToFhir" | "fhirToHl7" | "unknown";
  detail: DetectedHl7 | DetectedFhir | DetectedUnknown;
}

interface DetectedHl7 {
  kind: "hl7";
  messageType: string;      // e.g. "ADT^A01"
  category: string;         // e.g. "ADT"
  trigger: string;          // e.g. "A01"
  supported: boolean;
  description?: string;
}

interface DetectedFhir {
  kind: "fhir";
  resourceTypes: string[];
  targetMessageType?: string;
  supported: boolean;
}

interface DetectedUnknown {
  kind: "unknown";
  reason: string;
}`}
      />

      <h2 id="registry" className="mt-8">
        Supported-type registry
      </h2>
      <p style={muted}>
        <code>SUPPORTED_MESSAGE_TYPES: SupportedMessageType[]</code> — the runtime source of truth. Check{" "}
        <code>SUPPORTED_MESSAGE_TYPES.some(t {"=>"} t.category === "ADT" &amp;&amp; t.trigger === "A01")</code> instead of hardcoding
        support.
      </p>

      <h2 id="parsing" className="mt-8">
        Lower-level HL7v2 parsing
      </h2>
      <p style={muted}>Exported for inspecting a message's structure directly — the translation functions above are built on exactly these.</p>
      <table className="table mb-4">
        <thead>
          <tr>
            <th>Export</th>
            <th>Signature</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>parseHl7Message</code>
            </td>
            <td className="text-muted">(text) {"=>"} Hl7Message</td>
            <td className="text-muted">Parses raw HL7v2 text into a structured message. Throws Hl7ParseError on malformed input.</td>
          </tr>
          <tr>
            <td>
              <code>serializeHl7Message</code>
            </td>
            <td className="text-muted">(message) {"=>"} string</td>
            <td className="text-muted">Serializes a structured message back to pipe-delimited wire format.</td>
          </tr>
          <tr>
            <td>
              <code>findSegment</code>
            </td>
            <td className="text-muted">(message, id) {"=>"} Hl7Segment | undefined</td>
            <td className="text-muted">First segment with the given id, e.g. "PID".</td>
          </tr>
          <tr>
            <td>
              <code>findSegments</code>
            </td>
            <td className="text-muted">(message, id) {"=>"} Hl7Segment[]</td>
            <td className="text-muted">All segments with the given id, e.g. every OBX.</td>
          </tr>
          <tr>
            <td>
              <code>getField</code>
            </td>
            <td className="text-muted">(segment, fieldNumber) {"=>"} string | undefined</td>
            <td className="text-muted">Raw value of a 1-indexed HL7 field.</td>
          </tr>
          <tr>
            <td>
              <code>getComponent</code>
            </td>
            <td className="text-muted">(segment, fieldNumber, componentNumber, repetitionIndex?) {"=>"} string | undefined</td>
            <td className="text-muted">Value of one ^-delimited component.</td>
          </tr>
          <tr>
            <td>
              <code>getRepetitions</code>
            </td>
            <td className="text-muted">(segment, fieldNumber) {"=>"} string[][]</td>
            <td className="text-muted">All ~-delimited repetitions of a repeating field.</td>
          </tr>
        </tbody>
      </table>
      <CodeBlock
        lang="js"
        code={`import { parseHl7Message, findSegment, getField, getComponent } from "hl7-fhir-translator";

const hl7 = "MSH|^~\\\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5\\rPID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M";
const message = parseHl7Message(hl7);
const pid = findSegment(message, "PID");
getField(pid, 7);        // "19800515"  (PID-7, whole field)
getComponent(pid, 5, 1); // "Doe"       (PID-5, 1st component)`}
      />

      <h2 id="errors" className="mt-8">
        Errors
      </h2>
      <table className="table mb-4">
        <thead>
          <tr>
            <th>Export</th>
            <th>Extends</th>
            <th>Adds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>Hl7ParseError</code>
            </td>
            <td className="text-muted">Error</td>
            <td className="text-muted">context? — the offending line, when available</td>
          </tr>
          <tr>
            <td>
              <code>FhirValidationError</code>
            </td>
            <td className="text-muted">Error</td>
            <td className="text-muted">context?</td>
          </tr>
        </tbody>
      </table>
      <CodeBlock
        lang="js"
        code={`import { translateHl7ToFhir, Hl7ParseError, FhirValidationError } from "hl7-fhir-translator";

const input = "MSH|^~\\\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5";

try {
  translateHl7ToFhir(input);
} catch (err) {
  if (err instanceof Hl7ParseError || err instanceof FhirValidationError) {
    console.error(err.message, err.context);
  } else {
    throw err;
  }
}`}
      />

      <h2 id="cli" className="mt-8">
        CLI reference
      </h2>
      <p style={muted}>
        Installing the package also installs a <code>hl7-fhir-translator</code> binary.
      </p>
      <table className="table mb-4">
        <thead>
          <tr>
            <th>Flag</th>
            <th>Short</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>--in &lt;file&gt;</code>
            </td>
            <td className="text-muted">-i</td>
            <td className="text-muted">Input file. Reads stdin if omitted.</td>
          </tr>
          <tr>
            <td>
              <code>--out &lt;file&gt;</code>
            </td>
            <td className="text-muted">-o</td>
            <td className="text-muted">Output file. Writes stdout if omitted.</td>
          </tr>
          <tr>
            <td>
              <code>--direction &lt;dir&gt;</code>
            </td>
            <td className="text-muted">-d</td>
            <td className="text-muted">"hl7ToFhir" or "fhirToHl7". Auto-detected if omitted.</td>
          </tr>
          <tr>
            <td>
              <code>--json</code>
            </td>
            <td className="text-muted">—</td>
            <td className="text-muted">Print the full result including mappings/warnings.</td>
          </tr>
          <tr>
            <td>
              <code>--detect</code>
            </td>
            <td className="text-muted">—</td>
            <td className="text-muted">Print a one-line detection summary and exit.</td>
          </tr>
          <tr>
            <td>
              <code>--help</code>
            </td>
            <td className="text-muted">-h</td>
            <td className="text-muted">Show usage.</td>
          </tr>
        </tbody>
      </table>
      <CodeBlock
        lang="bash"
        code={`npx hl7-fhir-translator -i message.hl7                 # -> FHIR JSON on stdout
npx hl7-fhir-translator -i patient.json -d fhirToHl7   # -> HL7v2 on stdout
cat message.hl7 | npx hl7-fhir-translator --json       # direction auto-detected
npx hl7-fhir-translator -i message.hl7 --detect        # print detected type only`}
      />
    </div>
  );
}
