# Personal Pi Agent Preferences

## Git Commits

- Always use Conventional Commits in the form:

  ```text
  (fix|feat|chore)(scope): short-description
  ```

  Examples:

  ```text
  fix(ci): wire build environment suffix to app settings
  feat(auth): add password reset deep link handling
  chore(deps): update MAUI workload pin
  ```

- Include a descriptive commit body for every commit.
- The commit body should explain:
  - what changed
  - why the change was made
  - any important context, tradeoffs, or validation notes
- Treat commit bodies as living documentation. They should be complete enough for other developers and future agents to understand and track the work without relying only on the diff.

## Pull Requests

- PR titles should also follow the Conventional Commit pattern:

  ```text
  (fix|feat|chore)(scope): short-description
  ```

- Use a concise but descriptive scope when one is obvious, such as `ci`, `auth`, `mobile`, `ios`, `android`, or the feature/module name.
- Prefer lowercase short descriptions with no trailing period.

## Durable Memory

- When a stable user preference, repo convention, repeated workflow fact, or durable project constraint emerges, consider using the `retain` tool.
- Use project-scoped memories for repository-specific facts and global memories for cross-repository user preferences.
- Ask before retaining subjective, sensitive, ambiguous, or potentially stale information.
- Never retain secrets, credentials, temporary task state, speculative conclusions, or one-off debugging observations.
