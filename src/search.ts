import type { ScannedResource, SearchHit } from "./types.js";
import { normalizeText, stemToken, tokenize, tokenizeForDisplay, uniqueSorted } from "./text.js";
import { publicResource } from "./scanner.js";

interface IndexedDocument {
  resource: ScannedResource;
  length: number;
  frequencies: Map<string, number>;
}

const MAX_QUERY_TERMS = 256;

interface QueryTerm {
  match: string;
  display: string;
}

function queryTerms(query: string): QueryTerm[] {
  const byMatch = new Map<string, string>();
  for (const display of uniqueSorted(tokenizeForDisplay(query))) {
    const match = stemToken(display);
    if (!byMatch.has(match)) byMatch.set(match, display);
    if (byMatch.size >= MAX_QUERY_TERMS) break;
  }
  return [...byMatch.entries()].map(([match, display]) => ({ match, display }));
}

export function lexicalQueryTerms(query: string): string[] {
  const terms = queryTerms(query);
  if (terms.length === 0) throw new Error("Search query must contain at least one searchable word.");
  return terms.map((term) => term.display);
}

function weightedTerms(resource: ScannedResource): string[] {
  const name = tokenize(resource.name);
  const tags = tokenize(resource.tags.join(" "));
  const description = tokenize(resource.description);
  const corpus = tokenize(resource.corpus);
  return [
    ...name, ...name, ...name, ...name,
    ...tags, ...tags, ...tags,
    ...description, ...description,
    ...corpus
  ];
}

function frequencies(terms: readonly string[]): Map<string, number> {
  const output = new Map<string, number>();
  for (const term of terms) output.set(term, (output.get(term) ?? 0) + 1);
  return output;
}

export function rankResources(resources: readonly ScannedResource[], query: string): SearchHit[] {
  const queryLexemes = queryTerms(query);
  if (queryLexemes.length === 0) throw new Error("Search query must contain at least one searchable word.");
  if (resources.length === 0) return [];

  const documents: IndexedDocument[] = resources.map((resource) => {
    const terms = weightedTerms(resource);
    return { resource, length: terms.length, frequencies: frequencies(terms) };
  });
  const averageLength = documents.reduce((total, document) => total + document.length, 0) / documents.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const term of queryLexemes) {
    documentFrequency.set(term.match, documents.filter((document) => document.frequencies.has(term.match)).length);
  }

  const k1 = 1.4;
  const b = 0.72;
  const normalizedQuery = normalizeText(query).trim();
  const hits: SearchHit[] = [];

  for (const document of documents) {
    let score = 0;
    const matchedTerms: string[] = [];
    for (const term of queryLexemes) {
      const termFrequency = document.frequencies.get(term.match) ?? 0;
      if (termFrequency === 0) continue;
      matchedTerms.push(term.display);
      const frequency = documentFrequency.get(term.match) ?? 0;
      const inverseDocumentFrequency = Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5));
      const normalization = termFrequency + k1 * (1 - b + b * document.length / averageLength);
      score += inverseDocumentFrequency * termFrequency * (k1 + 1) / normalization;
    }
    const title = normalizeText(document.resource.name);
    const description = normalizeText(document.resource.description);
    if (normalizedQuery.length > 2 && title.includes(normalizedQuery)) score += 3;
    else if (normalizedQuery.length > 2 && description.includes(normalizedQuery)) score += 1.25;
    if (matchedTerms.length === queryLexemes.length) score += 0.35;
    if (score <= 0) continue;
    hits.push({
      resource: publicResource(document.resource),
      score: Number(score.toFixed(6)),
      matchedTerms: uniqueSorted(matchedTerms)
    });
  }

  hits.sort((left, right) => right.score - left.score
    || left.resource.name.localeCompare(right.resource.name, "en")
    || left.resource.id.localeCompare(right.resource.id, "en"));
  return hits;
}

export function searchResources(resources: readonly ScannedResource[], query: string, limit = 10): SearchHit[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be an integer between 1 and 100.");
  return rankResources(resources, query).slice(0, limit);
}
