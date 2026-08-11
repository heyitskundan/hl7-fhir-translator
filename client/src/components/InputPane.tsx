import type { Direction } from "../types.js";
import { DetectionBadge } from "./DetectionBadge.js";
import { DirectionToggle } from "./DirectionToggle.js";
import { SampleMessages } from "./SampleMessages.js";

interface Props {
  value: string;
  onChange: (value: string) => void;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  onSampleSelect: (index: number) => void;
  onTranslate: () => void;
}

export function InputPane({ value, onChange, direction, onDirectionChange, onSampleSelect, onTranslate }: Props) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DirectionToggle direction={direction} onChange={onDirectionChange} />
        <SampleMessages onSelect={onSampleSelect} />
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onTranslate();
          }
        }}
        spellCheck={false}
        placeholder={direction === "hl7ToFhir" ? "Paste a raw HL7v2 message…" : "Paste a FHIR R4 resource or Bundle (JSON)…"}
        className="min-h-[320px] flex-1 resize-none rounded-lg border border-surface-700 bg-surface-900 p-4 font-mono text-sm leading-relaxed text-slate-200 outline-none placeholder:text-slate-600 focus:border-accent-500"
      />

      <DetectionBadge value={value} direction={direction} onSwitchDirection={onDirectionChange} />

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Nothing typed here ever leaves your browser — but paste synthetic or de-identified messages only.
        </p>
        <button
          type="button"
          onClick={onTranslate}
          disabled={value.trim() === ""}
          className="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-surface-950 transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Translate
          <kbd className="rounded border border-surface-950/30 bg-surface-950/20 px-1.5 py-0.5 text-[10px] font-normal opacity-70">⌘⏎</kbd>
        </button>
      </div>
    </div>
  );
}
