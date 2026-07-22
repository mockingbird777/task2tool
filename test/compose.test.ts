import assert from "node:assert/strict";
import test from "node:test";
import { composeResources } from "../src/compose.js";
import type { ScannedResource } from "../src/types.js";

const RESOURCES: ScannedResource[] = [
  {
    id: "skill:review", name: "Security Reviewer", kind: "skill",
    description: "Review changes for security risks.", tags: ["review", "security"],
    path: "review/SKILL.md", corpus: "review security authentication"
  },
  {
    id: "mcp:postgres", name: "Postgres Explorer", kind: "mcp-server",
    description: "Query a Postgres database.", tags: ["query", "postgres"],
    path: "mcp.json", corpus: "query postgres tables"
  },
  {
    id: "prompt:release", name: "Release Writer", kind: "prompt",
    description: "Write release notes.", tags: ["release"],
    path: "release.prompt.md", corpus: "release changelog"
  }
];

test("greedily selects complementary resources and explains marginal coverage", () => {
  const plan = composeResources(RESOURCES, "review security and query postgres", 5);
  assert.deepEqual(plan.queryTerms, ["postgres", "query", "review", "security"]);
  assert.deepEqual(plan.queryBoundary, {
    evaluatedTermLimit: 256,
    totalTerms: 4,
    truncated: false,
    ignoredTerms: []
  });
  assert.equal(plan.picks.length, 2);
  assert.deepEqual(new Set(plan.picks.map((pick) => pick.resource.id)), new Set(["skill:review", "mcp:postgres"]));
  assert.deepEqual(plan.coveredTerms, plan.queryTerms);
  assert.deepEqual(plan.uncoveredTerms, []);
  assert.equal(plan.lexicalCoveragePercent, 100);
  assert.equal(plan.picks[1]?.cumulativeCoveragePercent, 100);
  assert.equal(new Set(plan.picks.flatMap((pick) => pick.newTerms)).size, 4);
});

test("stops when remaining resources add no lexical coverage", () => {
  const plan = composeResources(RESOURCES, "review security deploy kubernetes", 10);
  assert.equal(plan.picks.length, 1);
  assert.equal(plan.picks[0]?.resource.id, "skill:review");
  assert.deepEqual(plan.uncoveredTerms, ["deploy", "kubernetes"]);
  assert.equal(plan.lexicalCoveragePercent, 50);
});

test("composition is deterministic, bounded, and does not mutate resources", () => {
  const before = structuredClone(RESOURCES);
  const first = composeResources(RESOURCES, "release review security", 1);
  const second = composeResources(RESOURCES, "release review security", 1);
  assert.deepEqual(first, second);
  assert.equal(first.picks.length, 1);
  assert.deepEqual(RESOURCES, before);
  assert.throws(() => composeResources(RESOURCES, "the and to"), /searchable word/u);
  assert.throws(() => composeResources(RESOURCES, "security", 0), /between 1 and 100/u);
  assert.throws(() => composeResources(RESOURCES, "x".repeat(8_193)), /8,192 source or normalized characters/u);
  assert.throws(() => composeResources(RESOURCES, "\ufdfa".repeat(500)), /8,192 source or normalized characters/u);
});

test("discloses ignored query terms and never presents bounded evaluation as complete coverage", () => {
  const terms = Array.from({ length: 300 }, (_, index) => `t${String(index).padStart(3, "0")}`);
  const resource: ScannedResource = {
    id: "skill:first-256",
    name: "First 256 terms",
    kind: "skill",
    description: "Covers only the evaluated prefix.",
    tags: [],
    path: "bounded/SKILL.md",
    corpus: terms.slice(0, 256).join(" ")
  };

  const plan = composeResources([resource], terms.join(" "), 5);
  assert.equal(plan.queryTerms.length, 256);
  assert.equal(plan.queryBoundary.totalTerms, 300);
  assert.equal(plan.queryBoundary.truncated, true);
  assert.deepEqual(plan.queryBoundary.ignoredTerms, terms.slice(256));
  assert.deepEqual(plan.uncoveredTerms, []);
  assert.equal(plan.lexicalCoveragePercent, 85.3);
  assert.equal(plan.picks[0]?.cumulativeCoveragePercent, 85.3);
  assert.notEqual(plan.lexicalCoveragePercent, 100);
});
