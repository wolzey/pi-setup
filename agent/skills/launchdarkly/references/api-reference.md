# LaunchDarkly REST API v2 Reference

The bits of <https://launchdarkly.com/docs/api> that this skill actually depends
on. Use this when `bin/ld.sh` doesn't cover a case and you need to fall through
to a raw `curl`.

## Base

| Region   | Base URL                                |
| -------- | --------------------------------------- |
| Standard | `https://app.launchdarkly.com/api/v2`   |
| EU       | `https://app.eu.launchdarkly.com/api/v2`|
| Federal  | `https://app.launchdarkly.us/api/v2`    |

## Authentication

```
Authorization: <access-token>
```

The token is sent **raw** — there is no `Bearer ` prefix. Tokens come from
<https://app.launchdarkly.com/settings/authorization>. SDK keys and mobile keys
**cannot** be used here.

## Required headers

```
Authorization: <token>
LD-API-Version: 20240415
Content-Type: application/json
Accept: application/json
```

For semantic patch requests, set:

```
Content-Type: application/json; domain-model=launchdarkly.semanticpatch
```

`LD-API-Version` is required since the 20240415 release introduced breaking
pagination changes. For beta endpoints, use `LD-API-Version: beta`.

## Core endpoints

### List flags

```
GET /flags/{projectKey}
```

Query params: `limit`, `offset`, `env`, `tag`, `archived`, `summary`.

### Get a flag

```
GET /flags/{projectKey}/{flagKey}
```

Returns full flag with all environment-specific targeting and variations.

### Create a flag

```
POST /flags/{projectKey}
```

Body (boolean flag, minimum):

```json
{
  "key": "my-flag",
  "name": "My Flag",
  "kind": "boolean",
  "variations": [
    { "value": true,  "name": "On"  },
    { "value": false, "name": "Off" }
  ]
}
```

Optional: `description`, `tags` (array of string), `temporary` (bool),
`clientSideAvailability` (`{ "usingEnvironmentId": bool, "usingMobileKey": bool }`),
`maintainerId`, `defaults` (`{ "onVariation": 0, "offVariation": 1 }`).

For multivariate flags, set `kind: "multivariate"` and pass any number of
variations.

### Update / patch a flag

```
PATCH /flags/{projectKey}/{flagKey}
```

Three patch formats — pick whichever fits:

#### 1. JSON Patch (RFC 6902) — `Content-Type: application/json`

```json
[
  { "op": "replace", "path": "/description", "value": "Updated copy" },
  { "op": "add",     "path": "/tags/-",      "value": "new-tag" }
]
```

#### 2. JSON Merge Patch (RFC 7386) — `Content-Type: application/merge-patch+json`

```json
{ "description": "Updated copy" }
```

#### 3. Semantic Patch (LaunchDarkly) — `Content-Type: application/json; domain-model=launchdarkly.semanticpatch`

Best for environment-targeting changes. Body:

```json
{
  "environmentKey": "production",
  "comment": "optional audit comment",
  "instructions": [
    { "kind": "turnFlagOn" }
  ]
}
```

### Delete a flag

```
DELETE /flags/{projectKey}/{flagKey}
```

### Flag status (per environment)

```
GET /flag-statuses/{projectKey}/{environmentKey}/{flagKey}
```

Returns one of: `new`, `active`, `inactive`, `launched`.

### Projects & environments

```
GET /projects
GET /projects/{projectKey}
GET /projects/{projectKey}/environments
GET /projects/{projectKey}/environments/{envKey}
```

### Caller identity (auth check)

```
GET /caller-identity
```

## Useful semantic-patch instructions

All sent in `instructions: [...]` with `environmentKey` outside the array.

| `kind`                                  | Purpose                                  | Extra fields |
| --------------------------------------- | ---------------------------------------- | ------------ |
| `turnFlagOn` / `turnFlagOff`            | Toggle the flag in an environment        | — |
| `addTags` / `removeTags`                | Mutate tag list                          | `values: string[]` |
| `updateOffVariation`                    | Change the "off" variation               | `variationId` |
| `updateFallthroughVariationOrRollout`   | Set fallthrough rule (single variation OR weighted rollout) | `variationId` **OR** `rolloutWeights: { "0": w0, "1": w1 }` (sums to 100000) |
| `updateClauses`                         | Replace targeting clauses for a rule     | `ruleId`, `clauses` |
| `addUserTargets` / `removeUserTargets`  | Add/remove user keys to a variation list | `variationId`, `values: string[]` |
| `replaceTargetingRules`                 | Replace all targeting rules wholesale    | `rules` |
| `addRule`                               | Append a new rule                        | `clauses`, `variationId` |
| `removeRule`                            | Remove a rule                            | `ruleId` |
| `archiveFlag` / `restoreFlag`           | Archive / unarchive flag                 | — |

For weighted rollout, weights are in `/1000` units — so a 25% rollout to the
`true` variation (index 0) is `{"0": 25000, "1": 75000}`.

## Pagination

Since `LD-API-Version: 20240415`, list endpoints return paginated results:

```
?limit=50&offset=0
```

Response shape:

```json
{
  "items": [...],
  "totalCount": 312,
  "_links": {
    "next": { "href": "/api/v2/flags/default?limit=50&offset=50", "type": "application/json" }
  }
}
```

## Rate limits

LaunchDarkly enforces a 10-second sliding window. Each response includes:

- `X-Ratelimit-Global-Remaining` — remaining requests in your account-wide budget
- `X-Ratelimit-Route-Remaining` — remaining requests for this route
- `X-Ratelimit-Reset` — UNIX timestamp (ms) when the window resets
- `Retry-After` — seconds to wait, sent on 429 responses

When you see 429, back off until `Retry-After`. Specific numeric limits aren't
publicly documented; rely on the headers.

## Common errors

| Status | Meaning |
| ------ | ------- |
| 401    | Invalid / missing token, or SDK key used in place of API token |
| 403    | Token lacks role/permission for this resource |
| 404    | Wrong projectKey, flagKey, or environmentKey |
| 409    | Optimistic-lock conflict — re-fetch and retry the patch |
| 422    | Patch is well-formed but rejected (e.g., turnFlagOn when already on) |
| 429    | Rate limited |
