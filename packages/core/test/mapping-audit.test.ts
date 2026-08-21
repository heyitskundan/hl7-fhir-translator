import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { translateHl7ToFhir } from "../src/translate.js";

/**
 * Cross-checks docs/MAPPING.md against the actual mapper implementations: for every
 * message type's "Forward: HL7v2 -> FHIR" table(s), every documented source field must
 * actually appear in the `mappings[]` trail produced by translating that message type's
 * sample. This is what catches the spec (docs/MAPPING.md) drifting from the code (or vice
 * versa) — the failure mode that plain unit tests, which assert specific values but don't
 * check the table is exhaustive, don't catch.
 */

const DOC = readFileSync("../../docs/MAPPING.md", "utf8");

interface MessageTypeAudit {
  heading: string; // exact "## ..." heading text as it appears in the doc — no leading section number, so this stays stable regardless of where the section sits in the file
  sampleFile: string;
}

const AUDITS: MessageTypeAudit[] = [
  {
    heading:
      "## ADT^A01, A02, A05, A06, A08, A09, A11 (admission, transfer, pre-admit, class change, update, departure tracking, cancel admit)",
    sampleFile: "adt_a01.hl7",
  },
  { heading: "## ADT^A17 (swap patients)", sampleFile: "adt_a17.hl7" },
  { heading: "## ORU^R01 (unsolicited lab result)", sampleFile: "oru_r01.hl7" },
  { heading: "## ORM^O01 (general order)", sampleFile: "orm_o01.hl7" },
  { heading: "## VXU^V04 (immunization record update)", sampleFile: "vxu_v04.hl7" },
  { heading: "## SIU^S12 (appointment scheduling)", sampleFile: "siu_s12.hl7" },
  { heading: "## OML^O21 (laboratory order)", sampleFile: "oml_o21.hl7" },
  { heading: "## MDM^T02 (document management)", sampleFile: "mdm_t02.hl7" },
  { heading: "## ADT^A40 (merge patient)", sampleFile: "adt_a40.hl7" },
  { heading: "## RDE^O11 (pharmacy/treatment encoded order)", sampleFile: "rde_o11.hl7" },
  {
    heading: "## Message metadata (SFT, MSA) and IAM (patient adverse reaction information)",
    sampleFile: "adt_a01_metadata.hl7",
  },
];

/** Extracts the text between a `## ...` heading and the next `## ` heading (or end of doc). */
function sectionText(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  if (start === -1) throw new Error(`Heading not found in docs/MAPPING.md: "${heading}"`);
  const rest = doc.slice(start + heading.length);
  const nextHeadingOffset = rest.search(/\n## /);
  return nextHeadingOffset === -1 ? rest : rest.slice(0, nextHeadingOffset);
}

/** Extracts the "Forward: HL7v2 -> FHIR" subsection (one or more markdown tables) from a section's text. */
function forwardSubsection(section: string): string {
  const start = section.search(/### Forward: HL7v2/);
  if (start === -1) throw new Error("No 'Forward: HL7v2' subsection found");
  const rest = section.slice(start);
  const nextHeadingOffset = rest.slice(1).search(/\n###|\n---/);
  return nextHeadingOffset === -1 ? rest : rest.slice(0, nextHeadingOffset + 1);
}

/**
 * Pulls every distinct base HL7v2 field (e.g. `PID-3` from `PID-3.1`, or both `PID-5.2`
 * and `PID-5.3` collapsed to `PID-5`) referenced in a markdown table's first column, for
 * every row whose FHIR path column isn't a routing-only placeholder.
 */
function extractDocumentedFields(tableMarkdown: string): Set<string> {
  const fields = new Set<string>();
  for (const line of tableMarkdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] is "" (before the leading pipe); cells[1] is the HL7v2 field column.
    const firstCell = cells[1] ?? "";
    const fhirPathCell = cells[2] ?? "";
    if (fhirPathCell.includes("routing only")) continue;
    const tokens = [...firstCell.matchAll(/`([A-Z]+-\d+)(?:\.\d+)?`/g)].map((m) => m[1]!);
    for (const t of tokens) fields.add(t);
  }
  return fields;
}

describe("docs/MAPPING.md forward tables match the mapper implementations", () => {
  for (const { heading, sampleFile } of AUDITS) {
    it(`every documented forward field for ${heading.replace(/^## /, "")} appears in the actual mapping trail`, () => {
      const documentedFields = extractDocumentedFields(forwardSubsection(sectionText(DOC, heading)));
      expect(documentedFields.size).toBeGreaterThan(0);

      const hl7 = readFileSync(`../../samples/${sampleFile}`, "utf8");
      const result = translateHl7ToFhir(hl7);
      const actualSources = result.mappings.map((m) => m.source);

      const undocumentedInCode = [...documentedFields].filter(
        (field) => !actualSources.some((source) => source === field || source.startsWith(`${field} `) || source.startsWith(`${field}(`)),
      );
      expect(
        undocumentedInCode,
        `Fields documented in docs/MAPPING.md but never produced by the mapper: ${undocumentedInCode.join(", ")}`,
      ).toEqual([]);
    });
  }
});
