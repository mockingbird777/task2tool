import type { ScannedResource, SearchHit } from "./types.js";
import { normalizeText, tokenize, uniqueSorted } from "./text.js";
import { publicResource } from "./scanner.js";

interface IndexedDocument {
  resource: ScannedResource;
  terms: string[];
  frequencies: Map<string, number>;
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

export function searchResources(resources: readonly ScannedResource[], query: string, limit = 10): SearchHit[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be an integer between 1 and 100.");
  const queryTerms = uniqueSorted(tokenize(query));
  if (queryTerms.length === 0) throw new Error("Search query must contain at least one searchable word.");
  if (resources.length === 0) return [];

  const documents: IndexedDocument[] = resources.map((resource) => {
    const terms = weightedTerms(resource);
    return { resource, terms, frequencies: frequencies(terms) };
  });
  const averageLength = documents.reduce((total, document) => total + document.terms.length, 0) / documents.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, documents.filter((document) => document.frequencies.has(term)).length);
  }

  const k1 = 1.4;
  const b = 0.72;
  const normalizedQuery = normalizeText(query).trim();
  const hits: SearchHit[] = [];

  for (const document of documents) {
    let score = 0;
    const matchedTerms: string[] = [];
    for (const term of queryTerms) {
      const termFrequency = document.frequencies.get(term) ?? 0;
      if (termFrequency === 0) continue;
      matchedTerms.push(term);
      const frequency = documentFrequency.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5));
      const normalization = termFrequency + k1 * (1 - b + b * document.terms.length / averageLength);
      score += inverseDocumentFrequency * termFrequency * (k1 + 1) / normalization;
    }
    const title = normalizeText(document.resource.name);
    const description = normalizeText(document.resource.description);
    if (normalizedQuery.length > 2 && title.includes(normalizedQuery)) score += 3;
    else if (normalizedQuery.length > 2 && description.includes(normalizedQuery)) score += 1.25;
    if (matchedTerms.length === queryTerms.length) score += 0.35;
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
  return hits.slice(0, limit);
}
