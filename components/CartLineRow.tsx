"use client";

import { useEffect, useState } from "react";
import type { CartLine } from "@/lib/types";
import type { PricedItem } from "./InventoryProvider";
import { useCart } from "./CartProvider";
import { useToast } from "./ToastProvider";
import { QuantityStepper } from "./QuantityStepper";
import { getItemCopy, getFallbackImage, resolveImage } from "@/lib/catalog";
import { formatCurrency, formatPrice } from "@/lib/pricing";

interface CartLineRowProps {
  line: CartLine;
  item?: PricedItem;
}

export function CartLineRow({ line, item }: CartLineRowProps) {
  const { setQuantity, remove } = useCart();
  const { showToast } = useToast();
  const [imageSrc, setImageSrc] = useState(() => (item ? resolveImage(item) : ""));

  useEffect(() => {
    setImageSrc(item ? resolveImage(item) : "");
  }, [item]);

  if (!item) {
    return (
      <div className="flex flex-col items-start justify-between gap-space-md rounded-lg border border-error/40 bg-error-container/15 p-space-md sm:flex-row sm:items-center">
        <div className="flex items-center gap-space-sm">
          <span className="material-symbols-outlined text-[24px] text-error">report</span>
          <div className="flex flex-col">
            <span className="font-title-md text-title-md text-on-surface">
              Item {line.itemId} is no longer on the menu
            </span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              Remove it from the cart to continue with checkout.
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => remove(line.itemId)}
          className="flex items-center gap-1.5 rounded-full border border-error/50 px-4 py-2 font-label-md text-label-md uppercase tracking-wider text-error transition-colors hover:bg-error/10"
        >
          <span className="material-symbols-outlined text-[16px]">delete</span>
          Remove
        </button>
      </div>
    );
  }

  const copy = getItemCopy(item.id, item.name);
  const lineTotal = item.priceValue * line.quantity;
  const overStock = line.quantity > item.stock;

  const handleQuantity = (next: number) => {
    const result = setQuantity(item.id, next);
    if (!result.ok && result.message) {
      showToast({ tone: "error", title: "Invalid quantity", description: result.message });
    } else if (result.message) {
      showToast({ tone: "info", title: "Quantity adjusted", description: result.message });
    }
  };

  return (
    <div className="flex flex-col items-start justify-between gap-space-md rounded-lg bg-surface-container-low p-space-md shadow-[0_4px_20px_rgba(0,0,0,0.35)] transition-all hover:bg-surface-container sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-space-md">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded bg-surface-container-lowest shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={item.name}
            onError={() => setImageSrc(getFallbackImage(item.id, item.name))}
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
          />
          <div className="absolute left-1 top-1 rounded-sm bg-surface-container-lowest/80 px-1.5 py-0.5 font-label-sm text-[10px] text-primary backdrop-blur-sm">
            #{item.id}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-surface-container px-2 py-0.5 font-label-sm text-[10px] font-bold uppercase tracking-wider text-secondary">
              {item.category}
            </span>
            {copy.tag ? (
              <span className="font-label-sm text-label-sm text-outline">• {copy.tag}</span>
            ) : null}
          </div>
          <h2 className="truncate font-headline-sm text-headline-sm font-serif text-on-surface">
            {item.name}
          </h2>
          {copy.note ? (
            <div className="flex items-center gap-1.5 font-body-sm text-body-sm text-outline">
              <span className="material-symbols-outlined text-[15px] text-primary">edit_note</span>
              <span className="truncate italic text-on-surface-variant">“{copy.note}”</span>
            </div>
          ) : null}
          <div className="mt-0.5 font-body-sm text-body-sm text-outline">
            Unit: <span className="font-semibold text-on-surface">{formatPrice(item.priceValue)}</span>
            <span className="mx-2 text-outline-variant">|</span>
            <span className={overStock ? "text-error" : ""}>
              {item.stock} in stock
            </span>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-3 border-t border-outline-variant/30 pt-2 sm:w-auto sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
        <QuantityStepper
          value={line.quantity}
          max={Math.max(1, item.stock)}
          onChange={handleQuantity}
          label={`Quantity of ${item.name}`}
        />
        <div className="flex items-center gap-space-sm">
          <span className="font-title-md text-title-md font-bold text-primary">
            {item.priceValue > 0 ? formatCurrency(lineTotal) : "—"}
          </span>
          <button
            type="button"
            onClick={() => remove(item.id)}
            title="Remove item"
            aria-label={`Remove ${item.name} from order`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container text-outline transition-colors hover:bg-error-container/40 hover:text-error"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}
