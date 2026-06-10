---
name: memory
description: Guides when to save durable memories with retain/recall. Use when stable user preferences, repo conventions, recurring workflow facts, or project constraints emerge.
---

# Memory

Use this skill when a conversation reveals stable user preferences, repo conventions, repeated workflow facts, or important project-specific constraints that would be useful in future Pi sessions.

## When to retain memory

Call `retain` only for durable, non-sensitive facts such as:

- user preferences
- coding, commit, PR, or review conventions
- repo-specific build/test/deploy instructions
- integration details
- recurring gotchas
- stable architectural facts

Prefer `project` scope for facts about the current repository.
Prefer `global` scope for user preferences that apply across repositories.

## When not to retain memory

Do not retain:

- secrets, tokens, credentials, private personal data
- temporary task progress
- speculative conclusions
- one-off debug observations
- facts likely to become stale quickly
- anything the user explicitly says not to remember

## Ask first when uncertain

If the fact is useful but subjective, sensitive, or ambiguous, ask before calling `retain`.

Examples:

- "Should I remember that you prefer X?"
- "Should I save this as a project memory for this repo?"

## Good memory format

Keep memories concise and factual.

Good:

- "User prefers Conventional Commit messages with descriptive bodies."
- "In monolog, backend-only LaunchDarkly flags conventionally end in `-be`."
- "For GuardhouseMobile, Android Play Store pipeline work should validate the MAUI workload pin."

Bad:

- "We fixed the thing today."
- "Maybe the deploy is broken because of env vars."
- "Current task: update the README."
