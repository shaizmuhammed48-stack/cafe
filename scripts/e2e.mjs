/**
 * End-to-end tests for the whole stack.
 *
 * Boots two real servers:
 *   1. scripts/fake-apps-script.mjs  — the actual google-apps-script/Code.gs
 *      running behind an HTTP /exec endpoint.
 *   2. `next start`                  — the production Next.js build, pointed at
 *      the fake backend via GOOGLE_APPS_SCRIPT_URL.
 *
 * Then drives the Next.js API + auth + middleware over HTTP exactly the way the
 * browser does, and asserts that stock is deducted, oversells are rejected,
 * failures are never reported as success and concurrent orders cannot oversell.
 *
 *   npm run build && npm run test:e2e
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createFakeBackend } from "./fake-apps-script.mjs";
import { SEED } from "./lib/gs-runtime.mjs";

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT) || 4567;
const APP_PORT = Number(process.env.E2E_APP_PORT) || 3100;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "madco-admin";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  \u2717 ${name}${detail ? `\n      → ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ── HTTP helpers ────────────────────────────────────────────────────────── */

async function api(path, options = {}) {
  const response = await fetch(`${APP_ORIGIN}${path}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null for non-JSON responses */
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function postJson(path, body, headers = {}) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

async function backend(path, options = {}) {
  const response = await fetch(`${BACKEND_ORIGIN}${path}`, options);
  const text = await response.text();
  return { status: response.status, text, json: safeJson(text) };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function resetBackend(seed) {
  await backend("/__reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seed ?? {}),
  });
}

async function setBackendMode(mode) {
  await backend("/__mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

async function stockOf(itemId) {
  const response = await backend("/__state");
  const row = response.json.items.find(
    (entry, index) => index > 0 && String(entry[0]).trim() === itemId,
  );
  return row ? Number(row[4]) : null;
}

async function orderRows() {
  const response = await backend("/__state");
  return response.json.orders;
}

function findItem(items, id) {
  return items.find((item) => item.id === id);
}

/* ── Server lifecycle ────────────────────────────────────────────────────── */

let appProcess = null;

async function waitForApp(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_ORIGIN}/api/admin/session`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  throw new Error(`Next.js server did not become ready within ${timeoutMs}ms`);
}

async function killTree(pid) {
  if (!pid) return;
  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    killer.on("exit", resolve);
    killer.on("error", resolve);
  });
}

/* ── Suite ───────────────────────────────────────────────────────────────── */

async function main() {
  console.log("Starting fake Apps Script backend…");
  const fake = createFakeBackend();
  await fake.listen(BACKEND_PORT);

  console.log("Starting Next.js production server…");
  // Invoke the Next CLI with the current Node binary directly. This avoids the
  // Windows-only `spawn EINVAL` error you get when spawning .cmd shims.
  const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
  appProcess = spawn(
    process.execPath,
    [nextBin, "start", "-p", String(APP_PORT), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        GOOGLE_APPS_SCRIPT_URL: `${BACKEND_ORIGIN}/exec`,
        // The E2E suite exercises the legacy `?action=…` contract, so make sure
        // the separate `?type=…` data layer (APPS_SCRIPT_URL in .env.local) is
        // never contacted — an empty value keeps the legacy `/api/orders` path.
        APPS_SCRIPT_URL: "",
        ADMIN_PASSWORD,
      },
    },
  );

  let serverLog = "";
  appProcess.stdout.on("data", (chunk) => {
    serverLog += chunk.toString();
  });
  appProcess.stderr.on("data", (chunk) => {
    serverLog += chunk.toString();
  });

  try {
    await waitForApp();

    /* ── 1. Inventory via the Next.js API ──────────────────────────────── */
    section("1. Inventory API (GET /api/inventory)");
    await resetBackend();
    {
      const response = await api("/api/inventory");
      check("responds 200", response.status === 200, `got ${response.status}`);
      check("success flag is true", response.json?.success === true);
      const items = response.json?.items ?? [];
      check("returns six products", items.length === 6, `got ${items.length}`);
      check("pizza (a1) stock is 78", findItem(items, "a1")?.stock === 78);
      check("coffee (a5) stock is 30", findItem(items, "a5")?.stock === 30);
      check("item names come from the sheet", findItem(items, "a1")?.name === "pizza");
      check(
        "categories come from the sheet",
        findItem(items, "a1")?.category === "snacks" &&
          findItem(items, "a6")?.category === "beverages",
      );
    }

    /* ── 2. Ordering page renders ──────────────────────────────────────── */
    section("2. Ordering page (GET /)");
    {
      const response = await api("/");
      check("responds 200", response.status === 200, `got ${response.status}`);
      check(
        "is the ordering screen",
        /order|menu|cart/i.test(response.text),
        "no ordering copy found in HTML",
      );
    }

    /* ── 3. Create order deducts stock + persists ──────────────────────── */
    section("3. Create order (POST /api/orders) — pizza 78 → 77");
    await resetBackend();
    {
      const response = await postJson("/api/orders", {
        items: [{ itemId: "a1", quantity: 1 }],
      });
      check("responds 201", response.status === 201, `got ${response.status}`);
      check("success flag is true", response.json?.success === true);
      check(
        "returns generated order id OR007",
        response.json?.orderId === "OR007",
        `got ${response.json?.orderId}`,
      );
      check(
        "returned stock snapshot reports 77",
        response.json?.stock?.a1 === 77,
        JSON.stringify(response.json?.stock),
      );
      check("pizza stock is 77 in the sheet", (await stockOf("a1")) === 77);
      check("pizza stock is 77 via the API", findItem((await api("/api/inventory")).json.items, "a1")?.stock === 77);

      const rows = await orderRows();
      const newRow = rows.find((row) => row[0] === "OR007");
      check("a new row was appended for OR007", Boolean(newRow), JSON.stringify(rows));
      check(
        "the appended row is [OR007, a1, 1, pending]",
        newRow && newRow[1] === "a1" && String(newRow[2]) === "1" && newRow[3] === "pending",
        JSON.stringify(newRow),
      );
      check(
        "existing records OR001…OR006 are untouched",
        rows.filter((row) => row[0] === "OR001").length === 1,
      );

      const orders = (await api("/api/orders")).json?.orders ?? [];
      const enriched = orders.find((order) => order.orderId === "OR007");
      check("GET /api/orders shows OR007", Boolean(enriched));
      check(
        "item name is resolved from inventory",
        enriched?.itemName === "pizza",
        `got ${enriched?.itemName}`,
      );
    }

    /* ── 4. Persistence across requests ────────────────────────────────── */
    section("4. Refresh safety");
    {
      const first = findItem((await api("/api/inventory")).json.items, "a1");
      const second = findItem((await api("/api/inventory")).json.items, "a1");
      check("stock survives a second read (77)", first?.stock === 77 && second?.stock === 77);
      const orders = (await api("/api/orders")).json?.orders ?? [];
      check("the confirmed order survives a reload", orders.some((o) => o.orderId === "OR007"));
    }

    /* ── 5. Oversell + invalid quantity protection ─────────────────────── */
    section("5. Oversell + invalid quantity");
    {
      const over = await postJson("/api/orders", {
        items: [{ itemId: "a1", quantity: 999 }],
      });
      check("oversell is rejected with 409", over.status === 409, `got ${over.status}`);
      check("oversell reports failure", over.json?.success === false);
      check(
        "oversell error code is OUT_OF_STOCK",
        over.json?.error === "OUT_OF_STOCK",
        `got ${over.json?.error}`,
      );
      check("stock is unchanged after an oversell (77)", (await stockOf("a1")) === 77);

      for (const quantity of [0, -3, 2.5, "3", null]) {
        const bad = await postJson("/api/orders", {
          items: [{ itemId: "a1", quantity }],
        });
        check(
          `quantity ${JSON.stringify(quantity)} is rejected with 400`,
          bad.status === 400,
          `got ${bad.status}`,
        );
        check(
          `quantity ${JSON.stringify(quantity)} does not change stock`,
          (await stockOf("a1")) === 77,
        );
      }

      const empty = await postJson("/api/orders", { items: [] });
      check("empty cart is rejected with 400", empty.status === 400, `got ${empty.status}`);
    }

    /* ── 6. Multi-product order is one transaction ─────────────────────── */
    section("6. Multi-product order");
    await resetBackend();
    {
      const response = await postJson("/api/orders", {
        items: [
          { itemId: "a1", quantity: 1 },
          { itemId: "a5", quantity: 2 },
        ],
      });
      check("responds 201", response.status === 201, `got ${response.status}`);
      check(
        "one shared order id is generated (OR007)",
        response.json?.orderId === "OR007",
        `got ${response.json?.orderId}`,
      );
      check("pizza 78 → 77", (await stockOf("a1")) === 77);
      check("coffee 30 → 28", (await stockOf("a5")) === 28);

      const rows = (await orderRows()).filter((row) => row[0] === "OR007");
      check("both line items share the order id", rows.length === 2, `got ${rows.length}`);
      check(
        "quantities are recorded per line",
        rows.some((row) => row[1] === "a1" && String(row[2]) === "1") &&
          rows.some((row) => row[1] === "a5" && String(row[2]) === "2"),
      );
    }

    /* ── 7. All-or-nothing: one bad line blocks the whole order ────────── */
    section("7. All-or-nothing validation");
    await resetBackend();
    {
      const response = await postJson("/api/orders", {
        items: [
          { itemId: "a1", quantity: 1 },
          { itemId: "a2", quantity: 9999 },
        ],
      });
      check("mixed valid/invalid order is rejected", response.status === 409, `got ${response.status}`);
      check("pizza was NOT deducted (still 78)", (await stockOf("a1")) === 78);
      check("fries are unchanged (still 20)", (await stockOf("a2")) === 20);
      check(
        "no order row was appended",
        !(await orderRows()).some((row) => row[0] !== "" && !SEED.orders.flat().includes(row[0])),
      );
    }

    /* ── 8. Backend write failure rolls back and is never "success" ────── */
    section("8. Backend write failure");
    await resetBackend();
    {
      await backend("/__fail-next-append", { method: "POST" });
      const response = await postJson("/api/orders", {
        items: [{ itemId: "a1", quantity: 2 }],
      });
      check("does not report success", response.json?.success === false);
      check("responds 5xx", response.status >= 500, `got ${response.status}`);
      check("stock is restored to 78", (await stockOf("a1")) === 78);
      check("no order row was written", (await orderRows()).length === SEED.orders.length);
    }

    /* ── 9. Unreachable / malformed backend is never faked ─────────────── */
    section("9. Unreachable / malformed backend");
    for (const mode of ["http500", "html", "garbage"]) {
      await setBackendMode(mode);
      const inventory = await api("/api/inventory");
      check(
        `inventory fails (${mode}) instead of faking data`,
        inventory.json?.success === false && inventory.status >= 500,
        `status ${inventory.status}`,
      );
      const order = await postJson("/api/orders", { items: [{ itemId: "a1", quantity: 1 }] });
      check(
        `order fails (${mode}) instead of reporting success`,
        order.json?.success === false && order.status >= 500,
        `status ${order.status}`,
      );
    }
    await setBackendMode("ok");
    await resetBackend();
    {
      const inventory = await api("/api/inventory");
      check("recovers once the backend is healthy again", inventory.json?.success === true);
    }

    /* ── 10. Same-origin enforcement ───────────────────────────────────── */
    section("10. Same-origin enforcement");
    {
      const crossOrigin = await postJson(
        "/api/orders",
        { items: [{ itemId: "a1", quantity: 1 }] },
        { Origin: "http://evil.example" },
      );
      check("cross-site order is blocked with 403", crossOrigin.status === 403, `got ${crossOrigin.status}`);
      check("cross-site order reports failure", crossOrigin.json?.success === false);
      check("cross-site order did not touch stock", (await stockOf("a1")) === 78);
    }

    /* ── 11. Admin authentication ──────────────────────────────────────── */
    section("11. Admin authentication");
    let adminCookie = "";
    {
      const page = await api("/admin", { redirect: "manual" });
      check(
        "unauthenticated /admin redirects to the login screen",
        [301, 302, 303, 307, 308].includes(page.status) &&
          (page.headers.get("location") ?? "").includes("/admin/login"),
        `status ${page.status} location ${page.headers.get("location")}`,
      );

      const statusGuard = await postJson("/api/orders/status", {
        orderId: "OR001",
        paymentStatus: "paid",
      });
      check(
        "unauthenticated status update is blocked with 401",
        statusGuard.status === 401,
        `got ${statusGuard.status}`,
      );

      const wrong = await postJson("/api/admin/login", { password: "not-the-password" });
      check("wrong password is rejected with 401", wrong.status === 401, `got ${wrong.status}`);

      const login = await postJson("/api/admin/login", { password: ADMIN_PASSWORD });
      check("correct password logs in", login.status === 200 && login.json?.success === true);
      const setCookies =
        typeof login.headers.getSetCookie === "function" ? login.headers.getSetCookie() : [];
      const rawCookie = setCookies[0] ?? login.headers.get("set-cookie") ?? "";
      adminCookie = rawCookie.split(";")[0];
      check("a session cookie was issued", /madco_admin_session=/.test(adminCookie), adminCookie);

      const session = await api("/api/admin/session", {
        headers: { Cookie: adminCookie },
      });
      check("session endpoint reports authenticated", session.json?.authenticated === true);

      const status = await postJson(
        "/api/orders/status",
        { orderId: "OR001", paymentStatus: "paid" },
        { Cookie: adminCookie },
      );
      check("authenticated status update succeeds", status.status === 200, `got ${status.status}`);
      const paidRows = (await orderRows()).filter(
        (row) => row[0] === "OR001" && row[3] === "paid",
      );
      check("the sheet reflects payment status paid", paidRows.length >= 1);

      await resetBackend();
    }

    /* ── 12. Concurrent orders cannot oversell ─────────────────────────── */
    section("12. Concurrent orders cannot oversell");
    await resetBackend({
      items: [
        ["id", "category", "name", "image", "stock"],
        ["a1", "snacks", "pizza", "", 5],
      ],
      orders: [
        ["order id", "item id", "quantity order", "payment status"],
        ["OR001", "a1", 1, "paid"],
      ],
    });
    {
      const attempts = 10;
      const responses = await Promise.all(
        Array.from({ length: attempts }, () =>
          postJson("/api/orders", { items: [{ itemId: "a1", quantity: 1 }] }),
        ),
      );
      const successes = responses.filter((r) => r.status === 201 && r.json?.success === true);
      const rejected = responses.filter((r) => r.status === 409);
      const finalStock = await stockOf("a1");
      const ids = successes.map((r) => r.json.orderId);

      check("exactly five orders succeed", successes.length === 5, `got ${successes.length}`);
      check("the remaining five are rejected", rejected.length === 5, `got ${rejected.length}`);
      check("final stock is exactly 0", finalStock === 0, `got ${finalStock}`);
      check("stock never went negative", finalStock >= 0);
      check("every generated order id is unique", new Set(ids).size === ids.length, ids.join(","));
      check(
        "all order ids start after the seeded OR001",
        ids.every((id) => id !== "OR001"),
        ids.join(","),
      );
    }
    /* ── 13. Single-item-only backend (the deployed sheet script) ──────── */
    section("13. Single-item-only backend (multi-line cart fallback)");
    await resetBackend();
    await setBackendMode("single-item-only");
    {
      // The deployed sheet script refuses `{ items: [...] }` and accepts only one
      // line per request, so a multi-line cart must be split automatically.
      const first = await postJson("/api/orders", {
        items: [
          { itemId: "a1", quantity: 1 },
          { itemId: "a5", quantity: 2 },
        ],
      });
      check("multi-line cart still succeeds (201)", first.status === 201, `got ${first.status}`);
      check("success flag is true", first.json?.success === true);
      const ids = first.json?.orderIds ?? [];
      check("one order id per line is returned", ids.length === 2, JSON.stringify(ids));
      check("the two order ids are distinct", new Set(ids).size === 2, ids.join(","));
      check("pizza 78 → 77", (await stockOf("a1")) === 77);
      check("coffee 30 → 28", (await stockOf("a5")) === 28);

      const rows = (await orderRows()).filter((row) => ids.includes(row[0]));
      check("each line was written as its own order", rows.length === 2, `got ${rows.length}`);
      check(
        "quantities are recorded per line",
        rows.some((row) => row[1] === "a1" && String(row[2]) === "1") &&
          rows.some((row) => row[1] === "a5" && String(row[2]) === "2"),
      );

      const single = await postJson("/api/orders", { items: [{ itemId: "a2", quantity: 1 }] });
      check("single-line cart succeeds", single.status === 201, `got ${single.status}`);
      check("fries 20 → 19", (await stockOf("a2")) === 19);

      const second = await postJson("/api/orders", {
        items: [
          { itemId: "a1", quantity: 1 },
          { itemId: "a2", quantity: 1 },
        ],
      });
      check("a later multi-line cart also succeeds", second.status === 201, `got ${second.status}`);

      const counters = await backend("/__counters");
      check(
        "the unsupported batch shape is probed only once per process",
        counters.json?.singleItemRejections === 1,
        `got ${counters.json?.singleItemRejections}`,
      );
    }
    await setBackendMode("ok");

    /* ── 14. Duplicate sheet rows still render with unique keys ────────── */
    section("14. Duplicate order rows (React key safety)");
    await resetBackend({
      items: [
        ["id", "category", "name", "image", "stock"],
        ["a2", "snacks", "fries", "", 20],
      ],
      orders: [
        ["order id", "item id", "quantity order", "payment status"],
        ["OR001", "a2", 3, "pending"],
        ["OR001", "a2", 3, "pending"],
      ],
    });
    {
      const response = await api("/api/orders");
      const rows = response.json?.orders ?? [];
      check("both duplicate rows are returned", rows.length === 2, `got ${rows.length}`);
      const keys = rows.map((row) => row.rowId);
      check(
        "rowId is present on every row",
        keys.every((key) => typeof key === "string" && key.length > 0),
        JSON.stringify(keys),
      );
      check(
        "rowIds stay unique when orderId+itemId collide",
        new Set(keys).size === keys.length,
        keys.join(","),
      );
    }
    await resetBackend();
  } finally {
    await killTree(appProcess?.pid);
    await fake.close();
  }

  /* ── Summary ─────────────────────────────────────────────────────────── */
  console.log("\n" + "─".repeat(64));
  if (failed === 0) {
    console.log(`End-to-end tests: ${passed} passed, 0 failed`);
    process.exit(0);
  } else {
    console.log(`End-to-end tests: ${passed} passed, ${failed} failed`);
    for (const failure of failures) {
      console.log(`  • ${failure.name}${failure.detail ? ` — ${failure.detail}` : ""}`);
    }
    if (serverLog.trim()) {
      console.log("\nServer log tail:\n" + serverLog.split("\n").slice(-40).join("\n"));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("E2E harness crashed:", error);
  killTree(appProcess?.pid).finally(() => process.exit(1));
});
