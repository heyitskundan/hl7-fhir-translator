import { useMemo } from "react";
import { inspectInput } from "hl7-fhir-translator";
import type { Direction } from "../types.js";

interface Props {
  value: string;
  direction: Direction;
  onSwitchDirection: (direction: Direction) => void;
}

/**
 * Live preview of what inspectInput() detects — not just the direction, but the specific
 * HL7v2 message type or FHIR resource kind — recomputed on every keystroke since
 * detection is pure/synchronous and never throws.
 */
export function DetectionBadge({ value, direction, onSwitchDirection }: Props) {
  const detection = useMemo(() => (value.trim() === "" ? undefined : inspectInput(value)), [value]);

  if (!detection) return null;

  const { direction: detected, detail } = detection;
  const mismatch = detected !== "unknown" && detected !== direction;

  let label: string;
  let tagClass: string;

  if (detail.kind === "unknown") {
    label = detected === "unknown" ? "Format not recognized yet" : `Doesn't parse — ${detail.reason}`;
    tagClass = "tag-neutral";
  } else if (detail.kind === "hl7") {
    label = detail.supported
      ? `Detected: ${detail.messageType} — ${detail.description}`
      : `Detected: ${detail.messageType} — not supported by this package`;
    tagClass = detail.supported ? "tag-accent" : "tag-outline";
  } else {
    label = detail.supported
      ? `Detected: ${detail.resourceTypes.join(", ")} → ${detail.targetMessageType}`
      : `Detected: ${detail.resourceTypes.join(", ")} — no supported target message type`;
    tagClass = detail.supported ? "tag-accent" : "tag-outline";
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`tag ${tagClass}`}>{label}</span>
      {mismatch && (
        <button type="button" onClick={() => onSwitchDirection(detected as Direction)} className="btn" style={{ padding: "2px 8px", fontSize: 12 }}>
          Switch direction to match →
        </button>
      )}
    </div>
  );
}
