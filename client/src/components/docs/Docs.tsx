import { useCallback, useState } from "react";
import { ApiReference } from "./ApiReference.js";
import { Changelog } from "./Changelog.js";
import { DataMapping } from "./DataMapping.js";
import { GettingStarted } from "./GettingStarted.js";
import { apiReferenceRail, changelogRail, dataMappingRail, gettingStartedRail, type RailItem } from "./rails.js";

type PageId = "getting-started" | "api-reference" | "data-mapping" | "changelog";

const NAV: { group: string; items: { id: PageId; label: string }[] }[] = [
  {
    group: "Docs",
    items: [
      { id: "getting-started", label: "Getting Started" },
      { id: "api-reference", label: "API Reference" },
      { id: "data-mapping", label: "Data Mapping & Schemas" },
    ],
  },
  { group: "Project", items: [{ id: "changelog", label: "Changelog" }] },
];

const RAILS: Record<PageId, RailItem[]> = {
  "getting-started": gettingStartedRail,
  "api-reference": apiReferenceRail,
  "data-mapping": dataMappingRail,
  changelog: changelogRail,
};

/**
 * The whole docs experience, hand-authored per page (see GettingStarted / ApiReference /
 * DataMapping / Changelog) rather than parsed from markdown at runtime — a curated sidebar
 * switches between them, with a per-page "on this page" anchor rail on the right. Anchor
 * clicks scroll within the page rather than setting window.location.hash, since App.tsx's
 * own hash-based view router would otherwise mistake an in-page jump for a navigation away
 * from the Docs view. The live translator itself lives in the Translator tab, not here.
 */
export function Docs() {
  const [page, setPage] = useState<PageId>("getting-started");

  const goTo = useCallback((id: PageId) => {
    setPage(id);
    window.scrollTo(0, 0);
  }, []);

  const scrollToSection = useCallback((href: string) => {
    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const rail = RAILS[page];

  return (
    <div
      className="mx-auto grid gap-6 px-4 py-8 sm:px-6 lg:px-8"
      style={{ maxWidth: 1280, gridTemplateColumns: "minmax(160px,220px) minmax(0,1fr) minmax(140px,200px)" }}
    >
      <aside className="sticky flex flex-col gap-6 self-start" style={{ top: "5rem" }}>
        {NAV.map((section) => (
          <div key={section.group}>
            <div className="text-muted mb-2 text-[11px] tracking-wide uppercase">{section.group}</div>
            <div className="flex flex-col gap-2.5 text-[17px]">
              {section.items.map((item) => (
                <a
                  key={item.id}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    goTo(item.id);
                  }}
                  aria-current={page === item.id ? "page" : undefined}
                  style={page === item.id ? { color: "var(--color-accent)", fontWeight: 600 } : undefined}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <main className="docs-content min-w-0">
        {page === "getting-started" && <GettingStarted goDataMapping={() => goTo("data-mapping")} />}
        {page === "api-reference" && <ApiReference />}
        {page === "data-mapping" && <DataMapping />}
        {page === "changelog" && <Changelog />}
      </main>

      {rail.length > 0 && (
        <aside className="sticky self-start" style={{ top: "5rem" }}>
          <div className="text-muted mb-2 text-[11px] tracking-wide uppercase">On this page</div>
          <div className="flex flex-col gap-1 text-sm">
            {rail.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(item.href);
                }}
                style={item.indent ? { paddingLeft: "var(--space-3)", fontSize: 12 } : undefined}
              >
                {item.label}
              </a>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
