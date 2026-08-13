import { useMemo, useState } from "react";
import type { TranslateError } from "../api.js";
import { highlightHl7 } from "../hl7-highlight.js";
import { highlightJson } from "../json-highlight.js";
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
      className="btn"
      style={{ padding: "4px 10px", fontSize: 12 }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function OutputPane({ result, error }: Props) {
  const [tab, setTab] = useState<Tab>("translated");
  const isJson = result?.translated.trimStart().startsWith("{") ?? false;
  const highlighted = useMemo(() => {
    if (!result) return "";
    return isJson ? highlightJson(result.translated) : highlightHl7(result.translated);
  }, [result, isJson]);

  return (
    <div className="flex h-full flex-col gap-3 p-4 sm:p-6 lg:p-8">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b" style={{ borderColor: "var(--color-divider)" }}>
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
            className="border-b-2 px-3 py-2 text-sm font-medium transition-colors"
            style={
              tab === t.id
                ? { borderColor: "var(--color-accent)", color: "var(--color-text)" }
                : { borderColor: "transparent", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border" style={{ borderColor: "var(--color-divider)", background: "var(--color-surface)" }}>
        {error && (
          <div className="p-4">
            <p className="mb-1 text-sm font-semibold text-red-500">Translation failed</p>
            <p className="text-sm text-red-500/80">{error.message}</p>
            {error.context && (
              <p className="mt-2 p-2 font-mono text-xs" style={{ background: "var(--color-bg)", color: "var(--color-text)", opacity: 0.7 }}>
                {error.context}
              </p>
            )}
          </div>
        )}

        {!error && !result && (
          <div className="text-muted flex h-full items-center justify-center p-8 text-center text-sm">
            Paste a message and translate to see the output here.
          </div>
        )}

        {!error && result && tab === "translated" && (
          <div className="relative h-full">
            <div className="absolute top-3 right-3">
              <CopyButton text={result.translated} />
            </div>
            <pre
              className="h-full overflow-auto p-4 font-mono text-base leading-relaxed"
              style={{ color: "var(--color-text)" }}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>
        )}

        {!error && result && tab === "mappings" && (
          <div className="h-full overflow-y-auto p-3">
            <MappingTable mappings={result.mappings} warnings={result.warnings} />
          </div>
        )}
      </div>
    </div>
  );
}
