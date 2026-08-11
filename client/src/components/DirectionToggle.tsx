import type { Direction } from "../types.js";

interface Props {
  direction: Direction;
  onChange: (direction: Direction) => void;
}

export function DirectionToggle({ direction, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-surface-700 bg-surface-900 p-1" role="tablist" aria-label="Translation direction">
      {(
        [
          { value: "hl7ToFhir", label: "HL7v2 → FHIR" },
          { value: "fhirToHl7", label: "FHIR → HL7v2" },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={direction === opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            direction === opt.value ? "bg-accent-600 text-surface-950" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
