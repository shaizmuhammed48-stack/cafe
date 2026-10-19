"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { CreateOrderSuccess } from "@/lib/types";
import { formatCurrency } from "@/lib/pricing";

export interface ConfirmedOrder extends CreateOrderSuccess {
  lines: Array<{ itemId: string; name: string; quantity: number; lineTotal: number }>;
  total: number;
}

interface OrderConfirmationProps {
  order: ConfirmedOrder;
  onClose: () => void;
}

export function OrderConfirmation({ order, onClose }: OrderConfirmationProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const totalQuantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-confirmation-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl bg-surface-container-low shadow-[0_20px_60px_rgba(0,0,0,0.8)] animate-slide-up">
        <div className="fret-ribbon h-2.5 w-full border-b border-primary/20 opacity-40" />

        <div className="flex flex-col items-center gap-space-sm px-space-lg py-space-lg text-center">
          <span className="material-symbols-outlined text-[48px] text-primary">check_circle</span>
          <h2
            id="order-confirmation-title"
            className="font-headline-md text-headline-md font-serif text-on-surface"
          >
            Order Confirmed
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Your order has been recorded and the kitchen stock has been updated.
          </p>

          <div className="mt-space-xs flex flex-col items-center gap-1 rounded-lg border border-primary/30 bg-surface-container-lowest px-6 py-3">
            <span className="font-label-sm text-label-sm uppercase tracking-[0.25em] text-outline">
              Order ID
            </span>
            <span className="font-headline-sm text-headline-sm font-bold tracking-widest text-primary">
              {order.orderId}
            </span>
          </div>

          <div className="w-full pt-space-sm text-left">
            <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2">
              <span className="font-label-md text-label-md uppercase tracking-wider text-outline">
                Items
              </span>
              <span className="font-label-md text-label-md uppercase tracking-wider text-outline">
                Quantity
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-outline-variant/20">
              {order.lines.map((line) => (
                <li
                  key={line.itemId}
                  className="flex items-center justify-between gap-3 py-2 font-body-md text-body-md"
                >
                  <span className="truncate text-on-surface">{line.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-on-surface-variant">× {line.quantity}</span>
                    <span className="w-20 text-right font-title-md text-[16px] font-semibold text-primary">
                      {line.lineTotal > 0 ? formatCurrency(line.lineTotal) : "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex w-full items-baseline justify-between border-t border-outline-variant/30 pt-space-sm">
            <span className="font-title-md text-title-md text-on-surface">
              Total ({totalQuantity} {totalQuantity === 1 ? "item" : "items"})
            </span>
            <span className="font-headline-sm text-headline-sm font-serif font-bold text-primary">
              {formatCurrency(order.total)}
            </span>
          </div>

          <p className="font-body-sm text-body-sm text-outline">
            Payment status: <span className="text-secondary">pending</span> — settle at the counter.
          </p>

          <div className="flex w-full flex-col gap-2.5 pt-space-sm sm:flex-row">
            <Link
              href="/"
              onClick={onClose}
              className="pill-primary w-full px-6 py-3 shadow-[0_4px_24px_rgba(212,163,75,0.35)]"
            >
              <span className="material-symbols-outlined text-[18px]">restaurant_menu</span>
              Order something else
            </Link>
            <Link
              href="/admin"
              onClick={onClose}
              className="pill-outline w-full px-6 py-3"
            >
              <span className="material-symbols-outlined text-[18px]">receipt_long</span>
              View order list
            </Link>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="mt-1 font-label-md text-label-md uppercase tracking-wider text-outline transition-colors hover:text-primary"
          >
            Close
          </button>
        </div>

        <div className="fret-ribbon h-2.5 w-full border-t border-primary/20 opacity-40" />
      </div>
    </div>
  );
}
