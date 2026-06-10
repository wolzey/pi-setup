---
description: "Use when the user runs /create-worktree or asks to 'create a worktree', 'start a worktree', 'spin up a branch in a worktree'. Bootstraps a git worktree under .worktrees/ with branch name $username/$ticket?-$slug, copies .env files from the main checkout, installs dependencies, then renames and colors the session."
argument-hint: "[short description] [--base <branch>]"
---

<!-- Converted from Claude skill: /Users/ethanwolz/.claude/skills/create-worktree/SKILL.md -->

Run the converted Claude skill `create-worktree` for this request: $ARGUMENTS

Before taking action:
1. Read `/Users/ethanwolz/.claude/skills/create-worktree/SKILL.md` completely.
2. Treat that file as the source-of-truth instructions for this prompt invocation.
3. Resolve every relative path mentioned by the skill against `/Users/ethanwolz/.claude/skills/create-worktree` (for example `scripts/`, `references/`, `examples/`, and `assets/`).
4. If the skill refers to `$ARGUMENTS`, slash-command arguments, or invocation arguments, use the arguments passed to this prompt.
5. Follow all safety, confirmation, secrecy, and no-op/read-only rules from the skill exactly.
6. If referenced files are needed, load them from the original Claude skill directory rather than from `~/.pi/agent/prompts`.

User request / arguments: $ARGUMENTS
