---
description: Review current branch, diff, commit, or PR using scout/reviewer subagents and P0-P3 findings
argument-hint: "[target]"
---

Review the requested target for release readiness using the code-review skill and subagents.

Raw target argument: `$ARGUMENTS`

Use this workflow:

1. Load the `code-review` skill if it is not already loaded.
2. **Lock the target before running any diff/status/local inspection commands.** Treat `Raw target argument` as authoritative:
   - If `Raw target argument` is non-empty after trimming whitespace, review **only that target**. Do **not** inspect or use the current local branch as a fallback, even if the working tree has changes.
   - If `Raw target argument` is empty, then and only then review local repo state: current branch and/or uncommitted changes against the appropriate base branch.
   - If the intended target cannot be parsed or resolved, stop and ask a clarifying question instead of reviewing local changes.
3. Target resolution rules:
   - GitHub PR URL (for example `https://github.com/OrderProtection/monolog/pull/5734`) or PR number: run `gh pr view <target> --json number,title,headRefName,baseRefName,url,author,isDraft,mergeStateStatus`, lock `PR #<number> <url>, head=<headRefName>, base=<baseRefName>`, and review the PR head against that base. Prefer `gh pr diff <target>` and `gh pr checkout <target>` over local branch diffs.
   - Branch name: fetch if needed, resolve its upstream/default base (usually `origin/main` unless the PR metadata says otherwise), lock `branch=<branch>, base=<base>`, and review `<base>...<branch>`.
   - Commit or range: resolve it exactly, lock the explicit commit/range and base semantics, and review that exact target.
   - Ambiguous text: ask for clarification.
4. Before delegating to subagents, state the locked target in your working context. Ensure every subagent task includes that locked target; never pass `$ARGUMENTS`, `${ARGUMENTS}`, `${ARGUMENTS:-...}`, or any unresolved placeholder through to subagents.
5. Use `subagent` in parallel when useful:
   - `scout` maps changed areas, relevant conventions, and code paths with file references.
   - `reviewer` reviews the target for correctness, security, performance, test gaps, and release blockers.
6. If the target is broad or risky, run at least these two subagents in parallel, replacing `<LOCKED_TARGET>` with the resolved target details (never leave placeholders unresolved):

```ts
subagent({
  tasks: [
    {
      agent: "scout",
      task: "Map the code touched by this review target: <LOCKED_TARGET>. Identify changed files, relevant call paths, conventions to follow, and risky areas. Use read-only commands and return concise file references."
    },
    {
      agent: "reviewer",
      task: "Review this target for release readiness: <LOCKED_TARGET>. Use P0-P3 priorities. Focus on correctness, security, performance, migrations/config, and meaningful test gaps. Use read-only commands. Return verdict, findings, validation notes, and assumptions."
    }
  ]
})
```

7. Synthesize the subagent outputs into one final review. Do not simply paste their output; deduplicate, verify high-risk claims when needed, and rank findings by severity.

Final output format:

## Verdict

`Ship`, `Ship with follow-ups`, or `Do not ship`.

## Findings

List findings in P0 → P3 order. Use this format:

### P1: concise issue title

- **Where:** `path/to/file.ts:123` or smallest available location
- **Impact:** why this matters
- **Evidence:** what in the diff/code indicates the problem
- **Recommendation:** concrete fix or mitigation
- **Confidence:** high | medium | low

If no meaningful issues are found, say: `No blocking findings found.`

## Validation Notes

- Review target/base used
- Commands/tests run, if any
- Files/areas inspected
- What was not validated

## Open Questions / Assumptions

Only include if relevant.
