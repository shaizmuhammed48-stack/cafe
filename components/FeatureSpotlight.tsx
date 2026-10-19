"use client";

import { useEffect, useState } from "react";
import type { PricedItem } from "./InventoryProvider";
import { useCart } from "./CartProvider";
import { useToast } from "./ToastProvider";
import { getItemCopy, resolveImage } from "@/lib/catalog";
import { formatPrice } from "@/lib/pricing";
import { StockBadge } from "./FeedbackStates";

/** "Chef spotlight" hero card from the Stitch home screen. */
export function FeatureSpotlight({ item }: { item: PricedItem }) {
  const { add, remainingFor } = useCart();
  const { showToast } = useToast();
  const copy = getItemCopy(item.id, item.name);

  const [imageSrc, setImageSrc] = useState(() => resolveImage(item));

  useEffect(() => {
    setImageSrc(resolveImage(item));
  }, [item]);

  const remaining = remainingFor(item.id);
  const soldOut = item.stock <= 0;
  const allInCart = !soldOut && remaining <= 0;

  const handleAdd = () => {
    const result = add(item.id, 1);
    if (!result.ok) {
      showToast({ tone: "error", title: "Could not add to order", description: result.message });
      return;
    }
    showToast({
      tone: "success",
      title: `${item.name} added to your order`,
      description: "Review it in the My Order tab below.",
    });
  };

  return (
    <div className="relative mb-space-xl flex w-full flex-col items-center gap-space-lg overflow-hidden rounded-lg bg-surface-container-low p-space-md shadow-xl lg:flex-row md:p-space-lg">
      <div className="relative h-64 w-full overflow-hidden rounded shadow-lg lg:h-72 lg:w-5/12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={item.name}
          onError={() => setImageSrc(copy.fallbackImage)}
          className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-transparent to-transparent opacity-80" />
        <span className="absolute left-4 top-4 rounded-full bg-primary px-3 py-1 font-label-sm text-label-sm font-bold uppercase tracking-widest text-on-primary shadow-md">
          Highlight
        </span>
      </div>

      <div className="flex w-full flex-col justify-between gap-space-sm lg:w-7/12">
        <div className="flex flex-col gap-space-xs">
          <span className="font-label-sm text-label-sm uppercase tracking-[0.25em] text-outline">
            {item.category}
            {copy.tag ? ` • ${copy.tag}` : ""}
          </span>
          <h2 className="font-headline-md text-headline-md font-serif text-on-surface">
            {item.name}
          </h2>
          <p className="max-w-xl font-body-md text-body-md text-on-surface-variant">
            {copy.heroDescription ?? copy.description}
          </p>
          <div className="pt-1">
            <StockBadge stock={item.stock} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-space-md pt-space-sm">
          <span className="font-headline-md text-headline-md font-bold text-primary">
            {formatPrice(item.priceValue)}
          </span>

          {soldOut ? (
            <span className="flex items-center gap-space-xs rounded-full bg-surface-container-high px-6 py-3 font-label-lg text-label-lg uppercase tracking-wider text-outline">
              <span className="material-symbols-outlined text-[18px]">block</span>
              Sold out
            </span>
          ) : allInCart ? (
            <span className="flex items-center gap-space-xs rounded-full bg-surface-container-high px-6 py-3 font-label-lg text-label-lg uppercase tracking-wider text-secondary">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              All in cart
            </span>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-space-xs rounded-full bg-gradient-to-r from-primary to-primary-container px-6 py-3 font-label-lg text-label-lg font-bold text-on-primary shadow-[0_4px_24px_rgba(242,190,99,0.3)] transition-all hover:scale-105 hover:shadow-[0_4px_30px_rgba(242,190,99,0.45)] active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
