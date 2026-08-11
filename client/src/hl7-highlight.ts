const SEGMENT_ID = /^([A-Z][A-Z0-9]{2})/;

/**
 * Syntax-highlights an HL7v2 message for display: the segment id starting each line
 * (e.g. `PID`, `OBX`) and the field/component/repetition delimiters (`|`, `^`, `~`) each
 * get their own color, so a line's structure reads at a glance the way JSON's does.
 * HTML-escapes first, same safety rule as the JSON highlighter — field values can contain
 * arbitrary translated text (e.g. a patient name).
 */
export function highlightHl7(hl7: string): string {
  return hl7
    .split(/\r\n?/)
    .map((line) => {
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const segmentId = SEGMENT_ID.exec(escaped)?.[1];
      const head = segmentId ? `<span class="hl7-segment">${segmentId}</span>` : "";
      const rest = segmentId ? escaped.slice(segmentId.length) : escaped;
      return head + rest.replace(/[|^~]/g, (delim) => `<span class="hl7-delim">${delim}</span>`);
    })
    .join("\n");
}
