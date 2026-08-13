import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../src/theme.js";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to system preference when nothing is stored", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("dark");
  });

  it("prefers a stored theme over system preference", () => {
    localStorage.setItem("hl7-theme", "light");
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("light");
  });

  it("reflects the resolved theme onto <html data-theme>", () => {
    localStorage.setItem("hl7-theme", "dark");
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggle flips the theme and persists the choice", () => {
    localStorage.setItem("hl7-theme", "light");
    const { result } = renderHook(() => useTheme());

    act(() => result.current[1]());

    expect(result.current[0]).toBe("dark");
    expect(localStorage.getItem("hl7-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
