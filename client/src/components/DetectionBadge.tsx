import { useMemo } from "react";
import { inspectInput } from "hl7-fhir-translate";
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
  let tone: "ok" | "warn" | "muted";

  if (detail.kind === "unknown") {
    label = detected === "unknown" ? "Format not recognized yet" : `Doesn't parse — ${detail.reason}`;
    tone = "muted";
  } else if (detail.kind === "hl7") {
    label = detail.supported
      ? `Detected: ${detail.messageType} — ${detail.description}`
      : `Detected: ${detail.messageType} — not supported by this package`;
    tone = detail.supported ? "ok" : "warn";
  } else {
    label = detail.supported
      ? `Detected: ${detail.resourceTypes.join(", ")} → ${detail.targetMessageType}`
      : `Detected: ${detail.resourceTypes.join(", ")} — no supported target message type`;
    tone = detail.supported ? "ok" : "warn";
  }

  const toneClass = { ok: "text-accent-400", warn: "text-amber-400", muted: "text-slate-500" }[tone];

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={toneClass}>{label}</span>
      {mismatch && (
        <button
          type="button"
          onClick={() => onSwitchDirection(detected as Direction)}
          className="rounded border border-surface-700 px-1.5 py-0.5 text-slate-400 transition-colors hover:border-accent-500 hover:text-accent-400"
        >
          Switch direction to match →
        </button>
      )}
    </div>
  );
}
