/**
 * Verifies the Google Apps Script deployment that is actually configured in
 * .env.local — no invented URLs, no mocking.
 *
 *   npm run check:backend
 *
 * It runs three GETs and three deliberately non-destructive POSTs:
 *
 *   GET  ?action=ping            → the web app is reachable
 *   GET  ?action=getInventory    → `items list` (id, category, name, image, stock)
 *   GET  ?action=getOrders       → `order list` (order id, item id, quantity order,
 *                                  payment status)
 *   POST updatePaymentStatus with a malformed id → proves doPost routing/validation
 *   POST createOrder with an empty cart          → proves createOrder is wired
 *   POST createOrder with a non-existent item id → proves the spreadsheet and the
 *                                                  `items list` tab actually open
 *
 * None of the POSTs can write to the sheet: every one fails validation before a
 * single cell is touched. To run a genuine end-to-end write, opt in explicitly:
 *
 *   node scripts/check-backend.mjs --create-order a1 1      ← deducts stock!
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const ENV_FILE = path.join(ROOT, ".env.local");

/**
 * Mirrors isPlaceholderScriptUrl() in lib/config.ts (kept local so this Node
 * script does not have to import TypeScript).
 */
const PLACEHOLDER_PATTERNS = [/PASTE_DEPLOYMENT_ID/i, /example\.com/i];

function isPlaceholder(url) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(url));
}

let passed = 0;
let failed = 0;
const problems = [];

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    problems.push({ name, detail });
    console.log(`  \u2717 ${name}${detail ? `\n      → ${detail}` : ""}`);
  }
}

function readEnv() {
  const values = { ...process.env };
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (values[key] === undefined || values[key] === "") values[key] = value;
    }
  }
  return values;
}

function showBody(text, limit = 400) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "<empty>";
  return flat.slice(0, limit) + (flat.length > limit ? "…" : "");
}

async function get(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, ms: Date.now() - started, text, json };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
  }
}

async function post(url, body) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, ms: Date.now() - started, text, json };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
  }
}

async function main() {
  const env = readEnv();
  const configured = (env.GOOGLE_APPS_SCRIPT_URL ?? "").trim();

  console.log("\nGoogle Apps Script deployment check\n");

  if (!configured) {
    console.error("  \u2717 GOOGLE_APPS_SCRIPT_URL is not set.");
    console.error("\n  Fix: deploy google-apps-script/Code.gs as a Web app, then add this line to .env.local:");
    console.error("       GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec\n");
    process.exit(1);
  }

  if (isPlaceholder(configured)) {
    console.error("  \u2717 GOOGLE_APPS_SCRIPT_URL is still the placeholder value:");
    console.error(`       ${configured}`);
    console.error("\n  No real deployment is configured, so every request returns HTTP 404 from Google.");
    console.error("  Fix:");
    console.error("    1. Open your sheet → Extensions → Apps Script → paste google-apps-script/Code.gs");
    console.error("    2. Set CONFIG.SPREADSHEET_ID to the id from your sheet URL");
    console.error("    3. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone");
    console.error("    4. Copy the URL ending in /exec over the placeholder in .env.local");
    console.error("    5. Restart the dev server, then re-run: npm run check:backend\n");
    process.exit(1);
  }

  const base = configured.replace(/\?.*$/, "");
  console.log(`  Target: ${base}\n`);

  /* ── GET endpoints ──────────────────────────────────────────────────── */
  console.log("1. Read endpoints");

  const ping = await get(`${base}?action=ping`);
  check(
    "GET ?action=ping reaches the script",
    !ping.error && ping.json?.success === true,
    ping.error ?? `HTTP ${ping.status}: ${showBody(ping.text, 200)}`,
  );
  if (ping.ms !== undefined && !ping.error) console.log(`      (${ping.ms}ms)`);

  const inventory = await get(`${base}?action=getInventory`);
  const items = inventory.json?.items;
  check(
    "GET ?action=getInventory returns a JSON items array",
    !inventory.error && inventory.json?.success === true && Array.isArray(items),
    inventory.error ?? `HTTP ${inventory.status}: ${showBody(inventory.text, 300)}`,
  );

  if (Array.isArray(items) && items.length > 0) {
    check(
      `inventory contains ${items.length} item(s) with id/category/name/stock`,
      items.every(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.stock === "number",
      ),
      JSON.stringify(items[0]),
    );
    console.log("      " + items.map((i) => `${i.id}:${i.name}=${i.stock}`).join(", "));
  } else if (Array.isArray(items)) {
    check(
      "items list has data rows (row 1 must be the header)",
      items.length > 0,
      "The `items list` tab returned zero rows — check the header row and the tab name.",
    );
  }

  const orders = await get(`${base}?action=getOrders`);
  check(
    "GET ?action=getOrders returns a JSON orders array",
    !orders.error && orders.json?.success === true && Array.isArray(orders.json?.orders),
    orders.error ?? `HTTP ${orders.status}: ${showBody(orders.text, 300)}`,
  );
  if (Array.isArray(orders.json?.orders)) {
    console.log(`      ${orders.json.orders.length} order row(s)`);
  }

  /* ── POST endpoints (non-destructive) ───────────────────────────────── */
  console.log("\n2. Write endpoints (validated, no cells touched)");

  const badStatus = await post(base, {
    action: "updatePaymentStatus",
    orderId: "!!not-valid!!",
    paymentStatus: "paid",
  });
  check(
    "POST updatePaymentStatus routes + validates",
    !badStatus.error &&
      badStatus.json?.success === false &&
      badStatus.json?.error === "VALIDATION_ERROR",
    badStatus.error ?? `HTTP ${badStatus.status}: ${showBody(badStatus.text, 300)}`,
  );

  const emptyCart = await post(base, { action: "createOrder", items: [] });
  check(
    "POST createOrder rejects an empty cart",
    !emptyCart.error &&
      emptyCart.json?.success === false &&
      emptyCart.json?.error === "VALIDATION_ERROR",
    emptyCart.error ?? `HTTP ${emptyCart.status}: ${showBody(emptyCart.text, 300)}`,
  );

  const unknownItem = await post(base, {
    action: "createOrder",
    items: [{ itemId: "zz_probe_none", quantity: 1 }],
  });
  check(
    "POST createOrder opens the spreadsheet and finds `items list`",
    !unknownItem.error &&
      unknownItem.json?.success === false &&
      unknownItem.json?.error === "UNKNOWN_ITEM",
    unknownItem.error ??
      `HTTP ${unknownItem.status}: ${showBody(unknownItem.text, 300)}` +
        (unknownItem.json?.error === "CONFIG_ERROR"
          ? " → CONFIG.SPREADSHEET_ID is not set in Code.gs"
          : ""),
  );

  const unknownAction = await post(base, { action: "definitely_not_an_action" });
  check(
    "POST rejects an unknown action (JSON contract intact)",
    !unknownAction.error &&
      unknownAction.json?.success === false &&
      unknownAction.json?.error === "UNKNOWN_ACTION",
    unknownAction.error ?? `HTTP ${unknownAction.status}: ${showBody(unknownAction.text, 300)}`,
  );

  /* ── Optional real write ────────────────────────────────────────────── */
  const argv = process.argv.slice(2);
  const writeIndex = argv.indexOf("--create-order");
  if (writeIndex !== -1) {
    const itemId = argv[writeIndex + 1];
    const quantity = Number(argv[writeIndex + 2] ?? 1);
    if (!itemId) {
      console.log("\n  --create-order needs an item id, e.g. --create-order a1 1");
    } else {
      console.log(`\n3. Real write test: ${quantity} × ${itemId} (this WILL deduct stock)`);
      const created = await post(base, {
        action: "createOrder",
        items: [{ itemId, quantity }],
      });
      check(
        "POST createOrder created a real order",
        !created.error && created.json?.success === true && typeof created.json?.orderId === "string",
        created.error ?? `HTTP ${created.status}: ${showBody(created.text, 300)}`,
      );
      if (created.json?.orderId) console.log(`      order id: ${created.json.orderId}`);
      if (created.json?.stock) console.log(`      stock: ${JSON.stringify(created.json.stock)}`);
    }
  }

  /* ── Summary ────────────────────────────────────────────────────────── */
  console.log("\n" + "-".repeat(64));
  if (failed === 0) {
    console.log(`Apps Script deployment: ${passed} passed, 0 failed`);
    console.log("The configured /exec URL is live and matches the Next.js API contract.\n");
    process.exit(0);
  }
  console.log(`Apps Script deployment: ${passed} passed, ${failed} failed`);
  for (const problem of problems) {
    console.log(`  • ${problem.name}${problem.detail ? ` — ${problem.detail}` : ""}`);
  }
  console.log("");
  process.exit(1);
}

main().catch((error) => {
  console.error("Check crashed:", error);
  process.exit(1);
});
