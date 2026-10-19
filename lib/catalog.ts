/**
 * Presentation copy + imagery for the six catalogue items.
 *
 * The Google Sheet only stores id / category / name / image / stock, so the
 * editorial descriptions, tasting tags and offline image fallbacks live here.
 * Anything the sheet provides always wins — see `resolveImage`.
 */

export interface ItemCopy {
  /** Optional short tasting note shown on the cart screen. */
  note?: string;
  /** Short "• Wood-Fired" style descriptor. */
  tag?: string;
  description: string;
  /** Longer editorial copy used by the "chef spotlight" hero card. */
  heroDescription?: string;
  /** Local asset used when the sheet has no image (or the image fails). */
  fallbackImage: string;
}

const ITEM_COPY: Record<string, ItemCopy> = {
  a1: {
    description:
      "San Marzano tomato coulis, cold-pressed olive oil, fior di latte, and fresh aromatic sweet basil leaves.",
    heroDescription:
      "Charred Neapolitan crust baked over fragrant applewood, layered with San Marzano pomodoro, hand-stretched buffalo mozzarella, and mountain wild oregano.",
    tag: "Wood-Fired",
    note: "Extra oregano, crispy crust",
    fallbackImage: "/images/pizza.jpg",
  },
  a2: {
    description:
      "Russet potatoes double-blanched and crisp-fried, seasoned with Umbrian black truffle salt and thyme essence.",
    tag: "Hand Cut",
    note: "Salted, served hot",
    fallbackImage: "/images/french-fries.jpg",
  },
  a3: {
    description:
      "Tender farm-raised poultry coated in panko breadcrumbs, sage, garlic infusion, and served with house dips.",
    tag: "House Special",
    note: "Barbecue dip sauce",
    fallbackImage: "/images/nuggets.jpg",
  },
  a4: {
    description:
      "Non-GMO kernels air-popped, enrobed in browned pasture butter and lightly sprinkled with pink Himalayan salt.",
    tag: "Freshly Popped",
    fallbackImage: "/images/popcorn.jpg",
  },
  a5: {
    description:
      "Ethiopian Yirgacheffe slow-brewed; delicate aromatic notes of jasmine blossom, bergamot, and sweet stone fruit.",
    tag: "Single Origin",
    note: "Medium roast, steamed milk on side",
    fallbackImage: "/images/coffee.jpg",
  },
  a6: {
    description:
      "Robust Assam black tea simmered with freshly ground green cardamom, cinnamon bark, fresh ginger root, and creamy whole milk.",
    tag: "Spiced Infusion",
    fallbackImage: "/images/tea.jpg",
  },
};

const GENERIC_COPY: ItemCopy = {
  description: "Freshly prepared to order in the Mad Co Cafe kitchen.",
  fallbackImage: "/images/hero-pizza.jpg",
};

/** Name based fallbacks, used when an id is not one of the six seeded items. */
const NAME_FALLBACKS: Array<{ match: RegExp; image: string }> = [
  { match: /pizza/i, image: "/images/pizza.jpg" },
  { match: /fries|fry/i, image: "/images/french-fries.jpg" },
  { match: /nugget|chicken/i, image: "/images/nuggets.jpg" },
  { match: /popcorn/i, image: "/images/popcorn.jpg" },
  { match: /coffee|espresso|latte|brew/i, image: "/images/coffee.jpg" },
  { match: /tea|chai/i, image: "/images/tea.jpg" },
];

export const FEATURED_ITEM_ID = "a1";

export function getItemCopy(id: string, name: string): ItemCopy {
  const direct = ITEM_COPY[id];
  if (direct) return direct;

  const normalizedName = name.trim().toLowerCase();
  for (const [copyId, copy] of Object.entries(ITEM_COPY)) {
    if (!copyId) continue;
    if (normalizedName && copy.description.toLowerCase().includes(normalizedName)) {
      return copy;
    }
  }

  const byName = NAME_FALLBACKS.find((entry) => entry.match.test(name));
  if (byName) return { ...GENERIC_COPY, fallbackImage: byName.image };

  return GENERIC_COPY;
}

export function getFallbackImage(id: string, name: string): string {
  const direct = ITEM_COPY[id]?.fallbackImage;
  if (direct) return direct;
  return NAME_FALLBACKS.find((entry) => entry.match.test(name))?.image ?? GENERIC_COPY.fallbackImage;
}

/** Sheet image URL when usable, otherwise the bundled Stitch asset. */
export function resolveImage(item: { id: string; name: string; image: string }): string {
  const fromSheet = (item.image ?? "").trim();
  if (fromSheet && /^https?:\/\//i.test(fromSheet)) return fromSheet;
  if (fromSheet && fromSheet.startsWith("/")) return fromSheet;
  return getFallbackImage(item.id, item.name);
}

export const HERO_IMAGE = "/images/hero-pizza.jpg";
