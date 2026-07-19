import assert from "node:assert/strict";
import test from "node:test";
import { searchResources } from "../src/search.js";
import { tokenize } from "../src/text.js";
import type { ScannedResource } from "../src/types.js";

const RESOURCES: ScannedResource[] = [
  {
    id: "skill:security", name: "Pull Request Security Reviewer", kind: "skill",
    description: "Review code diffs for authentication vulnerabilities and unsafe data handling.",
    tags: ["code-review", "security"], path: "security/SKILL.md", corpus: "audit pull requests patches threat model tests"
  },
  {
    id: "prompt:release", name: "Release Notes", kind: "prompt",
    description: "Write readable release notes from commits and issue summaries.",
    tags: ["writing", "release"], path: "release.prompt.md", corpus: "changelog announce version users"
  },
  {
    id: "mcp:postgres", name: "Postgres Explorer", kind: "mcp-server",
    description: "Run read-only SQL queries and inspect database schemas.",
    tags: ["database", "sql"], path: "mcp.json", corpus: "postgres tables query data analytics"
  }
];

test("ranks the most task-relevant resource first", () => {
  const hits = searchResources(RESOURCES, "review a pull request for security bugs");
  assert.equal(hits[0]?.resource.id, "skill:security");
  assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
});

test("ranking is deterministic and does not mutate resources", () => {
  const before = structuredClone(RESOURCES);
  const first = searchResources(RESOURCES, "query postgres data", 2);
  const second = searchResources(RESOURCES, "query postgres data", 2);
  assert.deepEqual(first, second);
  assert.deepEqual(RESOURCES, before);
});

test("honors result limits", () => {
  assert.equal(searchResources(RESOURCES, "release database security", 2).length, 2);
});

test("rejects empty searches and unsafe limits", () => {
  assert.throws(() => searchResources(RESOURCES, "the and to"), /searchable word/u);
  assert.throws(() => searchResources(RESOURCES, "security", 0), /between 1 and 100/u);
  assert.throws(() => searchResources(RESOURCES, "security", 101), /between 1 and 100/u);
});

test("tokenizes CJK tasks for compact multilingual matching", () => {
  const resources: ScannedResource[] = [{
    id: "prompt:zh", name: "代码审查助手", kind: "prompt", description: "检查安全漏洞和测试遗漏。",
    tags: ["审查"], path: "review.prompt.md", corpus: "代码审查 安全漏洞"
  }];
  assert.equal(searchResources(resources, "帮我进行代码审查")[0]?.resource.id, "prompt:zh");
});

test("keeps ranking bounded for pathologically long CJK input", () => {
  const resources: ScannedResource[] = [{
    id: "prompt:bounded", name: "安全助手", kind: "prompt", description: "检查风险。",
    tags: [], path: "bounded.prompt.md", corpus: `安全${"文".repeat(100_000)}`
  }];
  const first = searchResources(resources, "安全检查");
  const second = searchResources(resources, "安全检查");
  assert.ok(tokenize(resources[0]!.corpus).length <= 8_192);
  assert.deepEqual(first, second);
  assert.equal(first[0]?.resource.id, "prompt:bounded");
});
