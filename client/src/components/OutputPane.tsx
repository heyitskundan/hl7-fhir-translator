import { useState } from "react";
import type { TranslateError } from "../api.js";
import type { TranslateResult } from "../types.js";
import { MappingTable } from "./MappingTable.js";

type Tab = "translated" | "mappings";

interface Props {
  result: TranslateResult | undefined;
  error: TranslateError | undefined;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md border border-surface-700 px-2.5 py-1 text-xs text-slate-400 transition-colors hover:border-accent-500 hover:text-accent-400"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function OutputPane({ result, error }: Props) {
  const [tab, setTab] = useState<Tab>("translated");

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-1 border-b border-surface-800">
        {(
          [
            { id: "translated", label: "Translated" },
            { id: "mappings", label: `Field Mappings${result ? ` (${result.mappings.length})` : ""}` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "border-accent-500 text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[320px] flex-1 rounded-lg border border-surface-700 bg-surface-900">
        {error && (
          <div className="p-4">
            <p className="mb-1 text-sm font-semibold text-red-400">Translation failed</p>
            <p className="text-sm text-red-300/80">{error.message}</p>
            {error.context && <p className="mt-2 rounded bg-surface-950/60 p-2 font-mono text-xs text-slate-500">{error.context}</p>}
          </div>
        )}

        {!error && !result && (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-600">
            Paste a message and press Translate to see the deterministic FHIR/HL7v2 output here — computed locally in your browser.
          </div>
        )}

        {!error && result && tab === "translated" && (
          <div className="relative h-full">
            <div className="absolute right-3 top-3">
              <CopyButton text={result.translated} />
            </div>
            <pre className="max-h-[520px] overflow-auto p-4 font-mono text-sm leading-relaxed text-slate-200">{result.translated}</pre>
          </div>
        )}

        {!error && result && tab === "mappings" && (
          <div className="h-full p-3">
            <MappingTable mappings={result.mappings} warnings={result.warnings} />
          </div>
        )}
      </div>
    </div>
  );
}
