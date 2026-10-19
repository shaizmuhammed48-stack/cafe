"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

/** Shapes returned by the Next.js routes (they mirror the Apps Script rows). */
interface Item {
  id: string;
  category: string;
  name: string;
  image: string;
  stock: number;
}

interface Order {
  "order id": string;
  "item id": string;
  "quantity order": number;
  "payment status": string;
  "item name": string;
  "item image": string;
}

type Json = Record<string, unknown> | null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something unexpected happened.";
}

/**
 * Human-readable text from either envelope shape:
 *   { success:false, error:"<message>" }        ← Apps Script / data layer
 *   { success:false, error:"CODE", message:"…" } ← legacy validation errors
 */
function errorText(json: Json, fallback: string): string {
  if (json) {
    const code = json.error;
    const detail = json.message;
    if (typeof code === "string" && code && !/^[A-Z_]+$/.test(code)) return code;
    if (typeof detail === "string" && detail) return detail;
    if (typeof code === "string" && code) return code;
  }
  return fallback;
}

/** GET /api/items?… and unwrap the `{ success, data }` envelope. */
async function readItems(query: string): Promise<Item[]> {
  const response = await fetch(`/api/items${query}`, { cache: "no-store" });
  const json = (await response.json().catch(() => null)) as Json;
  if (!response.ok || !json || json.success !== true || !Array.isArray(json.data)) {
    throw new Error(errorText(json, `Could not load items (HTTP ${response.status}).`));
  }
  return json.data as Item[];
}

/** GET /api/orders and unwrap the `{ success, data }` envelope. */
async function readOrders(): Promise<Order[]> {
  const response = await fetch("/api/orders", { cache: "no-store" });
  const json = (await response.json().catch(() => null)) as Json;
  if (!response.ok || !json || json.success !== true || !Array.isArray(json.data)) {
    throw new Error(errorText(json, `Could not load orders (HTTP ${response.status}).`));
  }
  return json.data as Order[];
}

/** POST/PATCH /api/orders; surfaces the backend `error` message on failure. */
async function mutate(method: "POST" | "PATCH", body: unknown): Promise<Json> {
  const response = await fetch("/api/orders", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as Json;
  if (!response.ok || !json || json.success !== true) {
    throw new Error(errorText(json, `Request failed (HTTP ${response.status}).`));
  }
  return json;
}

export default function DemoPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = category === "all" ? "" : `?category=${encodeURIComponent(category)}`;
        const [nextItems, nextOrders] = await Promise.all([readItems(query), readOrders()]);
        if (cancelled) return;

        setItems(nextItems);
        setOrders(nextOrders);
        // The category list always comes from the unfiltered fetch.
        if (category === "all") {
          setCategories(
            Array.from(new Set(nextItems.map((item) => item.category).filter(Boolean))),
          );
        }
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [category, reloadToken]);

  const placeOrder = async (item: Item) => {
    const quantity = quantities[item.id] ?? 1;
    setBusyItem(item.id);
    setError(null);
    setNotice(null);
    try {
      const result = await mutate("POST", {
        itemId: item.id,
        quantity,
        paymentStatus: "pending",
      });
      const left =
        typeof result?.remainingStock === "number" ? ` — ${result.remainingStock} left in stock` : "";
      setNotice(`${item.name} × ${quantity} ordered${left}.`);
      setQuantities((current) => ({ ...current, [item.id]: 1 }));
      reload(); // refresh stock and pick up the new order
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyItem(null);
    }
  };

  const markPaid = async (orderId: string) => {
    setBusyOrder(orderId);
    setError(null);
    setNotice(null);
    try {
      await mutate("PATCH", { orderId, paymentStatus: "paid" });
      setNotice(`${orderId} marked as paid.`);
      reload();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyOrder(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-gutter py-12">
      <header className="mb-8">
        <p className="font-label-sm text-label-sm uppercase tracking-[0.2em] text-secondary">
          Apps Script demo
        </p>
        <h1 className="font-headline-md text-headline-md text-on-surface">Items &amp; Orders</h1>
        <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
          Server-proxied through <code className="text-primary">/api/items</code> and{" "}
          <code className="text-primary">/api/orders</code>.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 font-body-sm text-body-sm text-error"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={reload}
            className="shrink-0 rounded-full border border-error/40 px-3 py-1 font-label-sm text-label-sm uppercase tracking-wider hover:bg-error/10"
          >
            Retry
          </button>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="mb-6 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 font-body-sm text-body-sm text-primary"
        >
          {notice}
        </div>
      ) : null}

      {/* Category filter */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
          Category
        </span>
        {["all", ...categories].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategory(value)}
            className={
              "rounded-full px-4 py-1.5 font-label-md text-label-md uppercase tracking-wider transition-colors " +
              (value === category
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest")
            }
          >
            {value}
          </button>
        ))}
      </div>

      {/* Items */}
      {loading ? (
        <div className="grid grid-cols-1 gap-gutter-sm sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-72 animate-pulse rounded-lg bg-surface-container-low" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-surface-container-low px-4 py-8 text-center font-body-md text-on-surface-variant">
          No items{category === "all" ? "" : ` in “${category}”`}.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-gutter-sm sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const soldOut = item.stock <= 0;
            const quantity = quantities[item.id] ?? 1;
            return (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-lg bg-surface-container-low shadow-md"
              >
                <div className="relative h-44 w-full bg-surface-container-high">
                  {item.image ? (
                    <Image
                      src={item.image}
                      alt={item.name}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover"
                    />
                  ) : null}
                  <span className="absolute left-3 top-3 rounded-full bg-surface-container-high/90 px-2.5 py-1 font-label-sm text-label-sm uppercase tracking-wider text-secondary backdrop-blur-md">
                    {item.category || "uncategorised"}
                  </span>
                </div>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h2 className="font-title-md text-title-md text-on-surface">{item.name}</h2>
                    <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                      <span className="text-primary">#{item.id}</span> ·{" "}
                      {soldOut ? "Out of stock" : `${item.stock} in stock`}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <label className="sr-only" htmlFor={`qty-${item.id}`}>
                      Quantity of {item.name}
                    </label>
                    <input
                      id={`qty-${item.id}`}
                      type="number"
                      min={1}
                      max={Math.max(1, item.stock)}
                      value={quantity}
                      disabled={soldOut}
                      onChange={(event) => {
                        const next = Number.parseInt(event.target.value, 10);
                        setQuantities((current) => ({
                          ...current,
                          [item.id]: Number.isFinite(next) && next > 0 ? next : 1,
                        }));
                      }}
                      className="h-10 w-20 rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 text-center font-body-md text-on-surface disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={soldOut || busyItem === item.id}
                      onClick={() => placeOrder(item)}
                      className="h-10 flex-1 rounded-lg bg-primary px-4 font-label-md text-label-md uppercase tracking-wider text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-outline"
                    >
                      {busyItem === item.id ? "Ordering…" : soldOut ? "Unavailable" : "Order"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Orders */}
      <section className="mt-12">
        <h2 className="mb-4 font-headline-sm text-headline-sm text-on-surface">Orders</h2>

        {loading ? (
          <div className="h-40 animate-pulse rounded-lg bg-surface-container-low" />
        ) : orders.length === 0 ? (
          <p className="rounded-lg bg-surface-container-low px-4 py-8 text-center font-body-md text-on-surface-variant">
            No orders yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-surface-container-low">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-outline-variant/30 font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const paid = order["payment status"] === "paid";
                  return (
                    <tr
                      key={order["order id"]}
                      className="border-b border-outline-variant/15 last:border-0"
                    >
                      <td className="px-4 py-3 font-label-md text-label-md text-primary">
                        {order["order id"]}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {order["item image"] ? (
                            <Image
                              src={order["item image"]}
                              alt={order["item name"]}
                              width={32}
                              height={32}
                              className="h-8 w-8 rounded object-cover"
                            />
                          ) : null}
                          <span className="font-body-md text-body-md text-on-surface">
                            {order["item name"] || order["item id"]}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-body-md text-body-md text-on-surface-variant">
                        {order["quantity order"]}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            "rounded-full px-2.5 py-1 font-label-sm text-label-sm uppercase tracking-wider " +
                            (paid ? "bg-primary/15 text-primary" : "bg-secondary/15 text-secondary")
                          }
                        >
                          {order["payment status"]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {paid ? (
                          <span className="font-body-sm text-body-sm text-on-surface-variant">—</span>
                        ) : (
                          <button
                            type="button"
                            disabled={busyOrder === order["order id"]}
                            onClick={() => markPaid(order["order id"])}
                            className="rounded-lg border border-primary/40 px-3 py-1.5 font-label-md text-label-md uppercase tracking-wider text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                          >
                            {busyOrder === order["order id"] ? "Saving…" : "Mark as paid"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
