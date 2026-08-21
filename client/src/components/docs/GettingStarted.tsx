import { CodeBlock } from "./CodeBlock.js";

export function GettingStarted({ goDataMapping }: { goDataMapping: () => void }) {
  return (
    <div>
      <h1 id="top" className="mb-2">
        Getting Started
      </h1>
      <p style={{ opacity: 0.85 }}>
        hl7-fhir-translator deterministically translates HL7v2 messages to FHIR R4, and back, through a hand-written parser and explicit
        bidirectional mapping tables. Every output value traces back to a specific HL7v2 field or FHIR path. It is open source,
        MIT-licensed, and has zero runtime dependencies.
      </p>

      <h2 id="overview" className="mt-8">
        Overview
      </h2>
      <p style={{ opacity: 0.85 }}>
        Translation is a pure function: the same input always produces the same output. There is no network I/O and no persistence — the
        library parses a string and returns a string. It ships as both an ESM and a CommonJS package, runs in Node.js 18+ or any modern
        browser, and is covered by 327 unit tests across the parser, all 14 message-type mapping directions, a docs/code mapping audit, and
        detection.
      </p>

      <h2 id="installation" className="mt-8">
        Installation
      </h2>
      <CodeBlock lang="bash" code="npm install hl7-fhir-translator" />

      <h2 id="quickstart" className="mt-8">
        Quick start
      </h2>
      <p style={{ opacity: 0.85 }}>
        Translating an ADT^A01 admission message into a FHIR <code>Patient</code> + <code>Encounter</code> bundle:
      </p>
      <CodeBlock
        lang="js"
        code={`import { translateHl7ToFhir } from "hl7-fhir-translator";

const hl7 = [
  "MSH|^~\\\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\\r"); // segments are CR-, LF-, or CRLF-separated

const result = translateHl7ToFhir(hl7);

result.translated; // FHIR R4 Bundle, pretty-printed JSON string
result.mappings;   // [{ source: "PID-3", target: "Patient.identifier[0].value", value: "MRN12345" }, ...]
result.warnings;   // segments/fields with no FHIR mapping, e.g. unmapped GT1`}
      />
      <p style={{ opacity: 0.85 }}>
        Both module systems work the same way — <code>require("hl7-fhir-translator")</code> needs no config.
      </p>

      <h2 id="phi" className="mt-8">
        Handling PHI
      </h2>
      <div className="blueprint flex gap-3 p-4">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flex: "none", marginTop: 2 }}
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        </svg>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="tag tag-accent">PHI</span>
            <strong style={{ fontFamily: "var(--font-heading)", fontSize: 15 }}>The library never sends data anywhere</strong>
          </div>
          <p className="mb-2 text-sm" style={{ opacity: 0.85 }}>
            Both HL7v2 and FHIR inputs typically carry PHI (names, birth dates, addresses, identifiers — see{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goDataMapping();
              }}
            >
              Data Mapping
            </a>{" "}
            for exactly which fields). The package performs no network I/O and no persistence: it parses the string you pass in and returns
            a string. PHI never leaves your process.
          </p>
          <p className="text-sm" style={{ opacity: 0.85 }}>
            The application calling it is still responsible for what happens to that string — avoid logging raw{" "}
            <code>result.translated</code> or the source message in plaintext. If you report a bug, use synthetic input or describe the
            shape of the data rather than pasting real PHI (see{" "}
            <a href="https://github.com/heyitskundan/hl7-fhir-translator/blob/main/SECURITY.md" target="_blank" rel="noreferrer">
              <code>SECURITY.md</code>
            </a>
            ).
          </p>
        </div>
      </div>

      <h2 id="requirements" className="mt-8">
        Requirements
      </h2>
      <table className="table">
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Version</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node.js</td>
            <td>18 or later</td>
            <td className="text-muted">Any modern browser also works when bundled</td>
          </tr>
          <tr>
            <td>Runtime dependencies</td>
            <td>None</td>
            <td className="text-muted">Parser, mapper and CLI are hand-written</td>
          </tr>
          <tr>
            <td>TypeScript</td>
            <td>Optional</td>
            <td className="text-muted">Full type defs ship for both ESM and CJS builds</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
