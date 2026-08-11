const BASH_TOKEN =
  /(?<comment>#[^\n]*)|(?<string>"(?:\\.|[^"\\])*"|'[^']*')|(?<flag>(?:^|\s)--?[A-Za-z][\w-]*)|(?<variable>\$\{?\w+\}?)|(?<command>^[A-Za-z][\w.-]*)/gm;

/**
 * Syntax-highlights a shell command line for display, using the same VS Code "Light+"
 * token colors as the JSON/HL7v2/JS highlighters elsewhere in the docs: the leading
 * command name, flags, quoted strings, `$VAR` substitutions, and `#` comments each get
 * their own color. Single-pass tokenizer, not a shell parser — built for the short
 * install/CLI snippets this package's docs actually contain.
 */
export function highlightBash(code: string): string {
  const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(BASH_TOKEN, (match, ...rest) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    if (groups.comment) return `<span class="bash-comment">${match}</span>`;
    if (groups.string) return `<span class="bash-string">${match}</span>`;
    if (groups.variable) return `<span class="bash-variable">${match}</span>`;
    if (groups.flag) {
      const lead = match.match(/^\s/)?.[0] ?? "";
      return `${lead}<span class="bash-flag">${match.slice(lead.length)}</span>`;
    }
    if (groups.command) return `<span class="bash-command">${match}</span>`;
    return match;
  });
}
