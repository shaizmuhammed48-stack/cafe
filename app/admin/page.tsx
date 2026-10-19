"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EnrichedOrder } from "@/lib/types";
import { OrderTable } from "@/components/OrderTable";
import { useToast } from "@/components/ToastProvider";
import { EmptyState, ErrorState, LoadingBlock, Spinner } from "@/components/FeedbackStates";
import { formatCurrency } from "@/lib/pricing";

type StatusFilter = "all" | "pending" | "paid";

interface OrdersResponse {
  success?: boolean;
  orders?: EnrichedOrder[];
  message?: string;
  error?: string;
}

const AUTO_REFRESH_MS = 15_000;

export default function AdminOrdersPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [orders, setOrders] = useState<EnrichedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatalConfig, setFatalConfig] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const hasLoaded = useRef(false);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (options?.silent) setRefreshing(true);
      else setLoading(true);

      try {
        const response = await fetch("/api/orders", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (response.status === 401) {
          router.replace("/admin/login?next=/admin");
          return;
        }

        const body = (await response.json().catch(() => null)) as OrdersResponse | null;

        if (!response.ok || body?.success !== true || !Array.isArray(body.orders)) {
          if (body?.error === "CONFIG_ERROR") setFatalConfig(true);
          setError(
            body?.message ?? `Unable to load the order ledger (HTTP ${response.status}).`,
          );
          return;
        }

        setOrders(body.orders);
        setError(null);
        setFatalConfig(false);
        setLastLoaded(Date.now());
        hasLoaded.current = true;
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? `Could not reach the order service: ${loadError.message}`
            : "Could not reach the order service.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (hasLoaded.current) return;
    void load();
  }, [load]);

  // Keep the ledger live so newly placed orders appear without a manual reload.
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void load({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  const stats = useMemo(() => {
    const uniqueOrders = new Set(orders.map((order) => order.orderId).filter(Boolean));
    const pending = orders.filter((order) => order.paymentStatus === "pending").length;
    const paid = orders.filter((order) => order.paymentStatus === "paid").length;
    const itemsSold = orders.reduce((total, order) => total + order.quantity, 0);
    const revenue = orders
      .filter((order) => order.paymentStatus === "paid")
      .reduce((total, order) => total + order.lineTotal, 0);

    return {
      rows: orders.length,
      uniqueOrders: uniqueOrders.size,
      pending,
      paid,
      itemsSold,
      revenue,
    };
  }, [orders]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus =
        statusFilter === "all" || order.paymentStatus.trim().toLowerCase() === statusFilter;
      if (!matchesStatus) return false;
      if (!needle) return true;
      return (
        order.orderId.toLowerCase().includes(needle) ||
        order.itemId.toLowerCase().includes(needle) ||
        order.itemName.toLowerCase().includes(needle)
      );
    });
  }, [orders, query, statusFilter]);

  const handleToggleStatus = async (order: EnrichedOrder) => {
    const target = order.paymentStatus.trim().toLowerCase() === "paid" ? "pending" : "paid";
    setUpdatingOrderId(order.orderId);

    try {
      const response = await fetch("/api/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId: order.orderId, paymentStatus: target }),
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=/admin");
        return;
      }

      const body = (await response.json().catch(() => null)) as
        | { success?: boolean; message?: string; updated?: number }
        | null;

      if (!response.ok || body?.success !== true) {
        showToast({
          tone: "error",
          title: "Payment status not updated",
          description: body?.message ?? `The backend rejected the change (HTTP ${response.status}).`,
        });
        return;
      }

      setOrders((current) =>
        current.map((row) =>
          row.orderId === order.orderId ? { ...row, paymentStatus: target } : row,
        ),
      );
      showToast({
        tone: "success",
        title: `Order ${order.orderId} marked ${target}`,
        description: `${body.updated ?? 0} row(s) updated in the order list.`,
      });
    } catch (updateError) {
      showToast({
        tone: "error",
        title: "Payment status not updated",
        description:
          updateError instanceof Error
            ? updateError.message
            : "Could not reach the backend.",
      });
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      router.replace("/admin/login");
      router.refresh();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-space-lg px-margin-mobile py-space-lg md:px-margin-desktop">
      {/* Banner */}
      <div className="relative w-full overflow-hidden rounded-lg bg-surface-container-low shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <div className="fret-ribbon h-2.5 w-full border-b border-primary/20 opacity-40" />
        <div className="flex flex-col gap-space-md px-space-lg py-space-md lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-space-xs">
              <span className="font-label-sm text-label-sm uppercase tracking-[0.25em] text-primary">
                MAD CO CAFE
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
              <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline">
                ATELIER ORDER LEDGER
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg-mobile font-serif tracking-tight text-on-surface md:text-headline-lg">
              ORDER MANAGEMENT
            </h1>
            <p className="font-body-sm text-body-sm uppercase tracking-wider text-outline">
              LIVE FROM THE “order list” SHEET TAB
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh((current) => !current)}
              aria-pressed={autoRefresh}
              className={`flex items-center gap-1.5 rounded-full border px-4 py-2 font-label-md text-label-md uppercase tracking-wider transition-colors ${
                autoRefresh
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-outline-variant/50 text-outline hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {autoRefresh ? "toggle_on" : "toggle_off"}
              </span>
              Auto refresh
            </button>
            <button
              type="button"
              onClick={() => void load({ silent: true })}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-full border border-outline-variant/50 px-4 py-2 font-label-md text-label-md uppercase tracking-wider text-on-surface transition-colors hover:border-primary/60 hover:text-primary disabled:opacity-50"
            >
              {refreshing ? (
                <Spinner className="text-[14px]" />
              ) : (
                <span className="material-symbols-outlined text-[14px]">refresh</span>
              )}
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="flex items-center gap-1.5 rounded-full border border-outline-variant/50 px-4 py-2 font-label-md text-label-md uppercase tracking-wider text-on-surface transition-colors hover:border-error/60 hover:text-error disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[14px]">logout</span>
              Sign out
            </button>
          </div>
        </div>
        <div className="fret-ribbon h-2.5 w-full border-t border-primary/20 opacity-40" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-space-sm md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Order rows", value: stats.rows, icon: "list_alt" },
          { label: "Unique orders", value: stats.uniqueOrders, icon: "receipt_long" },
          { label: "Pending", value: stats.pending, icon: "schedule" },
          { label: "Paid", value: stats.paid, icon: "verified" },
          { label: "Items sold", value: stats.itemsSold, icon: "shopping_bag" },
          { label: "Paid revenue", value: formatCurrency(stats.revenue), icon: "payments" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col gap-1 rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-sm"
          >
            <span className="flex items-center gap-1.5 font-label-sm text-[10px] uppercase tracking-wider text-outline">
              <span className="material-symbols-outlined text-[14px] text-primary">{stat.icon}</span>
              {stat.label}
            </span>
            <span className="font-headline-sm text-[22px] font-bold text-on-surface">
              {stat.value}
            </span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-space-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-md lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full flex-col gap-space-sm sm:flex-row lg:w-auto">
          <label className="relative flex w-full items-center sm:w-72">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 text-[18px] text-outline">
              search
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search order id, item id or name"
              aria-label="Search orders"
              className="field pl-10"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="sr-only">Filter by payment status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="field w-full sm:w-44"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </select>
          </label>

          {query || statusFilter !== "all" ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
              className="font-label-md text-label-md uppercase tracking-wider text-outline transition-colors hover:text-primary"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <span className="font-body-sm text-body-sm text-outline">
          Showing {filtered.length} of {orders.length} rows · last loaded{" "}
          {lastLoaded ? new Date(lastLoaded).toLocaleTimeString() : "—"}
        </span>
      </div>

      {/* Content */}
      {loading && orders.length === 0 && !error ? (
        <LoadingBlock label="Loading the order ledger" />
      ) : null}

      {error && orders.length === 0 ? (
        <ErrorState
          title={fatalConfig ? "Backend not configured" : "Order ledger unavailable"}
          message={error}
          onRetry={() => void load()}
          retrying={loading}
        />
      ) : null}

      {!loading && orders.length === 0 && !error ? (
        <EmptyState
          icon="receipt_long"
          title="No orders yet"
          description="Orders placed from the menu will appear here automatically."
        />
      ) : null}

      {!loading && orders.length > 0 && filtered.length === 0 ? (
        <EmptyState
          icon="search_off"
          title="No matching orders"
          description="Try a different order id, item, or payment status."
          action={
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
              className="pill-outline px-5 py-2"
            >
              Clear filters
            </button>
          }
        />
      ) : null}

      {orders.length > 0 && filtered.length > 0 ? (
        <OrderTable
          orders={filtered}
          updatingOrderId={updatingOrderId}
          onToggleStatus={(order) => void handleToggleStatus(order)}
        />
      ) : null}

      {error && orders.length > 0 ? (
        <p className="flex items-center gap-2 font-body-sm text-body-sm text-error">
          <span className="material-symbols-outlined text-[16px]">warning</span>
          Showing the last loaded ledger — refresh failed: {error}
        </p>
      ) : null}
    </div>
  );
}
