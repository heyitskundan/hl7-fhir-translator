import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataMapping } from "../src/components/docs/DataMapping.js";

describe("DataMapping", () => {
  it("renders the summary table, every message-type section, and the terminology table", () => {
    render(<DataMapping />);

    expect(screen.getByRole("heading", { level: 2, name: "Supported message types" })).toBeTruthy();
    for (const heading of [
      "ADT^A01 / ADT^A08 → Patient + Encounter",
      "ORU^R01 → DiagnosticReport + Observation[]",
      "ORM^O01 → ServiceRequest",
      "VXU^V04 → Immunization",
      "SIU^S12 → Appointment",
      "OML^O21 → ServiceRequest + Specimen",
      "MDM^T02 → DocumentReference",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { level: 2, name: "Terminology systems" })).toBeTruthy();

    // Representative field-row tokens, one per section, confirm the data-driven table
    // render (not just the headings) actually produced rows.
    expect(screen.getByText("PID-3.1")).toBeTruthy();
    expect(screen.getByText("OBX-8")).toBeTruthy();
    expect(screen.getByText("RXA-20")).toBeTruthy();
    expect(screen.getByText("SPM-17")).toBeTruthy();
    expect(screen.getByText("TXA-12")).toBeTruthy();
  });
});
