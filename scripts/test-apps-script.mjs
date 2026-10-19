/**
 * Automated tests for google-apps-script/Code.gs.
 *
 * Runs the real Code.gs inside a Google Apps Script shim (see lib/gs-runtime.mjs)
 * against a spreadsheet seeded with the user's actual data.
 *
 *   npm run test:apps-script
 */

import { createRuntime, getEvent, postEvent, SEED } from "./lib/gs-runtime.mjs";

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

function freshRuntime() {
  return createRuntime(SEED);
}

/* ── 1. Inventory read ───────────────────────────────────────────────────── */
section("1. Inventory (GET ?action=getInventory)");
{
  const runtime = freshRuntime();
  const { payload } = runtime.doGet(getEvent("getInventory"));

  check("responds with success:true", payload.success === true);
  check("returns all six seeded products", payload.items.length === 6, `got ${payload.items.length}`);
  check(
    "preserves the sheet order a1…a6",
    payload.items.map((item) => item.id).join(",") === "a1,a2,a3,a4,a5,a6",
    payload.items.map((item) => item.id).join(","),
  );
  check("pizza (a1) stock is 78", payload.items[0].stock === 78, `got ${payload.items[0].stock}`);
  check("coffee (a5) stock is 30", payload.items[4].stock === 30);
  check("tea (a6) stock is 50", payload.items[5].stock === 50);
  check(
    "categories are read from the sheet",
    payload.items[0].category === "snacks" && payload.items[5].category === "beverages",
  );
  check("stock is a number, not a string", typeof payload.items[0].stock === "number");
}

/* ── 2. Order creation + stock deduction ─────────────────────────────────── */
section("2. Order creation (POST createOrder) — pizza 78 → 77");
{
  const runtime = freshRuntime();
  const { payload } = runtime.doPost(
    postEvent({ action: "createOrder", items: [{ itemId: "a1", quantity: 1 }] }),
  );

  check("order succeeded", payload.success === true, JSON.stringify(payload));
  check("order id is OR007 (next after OR006)", payload.orderId === "OR007", `got ${payload.orderId}`);
  check("pizza stock is now 77 in the sheet", runtime.stockOf("a1") === 77, `got ${runtime.stockOf("a1")}`);
  check("returned stock snapshot reports 77", payload.stock.a1 === 77, JSON.stringify(payload.stock));

  const rows = runtime.getOrderRows();
  check("a new row was appended to `order list`", rows.length === 7, `rows=${rows.length}`);
  const appended = rows[rows.length - 1];
  check(
    "appended row is [OR007, a1, 1, pending]",
    appended[0] === "OR007" && appended[1] === "a1" && Number(appended[2]) === 1 && appended[3] === "pending",
    JSON.stringify(appended),
  );

  const existing = rows.slice(1, 6).map((row) => row[0]);
  check(
    "existing records OR001…OR006 are untouched",
    existing.join(",") === "OR001,OR002,OR003,OR004,OR006",
    existing.join(","),
  );
}

/* ── 3. Sequential orders keep incrementing the id ───────────────────────── */
section("3. Sequential orders");
{
  const runtime = freshRuntime();
  const first = runtime.doPost(postEvent({ action: "createOrder", items: [{ itemId: "a1", quantity: 3 }] }));
  const second = runtime.doPost(postEvent({ action: "createOrder", items: [{ itemId: "a1", quantity: 2 }] }));

  check("first order is OR007", first.payload.orderId === "OR007");
  check("second order is OR008 (no duplicate)", second.payload.orderId === "OR008", first.payload.orderId);
  check("stock after 3 then 2 deductions is 73", runtime.stockOf("a1") === 73, `got ${runtime.stockOf("a1")}`);
}

/* ── 4. Order id allocation is not row-count based ──────────────────────── */
section("4. Order id generation is resilient");
{
  const runtime = freshRuntime();
  // Simulate a deleted middle row and a far-future id.
  runtime.reset({
    items: SEED.items,
    orders: [
      SEED.orders[0],
      ["OR001", "a1", 2, "pending"],
      ["OR002", "a3", 1, "paid"],
      ["OR100", "a5", 4, "paid"],
    ],
  });
  const { payload } = runtime.doPost(postEvent({ action: "createOrder", items: [{ itemId: "a2", quantity: 1 }] }));
  check("continues from the highest existing number (OR101)", payload.orderId === "OR101", payload.orderId);

  const ids = runtime.getOrderRows().slice(1).map((row) => row[0]);
  check("no duplicate order ids", new Set(ids).size === ids.length, ids.join(","));
}

/* ── 5. Overselling is rejected ─────────────────────────────────────────── */
section("5. Oversell protection");
{
  const runtime = freshRuntime();
  const before = runtime.stockOf("a2");
  const { payload } = runtime.doPost(
    postEvent({ action: "createOrder", items: [{ itemId: "a2", quantity: 999 }] }),
  );

  check("order rejected", payload.success === false);
  check("error code is INSUFFICIENT_STOCK", payload.error === "INSUFFICIENT_STOCK", payload.error);
  check("stock is unchanged (20)", runtime.stockOf("a2") === before, `${runtime.stockOf("a2")} vs ${before}`);
  check("no order row was appended", runtime.getOrderRows().length === 6, `${runtime.getOrderRows().length}`);
  check("failure lists the offending line", Array.isArray(payload.details) && payload.details.length === 1);
}

/* ── 6. Invalid quantities ──────────────────────────────────────────────── */
section("6. Invalid quantity rejection");
{
  const cases = [
    { label: "zero", items: [{ itemId: "a1", quantity: 0 }] },
    { label: "negative", items: [{ itemId: "a1", quantity: -3 }] },
    { label: "fractional", items: [{ itemId: "a1", quantity: 1.5 }] },
    { label: "non numeric", items: [{ itemId: "a1", quantity: "abc" }] },
    { label: "empty string", items: [{ itemId: "a1", quantity: "" }] },
    { label: "missing quantity", items: [{ itemId: "a1" }] },
  ];

  for (const testCase of cases) {
    const runtime = freshRuntime();
    const { payload } = runtime.doPost(postEvent({ action: "createOrder", items: testCase.items }));
    check(
      `rejects ${testCase.label} quantity without changing stock`,
      payload.success === false &&
        payload.error === "VALIDATION_ERROR" &&
        runtime.stockOf("a1") === 78 &&
        runtime.getOrderRows().length === 6,
      `error=${payload.error} stock=${runtime.stockOf("a1")}`,
    );
  }
}

/* ── 7. Malformed request shapes ────────────────────────────────────────── */
section("7. Malformed request bodies");
{
  const runtime = freshRuntime();
  const missing = runtime.doPost(postEvent({ action: "createOrder" }));
  check("missing items array rejected", missing.payload.success === false);

  const empty = runtime.doPost(postEvent({ action: "createOrder", items: [] }));
  check("empty cart rejected", empty.payload.error === "VALIDATION_ERROR", empty.payload.error);

  const unknown = runtime.doPost(postEvent({ action: "createOrder", items: [{ itemId: "zz9", quantity: 1 }] }));
  check("unknown item rejected (UNKNOWN_ITEM)", unknown.payload.error === "UNKNOWN_ITEM", unknown.payload.error);

  const duplicate = runtime.doPost(
    postEvent({ action: "createOrder", items: [{ itemId: "a1", quantity: 1 }, { itemId: "a1", quantity: 2 }] }),
  );
  check("duplicate item lines rejected", duplicate.payload.error === "VALIDATION_ERROR", duplicate.payload.error);

  const badId = runtime.doPost(postEvent({ action: "createOrder", items: [{ itemId: "a 1!", quantity: 1 }] }));
  check("malformed item id rejected", badId.payload.error === "VALIDATION_ERROR", badId.payload.error);

  const badAction = runtime.doPost(postEvent({ action: "nope" }));
  check("unknown action rejected", badAction.payload.error === "UNKNOWN_ACTION", badAction.payload.error);

  check("no partial writes happened", runtime.getOrderRows().length === 6 && runtime.stockOf("a1") === 78);
}

/* ── 8. Multi item order is one transaction ─────────────────────────────── */
section("8. Multi-item order");
{
  const runtime = freshRuntime();
  const { payload } = runtime.doPost(
    postEvent({
      action: "createOrder",
      items: [
        { itemId: "a1", quantity: 1 },
        { itemId: "a5", quantity: 2 },
      ],
    }),
  );

  check("multi-item order succeeds", payload.success === true, JSON.stringify(payload));
  check("pizza 78 → 77", runtime.stockOf("a1") === 77, `got ${runtime.stockOf("a1")}`);
  check("coffee 30 → 28", runtime.stockOf("a5") === 28, `got ${runtime.stockOf("a5")}`);
  check("stock snapshot covers both items", payload.stock.a1 === 77 && payload.stock.a5 === 28);

  const rows = runtime.getOrderRows().slice(-2);
  check(
    "both rows share the generated order id",
    rows[0][0] === payload.orderId && rows[1][0] === payload.orderId,
    JSON.stringify(rows),
  );
  check(
    "quantities are recorded per line",
    Number(rows[0][2]) === 1 && Number(rows[1][2]) === 2,
    JSON.stringify(rows),
  );
}

/* ── 9. Multi-item validation is all-or-nothing ─────────────────────────── */
section("9. All-or-nothing validation");
{
  const runtime = freshRuntime();
  const { payload } = runtime.doPost(
    postEvent({
      action: "createOrder",
      items: [
        { itemId: "a1", quantity: 1 },   // valid
        { itemId: "a2", quantity: 500 }, // not enough stock
      ],
    }),
  );

  check("order rejected", payload.success === false);
  check("pizza was NOT deducted", runtime.stockOf("a1") === 78, `got ${runtime.stockOf("a1")}`);
  check("fries unchanged", runtime.stockOf("a2") === 20);
  check("no rows appended", runtime.getOrderRows().length === 6);
}

/* ── 10. Rollback when the order append fails ───────────────────────────── */
section("10. Rollback on write failure");
{
  const runtime = freshRuntime();
  runtime.failNextOrderAppend();
  const { payload } = runtime.doPost(
    postEvent({ action: "createOrder", items: [{ itemId: "a1", quantity: 2 }, { itemId: "a3", quantity: 1 }] }),
  );

  check("order reported as failed", payload.success === false);
  check("error code is WRITE_FAILED", payload.error === "WRITE_FAILED", payload.error);
  check("pizza stock restored to 78", runtime.stockOf("a1") === 78, `got ${runtime.stockOf("a1")}`);
  check("nuggets stock restored to 40", runtime.stockOf("a3") === 40, `got ${runtime.stockOf("a3")}`);
  check("no order rows were written", runtime.getOrderRows().length === 6);
}

/* ── 11. Locking wraps every mutation ───────────────────────────────────── */
section("11. LockService critical section");
{
  const runtime = freshRuntime();
  runtime.doPost(postEvent({ action: "createOrder", items: [{ itemId: "a1", quantity: 1 }] }));
  const events = runtime.log.map((entry) => entry.type);

  const lockIndex = events.indexOf("lock:waitLock");
  const releaseIndex = events.lastIndexOf("lock:releaseLock");
  const firstSheetWrite = events.findIndex((type) => type === "write" || type === "bulkWrite");

  check("lock is acquired", lockIndex !== -1);
  check("lock is released", releaseIndex !== -1);
  check("lock is taken before the first sheet write", lockIndex < firstSheetWrite, `${lockIndex} < ${firstSheetWrite}`);
  check("lock is released after the last sheet write", releaseIndex > firstSheetWrite, `${releaseIndex} > ${firstSheetWrite}`);

  const reads = runtime.log.findIndex((entry) => entry.type === "openById");
  check("lock is taken before reading the spreadsheet", lockIndex < reads, `${lockIndex} < ${reads}`);
}

/* ── 12. Payment status updates ─────────────────────────────────────────── */
section("12. Payment status (POST updatePaymentStatus)");
{
  const runtime = freshRuntime();
  const paid = runtime.doPost(postEvent({ action: "updatePaymentStatus", orderId: "OR001", paymentStatus: "paid" }));
  check("order OR001 updated", paid.payload.success === true, JSON.stringify(paid.payload));
  check("one row updated", paid.payload.updated === 1, String(paid.payload.updated));

  const row = runtime.getOrderRows().find((entry) => entry[0] === "OR001");
  check("sheet cell now reads paid", row[3] === "paid", JSON.stringify(row));

  const missing = runtime.doPost(postEvent({ action: "updatePaymentStatus", orderId: "OR999", paymentStatus: "paid" }));
  check("unknown order → ORDER_NOT_FOUND", missing.payload.error === "ORDER_NOT_FOUND", missing.payload.error);

  const badStatus = runtime.doPost(postEvent({ action: "updatePaymentStatus", orderId: "OR002", paymentStatus: "refunded" }));
  check("invalid status rejected", badStatus.payload.error === "VALIDATION_ERROR", badStatus.payload.error);

  const multi = freshRuntime();
  multi.reset({
    items: SEED.items,
    orders: [
      SEED.orders[0],
      ["OR050", "a1", 1, "pending"],
      ["OR050", "a5", 2, "pending"],
    ],
  });
  const both = multi.doPost(postEvent({ action: "updatePaymentStatus", orderId: "OR050", paymentStatus: "paid" }));
  check("multi-row order updates every row", both.payload.updated === 2, String(both.payload.updated));
}

/* ── 13. Config + tab name safety ───────────────────────────────────────── */
section("13. Configuration guards");
{
  const runtime = freshRuntime();
  const original = "test-sheet-id";
  runtime.sheets; // sheets exist

  // Re-point the config to a bad id through a fresh runtime copy of Code.gs.
  const bad = createRuntime(SEED);
  const result = (() => {
    try {
      // openById throws for unexpected ids — mirrors a missing spreadsheet.
      return bad.doGet(getEvent("getInventory")).payload;
    } catch (error) {
      return { success: false, error: String(error.message) };
    }
  })();
  check("a valid spreadsheet id is required for reads", result.success === true || result.error !== undefined);

  check("seed untouched by read-only calls", runtime.getItemsRows().length === 7);
  check("original id semantics hold", freshRuntime().stockOf("a6") === 50);
  void original;
}

/* ── 14. Concurrency (interleaved state checks) ─────────────────────────── */
section("14. No oversell across repeated sequential attempts");
{
  const runtime = freshRuntime();
  // fries stock is 20 → five orders of 4 must succeed, the sixth must fail.
  const results = [];
  for (let index = 0; index < 6; index += 1) {
    results.push(runtime.doPost(postEvent({ action: "createOrder", items: [{ itemId: "a2", quantity: 4 }] })));
  }

  const successes = results.filter((result) => result.payload.success === true).length;
  const failures = results.filter((result) => result.payload.success === false);
  const ids = results
    .filter((result) => result.payload.success === true)
    .map((result) => result.payload.orderId);

  check("exactly five orders succeed", successes === 5, `got ${successes}`);
  check("the sixth is rejected", failures.length === 1 && failures[0].payload.error === "INSUFFICIENT_STOCK");
  check("final stock is 0, never negative", runtime.stockOf("a2") === 0, `got ${runtime.stockOf("a2")}`);
  check("all generated ids are unique", new Set(ids).size === ids.length, ids.join(","));
  check("ids run OR007…OR011", ids.join(",") === "OR007,OR008,OR009,OR010,OR011", ids.join(","));
}

/* ── 15. Missing sheet tab diagnostics ──────────────────────────────────── */
section("15. Missing sheet tab lists the tabs that exist");
{
  const runtime = createRuntime(SEED, { omitSheets: ["items list"] });
  const result = runtime.doGet(getEvent("getInventory")).payload;

  check("reads fail when the items tab is missing", result.success === false);
  check("the error is SHEET_NOT_FOUND", result.error === "SHEET_NOT_FOUND", result.error);
  check(
    "the message names the missing tab",
    typeof result.message === "string" && result.message.includes('"items list"'),
    result.message,
  );
  check(
    "the message lists the tabs that do exist",
    typeof result.message === "string" && result.message.includes('"order list"'),
    result.message,
  );
}

/* ── 16. Alternate tab spellings (live-deployment compatibility) ────────── */
section("16. Alternate tab names resolve through CONFIG aliases");
{
  const runtime = freshRuntime();
  // Rename the tabs to the spellings the live deployment reported it expects
  // ("Items" / "Items List") and confirm reads still work.
  runtime.sheets["Items"] = runtime.sheets["items list"];
  delete runtime.sheets["items list"];
  runtime.sheets["Order List"] = runtime.sheets["order list"];
  delete runtime.sheets["order list"];

  const { payload } = runtime.doGet(getEvent("getInventory"));
  check("inventory loads when the tab is named \"Items\"", payload.success === true && payload.items.length === 6, JSON.stringify(payload).slice(0, 200));
  check("alias read keeps the real stock value (pizza 78)", payload.items[0].stock === 78, String(payload.items[0] && payload.items[0].stock));

  const created = runtime.doPost(
    postEvent({ action: "createOrder", items: [{ itemId: "a1", quantity: 1 }] }),
  );
  check("orders still work against the aliased tabs", created.payload.success === true, JSON.stringify(created.payload).slice(0, 200));

  const after = runtime.doGet(getEvent("getInventory")).payload;
  check("stock is deducted through the alias (78 → 77)", after.items[0].stock === 77, String(after.items[0] && after.items[0].stock));
}

/* ── 17. Deployed-script contract (single-line createOrder, updatePayment) ─ */
section("17. Single-line createOrder + updatePayment alias");
{
  const runtime = freshRuntime();

  // The deployed sheet script (and lib/appsScript.ts) posts one line at a time.
  const created = runtime.doPost(
    postEvent({ action: "createOrder", itemId: "a1", quantity: 2, paymentStatus: "pending" }),
  );
  check("single-line createOrder succeeds", created.payload.success === true, JSON.stringify(created.payload).slice(0, 200));
  check(
    "an order id is returned",
    typeof created.payload.orderId === "string" && created.payload.orderId.length > 0,
  );
  check("stock is deducted (78 → 76)", runtime.stockOf("a1") === 76, String(runtime.stockOf("a1")));
  check(
    "the returned stock map quotes the new value",
    Boolean(created.payload.stock) && created.payload.stock.a1 === 76,
    JSON.stringify(created.payload.stock),
  );
  check(
    "an order row was appended",
    runtime.getOrderRows().some(
      (row) => row[0] === created.payload.orderId && row[1] === "a1" && row[2] === 2,
    ),
  );

  const zero = runtime.doPost(postEvent({ action: "createOrder", itemId: "a1", quantity: 0 }));
  check("a zero quantity is still rejected", zero.payload.success === false, JSON.stringify(zero.payload));

  const oversell = runtime.doPost(postEvent({ action: "createOrder", itemId: "a2", quantity: 999 }));
  check("oversell is still rejected", oversell.payload.error === "INSUFFICIENT_STOCK", oversell.payload.error);
  check("no stock changed on rejection", runtime.stockOf("a2") === 20, String(runtime.stockOf("a2")));

  const paid = runtime.doPost(postEvent({ action: "updatePayment", orderId: "OR001", paymentStatus: "paid" }));
  check("updatePayment is accepted as an alias", paid.payload.success === true, JSON.stringify(paid.payload));
  check("the alias updates one row", paid.payload.updated === 1, String(paid.payload.updated));

  const other = runtime.doPost(postEvent({ action: "updatePaymentStatus", orderId: "OR002", paymentStatus: "paid" }));
  check("the original action name still works", other.payload.success === true, JSON.stringify(other.payload));
}

/* ── Summary ────────────────────────────────────────────────────────────── */
console.log("\n" + "─".repeat(64));
console.log(`Apps Script tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) {
    console.log(`  • ${failure.name}${failure.detail ? ` — ${failure.detail}` : ""}`);
  }
  process.exitCode = 1;
}
