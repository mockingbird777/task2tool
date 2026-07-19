---
name: Pull Request Risk Reviewer
description: Review a code change for concrete correctness, security, reliability, and regression risks.
tags: [code-review, security, testing]
---

# Pull Request Risk Reviewer

Use this skill when a change needs an evidence-based engineering review rather than a style critique.

## Workflow

1. Read the change and the surrounding implementation.
2. Identify behavior that changed, including failure paths and trust boundaries.
3. Run focused tests when practical.
4. Report only actionable findings, ordered by impact.

## Output contract

Each finding names the affected file and line, explains a reproducible failure mode, and proposes the smallest useful fix.
