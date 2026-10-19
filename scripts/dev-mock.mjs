/**
 * Local dev server backed by DUMMY data — no Google account required.
 *
 *   npm run dev:mock
 *
 * Boots two processes:
 *   1. scripts/fake-apps-script.mjs running the REAL google-apps-script/Code.gs
 *      over HTTP, seeded with scripts/lib/demo-seed.mjs.
 *   2. `next dev`, with GOOGLE_APPS_SCRIPT_URL pointed at that local backend
 *      (process env wins over .env.local, so your real URL is left untouched).
 *
 * The app code and the Apps Script code are unchanged: the menu, cart, orders,
 * stock deduction, oversell protection and admin console all run for real, just
 * against the dummy spreadsheet instead of Google Sheets.
 *
 * Env overrides:
 *   MOCK_BACKEND_PORT=4567   MOCK_APP_PORT=3001
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { createFakeBackend } from "./fake-apps-script.mjs";
import { DEMO_SEED } from "./lib/demo-seed.mjs";

const BACKEND_PORT = Number(process.env.MOCK_BACKEND_PORT) || 4567;
const APP_PORT = Number(process.env.MOCK_APP_PORT) || 3001;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

const fake = createFakeBackend({ seed: DEMO_SEED });

let appProcess = null;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[dev:mock] shutting down…");
  if (appProcess && appProcess.pid) {
    await new Promise((resolve) => {
      // Kill the whole tree — next dev spawns children.
      const killer = spawn("taskkill", ["/pid", String(appProcess.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  }
  await fake.close().catch(() => undefined);
  process.exit(exitCode);
}

async function main() {
  await fake.listen(BACKEND_PORT);
  console.log(`[dev:mock] dummy Apps Script backend → ${BACKEND_ORIGIN}/exec`);
  console.log(`[dev:mock] seeded with ${DEMO_SEED.items.length - 1} dummy products\n`);

  // Invoke the Next CLI with the current Node binary directly. This avoids the
  // Windows-only `spawn EINVAL` error you get when spawning .cmd shims.
  const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
  appProcess = spawn(process.execPath, [nextBin, "dev", "-p", String(APP_PORT)], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      GOOGLE_APPS_SCRIPT_URL: `${BACKEND_ORIGIN}/exec`,
    },
  });

  appProcess.on("exit", (code) => {
    void shutdown(code ?? 0);
  });

  console.log(`[dev:mock] Next.js dev server on http://localhost:${APP_PORT}`);
  console.log("[dev:mock] Press Ctrl+C to stop both servers.\n");
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

main().catch(async (error) => {
  console.error("[dev:mock] failed to start:", error && error.message ? error.message : error);
  await shutdown(1);
});
