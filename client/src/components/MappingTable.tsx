import type { Mapping } from "../types.js";

interface Props {
  mappings: Mapping[];
  warnings: string[];
}

export function MappingTable({ mappings, warnings }: Props) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="overflow-x-auto border" style={{ borderColor: "var(--color-divider)" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Target</th>
              <th>Value</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 && (
              <tr>
                <td colSpan={4} className="text-muted py-6 text-center">
                  No field mappings for this translation.
                </td>
              </tr>
            )}
            {mappings.map((m, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap font-mono" style={{ color: "var(--color-accent)" }}>
                  {m.source}
                </td>
                <td className="whitespace-nowrap font-mono">{m.target}</td>
                <td className="max-w-xs truncate" title={m.value}>
                  {m.value}
                </td>
                <td className="text-muted">{m.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {warnings.length > 0 && (
        <div className="border p-3" style={{ borderColor: "color-mix(in srgb, #b45309 40%, var(--color-divider))", background: "color-mix(in srgb, #b45309 8%, transparent)" }}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500">
            {warnings.length} field{warnings.length === 1 ? "" : "s"} skipped
          </p>
          <ul className="space-y-1 text-sm text-amber-600">
            {warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
