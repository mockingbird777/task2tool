const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "i", "in", "is", "it",
  "my", "of", "on", "or", "that", "the", "this", "to", "tool", "using", "want", "with"
]);

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const output: string[] = [];

  for (const valueToken of raw) {
    if (STOP_WORDS.has(valueToken)) continue;
    const token = stem(valueToken);
    if (token.length > 1 || /^\d$/u.test(token)) output.push(token);
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(token) && token.length > 2) {
      const characters = [...token];
      for (let index = 0; index < characters.length - 1; index += 1) {
        output.push(`${characters[index] ?? ""}${characters[index + 1] ?? ""}`);
      }
    }
  }
  return output;
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("`", "\\`");
}

export function safeJson(value: unknown, indentation = 2): string {
  return `${JSON.stringify(value, null, indentation)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")}\n`;
}
