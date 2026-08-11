const TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/**
 * Syntax-highlights a JSON string for display: escapes HTML first, then wraps each
 * key/string/number/boolean/null token in a `<span class="json-*">`. Safe against
 * injection from translated field values (e.g. a patient name) since escaping happens
 * before any token wrapping — the only markup this ever emits is the fixed span classes
 * below.
 */
export function highlightJson(json: string): string {
  const escaped = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(TOKEN, (match) => {
    let className = "json-number";
    if (match.startsWith('"')) {
      className = /:\s*$/.test(match) ? "json-key" : "json-string";
    } else if (match === "true" || match === "false") {
      className = "json-boolean";
    } else if (match === "null") {
      className = "json-null";
    }
    return `<span class="${className}">${match}</span>`;
  });
}
