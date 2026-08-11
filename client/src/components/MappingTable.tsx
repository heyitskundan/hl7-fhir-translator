import type { Mapping } from "../types.js";

interface Props {
  mappings: Mapping[];
  warnings: string[];
}

export function MappingTable({ mappings, warnings }: Props) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="overflow-x-auto rounded-lg border border-surface-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-900 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-800">
            {mappings.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No field mappings for this translation.
                </td>
              </tr>
            )}
            {mappings.map((m, i) => (
              <tr key={i} className="hover:bg-surface-900/60">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-accent-400">{m.source}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-300">{m.target}</td>
                <td className="max-w-xs truncate px-3 py-2 text-slate-300" title={m.value}>
                  {m.value}
                </td>
                <td className="px-3 py-2 text-slate-500">{m.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-400">
            {warnings.length} field{warnings.length === 1 ? "" : "s"} skipped
          </p>
          <ul className="space-y-1 text-sm text-amber-200/90">
            {warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
