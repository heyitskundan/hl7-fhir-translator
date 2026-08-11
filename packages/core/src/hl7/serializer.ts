import type { Hl7Delimiters, Hl7Field, Hl7Message, Hl7Segment } from "./types.js";

function serializeField(field: Hl7Field, delimiters: Hl7Delimiters): string {
  return field.reps.map((rep) => rep.join(delimiters.component)).join(delimiters.repetition);
}

function serializeSegment(segment: Hl7Segment, delimiters: Hl7Delimiters): string {
  if (segment.id === "MSH") {
    const encodingChars = segment.fields[2]?.raw ?? "";
    const rest = segment.fields.slice(3).map((f) => serializeField(f, delimiters));
    return ["MSH", encodingChars, ...rest].join(delimiters.field);
  }
  const rest = segment.fields.slice(1).map((f) => serializeField(f, delimiters));
  return [segment.id, ...rest].join(delimiters.field);
}

/** Serializes a structured HL7v2 message back to its pipe-delimited wire format (CR-separated segments). */
export function serializeHl7Message(message: Hl7Message): string {
  return message.segments.map((segment) => serializeSegment(segment, message.delimiters)).join("\r");
}

/** Builds a field from plain string components (single repetition). Empty trailing components are trimmed. */
export function field(...components: (string | undefined)[]): Hl7Field {
  const values = components.map((c) => c ?? "");
  while (values.length > 1 && values[values.length - 1] === "") {
    values.pop();
  }
  return { raw: values.join("^"), reps: [values] };
}

/** A blank field, used by `segment` to fill any index between 1 and the highest field passed in that wasn't explicitly given a value. */
export function emptyField(): Hl7Field {
  return { raw: "", reps: [[""]] };
}

/** Builds a segment from 1-indexed field values (index 0 is auto-filled with the segment id). */
export function segment(id: string, fields: Record<number, Hl7Field>): Hl7Segment {
  const maxIndex = Math.max(0, ...Object.keys(fields).map(Number));
  const arr: Hl7Field[] = [{ raw: id, reps: [[id]] }];
  for (let i = 1; i <= maxIndex; i++) {
    arr[i] = fields[i] ?? emptyField();
  }
  return { id, fields: arr };
}
