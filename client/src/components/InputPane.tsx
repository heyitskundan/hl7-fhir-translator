import { useMemo, useRef } from "react";
import { highlightHl7 } from "../hl7-highlight.js";
import { highlightJson } from "../json-highlight.js";
import type { Direction } from "../types.js";
import { DetectionBadge } from "./DetectionBadge.js";

interface Props {
  value: string;
  onChange: (value: string) => void;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  onTranslate: () => void;
}

export function InputPane({ value, onChange, direction, onDirectionChange, onTranslate }: Props) {
  const highlightRef = useRef<HTMLPreElement>(null);
  // A native <textarea> can't color individual characters, so the visible text renders in a
  // highlighted <pre> underneath; the textarea sits on top with transparent text (but a real,
  // visible caret) so typing/selection/scrolling stay fully native — the classic
  // highlighted-textarea overlay technique.
  const highlighted = useMemo(() => (direction === "hl7ToFhir" ? highlightHl7(value) : highlightJson(value)), [value, direction]);

  return (
    <div className="flex h-full flex-col gap-3 p-4 sm:p-6 lg:p-8">
      {/* Matches OutputPane's tab-bar row exactly (h-10, border-b) so both content boxes below start at the same y, not just end up the same height. */}
      <div className="flex h-10 shrink-0 items-center border-b border-surface-800">
        <DetectionBadge value={value} direction={direction} onSwitchDirection={onDirectionChange} />
      </div>

      <div className="relative min-h-0 flex-1">
        <pre
          ref={highlightRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-auto rounded-lg border border-transparent bg-[#282a36] p-4 font-mono text-base leading-relaxed whitespace-pre-wrap break-words text-[#f8f8f2]"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            const pre = highlightRef.current;
            if (pre) {
              pre.scrollTop = e.currentTarget.scrollTop;
              pre.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onTranslate();
            }
          }}
          spellCheck={false}
          placeholder={direction === "hl7ToFhir" ? "Paste a raw HL7v2 message…" : "Paste a FHIR R4 resource or Bundle (JSON)…"}
          className="absolute inset-0 resize-none rounded-lg border border-surface-700 bg-transparent p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-transparent caret-slate-200 outline-none placeholder:text-slate-600 focus:border-accent-500"
        />
      </div>
    </div>
  );
}
