# Backend Instructions

Apply these instructions when working in backend, API, database, auth, billing, webhook, or job-related files.

## Rules
- Treat auth, billing, schema, RLS, and production data as high-risk.
- Use migrations for schema changes.
- Explain data impact before destructive or structural changes.
- Prefer small, verifiable backend diffs.
- Keep Stripe, Supabase, and webhook logic isolated from unrelated code paths.
