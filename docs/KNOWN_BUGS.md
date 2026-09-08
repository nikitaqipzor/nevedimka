# KNOWN_BUGS.md

Track recurring issues and fragile areas.

## Template
### Title
- Symptoms:
- Scope:
- Workaround:
- Suspected cause:
- Status:

## Watchlist
Use this section for risk hotspots even when there is no active bug.

### Auth and Billing
- Symptoms: Regressions here can lock users out or affect money movement.
- Scope: Login, signup, sessions, roles, subscriptions, invoices, webhooks.
- Workaround: Require plan, focused verification, and explicit approval for sensitive changes.
- Suspected cause: High coupling to external services and policy rules.
- Status: High risk surface.

### Schema and RLS
- Symptoms: Data disappears, data leaks, or queries fail for some roles.
- Scope: migrations, policies, generated types, protected queries.
- Workaround: review schema diffs and RLS implications before applying.
- Suspected cause: policy drift, unreviewed migrations, missing role coverage.
- Status: High risk surface.

### Deploy and Monitoring
- Symptoms: app works locally but fails after release, silent production errors, broken env assumptions.
- Scope: Vercel envs, build config, runtime config, Sentry setup.
- Workaround: use at least one broader verification step for deploy-sensitive changes.
- Suspected cause: environment mismatch or missing observability coverage.
- Status: High risk surface.

### RESOLVED — Mini App e2e suite: all browser (page.click/page.goto) tests 401
- Symptoms: every Playwright-driven test in `apps/web/test/e2e.test.ts` that used
  `page.click`/`page.goto` failed with a 401.
- Cause: the dev server the test file spawns didn't set `ALLOW_DEV_AUTH=true`, and
  there is no real Telegram host in the headless browser to produce valid initData
  for the shared `page` object, so `AuthProvider.tsx` blocked all page content.
- Fix: added `ALLOW_DEV_AUTH: "true"` to the spawned dev server's env in
  `apps/web/test/e2e.test.ts`'s `before()` — the app already had a first-class,
  documented dev-only auth bypass in `api/auth/miniapp/route.ts` built for exactly
  this case; the test just never enabled it. Fetch-based tests are unaffected (they
  always send real signed initData, never touching the bypass branch).
- Status: Fixed on `multi-active-goals`. 29 of 30 tests in the file now pass (up
  from 12) — see the follow-on entry below for the one remaining failure this
  uncovered.

### RESOLVED — Mini App e2e suite: "root redirects to /today" test failed on a today-date mismatch
- Symptoms: the very first browser test in `apps/web/test/e2e.test.ts`
  ("root redirects to /today with real data rendered...") showed the check-in form
  instead of the seeded main task — i.e. the server didn't recognize `before()`'s
  seeded check-in as belonging to "today".
- Cause: `before()` computed `today` as `new Date().toISOString().slice(0, 10)` — a
  raw UTC date. The app itself computes "today" via `todayInTimezone(user.timezone)`
  (`apps/web/src/lib/dates.ts`), and the seeded owner user's timezone defaults to
  `Europe/Amsterdam` (`packages/db/migrations/001_init.sql:14`). Near that timezone's
  midnight boundary, UTC-today and Amsterdam-today are different calendar dates, so
  the plan the server looked up/created for "today" didn't match the one `before()`
  seeded a check-in for.
- Fix: `before()` now computes `today` via `todayInTimezone(user.timezone)`, the same
  function the app itself uses, instead of a raw UTC date.
- Status: Fixed on `multi-active-goals`. Full suite now 29/29 (up from 29/30). Newly
  exposed by the `ALLOW_DEV_AUTH` fix above (previously masked — this assertion was
  never reached while every browser test 401'd first).

### Multi-active-goals: mentor chat has no in-app goal selector
- Symptoms: `/api/mentor` requires an explicit `missionId` to address a specific
  goal, but the Mini App mentor screen has no UI to pick one — a user with 2+ active
  missions can only get the multi-goal summary framing, never a goal-specific chat,
  from the UI itself.
- Scope: `apps/web/src/app/mentor/page.tsx`, `apps/web/src/app/api/mentor/route.ts`.
- Workaround: none in-app; the API-level `missionId` param exists and works, it's
  just not wired to any UI control yet.
- Suspected cause: explicitly deferred as a follow-up in the multi-active-goals plan
  (Task 14) — shipping the API contract without the UI affordance was a deliberate
  scoping decision, not an oversight.
- Status: Open follow-up, not a regression.

### Multi-active-goals: content drafts carry no missionId of their own
- Symptoms: publishing content (`apps/bot/src/handlers/content.ts`,
  `apps/web/src/app/api/content/[id]/route.ts`) with 2+ active missions requires the
  caller to disambiguate explicitly (bot: inline keyboard prompt; web: reject with a
  4xx listing active missions) because a `ContentDraft` has no `mission_id` column
  recording which goal it was created for.
- Scope: content-draft creation flow and both publish endpoints.
- Workaround: explicit missionId is required whenever 2+ missions are active; single
  active mission still auto-attributes with no friction.
- Suspected cause: adding `mission_id` to drafts (new migration, set at draft-creation
  time) was explicitly scoped out of the multi-active-goals plan (Tasks 11/16) as a
  larger data-model change; the interim explicit-missionId requirement was the
  accepted minimal fix.
- Status: Open follow-up, not a regression.

### Multi-active-goals: a few defensive branches are untested
- Symptoms: no automated test exercises (a) `/api/settings` for a user with zero
  active missions (the `programLength`/`day0Date: null` branch and the "Нет активной
  цели." render), or (b) the `missions.length === 0` guards added to
  `apps/bot/src/handlers/evening.ts`'s `handleEveningRequest`/`handleEveningReviewText`.
- Scope: `apps/web/src/app/api/settings/route.ts`, `apps/web/src/app/settings/page.tsx`,
  `apps/bot/src/handlers/evening.ts`.
- Workaround: manually verified via code review and type-level reasoning that the
  guards are unreachable-unsafe paths (can't null-pointer), just not exercised
  end-to-end by a test.
- Suspected cause: these are small defensive fallbacks added as follow-up fixes
  after the original plan's task list was written, so no task explicitly called for
  test coverage of the empty-missions edge case in these two files.
- Status: Low-risk gap, flagged by code review; candidate for a future small test
  addition, not blocking.
