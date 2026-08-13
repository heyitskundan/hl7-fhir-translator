import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetectionBadge } from "../src/components/DetectionBadge.js";

const ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M",
].join("\r");

describe("DetectionBadge", () => {
  it("renders nothing for empty input", () => {
    const { container } = render(<DetectionBadge value="" direction="hl7ToFhir" onSwitchDirection={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the detected message type when direction matches", () => {
    render(<DetectionBadge value={ADT_A01} direction="hl7ToFhir" onSwitchDirection={vi.fn()} />);
    expect(screen.getByText(/Detected: ADT\^A01/)).toBeTruthy();
    expect(screen.queryByText(/Switch direction/)).toBeNull();
  });

  it("offers to switch direction on a mismatch, and calls back with the detected direction", () => {
    const onSwitchDirection = vi.fn();
    render(<DetectionBadge value={ADT_A01} direction="fhirToHl7" onSwitchDirection={onSwitchDirection} />);

    const button = screen.getByText(/Switch direction to match/);
    fireEvent.click(button);

    expect(onSwitchDirection).toHaveBeenCalledWith("hl7ToFhir");
  });

  it("reports unrecognized input without a switch button", () => {
    render(<DetectionBadge value="not a real message" direction="hl7ToFhir" onSwitchDirection={vi.fn()} />);
    expect(screen.getByText("Format not recognized yet")).toBeTruthy();
    expect(screen.queryByText(/Switch direction/)).toBeNull();
  });
});
