export function StatusBadge({ status }: { status: string }) {
  const normalized = status.trim().toLowerCase();

  const tone =
    normalized === "paid"
      ? "border-primary/40 bg-primary/15 text-primary"
      : normalized === "pending"
        ? "border-secondary/40 bg-secondary/10 text-secondary"
        : "border-outline-variant bg-surface-container-highest text-on-surface-variant";

  const icon = normalized === "paid" ? "verified" : normalized === "pending" ? "schedule" : "help";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-label-sm text-label-sm font-bold uppercase tracking-wider ${tone}`}
    >
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
      {status || "unknown"}
    </span>
  );
}
