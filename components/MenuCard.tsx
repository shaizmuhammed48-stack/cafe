"use client";

import { useEffect, useMemo, useState } from "react";
import type { PricedItem } from "./InventoryProvider";
import { useCart } from "./CartProvider";
import { useToast } from "./ToastProvider";
import { QuantityStepper } from "./QuantityStepper";
import { StockBadge } from "./FeedbackStates";
import { getItemCopy, resolveImage } from "@/lib/catalog";
import { formatPrice } from "@/lib/pricing";

export function MenuCard({ item }: { item: PricedItem }) {
  const { add, remainingFor, quantityOf } = useCart();
  const { showToast } = useToast();

  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [imageSrc, setImageSrc] = useState(() => resolveImage(item));

  useEffect(() => {
    setImageSrc(resolveImage(item));
  }, [item]);

  const copy = getItemCopy(item.id, item.name);
  const inCart = quantityOf(item.id);
  const remaining = remainingFor(item.id);
  const soldOut = item.stock <= 0;
  const allInCart = !soldOut && remaining <= 0;

  const maxSelectable = useMemo(() => Math.max(1, remaining), [remaining]);

  useEffect(() => {
    setQuantity((current) => {
      if (remaining <= 0) return 1;
      return Math.min(Math.max(1, current), remaining);
    });
  }, [remaining]);

  // The quantity picker is only open while the card can actually accept items.
  useEffect(() => {
    if (soldOut || allInCart) setAdding(false);
  }, [soldOut, allInCart]);

  const handleAdd = () => {
    const result = add(item.id, quantity);
    if (!result.ok) {
      showToast({ tone: "error", title: "Could not add to order", description: result.message });
      return;
    }
    showToast({
      tone: result.message ? "info" : "success",
      title: `${item.name} × ${result.added} added to your order`,
      description: result.message ?? "Review it in the My Order tab below.",
    });
    setQuantity(1);
    setAdding(false);
  };

  return (
    <article className="group relative flex flex-col rounded-lg bg-surface-container-low p-space-md shadow-md transition-all duration-300 hover:bg-surface-container hover:shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
      <div className="relative mb-space-md h-52 w-full overflow-hidden rounded shadow-inner">
        {/* Sheet-provided URLs are arbitrary hosts, so a plain <img> is used
            instead of next/image (no remote allow-list required). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={item.name}
          loading="lazy"
          onError={() => setImageSrc(copy.fallbackImage)}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-container-low via-transparent to-transparent opacity-60" />
        <span className="absolute left-3 top-3 rounded-full bg-surface-container-high/90 px-2.5 py-1 font-label-sm text-label-sm uppercase tracking-wider text-secondary backdrop-blur-md">
          {item.category}
          {copy.tag ? ` • ${copy.tag}` : ""}
        </span>
        <span className="absolute bottom-3 right-3 rounded-full bg-surface-container-highest px-2.5 py-0.5 font-label-sm text-label-sm font-bold text-on-surface-variant">
          #{item.id}
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between">
        <div>
          <h4 className="font-title-md text-title-md text-on-surface transition-colors group-hover:text-primary">
            {item.name}
          </h4>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StockBadge stock={item.stock} />
            {inCart > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 font-label-sm text-label-sm font-bold uppercase tracking-wider text-primary">
                <span className="material-symbols-outlined text-[13px]">shopping_bag</span>
                {inCart} in cart
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-space-sm flex flex-wrap items-center justify-between gap-space-sm border-t border-outline-variant/30 pt-space-md">
          <span className="font-title-md text-title-md font-bold text-primary">
            {formatPrice(item.priceValue)}
          </span>

          {soldOut ? (
            <span className="flex items-center gap-space-xs rounded-full bg-surface-container-high px-4 py-2 font-label-md text-label-md uppercase tracking-wider text-outline">
              <span className="material-symbols-outlined text-[16px]">block</span>
              Unavailable
            </span>
          ) : allInCart ? (
            <span className="flex items-center gap-space-xs rounded-full bg-surface-container-high px-4 py-2 font-label-md text-label-md uppercase tracking-wider text-secondary">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              All in cart
            </span>
          ) : adding ? (
            <div className="flex items-center gap-space-sm">
              <QuantityStepper
                value={Math.min(quantity, maxSelectable)}
                max={maxSelectable}
                onChange={setQuantity}
                size="sm"
                label={`Quantity of ${item.name} to add`}
              />
              <button
                type="button"
                onClick={handleAdd}
                aria-label={`Add ${quantity} × ${item.name} to order`}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm transition-all hover:scale-110 active:scale-95"
              >
                <span className="material-symbols-outlined text-[20px]">check</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setQuantity(1);
                }}
                aria-label={`Cancel adding ${item.name}`}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary/60 hover:text-primary"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              aria-expanded={adding}
              aria-label={`Choose a quantity of ${item.name}`}
              className="flex h-10 items-center gap-space-xs rounded-full bg-surface-container-high px-4 font-label-md text-label-md uppercase tracking-wider text-secondary shadow-sm transition-all hover:scale-105 hover:bg-primary hover:text-on-primary active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              Add
            </button>
          )}

        </div>
      </div>
    </article>
  );
}
