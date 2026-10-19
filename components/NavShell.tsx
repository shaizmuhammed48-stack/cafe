"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "./CartProvider";

interface NavLink {
  href: string;
  path: string;
  label: string;
  icon: string;
}

const LINKS: NavLink[] = [
  { href: "/", path: "home", label: "HOME", icon: "home" },
  { href: "/my-order", path: "my-order", label: "MY ORDER", icon: "shopping_bag" },
  { href: "/admin", path: "admin", label: "ADMIN", icon: "receipt_long" },
];

export function NavShell() {
  const pathname = usePathname();
  const { itemCount, hydrated } = useCart();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface-container-high/90 p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
    >
      {LINKS.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-2.5 transition-all sm:px-6 ${
              active
                ? "bg-gradient-to-r from-primary to-primary-container font-bold text-on-primary shadow-[0_0_24px_rgba(212,163,75,0.35)]"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="relative flex items-center">
              <span className="material-symbols-outlined text-[20px]">{link.icon}</span>
              {link.path === "my-order" && hydrated && itemCount > 0 ? (
                <span
                  aria-label={`${itemCount} items in cart`}
                  className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error"
                >
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              ) : null}
            </span>
            <span className="hidden font-label-lg text-label-lg tracking-wider uppercase sm:inline">
              {link.label}
            </span>
            <span className="sr-only sm:hidden">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
