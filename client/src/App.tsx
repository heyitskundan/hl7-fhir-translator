import { useEffect, useState } from "react";
import { Docs } from "./components/Docs.js";
import { Translator } from "./components/Translator.js";

type View = "translator" | "docs";

// Hash-based rather than a real path: this app is served as static files from GitHub
// Pages, which has no server-side rewrite to send a direct load of /doc back to
// index.html — a hash never reaches the server at all, so every load and reload
// resolves the same static file regardless of which view the URL points at.
function viewFromHash(): View {
  return window.location.hash === "#/doc" ? "docs" : "translator";
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const hash = view === "docs" ? "#/doc" : "#/";
    if (window.location.hash !== hash) window.location.hash = hash;
  }, [view]);

  return (
    <div className="min-h-screen">
      <header className="h-16 border-b border-surface-800">
        <div className="flex h-full items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 font-mono text-sm font-bold text-white">
              ⇄
            </div>
            <h1 className="text-lg font-semibold text-slate-100">HL7v2 ⇄ FHIR Translator</h1>
          </div>

          <nav className="flex items-center gap-1 rounded-lg border border-surface-700 bg-surface-900 p-1" aria-label="Section">
            {(
              [
                { id: "translator", label: "Translator" },
                { id: "docs", label: "Docs" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === tab.id ? "bg-accent-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {view === "translator" ? <Translator /> : <Docs />}
    </div>
  );
}
