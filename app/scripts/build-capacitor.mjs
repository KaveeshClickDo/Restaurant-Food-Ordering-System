// Capacitor static-export build (Phase 1.5).
//
// `output: "export"` is global — Next tries to export EVERY route, but the app
// has ~80 /api/* route handlers and many dynamic SSR pages that cannot be
// statically exported. So we quarantine every route except the POS ones for the
// duration of the build, run `CAPACITOR_BUILD=1 next build`, then restore.
//
// Safety: the quarantined dirs are all committed to git, so an interrupted run
// can always be recovered with `git checkout -- src/app`. The script also
// restores on startup if a previous run left the quarantine behind.
//
// Run with: npm run build:capacitor

import { execSync } from "node:child_process";
import {
  existsSync, mkdirSync, readdirSync, renameSync, rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir       = join(dirname(fileURLToPath(import.meta.url)), "..");
const routesDir    = join(appDir, "src", "app");
const quarantine   = join(appDir, ".cap-quarantine");

// Everything the POS export needs. Anything in src/app NOT listed here is moved
// out before the build and moved back after.
const KEEP = new Set([
  "pos",            // /pos and /pos/login
  "layout.tsx",     // root layout (required)
  "globals.css",
  "error.tsx",
  "global-error.tsx",
  "not-found.tsx",
  "favicon.ico",
  "types.d.ts",
]);

function restore() {
  if (!existsSync(quarantine)) return;
  for (const name of readdirSync(quarantine)) {
    const from = join(quarantine, name);
    const to   = join(routesDir, name);
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    renameSync(from, to);
  }
  rmSync(quarantine, { recursive: true, force: true });
}

// Recover from any prior interrupted run before we start.
restore();

const moved = [];
try {
  mkdirSync(quarantine, { recursive: true });
  for (const name of readdirSync(routesDir)) {
    if (KEEP.has(name)) continue;
    renameSync(join(routesDir, name), join(quarantine, name));
    moved.push(name);
  }
  console.log(`[build:capacitor] quarantined ${moved.length} non-POS entries:`, moved.join(", "));

  // The export bundles no /api/* routes, so apiBase() must point POS fetches at
  // the deployed backend. Inline the server URL (from CAPACITOR_SERVER_URL —
  // the same var capacitor.config.ts uses) as NEXT_PUBLIC_API_BASE_URL.
  const serverUrl = (process.env.CAPACITOR_SERVER_URL ?? "").replace(/\/$/, "");
  if (!serverUrl) {
    console.warn(
      "[build:capacitor] WARNING: CAPACITOR_SERVER_URL not set — apiBase() will " +
      "be empty, so the bundled APK cannot reach the backend. Set it for a real " +
      "build, e.g. CAPACITOR_SERVER_URL=https://yourapp.vercel.app npm run build:capacitor",
    );
  }

  execSync("next build", {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...process.env,
      CAPACITOR_BUILD: "1",
      NEXT_PUBLIC_API_BASE_URL: serverUrl,
    },
  });
} finally {
  restore();
  console.log("[build:capacitor] restored quarantined routes.");
}
