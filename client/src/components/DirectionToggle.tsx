import type { Direction } from "../types.js";

interface Props {
  direction: Direction;
  onChange: (direction: Direction) => void;
}

export function DirectionToggle({ direction, onChange }: Props) {
  return (
    <div className="seg" role="radiogroup" aria-label="Translation direction">
      {(
        [
          { value: "hl7ToFhir", label: "HL7v2 → FHIR" },
          { value: "fhirToHl7", label: "FHIR → HL7v2" },
        ] as const
      ).map((opt) => (
        <label key={opt.value} className="seg-opt">
          <input type="radio" name="direction" checked={direction === opt.value} onChange={() => onChange(opt.value)} />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
