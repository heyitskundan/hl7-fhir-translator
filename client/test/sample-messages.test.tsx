import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAMPLES } from "../src/samples.js";
import { SampleMessages } from "../src/components/SampleMessages.js";

describe("SampleMessages", () => {
  it("only lists samples matching the active direction", () => {
    render(<SampleMessages direction="hl7ToFhir" onSelect={vi.fn()} />);

    const select = screen.getByLabelText("Load a sample message") as HTMLSelectElement;
    const labels = Array.from(select.options)
      .map((o) => o.textContent)
      .filter((text) => text !== "Sample…");

    const expected = SAMPLES.filter((s) => s.direction === "hl7ToFhir").map((s) => s.label);
    expect(labels).toEqual(expected);
  });

  it("switches the listed samples when direction changes", () => {
    const { rerender } = render(<SampleMessages direction="hl7ToFhir" onSelect={vi.fn()} />);
    const select = screen.getByLabelText("Load a sample message") as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThan(1);

    rerender(<SampleMessages direction="fhirToHl7" onSelect={vi.fn()} />);
    const labels = Array.from(select.options)
      .map((o) => o.textContent)
      .filter((text) => text !== "Sample…");
    expect(labels).toEqual(SAMPLES.filter((s) => s.direction === "fhirToHl7").map((s) => s.label));
  });

  it("reports the full-array index of the selected sample, not the filtered position", () => {
    const onSelect = vi.fn();
    render(<SampleMessages direction="hl7ToFhir" onSelect={onSelect} />);

    const select = screen.getByLabelText("Load a sample message") as HTMLSelectElement;
    const secondHl7Sample = SAMPLES.filter((s) => s.direction === "hl7ToFhir")[1]!;
    const fullArrayIndex = SAMPLES.indexOf(secondHl7Sample);

    fireEvent.change(select, { target: { value: String(fullArrayIndex) } });

    expect(onSelect).toHaveBeenCalledWith(fullArrayIndex);
  });
});
