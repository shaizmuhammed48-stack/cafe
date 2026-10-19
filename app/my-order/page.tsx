"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useInventory } from "@/components/InventoryProvider";
import { useCart } from "@/components/CartProvider";
import { useToast } from "@/components/ToastProvider";
import { CartLineRow } from "@/components/CartLineRow";
import { OrderConfirmation, type ConfirmedOrder } from "@/components/OrderConfirmation";
import { EmptyState, Spinner } from "@/components/FeedbackStates";
import { buildSummary, formatCurrency, TAX_LABEL, TAX_RATE } from "@/lib/pricing";

interface OrdersApiResponse {
  success?: boolean;
  orderId?: string;
  message?: string;
  stock?: Record<string, number>;
  error?: string;
}

export default function MyOrderPage() {
  const { items, getItem, loading, error, refresh, lastUpdated } = useInventory();
  const { lines, hydrated, lineCount, unavailableItemIds, clear } = useCart();
  const { showToast } = useToast();

  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmedOrder | null>(null);

  const summary = useMemo(
    () =>
      buildSummary(
        lines.map((line) => {
          const item = getItem(line.itemId);
          return {
            itemId: line.itemId,
            name: item?.name ?? line.itemId,
            quantity: line.quantity,
            unitPrice: item?.priceValue ?? 0,
          };
        }),
      ),
    [lines, getItem],
  );

  const hasStockViolation = useMemo(
    () =>
      lines.some((line) => {
        const item = getItem(line.itemId);
        return item ? line.quantity > item.stock : false;
      }),
    [lines, getItem],
  );

  const inventoryUnavailable = items.length === 0 && error !== null;
  const cartEmpty = hydrated && lineCount === 0;

  const blockingReason = useMemo(() => {
    if (!hydrated) return "Restoring your saved order…";
    if (inventoryUnavailable) return "The live menu is unavailable, so checkout is disabled.";
    if (cartEmpty) return null;
    if (unavailableItemIds.length > 0)
      return "Some items are no longer on the menu — remove them before checking out.";
    if (hasStockViolation) return "Some quantities exceed the available stock. Adjust them first.";
    if (loading && items.length === 0) return "Loading the live menu…";
    return null;
  }, [
    hydrated,
    inventoryUnavailable,
    cartEmpty,
    unavailableItemIds.length,
    hasStockViolation,
    loading,
    items.length,
  ]);

  const canPlaceOrder = blockingReason === null && !placing && lineCount > 0;

  const handlePlaceOrder = async () => {
    if (!canPlaceOrder) {
      if (blockingReason) {
        showToast({ tone: "error", title: "Cannot place order", description: blockingReason });
      }
      return;
    }

    setPlacing(true);
    setCheckoutError(null);

    const payloadLines = lines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
    }));

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: payloadLines }),
      });

      let body: OrdersApiResponse | null = null;
      try {
        body = (await response.json()) as OrdersApiResponse;
      } catch {
        body = null;
      }

      if (!response.ok || body?.success !== true || !body.orderId) {
        const message =
          body?.message ??
          `The cafe backend rejected the order (HTTP ${response.status}). No stock was deducted.`;
        setCheckoutError(message);
        showToast({ tone: "error", title: "Order not placed", description: message });
        // Stock may have changed underneath us — resync and keep the cart intact.
        await refresh({ silent: true });
        return;
      }

      const confirmed: ConfirmedOrder = {
        success: true,
        orderId: body.orderId,
        message: body.message ?? `Order ${body.orderId} confirmed.`,
        items: payloadLines,
        stock: body.stock ?? {},
        lines: summary.lines.map((line) => ({
          itemId: line.itemId,
          name: line.name,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        })),
        total: summary.total,
      };

      setConfirmation(confirmed);
      clear();
      showToast({
        tone: "success",
        title: `Order ${confirmed.orderId} confirmed`,
        description: "Stock has been updated in Google Sheets.",
      });
      await refresh({ silent: true });
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? `Could not reach the cafe backend: ${requestError.message}`
          : "Could not reach the cafe backend. The order was not placed.";
      setCheckoutError(message);
      showToast({ tone: "error", title: "Order not placed", description: message });
    } finally {
      setPlacing(false);
    }
  };

  const handleSaveForLater = () => {
    if (lineCount === 0) return;
    showToast({
      tone: "info",
      title: "Order saved on this device",
      description: "Your cart is kept in this browser until you check out.",
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-space-lg px-margin-mobile py-space-lg md:px-margin-desktop">
      {/* ── Receipt banner ────────────────────────────────────────────────── */}
      <div className="relative w-full overflow-hidden rounded-lg bg-surface-container-low shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <div className="fret-ribbon h-2.5 w-full border-b border-primary/20 opacity-40" />
        <div className="relative flex flex-col items-start justify-between gap-space-md px-space-lg py-space-md lg:flex-row lg:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-space-xs">
              <span className="font-label-sm text-label-sm uppercase tracking-[0.25em] text-primary">
                MAD CO CAFE
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
              <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline">
                ATELIER RECEIPT
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg-mobile font-serif tracking-tight text-on-surface md:text-headline-lg">
              MY ORDER CART &amp; REVIEW
            </h1>
            <p className="font-body-sm text-body-sm uppercase tracking-wider text-outline">
              ARTISAN BEVERAGES AND SNACKS
            </p>
          </div>

          <div className="flex items-center gap-space-sm">
            <span className="font-label-md text-label-md uppercase tracking-wider text-outline">
              Last synced {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "—"}
            </span>
            <button
              type="button"
              onClick={() => void refresh({ silent: true })}
              className="flex items-center gap-1.5 rounded-full border border-outline-variant/50 px-4 py-1.5 font-label-md text-label-md uppercase tracking-wider text-on-surface transition-colors hover:border-primary/60 hover:text-primary"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              Refresh
            </button>
          </div>
        </div>
        <div className="fret-ribbon h-2.5 w-full border-t border-primary/20 opacity-40" />
      </div>

      {/* ── Two column layout ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 items-start gap-gutter-lg lg:grid-cols-12">
        {/* Left: cart lines */}
        <div className="flex flex-col gap-space-md lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-space-xs">
            <div className="flex items-center gap-3">
              <span className="font-headline-sm text-headline-sm font-serif text-on-surface">
                YOUR ORDERED ITEMS
              </span>
              <span className="rounded-full bg-surface-container-highest px-2.5 py-0.5 font-label-sm text-label-sm font-bold text-primary">
                {lineCount} {lineCount === 1 ? "ITEM" : "ITEMS"}
              </span>
            </div>
            <Link
              href="/"
              className="group flex items-center gap-1.5 text-primary transition-colors hover:text-secondary-fixed"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span className="font-label-lg text-label-lg uppercase tracking-wider underline decoration-primary/40 underline-offset-4 group-hover:decoration-primary">
                Add More Items
              </span>
            </Link>
          </div>

          {!hydrated ? (
            <div className="flex items-center justify-center gap-3 rounded-lg bg-surface-container-low px-6 py-10 text-on-surface-variant">
              <Spinner />
              <span className="font-body-md text-body-md">Restoring your saved order…</span>
            </div>
          ) : null}

          {hydrated && cartEmpty ? (
            <EmptyState
              icon="shopping_bag"
              title="Your cart is empty"
              description="Browse the artisan menu and add something delicious to begin your order."
              action={
                <Link href="/" className="pill-primary px-6 py-3">
                  <span className="material-symbols-outlined text-[18px]">restaurant_menu</span>
                  Browse the menu
                </Link>
              }
            />
          ) : null}

          {hydrated && !cartEmpty
            ? lines.map((line) => (
                <CartLineRow key={line.itemId} line={line} item={getItem(line.itemId)} />
              ))
            : null}

          {checkoutError ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-error/40 bg-error-container/15 p-space-md"
            >
              <span className="material-symbols-outlined text-[22px] text-error">error</span>
              <div className="flex flex-col gap-1">
                <span className="font-title-md text-title-md text-on-surface">
                  We could not place your order
                </span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {checkoutError}
                </span>
                <button
                  type="button"
                  onClick={() => setCheckoutError(null)}
                  className="mt-1 self-start font-label-md text-label-md uppercase tracking-wider text-primary hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: summary */}
        <div className="sticky top-24 flex flex-col gap-space-md lg:col-span-4">
          <div className="relative flex flex-col gap-space-md overflow-hidden rounded-xl bg-surface-container-low p-space-lg shadow-[0_12px_40px_rgba(0,0,0,0.65)]">
            <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />

            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-space-xs">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[22px] text-primary">
                  receipt_long
                </span>
                <span className="font-headline-sm text-headline-sm font-serif tracking-wide text-on-surface">
                  ORDER BREAKDOWN
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 border-y border-outline-variant/30 py-space-sm font-body-md text-body-md">
              <div className="flex items-center justify-between text-outline">
                <span>
                  Items Subtotal ({summary.itemCount}{" "}
                  {summary.itemCount === 1 ? "item" : "items"})
                </span>
                <span className="font-title-md text-[16px] font-semibold text-on-surface">
                  {formatCurrency(summary.subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-outline">
                <div className="flex items-center gap-1">
                  <span>{TAX_LABEL}</span>
                  <span className="rounded bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-bold text-secondary">
                    {Math.round(TAX_RATE * 100)}%
                  </span>
                </div>
                <span className="font-title-md text-[16px] font-semibold text-on-surface">
                  {formatCurrency(summary.tax)}
                </span>
              </div>
              <div className="flex items-center justify-between text-outline">
                <span>Artisan Packaging</span>
                <span className="font-label-md font-semibold uppercase tracking-wider text-secondary">
                  Complimentary
                </span>
              </div>
              <div className="my-1 h-px bg-gradient-to-r from-transparent via-outline-variant/40 to-transparent" />
              <div className="flex items-baseline justify-between pt-1">
                <div className="flex flex-col">
                  <span className="font-title-md text-title-md font-bold text-on-surface">
                    Total Payable
                  </span>
                  <span className="font-label-sm text-label-sm text-outline">Includes all taxes</span>
                </div>
                <span className="font-headline-md text-headline-md font-serif font-bold tracking-tight text-primary">
                  {formatCurrency(summary.total)}
                </span>
              </div>
              {summary.hasUnpricedItems ? (
                <p className="font-body-sm text-body-sm text-outline">
                  Some items have no configured price — the counter will confirm the amount.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => void handlePlaceOrder()}
                disabled={!canPlaceOrder}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary via-primary-container to-secondary px-6 py-3.5 font-label-lg text-label-lg font-bold uppercase tracking-wider text-on-primary shadow-[0_4px_24px_rgba(212,163,75,0.35)] transition-all hover:brightness-105 hover:shadow-[0_4px_30px_rgba(212,163,75,0.55)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
              >
                {placing ? (
                  <>
                    <Spinner className="text-[18px]" />
                    Placing order…
                  </>
                ) : (
                  <>
                    <span>PLACE ORDER</span>
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleSaveForLater}
                disabled={lineCount === 0}
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-transparent px-6 py-2.5 font-label-md text-label-md uppercase tracking-wider text-outline transition-colors hover:bg-surface-container hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">bookmark_border</span>
                <span>Save Order for Later</span>
              </button>
            </div>

            {blockingReason && lineCount > 0 ? (
              <div className="flex flex-col gap-2 rounded-lg bg-error-container/15 px-3 py-2">
                <p className="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px] text-error">info</span>
                  {inventoryUnavailable && error ? error : blockingReason}
                </p>
                {inventoryUnavailable ? (
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={loading}
                    className="pill-outline flex items-center gap-1.5 self-start px-4 py-1.5 font-label-md text-label-md uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? (
                      <Spinner className="text-[14px]" />
                    ) : (
                      <span className="material-symbols-outlined text-[14px]">refresh</span>
                    )}
                    {loading ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-center gap-2 pt-1 font-label-sm text-[11px] text-outline/80">
              <span className="material-symbols-outlined text-[14px] text-primary">lock</span>
              <span>Stock is deducted only after confirmation</span>
            </div>
          </div>
        </div>
      </div>

      {confirmation ? (
        <OrderConfirmation order={confirmation} onClose={() => setConfirmation(null)} />
      ) : null}
    </div>
  );
}
