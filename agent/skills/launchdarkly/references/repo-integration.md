# Repo Integration — How to wire a flag into the monolog monorepo

After creating a flag in LaunchDarkly, **always ask the user** before touching
code. The skill creates the LD flag eagerly; wiring is opt-in.

> "Want me to wire this flag into the repo too, or just leave it in
> LaunchDarkly?"
>
> If yes: "Backend (NestJS service), frontend (valet/concierge), or both?"

The repo follows a single-source pattern: every flag key lives in
`libs/shared/constants/feature-flags.ts`. Both backend and frontend import from
that constant. Always update it first.

---

## Step 1 — Add the flag to `FEATURE_FLAGS` (always)

**File:** `libs/shared/constants/feature-flags.ts`

```typescript
export const FEATURE_FLAGS = {
  // ...existing...
  MY_NEW_FLAG: 'my-new-flag',          // shared / frontend flag
  MY_BACKEND_FLAG: 'my-backend-flag-be', // backend-only — append `-be`
} as const;
```

Naming: SCREAMING_SNAKE_CASE for the constant key, kebab-case for the value
(must match the LD flag key exactly). Backend-only flags get a `-be` suffix on
the value.

---

## Step 2A — Backend (NestJS)

### Verify the service has `FeatureFlagsModule`

Most services already register it. Canonical example:

**File:** `apps/dispatch-svc/src/app.module.ts`

```typescript
import { FeatureFlagsModule } from '@monolog/feature-flags';
import { INJECT_TOKEN, MonologClients } from '@monolog/clients';

FeatureFlagsModule.registerAsync({
  enableWebhook: true,
  syncOnBootstrap: true,
  imports: [ConfigModule, ClientsModule],
  useFactory: (config: ConfigService, clients: MonologClients) => ({
    apiToken: config.getOrThrow<string>('launchdarkly.apiToken'),
    environment: config.getOrThrow<string>('launchdarkly.environment'),
    webhookSecretKey: config.get<string>('launchdarkly.webhookSecretKey'),
    onFlagChange: async (flagKey, value) => { /* react to changes */ },
  }),
  inject: [ConfigService, INJECT_TOKEN],
}),
```

If the service doesn't have `FeatureFlagsModule`:

1. Add `FeatureFlagsModule.registerAsync({...})` to `apps/<svc>/src/app.module.ts`.
2. Create `apps/<svc>/config/launchdarkly.config.ts`:
   ```typescript
   const { LAUNCHDARKLY_API_TOKEN, LAUNCHDARKLY_WEBHOOK_SECRET_KEY, LAUNCHDARKLY_ENVIRONMENT } = process.env;
   export const launchdarklyConfig = {
     launchdarkly: {
       apiToken: LAUNCHDARKLY_API_TOKEN,
       webhookSecretKey: LAUNCHDARKLY_WEBHOOK_SECRET_KEY,
       environment: LAUNCHDARKLY_ENVIRONMENT || 'production',
     },
   };
   ```
3. Register the config in `apps/<svc>/config/index.ts`.
4. Add the env vars to `apps/<svc>/.env.example` (and `.env`):
   ```
   LAUNCHDARKLY_API_TOKEN=
   LAUNCHDARKLY_ENVIRONMENT=test
   LAUNCHDARKLY_WEBHOOK_SECRET_KEY=
   ```

### Inject and read the flag

**Reference pattern:** `apps/dispatch-svc/src/integrations/yofi/yofi.service.ts`

```typescript
import { FeatureFlagsService } from '@monolog/feature-flags';
import { FEATURE_FLAGS } from '@monolog/constants';

@Injectable()
export class YofiService {
  constructor(
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  private async isDataApiEnabled(): Promise<boolean> {
    try {
      return await this.featureFlags.getFeatureFlag<boolean>(
        FEATURE_FLAGS.YOFI_V2_DATA_API_BE,
      );
    } catch (err) {
      this.logger.error(
        `Flag lookup failed, defaulting to disabled: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
```

### React to flag changes in real time

Use the `onFlagChange` factory option in `FeatureFlagsModule.registerAsync`:

```typescript
onFlagChange: async (flagKey, value) => {
  if (flagKey === FEATURE_FLAGS.CLAIM_AUTOMATION && !value) {
    await clients.claims.deactivateAllAutomations();
  }
},
```

---

## Step 2B — Frontend (valet / concierge)

The plumbing already exists — you just consume it.

### Plugin (already in place)

**Files:**
- `apps/valet/src/plugins/launch-darkly.client.ts`
- `apps/concierge/src/plugins/launch-darkly.client.ts`

Both initialize `launchdarkly-js-client-sdk` and provide `$ldClient` to the Nuxt app.

### Composable

**Files:**
- `apps/valet/src/composables/useLaunchDarkly.ts`
- `apps/concierge/src/composables/useLaunchDarkly.ts`

Both wrap `createLaunchDarklyHelpers` from `libs/shared/helpers/launch-darkly.helper.ts`:

```typescript
export function createLaunchDarklyHelpers(ldClient: LDClient) {
  function getFlag(key: string, defaultValue: boolean) {
    return ldClient?.variation(key, defaultValue);
  }
  function onFlagChange(key: string, callback: (value: any) => void) {
    ldClient?.on(`change:${key}`, callback);
  }
  return { getFlag, ldClient, onFlagChange };
}
```

### Use the flag in a component

**Reference:** `apps/valet/src/components/products/ProductsTable.vue`

```vue
<script setup lang="ts">
import { FEATURE_FLAGS } from '@constants';

const { getFlag } = useLaunchDarkly();

const warrantyExclusionsEnabled = computed(() =>
  getFlag(FEATURE_FLAGS.WARRANTY_EXCLUSIONS, false),
);
</script>
```

### Gate an entire page

**Reference:** `apps/valet/src/middleware/feature-flag.ts`

```vue
<script setup lang="ts">
definePageMeta({
  middleware: ['feature-flag'],
  featureFlag: 'DEVELOPER_PLATFORM', // a key from FEATURE_FLAGS
});
</script>
```

The middleware reads `to.meta.featureFlag`, looks it up in `FEATURE_FLAGS`, and
`navigateTo('/')` if the flag is off.

### Frontend env vars

In `apps/<app>/.env` (and `.env.example`):

```
LAUNCHDARKLY_CLIENT_ID=684744bac0b25c09284a9776
LAUNCHDARKLY_USER=anonymous-user
LAUNCHDARKLY_ANONYMOUS=true
```

These are read in `apps/<app>/nuxt.config.ts` `runtimeConfig.public.launchdarkly`.

---

## Step 3 — Verify

After wiring, run only what's actually affected:

```bash
# If a service was changed
pnpm nx run <service>:lint --fix
pnpm nx test <service>

# If valet/concierge was changed
pnpm nx run valet:lint --fix
pnpm nx run valet:test
```

`pnpm nx build typegen` is **not** needed for adding a key to
`FEATURE_FLAGS` — that file is consumed directly through `@monolog/constants`,
not via the typegen pipeline.

---

## Quick decision tree

```
User asks to wire flag?
├── No  → done after `flag create`
└── Yes
    ├── Backend only?
    │   1. Add to FEATURE_FLAGS (with -be suffix)
    │   2. Verify FeatureFlagsModule is registered in target app.module.ts
    │   3. Inject FeatureFlagsService into the service
    │   4. Call getFeatureFlag<boolean>(FEATURE_FLAGS.X, false)
    ├── Frontend only?
    │   1. Add to FEATURE_FLAGS (no -be suffix)
    │   2. const { getFlag } = useLaunchDarkly()
    │   3. getFlag(FEATURE_FLAGS.X, false) in computed
    │   4. (Optional) gate page via middleware: ['feature-flag']
    └── Both?
        1. Add to FEATURE_FLAGS once (no suffix)
        2. Do backend steps 2-4
        3. Do frontend steps 2-4
```
