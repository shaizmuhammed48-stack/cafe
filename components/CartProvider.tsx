"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CartLine } from "@/lib/types";
import { useInventory } from "./InventoryProvider";

const STORAGE_KEY = "madco_cafe_cart_v1";

export interface CartMutationResult {
  ok: boolean;
  added?: number;
  message?: string;
}

interface CartContextValue {
  lines: CartLine[];
  hydrated: boolean;
  itemCount: number;
  lineCount: number;
  /** Item ids in the cart that no longer exist in `items list`. */
  unavailableItemIds: string[];
  quantityOf: (itemId: string) => number;
  /** Elapsed stock for an item: stock minus what is already in the cart. */
  remainingFor: (itemId: string) => number;
  add: (itemId: string, quantity?: number) => CartMutationResult;
  setQuantity: (itemId: string, quantity: number) => CartMutationResult;
  remove: (itemId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { itemId?: unknown; quantity?: unknown };
  return (
    typeof record.itemId === "string" &&
    record.itemId.length > 0 &&
    typeof record.quantity === "number" &&
    Number.isFinite(record.quantity) &&
    record.quantity > 0
  );
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { items } = useInventory();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage (browser refresh must not lose the cart).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setLines(
            parsed
              .filter(isCartLine)
              .map((line) => ({ itemId: line.itemId, quantity: Math.floor(line.quantity) })),
          );
        }
      }
    } catch {
      // Corrupt storage is not fatal — start from an empty cart.
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist every change after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Storage may be unavailable (private mode) — the cart still works in memory.
    }
  }, [lines, hydrated]);

  // Keep cart lines consistent with the live inventory (stock can change
  // underneath the customer while they are still browsing).
  useEffect(() => {
    if (!hydrated || items.length === 0) return;

    setLines((current) => {
      let changed = false;
      const next: CartLine[] = [];

      for (const line of current) {
        const item = items.find((candidate) => candidate.id === line.itemId);

        if (!item) {
          // Unknown item — keep it so the customer can see and remove it.
          next.push(line);
          continue;
        }

        const max = Math.max(0, item.stock);
        const clamped = Math.min(line.quantity, max);

        if (clamped <= 0) {
          // Stock ran out while it sat in the cart: drop the line.
          changed = true;
          continue;
        }
        if (clamped !== line.quantity) {
          changed = true;
          next.push({ ...line, quantity: clamped });
          continue;
        }
        next.push(line);
      }

      return changed ? next : current;
    });
  }, [items, hydrated]);

  const getItem = useCallback(
    (itemId: string) => items.find((item) => item.id === itemId),
    [items],
  );

  const quantityOf = useCallback(
    (itemId: string) => lines.find((line) => line.itemId === itemId)?.quantity ?? 0,
    [lines],
  );

  const remainingFor = useCallback(
    (itemId: string) => {
      const item = getItem(itemId);
      if (!item) return 0;
      return Math.max(0, item.stock - quantityOf(itemId));
    },
    [getItem, quantityOf],
  );

  const add = useCallback<CartContextValue["add"]>(
    (itemId, quantity = 1) => {
      const item = getItem(itemId);
      if (!item) {
        return { ok: false, message: "That item is no longer on the menu." };
      }
      if (item.stock <= 0) {
        return { ok: false, message: `${item.name} is sold out.` };
      }
      if (!Number.isFinite(quantity) || quantity < 1) {
        return { ok: false, message: "Choose a quantity of at least 1." };
      }

      const requested = Math.floor(quantity);
      const alreadyInCart = quantityOf(itemId);
      const available = Math.max(0, item.stock - alreadyInCart);

      if (available <= 0) {
        return {
          ok: false,
          message: `Your cart already holds all ${item.stock} available ${item.name}.`,
        };
      }

      const added = Math.min(requested, available);
      setLines((current) => {
        const existing = current.find((line) => line.itemId === itemId);
        if (existing) {
          return current.map((line) =>
            line.itemId === itemId ? { ...line, quantity: line.quantity + added } : line,
          );
        }
        return [...current, { itemId, quantity: added }];
      });

      return {
        ok: true,
        added,
        message:
          added < requested
            ? `Only ${added} more ${item.name} could be added — the rest is already in your cart.`
            : undefined,
      };
    },
    [getItem, quantityOf],
  );

  const setQuantity = useCallback<CartContextValue["setQuantity"]>(
    (itemId, quantity) => {
      const item = getItem(itemId);
      if (!Number.isFinite(quantity) || quantity < 1) {
        return { ok: false, message: "Quantity must be at least 1." };
      }

      const requested = Math.floor(quantity);
      if (item && requested > item.stock) {
        setLines((current) =>
          current.map((line) =>
            line.itemId === itemId ? { ...line, quantity: item.stock } : line,
          ),
        );
        return {
          ok: true,
          message: `Only ${item.stock} ${item.name} available — quantity capped.`,
        };
      }

      setLines((current) =>
        current.map((line) => (line.itemId === itemId ? { ...line, quantity: requested } : line)),
      );
      return { ok: true };
    },
    [getItem],
  );

  const remove = useCallback((itemId: string) => {
    setLines((current) => current.filter((line) => line.itemId !== itemId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  const unavailableItemIds = useMemo(
    () =>
      items.length === 0
        ? []
        : lines
            .filter((line) => !items.some((item) => item.id === line.itemId))
            .map((line) => line.itemId),
    [lines, items],
  );

  const itemCount = useMemo(
    () => lines.reduce((total, line) => total + line.quantity, 0),
    [lines],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      hydrated,
      itemCount,
      lineCount: lines.length,
      unavailableItemIds,
      quantityOf,
      remainingFor,
      add,
      setQuantity,
      remove,
      clear,
    }),
    [
      lines,
      hydrated,
      itemCount,
      unavailableItemIds,
      quantityOf,
      remainingFor,
      add,
      setQuantity,
      remove,
      clear,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside a <CartProvider>.");
  }
  return context;
}
