import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { marked, Renderer, type Token, type Tokens } from "marked";
import { highlightBash } from "../bash-highlight.js";
import { highlightHl7 } from "../hl7-highlight.js";
import { highlightJson } from "../json-highlight.js";
import { highlightJs } from "../js-highlight.js";
import overviewSource from "../../../README.md?raw";
import apiSource from "../../../packages/core/README.md?raw";
import mappingSource from "../../../docs/MAPPING.md?raw";

marked.setOptions({ gfm: true });

const JS_LANGS = new Set(["js", "jsx", "ts", "tsx", "javascript", "typescript"]);
const BASH_LANGS = new Set(["bash", "sh", "shell", "zsh"]);

const REPO_URL = "https://github.com/heyitskundan/hl7-fhir-translator";
// Top-level repo entries that are directories, not files — everything else relative is
// treated as a file. Kept as a fixed list since the repo layout is small and static.
const REPO_DIRECTORIES = new Set(["packages/core", "client", "samples", ".github", "packages/core/src/mapping"]);

/**
 * These three markdown files are authored to be read on GitHub, where a relative link like
 * `./docs/MAPPING.md` resolves against the repo's own file browser. Rendered inline in this
 * SPA, that same href would just navigate the tab to a nonexistent local route. Rewriting
 * relative repo-file links to their real `github.com/.../blob|tree/main/...` URL is what
 * makes them resolve to something real in both places this content is read.
 */
function resolveRepoLink(href: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const hashIndex = href.indexOf("#");
  const fragment = hashIndex === -1 ? "" : href.slice(hashIndex);
  // Strips every leading "./" or "../" segment, not just one — a link two directories deep
  // (e.g. packages/core/README.md linking "../../docs/MAPPING.md") needs both stripped to
  // land on the right repo-root-relative path; leaving any "../" in a github.com/.../blob/main/...
  // URL lets the browser's own dot-segment normalization eat the "main" branch segment.
  const path = href.slice(0, hashIndex === -1 ? undefined : hashIndex).replace(/^(\.\.?\/)+/, "");
  const kind = REPO_DIRECTORIES.has(path) ? "tree" : "blob";
  return `${REPO_URL}/${kind}/main/${path}${fragment}`;
}

/** Wraps a rendered code block with a copy button, the raw source stashed in a data attribute since this HTML is static (see handleContentClick for the click handler that reads it back out). */
function withCopyButton(rawText: string, inner: string): string {
  const encoded = encodeURIComponent(rawText);
  return `<div class="code-block"><button type="button" class="copy-code-btn" data-code="${encoded}" aria-label="Copy code">Copy</button>${inner}</div>`;
}

/**
 * Fenced code blocks get the same token coloring as the rest of the app: ```json matches
 * the Translator's JSON output, ```ts/```js/```bash/```hl7 each get their own standard VS
 * Code colors; everything else renders normally. Every code block gets a copy button.
 * Relative links to other files in the repo are rewritten to real GitHub URLs (see
 * resolveRepoLink) and open in a new tab, since this page isn't a file browser.
 */
function createDocsRenderer(): Renderer {
  const renderer = new Renderer();
  const defaultCode = renderer.code.bind(renderer);
  renderer.code = (token: Tokens.Code) => {
    let inner: string;
    if (token.lang === "json") inner = `<pre><code class="hljson">${highlightJson(token.text)}</code></pre>`;
    else if (token.lang === "hl7") inner = `<pre><code class="hlhl7">${highlightHl7(token.text)}</code></pre>`;
    else if (token.lang && JS_LANGS.has(token.lang)) inner = `<pre><code class="hljs-js">${highlightJs(token.text)}</code></pre>`;
    else if (token.lang && BASH_LANGS.has(token.lang)) inner = `<pre><code class="hlbash">${highlightBash(token.text)}</code></pre>`;
    else inner = defaultCode(token);
    return withCopyButton(token.text, inner);
  };
  renderer.link = ({ href, title, tokens }: Tokens.Link) => {
    const resolved = resolveRepoLink(href);
    const text = renderer.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${title}"` : "";
    const external = /^https?:/.test(resolved) ? ` target="_blank" rel="noopener noreferrer"` : "";
    return `<a href="${resolved}"${titleAttr}${external}>${text}</a>`;
  };
  // Ids match Section.slug (same slugify + seen-map as buildSections) so the right-rail
  // "On this page" list can scroll to them, and so #anchor links landing on a whole-document
  // render (see handleContentClick) resolve to a real element.
  const seen = new Map<string, number>();
  renderer.heading = ({ tokens, depth, text }: Tokens.Heading) => {
    const id = slugify(text, seen);
    const body = renderer.parser.parseInline(tokens);
    return `<h${depth} id="${id}">${body}</h${depth}>`;
  };
  return renderer;
}

interface Section {
  depth: number; // 0 = the document itself
  text: string;
  slug: string;
  bodyTokens: Token[]; // this section's own content, not its children's
  children: Section[];
}

/**
 * Same slug for the same heading text within one document; repeats get -1, -2, ... suffixes.
 * Matches GitHub's own heading-anchor algorithm (each whitespace character becomes its own
 * hyphen rather than collapsing runs) so a link authored against GitHub's anchor, like
 * "Contributing / running from source" -> `#contributing--running-from-source` (the double
 * hyphen from the two spaces either side of the removed "/"), resolves to the same slug here.
 */
function slugify(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[`*_]/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s/g, "-") || "section";
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** Splits a document into a tree of self-contained topics — each section holds only its own content, not its subsections'. */
function buildSections(source: string): Section {
  const seen = new Map<string, number>();
  const root: Section = { depth: 0, text: "", slug: "", bodyTokens: [], children: [] };
  const stack: Section[] = [root];

  for (const token of marked.lexer(source)) {
    if (token.type === "heading") {
      if (token.depth === 1) continue; // the doc's own title — shown via the topic label instead
      const section: Section = { depth: token.depth, text: token.text, slug: slugify(token.text, seen), bodyTokens: [], children: [] };
      while (stack.length > 1 && stack[stack.length - 1]!.depth >= token.depth) stack.pop();
      stack[stack.length - 1]!.children.push(section);
      stack.push(section);
    } else {
      stack[stack.length - 1]!.bodyTokens.push(token);
    }
  }
  return root;
}

function findSection(root: Section, path: string[]): Section {
  let current = root;
  for (const slug of path) {
    const next = current.children.find((c) => c.slug === slug);
    if (!next) break;
    current = next;
  }
  return current;
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function visibleChildren(section: Section, excludeSlugs: string[] | undefined): Section[] {
  if (!excludeSlugs || excludeSlugs.length === 0) return section.children;
  return section.children.filter((c) => !excludeSlugs.includes(c.slug));
}

/** Every heading in a section's subtree, in document order — the right-rail "on this page" list for a flat (whole-subtree-merged) topic. */
function flattenHeadings(section: Section, excludeSlugs?: string[]): { slug: string; text: string; depth: number }[] {
  const result: { slug: string; text: string; depth: number }[] = [];
  for (const child of visibleChildren(section, excludeSlugs)) {
    result.push({ slug: child.slug, text: child.text, depth: child.depth });
    result.push(...flattenHeadings(child));
  }
  return result;
}

/**
 * Renders a section's own content followed by every descendant's content, each under its
 * own heading — a "flat" topic's whole subtree merged into one page instead of leaving each
 * subsection as a separate click. `isRoot` skips re-printing the section's own heading (the
 * page already shows it via the topic label or the h2 above the content), but every
 * descendant still gets one.
 */
function renderSubtree(section: Section, renderer: Renderer, isRoot: boolean): string {
  const own = marked.parser(section.bodyTokens, { renderer }) as string;
  const level = Math.min(section.depth, 4);
  const heading = isRoot ? "" : `<h${level} id="${section.slug}">${cleanLabel(section.text)}</h${level}>`;
  const children = section.children.map((child) => renderSubtree(child, renderer, false)).join("");
  return heading + own + children;
}

// Strips backticks and a leading outline number ("3. ", "4.1 ", "8. ") — those numbers are
// the spec doc's own cross-referencing convention and read as broken/out-of-order once a
// topic list is curated down to a subset, so the UI never shows them.
const cleanLabel = (text: string) => text.replace(/`/g, "").replace(/^\d+(?:\.\d+)*\.?\s+/, "");

type DocId = "overview" | "api" | "mapping";

const DOCS: { id: DocId; source: string }[] = [
  { id: "overview", source: overviewSource },
  { id: "api", source: apiSource },
  { id: "mapping", source: mappingSource },
];

const DOC_PATHS: Record<DocId, string> = {
  overview: "README.md",
  api: "packages/core/README.md",
  mapping: "docs/MAPPING.md",
};

/** Depth-first search for a section with the given slug anywhere in a document's tree, returning the path of slugs from the root down to it. */
function findPathToSlug(root: Section, targetSlug: string, prefix: string[] = []): string[] | null {
  for (const child of root.children) {
    const path = [...prefix, child.slug];
    if (child.slug === targetSlug) return path;
    const found = findPathToSlug(child, targetSlug, path);
    if (found) return found;
  }
  return null;
}

/**
 * The docs are three full READMEs — dozens of headings between them, most of which
 * (Requirements, CLI reference, Contributing, License, ...) are reference detail nobody
 * browsing the demo needs up front. This is the curated top-level list; each entry points
 * at a real section already written in one of those three files (by slug, verified against
 * the actual generated slugs — not guessed), and still exposes that section's own
 * subsections underneath it. Nothing here duplicates content — it's a smaller front door
 * onto the same docs.
 */
const TOPICS: { label: string; docId: DocId; path: string[]; flat?: boolean; excludeChildSlugs?: string[] }[] = [
  { label: "Overview", docId: "overview", path: [], flat: true },
  { label: "Install", docId: "api", path: ["install"] },
  // "How to use" and "API" read as one continuous page each — their real subsections
  // (a few sentences per step, or per exported function) are too thin to earn a separate
  // click; flat merges a topic's whole subtree into a single view instead of fragmenting it.
  { label: "How to use", docId: "api", path: ["how-to-use-it"], flat: true },
  { label: "API", docId: "api", path: ["api-reference"], flat: true },
  { label: "Errors", docId: "api", path: ["errors-1"] },
  // Versions/Conventions are authoring preamble for the spec doc, not something a demo visitor needs to navigate to.
  { label: "Mapping schema", docId: "mapping", path: [], excludeChildSlugs: ["1-versions", "2-conventions-used-in-this-document"] },
];

function SectionList({
  sections,
  fullParentPath,
  activeTopicIndex,
  topicIndex,
  activePath,
  onSelect,
}: {
  sections: Section[];
  fullParentPath: string[];
  activeTopicIndex: number;
  topicIndex: number;
  activePath: string[];
  onSelect: (topicIndex: number, path: string[]) => void;
}) {
  return (
    <ul className={fullParentPath.length === 0 ? "space-y-0.5" : "space-y-0.5 border-l border-surface-800 pl-3"}>
      {sections.map((section) => {
        const path = [...fullParentPath, section.slug];
        const isActive = activeTopicIndex === topicIndex && sameArray(activePath, path);
        return (
          <li key={section.slug}>
            <button
              type="button"
              onClick={() => onSelect(topicIndex, path)}
              title={cleanLabel(section.text)}
              className={`block w-full truncate rounded px-2 py-1 text-left text-sm transition-colors ${
                isActive ? "bg-surface-800 text-accent-400" : "text-slate-400 hover:bg-surface-800 hover:text-slate-200"
              }`}
            >
              {cleanLabel(section.text)}
            </button>
            {section.children.length > 0 && (
              <SectionList
                sections={section.children}
                fullParentPath={path}
                activeTopicIndex={activeTopicIndex}
                topicIndex={topicIndex}
                activePath={activePath}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Renders this project's own markdown docs (root README, package README, mapping
 * spec) client-side, so the GitHub Pages build carries documentation alongside the
 * demo without a separate static-site pipeline. The sidebar is a curated top-level
 * topic list (see TOPICS above), not every heading in every file — each topic still
 * expands to its own real subsections. Selecting any topic shows only that topic's
 * own content, never the whole document.
 */
export function Docs() {
  const [topicIndex, setTopicIndex] = useState(0);
  const [subPath, setSubPath] = useState<string[]>([]);

  const docs = useMemo(() => new Map(DOCS.map((doc) => [doc.id, buildSections(doc.source)])), []);
  const sources = useMemo(() => new Map(DOCS.map((doc) => [doc.id, doc.source])), []);
  const topic = TOPICS[topicIndex]!;
  const fullPath = useMemo(() => [...topic.path, ...subPath], [topic, subPath]);
  const activeSection = useMemo(() => findSection(docs.get(topic.docId)!, fullPath), [docs, topic, fullPath]);
  const onThisPage = useMemo(
    () => (topic.flat ? flattenHeadings(activeSection, subPath.length === 0 ? topic.excludeChildSlugs : undefined) : null),
    [topic, activeSection, subPath],
  );
  const contentHtml = useMemo(() => {
    const renderer = createDocsRenderer();
    if (topic.flat && topic.path.length === 0) return marked.parse(sources.get(topic.docId)!, { renderer }) as string;
    if (topic.flat) return renderSubtree(activeSection, renderer, true);
    return marked.parser(activeSection.bodyTokens, { renderer }) as string;
  }, [topic, sources, activeSection]);

  const handleSelect = useCallback((newTopicIndex: number, absolutePath: string[]) => {
    setTopicIndex(newTopicIndex);
    setSubPath(absolutePath.slice(TOPICS[newTopicIndex]!.path.length));
  }, []);

  const handleSelectTopic = useCallback((index: number) => handleSelect(index, TOPICS[index]!.path), [handleSelect]);

  // Every "see X" cross-reference in these READMEs is a same-document `#slug` anchor,
  // written for GitHub's own anchor navigation. There's no DOM element with a matching id
  // here — content is split across topics/subpaths instead of one scrolling page — so a
  // click is resolved against the section tree directly: land on the curated topic whose
  // path contains that slug, or open the real file on GitHub when the target isn't part of
  // the curated topic list at all.
  const handleContentClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const copyButton = (e.target as HTMLElement).closest("button.copy-code-btn");
      if (copyButton) {
        const code = decodeURIComponent(copyButton.getAttribute("data-code") ?? "");
        void navigator.clipboard.writeText(code);
        copyButton.textContent = "Copied";
        setTimeout(() => {
          copyButton.textContent = "Copy";
        }, 1500);
        return;
      }
      const anchor = (e.target as HTMLElement).closest("a[href^='#']");
      if (!anchor) return;
      e.preventDefault();
      const targetSlug = anchor.getAttribute("href")!.slice(1);
      const sectionPath = findPathToSlug(docs.get(topic.docId)!, targetSlug);
      if (!sectionPath) return;
      const matchingTopicIndex = TOPICS.findIndex((t) => t.docId === topic.docId && sameArray(t.path, sectionPath.slice(0, t.path.length)));
      if (matchingTopicIndex === -1) {
        window.open(`${REPO_URL}/blob/main/${DOC_PATHS[topic.docId]}#${targetSlug}`, "_blank", "noopener,noreferrer");
        return;
      }
      handleSelect(matchingTopicIndex, sectionPath);
    },
    [docs, topic, handleSelect],
  );

  const sectionChildren = topic.flat ? null : visibleChildren(activeSection, subPath.length === 0 ? topic.excludeChildSlugs : undefined);
  const railItems = topic.flat ? onThisPage! : sectionChildren!;

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <nav
        className="w-64 shrink-0 overflow-y-auto border-r border-surface-800 py-6 pr-4 pl-4 sm:pl-6 lg:pl-8"
        aria-label="Documentation topics"
      >
        {TOPICS.map((t, i) => {
          const root = docs.get(t.docId)!;
          const topicSection = findSection(root, t.path);
          const isTopicActive = topicIndex === i && subPath.length === 0;
          return (
            <div key={t.label} className="mb-5">
              <button
                type="button"
                onClick={() => handleSelectTopic(i)}
                className={`mb-1 block w-full rounded px-2 py-1.5 text-left text-base font-semibold transition-colors ${
                  isTopicActive ? "text-accent-400" : "text-slate-200 hover:text-accent-400"
                }`}
              >
                {t.label}
              </button>
              {!t.flat && (
                <SectionList
                  sections={visibleChildren(topicSection, t.excludeChildSlugs)}
                  fullParentPath={t.path}
                  activeTopicIndex={topicIndex}
                  topicIndex={i}
                  activePath={fullPath}
                  onSelect={handleSelect}
                />
              )}
            </div>
          );
        })}
      </nav>

      <article className="markdown-body min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        <nav className="mb-5 flex flex-wrap items-center gap-1 text-sm text-slate-500" aria-label="Breadcrumb">
          <button type="button" onClick={() => handleSelectTopic(topicIndex)} className="transition-colors hover:text-accent-400">
            {topic.label}
          </button>
          {subPath.map((slug, i) => {
            const crumbPath = [...topic.path, ...subPath.slice(0, i + 1)];
            const section = findSection(docs.get(topic.docId)!, crumbPath);
            return (
              <span key={slug} className="flex items-center gap-1">
                <span>/</span>
                <button
                  type="button"
                  onClick={() => handleSelect(topicIndex, crumbPath)}
                  className={i === subPath.length - 1 ? "text-slate-300" : "transition-colors hover:text-accent-400"}
                >
                  {cleanLabel(section.text)}
                </button>
              </span>
            );
          })}
        </nav>

        {subPath.length > 0 && <h2>{cleanLabel(activeSection.text)}</h2>}

        <div onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: contentHtml }} />
      </article>

      {railItems.length > 0 && (
        <aside
          className="hidden w-56 shrink-0 overflow-y-auto border-l border-surface-800 py-6 pr-4 pl-4 sm:pr-6 xl:block"
          aria-label="On this page"
        >
          <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {topic.flat ? "On this page" : "In this section"}
          </p>
          <ul className="space-y-2 text-sm">
            {topic.flat
              ? onThisPage!.map((h) => (
                  <li key={h.slug} style={{ paddingLeft: `${Math.max(h.depth - 2, 0) * 12}px` }}>
                    <a
                      href={`#${h.slug}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(h.slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="block truncate text-slate-400 transition-colors hover:text-accent-400"
                    >
                      {cleanLabel(h.text)}
                    </a>
                  </li>
                ))
              : sectionChildren!.map((child) => (
                  <li key={child.slug}>
                    <button
                      type="button"
                      onClick={() => handleSelect(topicIndex, [...fullPath, child.slug])}
                      className="block truncate text-left text-slate-400 transition-colors hover:text-accent-400"
                    >
                      {cleanLabel(child.text)}
                    </button>
                  </li>
                ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
