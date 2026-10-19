import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";
import { InventoryProvider } from "@/components/InventoryProvider";
import { CartProvider } from "@/components/CartProvider";
import { NavShell } from "@/components/NavShell";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: {
    default: "Mad Co Cafe — Order Management",
    template: "%s • Mad Co Cafe",
  },
  description:
    "Artisan cafe ordering and order management system powered by Next.js, Google Apps Script and Google Sheets.",
};

export const viewport: Viewport = {
  themeColor: "#17130f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-body-md text-body-md text-on-surface antialiased">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-surface-container-lowest to-surface"
        />
        <ToastProvider>
          <InventoryProvider>
            <CartProvider>
              <main className="relative min-h-screen">{children}</main>
              <NavShell />
            </CartProvider>
          </InventoryProvider>
        </ToastProvider>
        <Footer />
      </body>
    </html>
  );
}
