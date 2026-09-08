// Copies the two things Next deliberately leaves out of a standalone build.
//
// next.config.mjs sets output: "standalone", which emits a self-contained
// server at .next/standalone/apps/web/server.js with its own pruned
// node_modules — but Next does NOT copy `public/` or `.next/static/` into it.
// That is documented behaviour, not a bug: the deploy step is expected to
// place them, because a real deployment often serves them from a CDN instead.
//
// Confirmed failure mode when they are missing (verified by running it): every
// page returns 200 and every API route works, but /_next/static/chunks/*.js,
// /manifest.json and /sw.js all 404. The result looks alive and is not — the
// server-rendered HTML arrives, React never hydrates, so nothing on the page
// responds to a click, and the PWA can't install. Dockerfile's `web` stage
// already copies both explicitly; this script is what makes a local
// `npm run build && npm start` behave the same way.
//
// Runs as apps/web's postbuild. Safe to run when there is no standalone
// output (it exits quietly), so it doesn't break a build with a different
// output mode.

import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const standaloneRoot = join(".next", "standalone", "apps", "web");

if (!existsSync(standaloneRoot)) {
  // Not a standalone build — nothing to do.
  process.exit(0);
}

const copies = [
  { from: "public", to: join(standaloneRoot, "public") },
  { from: join(".next", "static"), to: join(standaloneRoot, ".next", "static") },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.warn(`[standalone] skipped missing ${from}`);
    continue;
  }
  cpSync(from, to, { recursive: true });
  console.log(`[standalone] copied ${from} -> ${to}`);
}
