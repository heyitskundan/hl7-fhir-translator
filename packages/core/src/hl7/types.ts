/** The five delimiter characters an HL7v2 message declares in MSH-1/MSH-2. */
export interface Hl7Delimiters {
  field: string;
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
}

/** The standard HL7v2 delimiter set (`|^~\&`), used when building a message from scratch (the FHIR-to-HL7v2 direction). */
export const DEFAULT_DELIMITERS: Hl7Delimiters = {
  field: "|",
  component: "^",
  repetition: "~",
  escape: "\\",
  subcomponent: "&",
};

/** A single field occurrence: reps[repetitionIndex][componentIndex - 1] */
export interface Hl7Field {
  raw: string;
  reps: string[][];
}

/** One HL7v2 segment (e.g. `PID`, `OBX`), with its fields indexed 1-based per the HL7v2 spec. */
export interface Hl7Segment {
  id: string;
  /** 1-indexed by HL7 field number; fields[0] holds the segment id token. */
  fields: Hl7Field[];
}

/** A fully parsed HL7v2 message, produced by `parseHl7Message`. */
export interface Hl7Message {
  segments: Hl7Segment[];
  delimiters: Hl7Delimiters;
  /** MSH-9 message type, e.g. "ADT^A01" */
  messageType: string;
}

/** Thrown when input isn't structurally valid HL7v2 — bad/missing MSH delimiters, an empty message, or unparseable segments. */
export class Hl7ParseError extends Error {
  constructor(
    message: string,
    public readonly context?: string,
  ) {
    super(message);
    this.name = "Hl7ParseError";
  }
}
