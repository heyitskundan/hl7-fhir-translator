import { Hl7ParseError, type Hl7Delimiters, type Hl7Field, type Hl7Message, type Hl7Segment } from "./types.js";

function rawField(value: string): Hl7Field {
  return { raw: value, reps: [[value]] };
}

function parseField(raw: string, delimiters: Hl7Delimiters): Hl7Field {
  const reps = (raw.length === 0 ? [""] : raw.split(delimiters.repetition)).map((rep) => rep.split(delimiters.component));
  return { raw, reps };
}

function parseMshSegment(line: string, delimiters: Hl7Delimiters): Hl7Segment {
  const encodingEnd = line.indexOf(delimiters.field, 4);
  const encodingChars = line.substring(4, encodingEnd);
  const rest = line.substring(encodingEnd + 1).split(delimiters.field);

  const fields: Hl7Field[] = [rawField("MSH"), rawField(delimiters.field), rawField(encodingChars)];
  for (const token of rest) {
    fields.push(parseField(token, delimiters));
  }
  return { id: "MSH", fields };
}

function parseSegment(line: string, delimiters: Hl7Delimiters): Hl7Segment {
  if (line.startsWith("MSH")) {
    return parseMshSegment(line, delimiters);
  }
  const tokens = line.split(delimiters.field);
  const id = tokens[0] ?? "";
  const fields = tokens.map((token, i) => (i === 0 ? rawField(id) : parseField(token, delimiters)));
  return { id, fields };
}

/**
 * Parses a raw HL7v2 message (segments delimited by CR, LF, or CRLF) into a
 * structured, message-type-agnostic representation. Delimiters are derived
 * from MSH-1/MSH-2 rather than assumed, per the HL7v2 spec.
 */
export function parseHl7Message(text: string): Hl7Message {
  const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  const lines = normalized
    .split("\r")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Hl7ParseError("Empty HL7 message");
  }

  const first = lines[0]!;
  if (!first.startsWith("MSH")) {
    throw new Hl7ParseError("Message must start with an MSH segment", first);
  }
  if (first.length < 8) {
    throw new Hl7ParseError("MSH segment is too short to contain field and encoding delimiters", first);
  }

  const fieldSep = first[3]!;
  const encodingEnd = first.indexOf(fieldSep, 4);
  if (encodingEnd === -1) {
    throw new Hl7ParseError("MSH segment is missing the MSH-2 encoding characters field", first);
  }
  const encodingChars = first.substring(4, encodingEnd);
  if (encodingChars.length < 4) {
    throw new Hl7ParseError(`MSH-2 encoding characters field is malformed: "${encodingChars}"`, first);
  }

  const delimiters: Hl7Delimiters = {
    field: fieldSep,
    component: encodingChars[0]!,
    repetition: encodingChars[1]!,
    escape: encodingChars[2]!,
    subcomponent: encodingChars[3]!,
  };

  const segments = lines.map((line) => parseSegment(line, delimiters));
  const msh = segments[0]!;
  const messageType = msh.fields[9]?.raw ?? "";
  if (!messageType) {
    throw new Hl7ParseError("MSH-9 (message type) is required", first);
  }

  return { segments, delimiters, messageType };
}

/** Returns the first segment with the given 3-letter id (e.g. `"PID"`), or `undefined` if the message has none. */
export function findSegment(message: Hl7Message, id: string): Hl7Segment | undefined {
  return message.segments.find((s) => s.id === id);
}

/** Returns every segment with the given 3-letter id, in message order (e.g. every `OBX` in an ORU message). */
export function findSegments(message: Hl7Message, id: string): Hl7Segment[] {
  return message.segments.filter((s) => s.id === id);
}

/**
 * Returns the raw value of a 1-indexed HL7 field (e.g. `getField(pid, 7)` for `PID-7`).
 * `undefined` when the segment is missing or the field is empty/absent — never `""`.
 */
export function getField(segment: Hl7Segment | undefined, fieldNumber: number): string | undefined {
  const value = segment?.fields[fieldNumber]?.raw;
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Returns the value of one `^`-delimited component within a field (e.g.
 * `getComponent(pid, 5, 1)` for the family-name component of `PID-5`). `componentNumber`
 * is 1-indexed to match the HL7v2 spec's own numbering (`PID-5.1`). `repetitionIndex`
 * selects which `~`-delimited repetition to read from, defaulting to the first (`0`).
 */
export function getComponent(
  segment: Hl7Segment | undefined,
  fieldNumber: number,
  componentNumber: number,
  repetitionIndex = 0,
): string | undefined {
  const value = segment?.fields[fieldNumber]?.reps[repetitionIndex]?.[componentNumber - 1];
  return value === undefined || value === "" ? undefined : value;
}

/** Returns every `~`-delimited repetition of a repeating field, each as its own array of `^`-delimited components. */
export function getRepetitions(segment: Hl7Segment | undefined, fieldNumber: number): string[][] {
  return segment?.fields[fieldNumber]?.reps ?? [];
}

/**
 * Returns the raw `Hl7Field` at a 1-indexed field number, or `undefined` if the segment is
 * missing or the field is empty. Unlike `getField`/`getComponent`, this hands back the
 * field's full component/repetition structure rather than a single string — for passing
 * into a datatype converter (`./mapping/datatypes.js`) that needs to read more than one
 * component, without that converter needing to know which segment/field number it came from.
 */
export function getRawField(segment: Hl7Segment | undefined, fieldNumber: number): Hl7Field | undefined {
  const value = segment?.fields[fieldNumber];
  return value === undefined || value.raw === "" ? undefined : value;
}
