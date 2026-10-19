import type { ReactNode } from "react";

export function Spinner({ className = "text-[20px]" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`material-symbols-outlined animate-spin ${className}`}
    >
      progress_activity
    </span>
  );
}

export function SkeletonCard() {
  return (
    <div className="flex flex-col rounded-lg bg-surface-container-low p-space-md shadow-md">
      <div className="mb-space-md h-52 w-full animate-pulse rounded bg-surface-container-high" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container-high" />
      <div className="mt-3 h-3 w-full animate-pulse rounded bg-surface-container-high" />
      <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-surface-container-high" />
      <div className="mt-space-md flex items-center justify-between border-t border-outline-variant/30 pt-space-sm">
        <div className="h-5 w-16 animate-pulse rounded bg-surface-container-high" />
        <div className="h-10 w-10 animate-pulse rounded-full bg-surface-container-high" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading menu"
      className="grid grid-cols-1 gap-gutter-lg md:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-lg bg-surface-container-low px-6 py-10 text-on-surface-variant">
      <Spinner />
      <span className="font-body-md text-body-md">{label}…</span>
    </div>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-space-sm rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-md py-space-xl text-center">
      <span className="material-symbols-outlined text-[40px] text-primary/70">{icon}</span>
      <h3 className="font-headline-sm text-headline-sm font-serif text-on-surface">{title}</h3>
      {description ? (
        <p className="max-w-md font-body-md text-body-md text-on-surface-variant">{description}</p>
      ) : null}
      {action ? <div className="pt-space-sm">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retrying = false,
  action,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-space-sm rounded-lg border border-error/40 bg-error-container/15 px-space-md py-space-xl text-center"
    >
      <span className="material-symbols-outlined text-[40px] text-error">cloud_off</span>
      <h3 className="font-headline-sm text-headline-sm font-serif text-on-surface">{title}</h3>
      <p className="max-w-xl font-body-md text-body-md text-on-error-container/90">{message}</p>
      <div className="flex flex-wrap items-center justify-center gap-space-sm pt-space-sm">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="pill-primary px-6 py-2.5 shadow-[0_0_20px_rgba(242,190,99,0.3)] hover:shadow-[0_0_26px_rgba(242,190,99,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying ? <Spinner className="text-[18px]" /> : <span className="material-symbols-outlined text-[18px]">refresh</span>}
            {retrying ? "Retrying…" : "Retry"}
          </button>
        ) : null}
        {action}
      </div>
    </div>
  );
}

export function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-error-container/40 px-2.5 py-1 font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-error-container">
        <span className="material-symbols-outlined text-[13px]">block</span>
        Sold out
      </span>
    );
  }

  const low = stock <= 5;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-label-sm text-label-sm font-bold uppercase tracking-wider ${
        low
          ? "bg-secondary-container/50 text-secondary"
          : "bg-surface-container-highest text-on-surface-variant"
      }`}
    >
      <span className="material-symbols-outlined text-[13px]">inventory_2</span>
      {low ? `Only ${stock} left` : `${stock} in stock`}
    </span>
  );
}
