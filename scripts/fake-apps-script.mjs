/**
 * Fake Google Apps Script web app for end-to-end tests.
 *
 * Wraps the same `scripts/lib/gs-runtime.mjs` shim that the unit tests use, so
 * the E2E suite exercises the real `google-apps-script/Code.gs` logic over a
 * real HTTP round trip — no duplicated business rules.
 *
 * Endpoints (mirroring a deployed /exec web app):
 *   GET  /exec?action=...          → doGet
 *   POST /exec  {json body}        → doPost (302 → /__echo/<token>, like Google)
 *   GET  /__echo/<token>           → the stored doPost JSON
 *
 * Test-only control endpoints:
 *   POST /__reset   {items?, orders?}      → reseed the fake spreadsheet
 *   GET  /__state                          → current { items, orders } rows
 *   GET  /__counters                       → request counters (see FAULT_MODES)
 *   POST /__fail-next-append               → make the next order append fail
 *   POST /__mode    {mode}                 → force a transport fault
 *
 * Modes: ok | http500 | html | garbage | timeout | single-item-only
 * `single-item-only` mirrors the deployed sheet script: the batch createOrder
 * shape is refused with `{success:false,error:"itemId and a quantity >= 1 are
 * required"}` and only one line per request is accepted.
 *
 * Test-only module — never imported by application code.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRuntime, SEED } from "./lib/gs-runtime.mjs";

/** Transport faults that let us prove failures are never reported as success. */
const FAULT_MODES = new Set(["ok", "http500", "html", "garbage", "timeout", "single-item-only"]);

/** The deployed sheet script's rejection for the batch `createOrder` shape. */
const SINGLE_ITEM_ONLY_ERROR = "itemId and a quantity >= 1 are required";

export function createFakeBackend({ seed = SEED } = {}) {
  const runtime = createRuntime(seed);
  let mode = "ok";
  /** How often the batch createOrder shape was refused (see /__counters). */
  let singleItemRejections = 0;
  /** Redirect targets produced by POST /exec, keyed by echo token. */
  const echoes = new Map();

  // A tiny promise-chain mutex. The gs-runtime is synchronous, but this makes
  // the "one mutation at a time" guarantee explicit for the concurrency test.
  let chain = Promise.resolve();
  function withMutex(task) {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function sendJson(res, status, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      ...extraHeaders,
    });
    res.end(body);
  }

  async function handlePostExec(req, res) {
    const raw = await readBody(req);

    if (mode === "timeout") return; // never respond → client timeout path
    if (mode === "http500") {
      return sendJson(res, 500, { error: "simulated upstream failure" });
    }
    if (mode === "html") {
      const html = "<!doctype html><html><body>Sign in</body></html>";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (mode === "garbage") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("not-json{");
    }

    // Apps Script answers POSTs with a 302 to a googleusercontent echo URL.
    // The echo token is allocated inside the critical section so concurrent
    // requests can never read each other's response.
    if (mode === "single-item-only") {
      // Mirrors the deployed sheet script: the whole-cart shape is refused and
      // only `{ itemId, quantity }` is accepted.
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (payload && payload.action === "createOrder" && Array.isArray(payload.items)) {
        singleItemRejections += 1;
        return sendJson(res, 200, { success: false, error: SINGLE_ITEM_ONLY_ERROR });
      }
    }

    const { echoToken } = await withMutex(async () => {
      const result = runtime.doPost({ parameter: {}, postData: { contents: raw } });
      const newToken = randomUUID();
      echoes.set(newToken, result.raw);
      // Keep the map from growing without bound across a long test run.
      if (echoes.size > 200) echoes.delete(echoes.keys().next().value);
      return { echoToken: newToken };
    });

    res.writeHead(302, { Location: `/__echo/${echoToken}` });
    res.end();
  }

  function handleGetExec(url, res) {
    const action = url.searchParams.get("action") ?? "getAll";

    if (mode === "timeout") return;
    if (mode === "http500") {
      return sendJson(res, 500, { error: "simulated upstream failure" });
    }
    if (mode === "html") {
      const html = "<!doctype html><html><body>Sign in</body></html>";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (mode === "garbage") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("not-json{");
    }

    const result = runtime.doGet({ parameter: { action } });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(result.raw);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === "/exec") {
        return handleGetExec(url, res);
      }
      if (req.method === "POST" && pathname === "/exec") {
        return handlePostExec(req, res);
      }
      if (req.method === "GET" && pathname.startsWith("/__echo/")) {
        const echoToken = pathname.slice("/__echo/".length);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(echoes.get(echoToken) ?? "{}");
      }

      // ── test control plane ──────────────────────────────────────────────
      if (req.method === "POST" && pathname === "/__reset") {
        const raw = await readBody(req);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          body = {};
        }
        const nextSeed =
          body && body.items && body.orders
            ? { items: body.items, orders: body.orders }
            : SEED;
        runtime.reset(nextSeed);
        mode = "ok";
        singleItemRejections = 0;
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && pathname === "/__state") {
        return sendJson(res, 200, {
          items: runtime.getItemsRows(),
          orders: runtime.getOrderRows(),
        });
      }
      if (req.method === "GET" && pathname === "/__counters") {
        return sendJson(res, 200, { singleItemRejections });
      }
      if (req.method === "POST" && pathname === "/__fail-next-append") {
        runtime.failNextOrderAppend();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "POST" && pathname === "/__mode") {
        const raw = await readBody(req);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          body = {};
        }
        const next = String(body.mode ?? "ok");
        if (!FAULT_MODES.has(next)) {
          return sendJson(res, 400, { ok: false, error: "unknown mode" });
        }
        mode = next;
        return sendJson(res, 200, { ok: true, mode });
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      sendJson(res, 500, { error: String(error && error.message ? error.message : error) });
    }
  });

  return {
    server,
    runtime,
    listen(port = 4567, host = "127.0.0.1") {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** CLI entry point: `node scripts/fake-apps-script.mjs [port]`. */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.argv[2]) || 4567;
  const backend = createFakeBackend();
  backend
    .listen(port)
    .then(() => {
      console.log(`[fake-apps-script] listening on http://127.0.0.1:${port}/exec`);
      console.log("[fake-apps-script] control: POST /__reset, GET /__state, GET /__counters, POST /__mode");
    })
    .catch((error) => {
      const code = error && error.code;
      console.error(
        `[fake-apps-script] failed to listen on 127.0.0.1:${port}: ` +
          `${code === "EADDRINUSE" ? "port already in use — stop the other process or pass a port" : error}`,
      );
      process.exit(1);
    });
}
