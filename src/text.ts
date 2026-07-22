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

function consumeControlString(value: string, start: number, bellTerminates: boolean): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x18 || code === 0x1a) return index + 1;
    if ((bellTerminates && code === 0x07) || code === 0x9c) return index + 1;
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
  }
  return value.length;
}

function consumeControlSequence(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x18 || code === 0x1a) return index + 1;
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return value.length;
}

function consumeEscapeSequence(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index += 1;
  }
  const final = value.charCodeAt(index);
  return final >= 0x30 && final <= 0x7e ? index + 1 : start;
}

/** Remove complete ANSI/ECMA-48 sequences and C0/C1 controls, preserving tabs and line breaks. */
export function stripTerminalControls(value: string): string {
  const output: string[] = [];
  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5d || next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
        index = consumeControlString(value, index + 2, next === 0x5d);
      } else if (next === 0x5b) {
        index = consumeControlSequence(value, index + 2);
      } else {
        index = consumeEscapeSequence(value, index + 1);
      }
      continue;
    }
    if (code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
      index = consumeControlString(value, index + 1, code === 0x9d);
      continue;
    }
    if (code === 0x9b) {
      index = consumeControlSequence(value, index + 1);
      continue;
    }
    if ((code >= 0x00 && code <= 0x08)
      || code === 0x0b || code === 0x0c
      || (code >= 0x0e && code <= 0x1f)
      || (code >= 0x7f && code <= 0x9f)) {
      index += 1;
      continue;
    }
    output.push(value[index] ?? "");
    index += 1;
  }
  return output.join("");
}

/** Safely collapse untrusted text before writing it as one terminal line. */
export function terminalLine(value: string): string {
  return stripTerminalControls(value).replace(/\s+/gu, " ").trim();
}

export function escapeHtml(value: string): string {
  return stripTerminalControls(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeMarkdown(value: string): string {
  return stripTerminalControls(value)
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
    .replace(/[\u007f-\u009f]/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")}\n`;
}
