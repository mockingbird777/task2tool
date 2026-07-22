import { analyzeLexicalQuery, MAX_QUERY_TERMS, rankResources } from "./search.js";
import type { CompositionPlan, ScannedResource, SearchHit } from "./types.js";

function coveragePercent(covered: number, total: number): number {
  return Number((total === 0 ? 0 : covered * 100 / total).toFixed(1));
}

/**
 * Select a compact set of complementary resources by greedy marginal lexical
 * coverage. This is deliberately explainable retrieval, not semantic planning.
 */
export function composeResources(
  resources: readonly ScannedResource[],
  query: string,
  limit = 5
): CompositionPlan {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be an integer between 1 and 100.");
  }
  const queryAnalysis = analyzeLexicalQuery(query);
  const queryTerms = queryAnalysis.evaluatedTerms.map((term) => term.display);
  const ignoredTerms = queryAnalysis.ignoredTerms.map((term) => term.display);
  const candidates = rankResources(resources, query);
  const uncovered = new Set(queryTerms);
  const selected = new Set<string>();
  const picks: CompositionPlan["picks"] = [];

  while (picks.length < limit) {
    let best: SearchHit | undefined;
    let bestNewTerms: string[] = [];
    for (const candidate of candidates) {
      if (selected.has(candidate.resource.id)) continue;
      const newTerms = candidate.matchedTerms.filter((term) => uncovered.has(term));
      if (newTerms.length === 0) continue;
      if (!best
        || newTerms.length > bestNewTerms.length
        || (newTerms.length === bestNewTerms.length && candidate.score > best.score)
        || (newTerms.length === bestNewTerms.length && candidate.score === best.score
          && candidate.resource.id.localeCompare(best.resource.id, "en") < 0)) {
        best = candidate;
        bestNewTerms = newTerms;
      }
    }
    if (!best) break;
    selected.add(best.resource.id);
    for (const term of bestNewTerms) uncovered.delete(term);
    picks.push({
      ...best,
      newTerms: bestNewTerms,
      cumulativeCoveragePercent: coveragePercent(queryTerms.length - uncovered.size, queryAnalysis.totalTerms)
    });
  }

  const coveredTerms = queryTerms.filter((term) => !uncovered.has(term));
  const uncoveredTerms = queryTerms.filter((term) => uncovered.has(term));
  return {
    queryBoundary: {
      evaluatedTermLimit: MAX_QUERY_TERMS,
      totalTerms: queryAnalysis.totalTerms,
      truncated: ignoredTerms.length > 0,
      ignoredTerms
    },
    queryTerms,
    coveredTerms,
    uncoveredTerms,
    lexicalCoveragePercent: coveragePercent(coveredTerms.length, queryAnalysis.totalTerms),
    picks
  };
}
