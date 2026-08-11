const STORAGE_KEYWORDS =
  "import|export|from|as|default|const|let|var|function|class|interface|type|enum|namespace|declare|async|await|static|readonly|public|private|protected|extends|implements|new|void|typeof|instanceof|keyof|true|false|null|undefined";
const CONTROL_KEYWORDS = "if|else|return|throw|try|catch|finally|for|while|do|switch|case|break|continue|in|of";

const JS_TOKEN = new RegExp(
  "(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)" +
    "|(?<template>`(?:\\\\.|\\$\\{[^}]*\\}|[^`\\\\])*`)" +
    "|(?<string>\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')" +
    "|(?<number>\\b\\d+(?:\\.\\d+)?\\b)" +
    `|(?<storagekw>\\b(?:${STORAGE_KEYWORDS})\\b)` +
    `|(?<controlkw>\\b(?:${CONTROL_KEYWORDS})\\b)` +
    "|(?<call>\\b[A-Za-z_$][\\w$]*(?=\\())",
  "g",
);

/**
 * Syntax-highlights TypeScript/JavaScript for display, using the standard VS Code
 * "Dark+" token colors (the same convention this project already uses for JSON and
 * HL7v2): comments, strings/template literals, numbers, declaration keywords, control-flow
 * keywords, and function-call names each get their own color. Not a full parser — a
 * single-pass tokenizer, same approach as the JSON/HL7v2 highlighters, good enough for
 * short documentation snippets, not a guarantee against every valid TS construct.
 */
export function highlightJs(code: string): string {
  const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(JS_TOKEN, (match, ...rest) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    let className: string | undefined;
    if (groups.comment) className = "js-comment";
    else if (groups.template || groups.string) className = "js-string";
    else if (groups.number) className = "js-number";
    else if (groups.storagekw) className = "js-keyword";
    else if (groups.controlkw) className = "js-control";
    else if (groups.call) className = "js-call";
    return className ? `<span class="${className}">${match}</span>` : match;
  });
}
