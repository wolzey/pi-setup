---
name: code-review
description: Reviews pull requests, branches, commits, diffs, and implementations for correctness, security, performance, tests, and release readiness using P0-P3 findings.
---

# Code Review

Use this skill when the user asks to review a pull request, branch, commit, diff, uncommitted work, or implementation for bugs, regressions, security issues, performance problems, test gaps, or release readiness.

## Review standard

Prioritize actionable correctness and release-risk findings. Do not fill the review with generic style advice, broad refactor suggestions, or subjective taste unless they materially affect maintainability or correctness.

Always produce:

1. **Verdict**
   - `Ship` — no blocking findings
   - `Ship with follow-ups` — non-blocking concerns exist
   - `Do not ship` — one or more P0/P1 findings
2. **Findings** grouped by priority
3. **Validation notes** covering what was inspected and any tests/checks run
4. **Open questions / assumptions** when relevant

If no meaningful issues are found, say so explicitly: `No blocking findings found.`

## Priority levels

- **P0 — Critical blocker**
  - security vulnerability, data loss/corruption, broken production deploy, credential leakage, irreversible destructive behavior, build completely broken
- **P1 — Serious blocker**
  - likely correctness regression, broken main user flow, flaky or unsafe migration, authorization bypass, severe performance regression, missing critical test for risky behavior
- **P2 — Important non-blocker**
  - maintainability concern with clear future cost, moderate performance issue, incomplete edge-case handling, meaningful test gap, observability/debuggability gap
- **P3 — Minor**
  - small cleanup, docs/comment issue, naming clarity, low-risk polish

## Finding format

Each finding should include:

```md
### P1: concise issue title

- **Where:** `path/to/file.ts:123` or the smallest available location
- **Impact:** why this matters
- **Evidence:** what in the diff/code indicates the problem
- **Recommendation:** concrete fix or mitigation
- **Confidence:** high | medium | low
```

Prefer exact file paths and line numbers when available. If line numbers are unavailable, cite function/class/file context.

## Review workflow

When reviewing a branch or PR:

1. Determine the base branch if possible (`main`, `master`, or upstream target).
2. Inspect changed files and diff before reading entire files.
3. Follow code paths for risky changes rather than only reading the diff.
4. Check tests relevant to the behavior changed.
5. Run tests/build/lint only when appropriate and not too expensive, or explain why they were not run.
6. Distinguish confirmed issues from hypotheses.

Useful commands:

```bash
git status --short
git branch --show-current
git merge-base HEAD origin/main
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
git diff origin/main...HEAD -- path/to/file
```

Adjust the base branch when the repo uses a different default or PR target.

## Avoid

- Do not nitpick formatting if an autoformatter/linter owns it.
- Do not invent requirements not present in code, tests, docs, or user context.
- Do not claim tests passed unless you actually ran them.
- Do not produce long praise sections.
- Do not bury blockers below minor findings.

## Future enhancement note

After subagent orchestration is available, revisit this review workflow and consider splitting reviews across specialized reviewer subagents, such as correctness, security, tests/build, and performance/release-risk reviewers. Aggregate their findings into the same P0–P3 verdict format.
