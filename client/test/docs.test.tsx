import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Docs } from "../src/components/docs/Docs.js";

describe("Docs", () => {
  it("shows Getting Started by default", () => {
    render(<Docs />);
    expect(screen.getByRole("heading", { level: 1, name: "Getting Started" })).toBeTruthy();
  });

  it("switches page content when a sidebar topic is clicked, without leaving stale content behind", () => {
    render(<Docs />);

    fireEvent.click(screen.getByRole("link", { name: "API Reference" }));

    expect(screen.getByRole("heading", { level: 1, name: "API Reference" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Getting Started" })).toBeNull();
  });

  it("does not offer a Playground topic", () => {
    render(<Docs />);
    expect(screen.queryByText("Playground")).toBeNull();
  });

  it("shows the on-this-page rail for the active topic", () => {
    render(<Docs />);
    expect(screen.getByRole("link", { name: "Handling PHI" })).toBeTruthy();
  });
});
