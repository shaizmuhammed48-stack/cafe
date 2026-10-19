"use client";

interface CategoryFilterProps {
  categories: string[];
  active: string;
  onChange: (category: string) => void;
  counts?: Record<string, number>;
  total: number;
}

const ICONS: Record<string, string> = {
  all: "restaurant_menu",
  snacks: "lunch_dining",
  beverages: "coffee",
};

function iconFor(category: string): string {
  return ICONS[category] ?? "sell";
}

function labelFor(category: string): string {
  if (category === "all") return "All Items";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function CategoryFilter({
  categories,
  active,
  onChange,
  counts = {},
  total,
}: CategoryFilterProps) {
  const options = ["all", ...categories];

  return (
    <div
      role="tablist"
      aria-label="Filter menu by category"
      className="scrollbar-none flex w-full items-center gap-space-sm overflow-x-auto pb-2 sm:w-auto sm:pb-0"
    >
      {options.map((category) => {
        const isActive = category === active;
        const count = category === "all" ? total : (counts[category] ?? 0);

        return (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(category)}
            className={`group flex shrink-0 items-center gap-2 rounded-full font-label-lg text-label-lg transition-all ${
              isActive
                ? "bg-gradient-to-r from-primary to-primary-container px-6 py-2.5 font-bold text-on-primary shadow-[0_0_20px_rgba(242,190,99,0.3)]"
                : "bg-surface-container px-5 py-2.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{iconFor(category)}</span>
            <span>{labelFor(category)}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 font-label-sm text-[10px] ${
                isActive
                  ? "bg-on-primary/15 text-on-primary"
                  : "bg-surface-container-highest text-outline"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
