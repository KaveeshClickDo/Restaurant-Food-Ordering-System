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
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appDir       = join(dirname(fileURLToPath(import.meta.url)), "..");
const routesDir    = join(appDir, "src", "app");
const quarantine   = join(appDir, ".cap-quarantine");

// Minimal .env parser for the APK-only env file (KEY=VALUE, "#" comments).
// Dependency-free. These values are merged into the build env below and — because
// Next does NOT override already-set process.env vars — they win over .env.local.
// That's how the APK build targets PRODUCTION Supabase without touching the dev
// env used by `npm run dev` / the website build.
function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (let raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

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
    try {
      renameSync(join(routesDir, name), join(quarantine, name));
    } catch (e) {
      if (e && (e.code === "EPERM" || e.code === "EBUSY")) {
        throw new Error(
          `\n[build:capacitor] Could not move src/app/${name} — a file lock is holding it.\n` +
          `   Stop the dev server (Ctrl+C in the 'npm run dev' terminal) and re-run.\n` +
          `   Next's dev server locks src/app on Windows, which blocks the route quarantine.\n`,
        );
      }
      throw e;
    }
    moved.push(name);
  }
  console.log(`[build:capacitor] quarantined ${moved.length} non-POS entries:`, moved.join(", "));

  // The export bundles no /api/* routes, so apiBase() must point POS fetches at
  // the deployed backend. Inline CAPACITOR_API_URL as NEXT_PUBLIC_API_BASE_URL.
  // (Deliberately NOT CAPACITOR_SERVER_URL — that var flips capacitor.config.ts
  // into server mode at `npx cap sync`, the opposite of a bundled build.)
  // APK-only env: app/.env.capacitor OVERRIDES .env.local for THIS build only.
  // Put the PRODUCTION values here (CAPACITOR_API_URL + NEXT_PUBLIC_SUPABASE_URL
  // + NEXT_PUBLIC_SUPABASE_ANON_KEY) so the installed app's /api calls AND its
  // direct Supabase reads/realtime both hit prod — without changing the dev
  // env used by `npm run dev` / the website. NEVER put SUPABASE_SERVICE_ROLE_KEY
  // here; it must never ship in a client.
  const capEnv  = loadEnvFile(join(appDir, ".env.capacitor"));
  const capKeys = Object.keys(capEnv);
  if (capKeys.length) {
    console.log(`[build:capacitor] loaded .env.capacitor (${capKeys.length} vars): ${capKeys.join(", ")}`);
  } else {
    console.warn(
      "[build:capacitor] no app/.env.capacitor found — using .env.local. That's fine " +
      "for LOCAL testing, but a PROD APK should have .env.capacitor with prod values.",
    );
  }

  // CAPACITOR_API_URL can come from .env.capacitor or the shell (shell wins if both).
  const apiUrl = (process.env.CAPACITOR_API_URL ?? capEnv.CAPACITOR_API_URL ?? "").replace(/\/$/, "");
  if (!apiUrl) {
    console.warn(
      "[build:capacitor] WARNING: CAPACITOR_API_URL not set — apiBase() will be " +
      "empty, so the bundled APK cannot reach the backend. Set it in .env.capacitor " +
      "(CAPACITOR_API_URL=https://demo.directdine.tech) or the shell.",
    );
  }

  execSync("next build", {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...capEnv,                 // APK-only overrides (prod Supabase, API URL)
      CAPACITOR_BUILD: "1",
      NEXT_PUBLIC_API_BASE_URL: apiUrl,
    },
  });

  // Capacitor's webDir entry point must be index.html at the root of out/, but
  // the export only produced out/pos/index.html (the / home route is
  // quarantined). Write a tiny root redirect so the APK opens into the POS.
  const outIndex = join(appDir, "out", "index.html");
  // Redirect to the EXPLICIT index.html FILE with an ABSOLUTE path. Capacitor's
  // local server serves real files directly but does NOT resolve a folder path
  // like "/pos/" to "/pos/index.html" — it SPA-falls-back to root index.html,
  // which (with a relative redirect) caused an infinite /pos/pos/pos/… loop.
  writeFileSync(
    outIndex,
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Restaurant POS</title>
<meta http-equiv="refresh" content="0; url=/pos/index.html">
<script>location.replace("/pos/index.html");</script>
</head><body></body></html>
`,
  );
  console.log("[build:capacitor] wrote out/index.html (redirect → /pos/index.html).");
} finally {
  restore();
  console.log("[build:capacitor] restored quarantined routes.");
}
