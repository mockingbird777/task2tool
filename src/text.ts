const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "i", "in", "is", "it",
  "my", "of", "on", "or", "that", "the", "this", "to", "tool", "using", "want", "with"
]);
const MAX_TOKENS_PER_VALUE = 8_192;
const MAX_EXACT_TOKEN_CHARACTERS = 128;

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function tokenizeInternal(value: string, applyStemming: boolean): string[] {
  const normalized = normalizeText(value);
  const output: string[] = [];

  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    const valueToken = match[0];
    if (STOP_WORDS.has(valueToken)) continue;
    const token = applyStemming ? stemToken(valueToken) : valueToken;
    if ((token.length > 1 || /^\d$/u.test(token)) && token.length <= MAX_EXACT_TOKEN_CHARACTERS) output.push(token);
    if (output.length >= MAX_TOKENS_PER_VALUE) break;
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(token) && token.length > 2) {
      let previous = "";
      for (const character of token) {
        if (previous) output.push(`${previous}${character}`);
        if (output.length >= MAX_TOKENS_PER_VALUE) break;
        previous = character;
      }
    }
  }
  return output;
}

export function tokenize(value: string): string[] {
  return tokenizeInternal(value, true);
}

export function tokenizeForDisplay(value: string): string[] {
  return tokenizeInternal(value, false);
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
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]{}()#+.!|~-])/gu, "\\$1");
}

export function safeJson(value: unknown, indentation = 2): string {
  return `${JSON.stringify(value, null, indentation)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")}\n`;
}
