---
name: launchdarkly
description: |
  CRUD on LaunchDarkly feature flags via REST API v2 plus repo-aware wiring.
  Use when the user wants to create / list / update / delete a feature flag,
  toggle a flag on/off in an environment, set a percentage rollout, check flag
  status, or wire a new flag into the monolog repo (NestJS @monolog/feature-flags
  module or the Nuxt useLaunchDarkly composable).
  Triggers on: "create a feature flag", "turn on <flag>", "turn off <flag>",
  "rollout <flag>", "list feature flags", "delete the <flag> flag",
  "what's the status of <flag> in staging", "wire up <flag>".
---

# LaunchDarkly Skill

Interacts with LaunchDarkly REST API v2 for feature flag CRUD plus repo-aware wiring
into the monolog monorepo.

## When to use

Pick this skill when the user asks to:

- **Create a flag**: "create a feature flag for X", "add an LD flag called Y"
- **List / inspect**: "list all flags", "what flags are tagged Z", "show me the
  warranty-exclusions flag"
- **Toggle**: "turn on <flag> in staging", "turn off <flag>", "kill switch <flag>"
- **Roll out**: "ramp <flag> to 25% in production", "set <flag> rollout to 50%"
- **Check status**: "what's the status of <flag>", "is <flag> on in test"
- **Update / tag**: "rename <flag>", "tag <flag> with foo", "remove the bar tag"
- **Delete**: "delete the <flag> flag"
- **Wire into the repo**: "wire up the <flag> feature flag", "use this flag in the
  warranty service"

## Setup

### Option A: Environment variables (highest priority)

```bash
export LAUNCHDARKLY_API_TOKEN=<personal-or-service-token>
export LAUNCHDARKLY_ENVIRONMENT=test       # test | staging | production
export LAUNCHDARKLY_PROJECT_KEY=default     # optional, defaults to "default"
```

Tokens come from <https://app.launchdarkly.com/settings/authorization>. Service
tokens are recommended; SDK keys / mobile keys do **not** work for the REST API.

### Option B: Profiles (stored at `~/.config/launchdarkly/<name>.json`)

```bash
# Create a profile (defaultEnvironment is optional but recommended)
ld.sh config create personal --api-key <token> --environment test

# Switch active profile
ld.sh config set profile personal

# Update active profile's environment without recreating
ld.sh config set environment staging

# List (* = active)
ld.sh config list
```

Each profile file is `{"apiKey":"...","defaultEnvironment":"...","projectKey":"..."}`
(chmod 600). The active profile name is stored in `~/.config/launchdarkly/current`.

### Option C: Per-command flags

```bash
ld.sh --api-key <token> --environment staging flag list
```

Auth resolution order: **per-command flags > env vars > active profile**.

Per-command flags win so an explicit `--api-key staging-token` is never silently
overridden by a stale `LAUNCHDARKLY_API_TOKEN` in the user's shell.

## Usage

```bash
~/.pi/agent/skills/launchdarkly/bin/ld.sh [global-flags] <command> [args]
```

In Pi, invoke this skill explicitly with:

```text
/skill:launchdarkly <request>
```

## Global flags

| Flag                  | Description                                        |
| --------------------- | -------------------------------------------------- |
| `--profile <name>`    | Use a specific profile for this command            |
| `--api-key <token>`   | Override API token                                 |
| `--environment <env>` | Override target environment (e.g. test/staging/production) |
| `--project <key>`     | Override project key (default: `default`)          |

## Commands

| Command | Description |
| --- | --- |
| `me` | Sanity check — returns caller identity |
| `config create <name> --api-key <t> [--environment <e>] [--project <k>]` | Create a profile |
| `config set profile <name>` | Set active profile |
| `config set environment <env>` | Update active profile's `defaultEnvironment` |
| `config get profile` | Show active profile (apiKey redacted) |
| `config list` | List profiles (* = active) |
| `config delete <name>` | Delete a profile |
| `project list` | List all projects |
| `project get [<key>]` | Get project details |
| `environment list [--project <k>]` | List environments |
| `flag list [--project <k>] [--env <e>] [--tag <t>] [--limit <n>]` | List feature flags |
| `flag get <key> [--project <k>]` | Get full flag details |
| `flag create --key <k> --name <n> [--description <d>] [--kind boolean\|multivariate] [--variations <json>] [--tag <t>]... [--temporary]` | Create a flag |
| `flag update <key> [--name <n>] [--description <d>] [--add-tag <t>] [--remove-tag <t>]` | Update flag metadata |
| `flag delete <key>` | Delete a flag |
| `flag on <key> [--env <e>] [--project <k>] [--comment <text>]` | Turn flag on in an environment |
| `flag off <key> [--env <e>] [--project <k>] [--comment <text>]` | Turn flag off in an environment |
| `flag status <key> [--env <e>] [--project <k>]` | Get flag status (new / active / launched / inactive) |
| `flag rollout <key> --percentage <0-100> [--env <e>] [--project <k>]` | Set fallthrough rollout % (true variation) |

For boolean flags, default variations are `[{value:true,name:"On"},{value:false,name:"Off"}]`.
For multivariate flags, pass `--variations` as a JSON array.

## Repo integration — ALWAYS ask first

After **creating** a new flag in LaunchDarkly, you MUST ask the user:

> "Want me to wire this flag into the repo too, or just leave it in LaunchDarkly?"

If they say yes, then ask:

> "Backend (NestJS service), frontend (valet/concierge), or both?"

Then follow the steps in [`references/repo-integration.md`](references/repo-integration.md).

**Never wire a flag into code without explicit confirmation in the current turn.**
A wiring instruction in the original prompt does not count — ask anyway. The user
often creates flags ahead of implementation and wants them to exist in LD only at first.

## Key rules

- **Flag keys are kebab-case.** `claim-automation`, `warranty-exclusions`,
  `yofi-v2-data-api-be`. The script does not enforce this; you must.
- **Backend-only flags get a `-be` suffix** (existing convention in
  `libs/shared/constants/feature-flags.ts`). Example: `notifications-be`.
- The default LD project key for this org is `default`. Don't pass `--project`
  unless the user explicitly says otherwise.
- LD environment names in this org: `test`, `staging`, `production`.
- When wiring a flag into the repo, **always** add the key to the
  `FEATURE_FLAGS` constant in `libs/shared/constants/feature-flags.ts` first —
  both backend and frontend read from this single source.
- Authorization header is the raw token (no `Bearer` prefix). The script handles this.
- Requires `curl` and `jq`.

## References

- [LaunchDarkly REST API reference](references/api-reference.md)
- [Repo integration playbook](references/repo-integration.md)
