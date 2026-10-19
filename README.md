# Mad Co Cafe — Order Management System

A complete cafe ordering + order-management system built with **Next.js (App Router) + TypeScript + Tailwind CSS**, backed by **Google Apps Script + Google Sheets**. The UI is a faithful recreation of the supplied Stitch ("Artisan Roast Gilt") design.

Stock is never hardcoded. Every product, stock level, image and order row is read live from the Google Sheet through the Apps Script JSON API, and stock is deducted **server-side** inside a lock so two customers can never oversell the same pizza.

---

## Contents

- [What's included](#whats-included)
- [Architecture](#architecture)
- [The Google Sheet](#the-google-sheet)
- [Setup](#setup)
- [Deploying the Apps Script backend](#deploying-the-apps-script-backend)
- [Configuration reference](#configuration-reference)
- [Running the app](#running-the-app)
- [Pricing](#pricing)
- [API](#api)
- [Security](#security)
- [Testing](#testing)
- [File map](#file-map)
- [Troubleshooting](#troubleshooting)

---

## What's included

**Ordering page (`/`)**
- All products loaded live from the `items list` tab with image, name, category and remaining stock.
- Category filters for **Snacks** and **Beverages**.
- Quantity stepper, add-to-cart, and a cart drawer with per-line remove.
- Blocks zero / negative / fractional quantities, blocks any quantity above remaining stock, and disables items whose stock is `0`.
- Checkout summary (subtotal, tax, total) → **Confirm order** → shows the generated order id.
- Loading, empty, success and error states everywhere. No silent mock-data fallback.

**Cart / checkout (`/my-order`)**
- Persistent cart (survives refresh via `localStorage`), re-validated against live stock before checkout.
- Confirm order calls the backend, which validates + deducts stock + appends the order as one transaction.
- The order is only shown as confirmed after the backend returns an order id.

**Admin order console (`/admin`)**
- Password-protected (see [Security](#security)).
- Table of every order with **Order ID, Item ID, resolved item name, quantity, payment status**.
- Search by order id, filter by payment status, manual refresh + auto-refresh.
- Toggle an order between `pending` and `paid` (writes back to the sheet).

---

## Architecture

```
Browser
  │  (never sees the Apps Script URL or admin secret)
  ▼
Next.js App Router  ──  Route handlers in app/api/*  ──  lib/appsScript.ts
  │                                                        │  server-only fetch
  ▼                                                        ▼
Static React UI                                    Google Apps Script Web App
(components/*, app/*/page.tsx)                     google-apps-script/Code.gs
                                                           │  LockService + SpreadsheetApp
                                                           ▼
                                                    Google Sheets
                                                    "items list" / "order list"
```

- The Apps Script deployment URL lives **only** on the server (`GOOGLE_APPS_SCRIPT_URL`). Every sheet call is proxied through the Next.js route handlers.
- The Apps Script backend is the single source of truth for stock validation and order-id allocation.

---

## The Google Sheet

Two tabs, with these **exact** names (lowercase, space included):

> The backend's configured names are `items list` / `order list`. The
> alternate spellings `Items`, `Items List`, `Orders` and `Order List` are also
> accepted as a fallback (see `CONFIG.*_SHEET_ALIASES` in `google-apps-script/Code.gs`),
> so a workbook that capitalises the tabs still loads.

### `items list`

| Col | Field | Example |
|-----|-------|---------|
| A | `id` | `a1` |
| B | `category` | `snacks` |
| C | `name` | `pizza` |
| D | `image` | `https://…/pizza.jpg` (optional URL) |
| E | `stock` | `78` |
| F | `price` | *(optional — see [Pricing](#pricing))* |

Row 1 is the header; data starts at row 2.

### `order list`

| Col | Field | Example |
|-----|-------|---------|
| A | `order id` | `OR007` |
| B | `item id` | `a1` |
| C | `quantity order` | `1` |
| D | `payment status` | `pending` / `paid` |

Row 1 is the header. A multi-item order writes **one row per item**, all sharing the same generated order id.

> The image column is optional. When it is empty the UI falls back to the bundled Stitch artwork in `public/images/`.

---

## Setup

Requirements: **Node.js 18.17+** (developed on Node 24) and npm.

```bash
# 1. install dependencies
npm install

# 2. create your environment file
copy .env.example .env.local      # Windows
# cp .env.example .env.local      # macOS / Linux
```

Then edit `.env.local` (see [Configuration reference](#configuration-reference)) and paste your Apps Script `/exec` URL.

---

## Deploying the Apps Script backend

1. Open your Google Sheet → **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` contents and paste the full contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
3. At the top of that file, set your spreadsheet id:

   ```js
   var CONFIG = {
     SPREADSHEET_ID: 'PASTE_YOUR_SPREADSHEET_ID_HERE',   // ← replace this
     ...
   };
   ```

   The id is the long string between `/d/` and `/edit` in the sheet URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

4. **Deploy → New deployment → Web app**, with:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
5. Authorise when prompted, then copy the **Web app URL** (it ends in `/exec`).
6. Put that URL into `.env.local` as `GOOGLE_APPS_SCRIPT_URL` and restart the dev server.
7. Run the `debugShowConfig` function once from the Apps Script editor to confirm the id and tabs resolve.

> **Every time you edit `Code.gs`** you must create a **new version** (`Deploy → Manage deployments → edit → Version: New version`). Editing the code without re-deploying leaves the old version live.

Sanity check: opening `<exec-url>?action=ping` in a browser should return `{"success":true,"message":"ok",…}`.

---

## Configuration reference

All configuration lives in **`.env.local`** (server-only; never committed).

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GOOGLE_APPS_SCRIPT_URL` | ✅ | — | The Apps Script `/exec` deployment URL. Falls back to `APPS_SCRIPT_URL` when empty. |
| `APPS_SCRIPT_URL` | — | same as above | Same deployment, used by the `?type=…` data layer (`/api/items`, filtered `/api/orders`, `/demo`). |
| `APPS_SCRIPT_TIMEOUT_MS` | — | `15000` | Request timeout for backend calls. |
| `ADMIN_PASSWORD` | ✅ (for `/admin`) | — | Password for the order console. |
| `ADMIN_SESSION_SECRET` | — | derived from password | HMAC key for the admin session cookie. |
| `ADMIN_SESSION_TTL_HOURS` | — | `12` | Admin session lifetime. |

Both URL variables should point at the **same** Apps Script project. Setting only one is enough.

The one **Apps Script–side** setting is `CONFIG.SPREADSHEET_ID` in `google-apps-script/Code.gs`.

---

## Running the app

```bash
npm run dev      # development server → http://localhost:3000
npm run dev:mock # dev server backed by DUMMY data (no Google account needed)
npm run build    # production build
npm run start    # serve the production build
```

### Preview with dummy data — `npm run dev:mock`

If the live Apps Script deployment is not ready yet (or you just want to click
around), this boots the real `google-apps-script/Code.gs` on a local HTTP
endpoint seeded with the sample spreadsheet in
[`scripts/lib/demo-seed.mjs`](scripts/lib/demo-seed.mjs), then starts `next dev`
pointed at it:

```bash
npm run dev:mock   # → http://localhost:3001
```

The application code and the Apps Script code are untouched — the menu, cart,
stock deduction, oversell protection and admin console all run for real, just
against the dummy spreadsheet instead of Google Sheets. `.env.local` is **not**
modified (the override is passed as a process env var). Edit `demo-seed.mjs` to
preview different products, prices or sold-out states, then restart.

Ports can be changed with `MOCK_APP_PORT` / `MOCK_BACKEND_PORT`.

Other scripts:

```bash
npm run lint         # eslint (app, components, lib)
npm run typecheck    # tsc --noEmit
npm test             # Apps Script logic tests (alias of test:apps-script)
npm run test:apps-script
npm run test:e2e     # requires `npm run build` first
npm run check:backend # verifies the LIVE Apps Script URL in .env.local
```

`npm run check:backend` is the quickest way to confirm your deployment is wired
correctly: it reads inventory/orders and exercises both POST actions with
non-destructive probes. Add `--create-order a1 1` only when you want a real write
(that deducts stock).

---

## Pricing

The `items list` tab has no price column, so prices are configured in one place: [`lib/pricing.ts`](lib/pricing.ts) (`PRICE_MAP`). A 5% service/tax line (`TAX_RATE`) is added at checkout.

If you later add a **column F (`price`)** to `items list`, the backend returns it and it automatically overrides `PRICE_MAP` for that item — no code change required. Items with no resolvable price simply display **"Price on request"**.

---

## API

All endpoints return a consistent envelope: `{ success: true, … }` or `{ success: false, error, message, details? }`.

### Next.js (same-origin, server-side)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/inventory` | Live inventory from the sheet. |
| `GET` | `/api/items` | Items via the `APPS_SCRIPT_URL` data layer. Supports `?category=` and `?id=`. |
| `GET` | `/api/orders` | All orders, enriched with item name/category/image/price. Also carries the raw `data` rows and supports `?status=` / `?orderId=`. |
| `POST` | `/api/orders` | Create an order (validates, deducts stock, appends rows). `201`. Accepts either `{ items:[…] }` (multi-line) or `{ itemId, quantity, paymentStatus }` (single). |
| `PATCH` | `/api/orders` | Update one order's payment status: `{ orderId, paymentStatus }`. |
| `POST` | `/api/orders/status` | **Admin.** Update payment status. |
| `POST` | `/api/admin/login` | Exchange password for a signed session cookie. |
| `POST` | `/api/admin/logout` | Clear the session cookie. |
| `GET` | `/api/admin/session` | Whether an admin session exists. |

### Apps Script web app (demo data layer — `APPS_SCRIPT_URL`)

The `/demo` page talks to a separate deployment through `lib/api.ts`, which uses the
`?type=…` query contract:

| Method | Request | Description |
|--------|---------|-------------|
| `GET` | `?type=items` (optional `&category=`, `&id=`) | Item rows. |
| `GET` | `?type=orders` (optional `&status=`, `&orderId=`) | Order rows (backend joins item name/image). |
| `POST` | `{ "action":"createOrder", "itemId":"a1", "quantity":2, "paymentStatus":"pending" }` | Creates an order and deducts stock; returns `{ order, remainingStock }`. |
| `POST` | `{ "action":"updatePayment", "orderId":"OR001", "paymentStatus":"paid" }` | Updates payment status. |

### Apps Script web app (`GOOGLE_APPS_SCRIPT_URL`)

| Method | Action | Description |
|--------|--------|-------------|
| `GET` | `?action=getInventory` | `items list` rows. |
| `GET` | `?action=getOrders` | `order list` rows. |
| `GET` | `?action=getAll` | Both in one call. |
| `GET` | `?action=ping` | Health check. |
| `POST` | `{ "action":"createOrder", "items":[{"itemId":"a1","quantity":1}] }` | Validate → deduct → append → return `orderId` + updated `stock`. |
| `POST` | `{ "action":"createOrder", "itemId":"a1", "quantity":2 }` | Single-line form — accepted by `Code.gs` **and** by the deployed sheet script. |
| `POST` | `{ "action":"updatePaymentStatus", "orderId":"OR001", "paymentStatus":"paid" }` | Flip `pending`/`paid`. |
| `POST` | `{ "action":"updatePayment", "orderId":"OR001", "paymentStatus":"paid" }` | Same thing under the deployed script's action name. |

Stock is **never** mutated by a `GET`.

`lib/appsScript.ts` sends the single-line form for a one-item cart and the cart form for
anything larger, falling back to one request per line when the deployment only accepts
`itemId`/`quantity`. A multi-line cart split that way produces **one order id per line**;
deploy `google-apps-script/Code.gs` to get a single atomic order id per cart.

Stock is **never** mutated by a `GET`.

---

## Security

- **No secrets client-side.** The Apps Script URL and admin password exist only in server env vars.
- **Same-origin checks** on every state-changing route (`isSameOrigin`), plus validation/sanitisation of all input.
- **Admin auth** via an HMAC-SHA256 signed, `httpOnly`, `SameSite=Lax` cookie (`lib/sessionToken.ts`). Protected twice: Edge `middleware.ts` (`/admin/*`, `/api/orders/status`) and a route-level check. Login is rate-limited in memory.
- **No fake success.** If the backend is unreachable, times out, returns HTML or malformed JSON, the API returns a real error and the UI shows an error state. There is no mock-data fallback.
- **All-or-nothing orders.** The backend validates every line before writing, deducts stock, appends the order, and on any write failure restores the original stock — so stock is never deducted without an order row.
- **Concurrency-safe.** All reads/writes run under `LockService.getScriptLock()`; order ids are allocated from the highest existing `OR###` (never from a row count) and de-duplicated.

> Change `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` before exposing the app anywhere.

---

## Testing

Two automated suites, both dependency-free (`node:test`-style custom runner, no test framework installed):

### 1. Apps Script logic — `npm run test:apps-script`

Runs the **real** `Code.gs` inside a Google Apps Script shim (`scripts/lib/gs-runtime.mjs`) against a spreadsheet seeded with the sample data. Covers inventory reads, stock deduction (`78 → 77`), sequential + resilient order ids, oversell protection, invalid quantities, malformed bodies, multi-item orders, all-or-nothing validation, rollback on write failure, lock ordering, payment status, config guards and repeated no-oversell.

### 2. End-to-end — `npm run test:e2e` (run `npm run build` first)

Boots the fake `/exec` backend (`scripts/fake-apps-script.mjs`, which wraps the same shim) and a real production `next start`, then drives the app over HTTP:

| # | Scenario |
|---|----------|
| 1 | Inventory loads 6 products; pizza `78`, coffee `30`; names/categories from the sheet |
| 2 | Ordering page renders |
| 3 | One pizza → `OR007`, stock `78 → 77`, row appended, persisted, existing rows untouched |
| 4 | Values survive a reload |
| 5 | Oversell rejected (`409`) with no stock change; zero/negative/fractional/string/null qty rejected (`400`); empty cart rejected |
| 6 | Multi-product order shares one order id and deducts each line |
| 7 | All-or-nothing: one bad line blocks the whole order |
| 8 | Backend write failure → not reported as success, stock restored |
| 9 | Unreachable/HTML/garbage backend → real error, never faked data |
| 10 | Cross-site POST blocked (`403`) |
| 11 | Admin redirect when logged out, `401` on status update, wrong password rejected, login → cookie → update works |
| 12 | 10 concurrent orders against stock `5` → exactly 5 succeed, 5 rejected, final stock `0`, unique ids |

> The concurrency test validates observable no-oversell + unique-id behaviour. Genuine mutual exclusion comes from Apps Script's `LockService`; the suite also asserts the lock wraps all reads/writes. The E2E suite reproduces the redirect behaviour of a real Apps Script POST (302 → echo URL).

---

## File map

```
app/
  layout.tsx                    Root layout (fonts, providers, chrome)
  page.tsx                      Ordering page  (/)
  my-order/page.tsx             Cart + checkout + receipt  (/my-order)
  demo/page.tsx                 Apps Script demo (items + orders)  (/demo)
  admin/page.tsx                Order console  (/admin)
  admin/login/page.tsx          Admin login  (/admin/login)
  globals.css                   Tailwind + Stitch fonts/utilities
  api/inventory/route.ts        GET  /api/inventory
  api/items/route.ts            GET  /api/items   (?category=, ?id=)
  api/orders/route.ts           GET + POST + PATCH /api/orders
  api/orders/status/route.ts    POST /api/orders/status   (admin)
  api/admin/login|logout|session/route.ts
components/
  NavShell, Footer, GreekDivider, ToastProvider, FeedbackStates,
  InventoryProvider, CartProvider, MenuCard, CategoryFilter, QuantityStepper,
  FeatureSpotlight, CartLineRow, OrderConfirmation, StatusBadge, OrderTable
lib/
  types.ts             Shared TypeScript types
  config.ts            Server env/config access
  api.ts               Server-only data layer for APPS_SCRIPT_URL (?type=… contract)
  appsScript.ts        Server-only Apps Script client (+ order enrichment)
  apiResponse.ts       Consistent JSON envelopes + error mapping
  validate.ts          Input validation / sanitisation / same-origin
  sessionToken.ts      HMAC admin session tokens (Web Crypto, Edge-safe)
  adminAuth.ts         Cookie issue/verify helpers
  pricing.ts           PRICE_MAP, TAX_RATE, summary maths
  catalog.ts           Editorial copy + image fallbacks
google-apps-script/
  Code.gs              Complete backend (only SPREADSHEET_ID needs editing)
scripts/
  dev-mock.mjs         Local dev server backed by dummy data (npm run dev:mock)
  test-apps-script.mjs Apps Script logic test suite
  e2e.mjs              End-to-end test suite
  fake-apps-script.mjs Fake /exec HTTP backend for E2E + dev:mock
  lib/gs-runtime.mjs   Apps Script runtime shim + seed data
  lib/demo-seed.mjs    Dummy spreadsheet rows used by npm run dev:mock
public/images/         Stitch product artwork (fallbacks)
middleware.ts          Edge protection for /admin/* and /api/orders/status
tailwind.config.ts     Stitch design tokens
.env.example           Environment template
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| API returns `CONFIG_ERROR` / "URL is not configured" / "still contains the placeholder value" | `GOOGLE_APPS_SCRIPT_URL` in `.env.local` was never replaced (or is empty). Paste the real `/exec` URL and restart. Run `npm run check:backend` to confirm. |
| "responded with HTTP 404. The deployment URL does not exist" | The deployment id is wrong/outdated or the deployment was deleted. Deploy a **new version** and use the fresh `/exec` URL. |
| "returned an HTML page instead of JSON" | The deployment is not set to **Anyone**, or the URL is not the `/exec` URL. Re-deploy. |
| "responded with HTTP 403" | The web app is not publicly reachable. Redeploy with **Who has access: Anyone** as the script owner. |
| "failed with HTTP 5xx" | The script threw. Open the Apps Script editor → **Executions** for the stack trace (usually `CONFIG.SPREADSHEET_ID` unset, or a tab not named exactly `items list` / `order list`). |
| "did not return an items array" / the backend replies `{"ok":false,…}` or "Expected one of: Items, Items List" | `GOOGLE_APPS_SCRIPT_URL` points at a **different** Apps Script project (it uses `ok` instead of `success` and its own tab names). Point it at the deployment that actually serves your sheet (`APPS_SCRIPT_URL`) and restart, or deploy `google-apps-script/Code.gs` (see above) and paste the fresh `/exec` URL, then run `npm run check:backend`. The script also accepts `Items` / `Items List` as tab aliases. |
| A multi-item cart creates several orders | The deployment only accepts one line per `createOrder` request (`{itemId, quantity}`), so the app sends one request per line. Deploy `google-apps-script/Code.gs` to get a single atomic order id per cart. |
| "Sheet tab … was not found" | Tab names are case-sensitive: exactly `items list` and `order list` (the aliases `Items`, `Items List`, `Orders`, `Order List` are also accepted). The error message lists every tab that does exist. |
| Changes to `Code.gs` have no effect | Deploy a **new version** of the web app. |
| `/admin` keeps redirecting to login | Confirm `ADMIN_PASSWORD` is set and you typed it correctly. |
| Stock looks stale | Use the refresh control; the UI reads live stock on mount, on checkout and after every order. |

**Known limitations**
- Google Sheets/Apps Script quotas apply (execution time, daily calls). Heavy production traffic should move to a real database.
- The in-memory login throttle resets when the server restarts; use a store like Redis for multi-instance deployments.
- Prices live in `lib/pricing.ts` until a `price` column (F) is added to the sheet.
