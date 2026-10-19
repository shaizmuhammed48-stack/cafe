"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { InventoryItem } from "@/lib/types";
import { resolvePrice } from "@/lib/pricing";

/** Inventory item with its resolved display price. */
export interface PricedItem extends InventoryItem {
  priceValue: number;
}

interface InventoryContextValue {
  items: PricedItem[];
  categories: string[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  getItem: (itemId: string) => PricedItem | undefined;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

async function readInventory(): Promise<PricedItem[]> {
  const response = await fetch("/api/inventory", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `The inventory service returned a malformed response (HTTP ${response.status}).`,
    );
  }

  const body = payload as {
    success?: boolean;
    items?: InventoryItem[];
    message?: string;
  };

  if (!response.ok || body.success !== true || !Array.isArray(body.items)) {
    throw new Error(
      body.message ??
        `Unable to load the live inventory (HTTP ${response.status}). Please try again.`,
    );
  }

  return body.items.map((item) => ({ ...item, priceValue: resolvePrice(item) }));
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PricedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const loadedOnce = useRef(false);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const nextItems = await readInventory();
      setItems(nextItems);
      setError(null);
      setLastUpdated(Date.now());
      loadedOnce.current = true;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the live inventory. Please try again.",
      );
      // Deliberately keep the previously loaded items so a transient network
      // blip does not blank out the menu — but never invent fake stock.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (loadedOnce.current) return;
    void refresh();
  }, [refresh]);

  const getItem = useCallback(
    (itemId: string) => items.find((item) => item.id === itemId),
    [items],
  );

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const item of items) {
      if (item.category) seen.add(item.category);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const value = useMemo<InventoryContextValue>(
    () => ({
      items,
      categories,
      loading,
      refreshing,
      error,
      lastUpdated,
      getItem,
      refresh,
    }),
    [items, categories, loading, refreshing, error, lastUpdated, getItem, refresh],
  );

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory(): InventoryContextValue {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error("useInventory must be used inside an <InventoryProvider>.");
  }
  return context;
}
