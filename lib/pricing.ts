/**
 * Pricing.
 *
 * The `items list` tab has no price column, so prices are configured here as a
 * plain map (editable without touching any other file). If the spreadsheet
 * later gains a price column (column F) the Apps Script backend will return it
 * and that value takes precedence over this map.
 *
 * Set a price to `null` / omit it to display "Price on request".
 */

export const TAX_RATE = 0.05;
export const TAX_LABEL = "Cafe Service & Tax";

export const PRICE_MAP: Record<string, number> = {
  a1: 120,
  a2: 60,
  a3: 80,
  a4: 50,
  a5: 35,
  a6: 25,
};

const NAME_PRICES: Array<{ match: RegExp; price: number }> = [
  { match: /pizza/i, price: 120 },
  { match: /fries|fry/i, price: 60 },
  { match: /nugget/i, price: 80 },
  { match: /popcorn/i, price: 50 },
  { match: /coffee/i, price: 35 },
  { match: /tea|chai/i, price: 25 },
];

/** Resolves the price for one inventory item. */
export function resolvePrice(item: {
  id: string;
  name: string;
  price: number | null;
}): number {
  if (typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0) {
    return item.price;
  }
  const byId = PRICE_MAP[item.id];
  if (typeof byId === "number" && byId > 0) return byId;
  const byName = NAME_PRICES.find((entry) => entry.match.test(item.name));
  if (byName) return byName.price;
  return 0;
}

export function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Currency for products without a configured price. */
export const PRICE_ON_REQUEST = "Price on request";

export function formatPrice(value: number): string {
  return value > 0 ? formatCurrency(value) : PRICE_ON_REQUEST;
}

export interface SummaryLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  priced: boolean;
}

export interface CartSummary {
  lines: SummaryLine[];
  itemCount: number;
  lineCount: number;
  subtotal: number;
  tax: number;
  total: number;
  hasUnpricedItems: boolean;
}

export function buildSummary(
  lines: Array<{
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>,
): CartSummary {
  const summaryLines: SummaryLine[] = [];
  let subtotal = 0;
  let itemCount = 0;
  let hasUnpricedItems = false;

  for (const line of lines) {
    const lineTotal = line.unitPrice * line.quantity;
    subtotal += lineTotal;
    itemCount += line.quantity;
    if (line.unitPrice <= 0) hasUnpricedItems = true;
    summaryLines.push({
      itemId: line.itemId,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal,
      priced: line.unitPrice > 0,
    });
  }

  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return {
    lines: summaryLines,
    itemCount,
    lineCount: summaryLines.length,
    subtotal: Math.round(subtotal * 100) / 100,
    tax,
    total,
    hasUnpricedItems,
  };
}
