import { describe, expect, it } from "vitest";
import { findSegment, getComponent, getField, parseHl7Message } from "../src/hl7/parser.js";
import { serializeHl7Message } from "../src/hl7/serializer.js";
import { Hl7ParseError } from "../src/hl7/types.js";

const ADT_A01 = [
  "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||MRN12345^^^HOSP^MR||Doe^John^A||19800515|M|||123 Main St^^Springfield^IL^62701^USA",
  "PV1|1|I|ICU^101^A^^^HOSP||||1234^Smith^Jane^M^MD",
].join("\r");

describe("parseHl7Message", () => {
  it("derives delimiters from MSH-1/MSH-2 rather than assuming them", () => {
    const message = parseHl7Message(ADT_A01);
    expect(message.delimiters).toEqual({ field: "|", component: "^", repetition: "~", escape: "\\", subcomponent: "&" });
  });

  it("extracts MSH-9 as the message type", () => {
    const message = parseHl7Message(ADT_A01);
    expect(message.messageType).toBe("ADT^A01");
  });

  it("indexes fields 1-based per HL7 field numbering", () => {
    const message = parseHl7Message(ADT_A01);
    const pid = findSegment(message, "PID");
    expect(getField(pid, 7)).toBe("19800515");
    expect(getField(pid, 8)).toBe("M");
    expect(getComponent(pid, 3, 1)).toBe("MRN12345");
    expect(getComponent(pid, 3, 5)).toBe("MR");
    expect(getComponent(pid, 5, 1)).toBe("Doe");
    expect(getComponent(pid, 5, 2)).toBe("John");
  });

  it("accepts LF and CRLF segment separators identically to CR", () => {
    const crlf = ADT_A01.replace(/\r/g, "\r\n");
    const lf = ADT_A01.replace(/\r/g, "\n");
    expect(parseHl7Message(crlf).segments.length).toBe(parseHl7Message(ADT_A01).segments.length);
    expect(parseHl7Message(lf).segments.length).toBe(parseHl7Message(ADT_A01).segments.length);
  });

  it("round-trips parse -> serialize back to the original wire format", () => {
    const message = parseHl7Message(ADT_A01);
    expect(serializeHl7Message(message)).toBe(ADT_A01);
  });

  it("throws a typed error, not a crash, for a non-MSH first segment", () => {
    expect(() => parseHl7Message("PID|1||123")).toThrow(Hl7ParseError);
  });

  it("throws a typed error for an empty message", () => {
    expect(() => parseHl7Message("")).toThrow(Hl7ParseError);
  });

  it("throws a typed error for a truncated MSH segment", () => {
    expect(() => parseHl7Message("MSH")).toThrow(Hl7ParseError);
  });

  it("throws a typed error when MSH-9 (message type) is missing", () => {
    expect(() => parseHl7Message("MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||")).toThrow(Hl7ParseError);
  });

  it("supports repeating fields via the repetition separator", () => {
    const withRepeat = "MSH|^~\\&|HIS|HOSP|ADT|HOSP|20240101120000||ADT^A01|MSG001|P|2.5\rPID|1||A~B~C";
    const message = parseHl7Message(withRepeat);
    const pid = findSegment(message, "PID");
    expect(pid?.fields[3]?.reps).toEqual([["A"], ["B"], ["C"]]);
  });
});
