import { useState } from "react";
import { highlightBash } from "../../bash-highlight.js";
import { highlightHl7 } from "../../hl7-highlight.js";
import { highlightJs } from "../../js-highlight.js";
import { highlightJson } from "../../json-highlight.js";

type Lang = "js" | "ts" | "bash" | "json" | "hl7" | "text";

const HIGHLIGHT: Record<Lang, ((code: string) => string) | undefined> = {
  js: highlightJs,
  ts: highlightJs,
  bash: highlightBash,
  json: highlightJson,
  hl7: highlightHl7,
  text: undefined,
};

const LANG_LABEL: Partial<Record<Lang, string>> = { js: "JS", ts: "TS", bash: "Shell", json: "JSON", hl7: "HL7v2" };

/** A hairline "blueprint" panel with corner registration marks — the one decorative motif this design system carries, used for every code sample and worked example in the docs. */
export function CodeBlock({ code, lang = "text" }: { code: string; lang?: Lang }) {
  const [copied, setCopied] = useState(false);
  const highlighter = HIGHLIGHT[lang];
  const html = highlighter ? highlighter(code) : code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return (
    <div className="blueprint my-4 p-4" style={{ background: "var(--color-surface)" }}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className="mb-2 flex items-center justify-between">
        <span className="tag tag-neutral">{LANG_LABEL[lang] ?? ""}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="text-muted flex items-center gap-1 border px-2 py-1 text-[11px] leading-none"
          style={{ borderColor: "var(--color-divider)" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto pb-3 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
