import { SAMPLES } from "../samples.js";
import type { Direction } from "../types.js";

interface Props {
  direction: Direction;
  onSelect: (index: number) => void;
}

/**
 * Only lists samples for the active direction — the two directions' sample sets don't
 * overlap, so showing both just meant scrolling past ones that don't apply. Indices
 * passed to onSelect are into the full SAMPLES array, not this filtered view, since
 * that's what Translator's handleSampleSelect expects.
 */
export function SampleMessages({ direction, onSelect }: Props) {
  const options = SAMPLES.map((sample, index) => ({ sample, index })).filter(({ sample }) => sample.direction === direction);

  return (
    <div className="relative inline-flex items-center">
      <select
        defaultValue=""
        onChange={(e) => {
          const index = Number(e.target.value);
          if (!Number.isNaN(index)) onSelect(index);
          e.target.value = "";
        }}
        className="appearance-none py-1.5 pr-7 pl-3 text-sm"
        style={{
          background: "var(--color-surface)",
          color: "var(--color-text)",
          border: "1px solid var(--color-divider)",
          borderRadius: "var(--radius-md)",
        }}
        aria-label="Load a sample message"
      >
        <option value="" disabled>
          Sample…
        </option>
        {options.map(({ sample, index }) => (
          <option key={sample.label} value={index}>
            {sample.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: "var(--color-text)", opacity: 0.55 }}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
