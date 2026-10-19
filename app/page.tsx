"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useInventory } from "@/components/InventoryProvider";
import { useCart } from "@/components/CartProvider";
import { CategoryFilter } from "@/components/CategoryFilter";
import { FeatureSpotlight } from "@/components/FeatureSpotlight";
import { MenuCard } from "@/components/MenuCard";
import { GreekDivider } from "@/components/GreekDivider";
import { EmptyState, ErrorState, SkeletonGrid, Spinner } from "@/components/FeedbackStates";
import { FEATURED_ITEM_ID } from "@/lib/catalog";

function formatClock(timestamp: number | null): string {
  if (!timestamp) return "not synced yet";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function HomePage() {
  const { items, categories, loading, refreshing, error, lastUpdated, refresh } = useInventory();
  const { itemCount, lineCount } = useCart();
  const [activeCategory, setActiveCategory] = useState("all");

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of items) {
      result[item.category] = (result[item.category] ?? 0) + 1;
    }
    return result;
  }, [items]);

  const filteredItems = useMemo(
    () =>
      activeCategory === "all"
        ? items
        : items.filter((item) => item.category === activeCategory),
    [items, activeCategory],
  );

  const featuredItem = useMemo(
    () => items.find((item) => item.id === FEATURED_ITEM_ID) ?? items[0] ?? null,
    [items],
  );

  const showSpotlight =
    featuredItem !== null &&
    (activeCategory === "all" || featuredItem.category === activeCategory);

  // Skeletons are shown only for the very first load. Once an error is known we
  // keep the error panel (and its Retry button) mounted, so pressing Retry shows
  // "Retrying…" instead of flashing the skeletons again.
  const isInitialLoading = loading && items.length === 0 && error === null;
  const hasFatalError = error !== null && items.length === 0;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-margin-mobile py-space-md md:px-margin-desktop">
      {/* ── Greek-key hero banner ─────────────────────────────────────────── */}
      <div className="relative mb-space-xl w-full overflow-hidden rounded-lg bg-surface-container-low p-space-md shadow-[0_12px_40px_rgba(0,0,0,0.7)] md:p-space-lg">
        <div className="absolute left-0 right-0 top-0 h-2 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-secondary/20 to-transparent" />

        <div className="flex flex-col items-center justify-between gap-space-lg md:flex-row">
          <div className="flex max-w-2xl flex-col space-y-space-xs text-center md:text-left">
            <span className="font-label-sm text-label-sm uppercase tracking-[0.25em] text-primary">
              MAD CO CAFE • ATELIER ORDERING
            </span>
            <h1 className="mt-space-xs font-headline-lg text-headline-lg-mobile tracking-wide text-on-surface md:text-headline-lg">
              Artisan Roast &amp; <span className="font-display-lg italic text-primary">Fine Culinary Arts</span>
            </h1>
            <p className="max-w-xl font-body-md text-body-md text-on-surface-variant">
              Immerse yourself in classical wood-fired delicacies, rare single-origin roasts, and
              house-crafted refreshments tailored for discerning palates.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2 rounded-lg border border-primary/20 bg-surface-container-lowest/60 px-5 py-4 text-center shadow-inner md:items-end">
            <span className="flex items-center gap-2 font-label-md text-label-md uppercase tracking-wider text-outline">
              <span className="material-symbols-outlined text-[16px] text-primary">sync</span>
              Live sheet sync
            </span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              Updated {formatClock(lastUpdated)}
            </span>
            <button
              type="button"
              onClick={() => void refresh({ silent: true })}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-full border border-outline-variant/50 px-4 py-1.5 font-label-md text-label-md uppercase tracking-wider text-on-surface transition-colors hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshing ? (
                <Spinner className="text-[14px]" />
              ) : (
                <span className="material-symbols-outlined text-[14px]">refresh</span>
              )}
              Refresh stock
            </button>
          </div>
        </div>

        <GreekDivider className="mt-space-lg pt-space-md" />
      </div>

      {/* ── Category filter bar ───────────────────────────────────────────── */}
      <section className="mb-space-lg flex flex-col items-center justify-between gap-space-md sm:flex-row">
        <CategoryFilter
          categories={categories}
          active={activeCategory}
          onChange={setActiveCategory}
          counts={counts}
          total={items.length}
        />
        <div className="flex items-center gap-2 font-label-md text-label-md tracking-wider text-outline">
          <span className="material-symbols-outlined text-[16px] text-primary">verified</span>
          <span>
            CURATED COLLECTION: {filteredItems.length}{" "}
            {filteredItems.length === 1 ? "SELECTION" : "SELECTIONS"}
          </span>
        </div>
      </section>

      {/* ── Chef spotlight ────────────────────────────────────────────────── */}
      {!isInitialLoading && !hasFatalError && showSpotlight && featuredItem ? (
        <FeatureSpotlight item={featuredItem} />
      ) : null}

      {/* ── Menu grid ─────────────────────────────────────────────────────── */}
      <section className="w-full">
        <div className="mb-space-md flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-headline-sm text-headline-sm font-serif text-on-surface">
            Artisan Menu Repertoire
          </h3>
          <span className="font-body-sm text-body-sm text-outline">
            Freshly Prepared On Demand
          </span>
        </div>

        {isInitialLoading ? <SkeletonGrid count={6} /> : null}

        {hasFatalError ? (
          <ErrorState
            title="Live menu unavailable"
            message={error ?? "Unable to load the menu."}
            onRetry={() => void refresh()}
            retrying={loading}
          />
        ) : null}

        {!isInitialLoading && !hasFatalError && filteredItems.length === 0 ? (
          <EmptyState
            icon="restaurant_menu"
            title="No items in this category"
            description={
              items.length === 0
                ? "The kitchen has not published any items yet. Please check back shortly."
                : "Try another category — or view the full menu."
            }
            action={
              items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveCategory("all")}
                  className="pill-outline px-5 py-2"
                >
                  Show all items
                </button>
              ) : null
            }
          />
        ) : null}

        {!isInitialLoading && !hasFatalError && filteredItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-gutter-lg md:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => (
              <MenuCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}

        {error && items.length > 0 ? (
          <p className="mt-space-md flex items-center gap-2 font-body-sm text-body-sm text-error">
            <span className="material-symbols-outlined text-[16px]">warning</span>
            Showing the last known menu — live sync failed: {error}
          </p>
        ) : null}
      </section>

      {/* ── Cart short-cut banner ─────────────────────────────────────────── */}
      {lineCount > 0 ? (
        <div className="mt-space-xl flex flex-col items-center justify-between gap-space-md rounded-lg border border-primary/30 bg-surface-container-low p-space-md shadow-lg sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[24px] text-primary">shopping_bag</span>
            <div className="flex flex-col">
              <span className="font-title-md text-title-md text-on-surface">
                {itemCount} {itemCount === 1 ? "item" : "items"} awaiting checkout
              </span>
              <span className="font-body-sm text-body-sm text-outline">
                Stock is only deducted after you confirm the order.
              </span>
            </div>
          </div>
          <Link
            href="/my-order"
            className="pill-primary px-6 py-3 shadow-[0_4px_24px_rgba(242,190,99,0.3)] hover:shadow-[0_4px_30px_rgba(242,190,99,0.45)]"
          >
            Review my order
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
