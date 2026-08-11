import { SAMPLES } from "../samples.js";

interface Props {
  onSelect: (index: number) => void;
}

export function SampleMessages({ onSelect }: Props) {
  return (
    <select
      defaultValue=""
      onChange={(e) => {
        const index = Number(e.target.value);
        if (!Number.isNaN(index)) onSelect(index);
        e.target.value = "";
      }}
      className="rounded-lg border border-surface-700 bg-surface-900 px-3 py-1.5 text-sm text-slate-300 outline-none focus:border-accent-500"
      aria-label="Load a sample message"
    >
      <option value="" disabled>
        Load a sample…
      </option>
      {SAMPLES.map((sample, i) => (
        <option key={sample.label} value={i}>
          {sample.label}
        </option>
      ))}
    </select>
  );
}
