import { useEffect, useState } from "react";
import { Docs } from "./components/docs/Docs.js";
import { Translator } from "./components/Translator.js";
import { useTheme } from "./theme.js";

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
  const [theme, toggleTheme] = useTheme();

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
      <nav className="nav sticky top-0 z-10 flex-wrap" style={{ background: "var(--color-bg)", borderBottom: "1px solid var(--color-divider)" }}>
        <span className="nav-brand">hl7-fhir-translator</span>
        <span className="tag tag-neutral">v1.0.0</span>

        <div className="seg" role="radiogroup" aria-label="Section">
          <label className="seg-opt">
            <input type="radio" name="view" checked={view === "translator"} onChange={() => setView("translator")} />
            Translator
          </label>
          <label className="seg-opt">
            <input type="radio" name="view" checked={view === "docs"} onChange={() => setView("docs")} />
            Docs
          </label>
        </div>

        <a href="https://github.com/heyitskundan/hl7-fhir-translator" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
            <path d="M9 18c-4.51 2-5-2-7-2" />
          </svg>
          GitHub
        </a>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle dark mode"
          className="flex h-8 w-8 items-center justify-center border"
          style={{ borderColor: "var(--color-divider)", color: "var(--color-text)" }}
        >
          {theme === "dark" ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          )}
        </button>
      </nav>

      {view === "translator" ? <Translator /> : <Docs />}
    </div>
  );
}
