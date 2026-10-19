"use client";

import type { EnrichedOrder } from "@/lib/types";
import { resolveImage } from "@/lib/catalog";
import { formatCurrency } from "@/lib/pricing";
import { StatusBadge } from "./StatusBadge";
import { Spinner } from "./FeedbackStates";

interface OrderTableProps {
  orders: EnrichedOrder[];
  updatingOrderId: string | null;
  onToggleStatus: (order: EnrichedOrder) => void;
}

function nextStatus(status: string): "paid" | "pending" {
  return status.trim().toLowerCase() === "paid" ? "pending" : "paid";
}

export function OrderTable({ orders, updatingOrderId, onToggleStatus }: OrderTableProps) {
  return (
    <>
      {/* Desktop / tablet table */}
      <div className="scrollbar-visible hidden overflow-x-auto rounded-lg border border-outline-variant/30 bg-surface-container-low md:block">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-outline-variant/40 bg-surface-container">
              {["Order ID", "Item ID", "Item", "Category", "Quantity", "Line Total", "Payment", "Action"].map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-4 py-3 font-label-md text-label-md uppercase tracking-wider text-outline"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const busy = updatingOrderId === order.orderId;
              return (
                <tr
                  key={order.rowId}
                  className="border-b border-outline-variant/20 transition-colors last:border-b-0 hover:bg-surface-container"
                >
                  <td className="px-4 py-3">
                    <span className="font-title-md text-[15px] font-bold tracking-wider text-primary">
                      {order.orderId || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-body-md text-body-md text-on-surface-variant">
                    <span className="rounded bg-surface-container-highest px-2 py-0.5 font-label-sm text-label-sm">
                      {order.itemId || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {order.itemImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveImage({
                            id: order.itemId,
                            name: order.itemName,
                            image: order.itemImage,
                          })}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : null}
                      <div className="flex flex-col">
                        <span className="font-body-md text-body-md font-semibold text-on-surface">
                          {order.itemName}
                        </span>
                        {order.unknownItem ? (
                          <span className="font-label-sm text-[10px] uppercase tracking-wider text-error">
                            not in items list
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-body-sm text-body-sm uppercase tracking-wider text-on-surface-variant">
                    {order.itemCategory}
                  </td>
                  <td className="px-4 py-3 font-title-md text-[16px] font-bold text-on-surface">
                    {order.quantity}
                  </td>
                  <td className="px-4 py-3 font-title-md text-[16px] text-primary">
                    {order.lineTotal > 0 ? formatCurrency(order.lineTotal) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.paymentStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onToggleStatus(order)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 px-3 py-1.5 font-label-md text-label-md uppercase tracking-wider text-on-surface transition-colors hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? (
                        <Spinner className="text-[14px]" />
                      ) : (
                        <span className="material-symbols-outlined text-[14px]">
                          {nextStatus(order.paymentStatus) === "paid" ? "payments" : "undo"}
                        </span>
                      )}
                      Mark {nextStatus(order.paymentStatus)}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-space-sm md:hidden">
        {orders.map((order) => {
          const busy = updatingOrderId === order.orderId;
          return (
            <div
              key={order.rowId}
              className="flex flex-col gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-md"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-title-md text-[15px] font-bold tracking-wider text-primary">
                  {order.orderId || "—"}
                </span>
                <StatusBadge status={order.paymentStatus} />
              </div>
              <div className="flex items-center gap-3">
                {order.itemImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImage({
                      id: order.itemId,
                      name: order.itemName,
                      image: order.itemImage,
                    })}
                    alt=""
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : null}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-body-md text-body-md font-semibold text-on-surface">
                    {order.itemName}
                  </span>
                  <span className="font-body-sm text-body-sm uppercase tracking-wider text-outline">
                    {order.itemId} • {order.itemCategory}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-outline-variant/30 pt-2 font-body-sm text-body-sm">
                <span className="text-outline">
                  Quantity <span className="font-bold text-on-surface">{order.quantity}</span>
                </span>
                <span className="font-title-md text-[15px] text-primary">
                  {order.lineTotal > 0 ? formatCurrency(order.lineTotal) : "—"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggleStatus(order)}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-outline-variant/60 px-3 py-2 font-label-md text-label-md uppercase tracking-wider text-on-surface transition-colors hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Spinner className="text-[14px]" /> : null}
                Mark {nextStatus(order.paymentStatus)}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
