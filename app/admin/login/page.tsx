"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/admin");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next && next.startsWith("/")) setNextPath(next);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setError("Enter the admin password to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ password }),
      });

      const body = (await response.json().catch(() => null)) as
        | { success?: boolean; message?: string }
        | null;

      if (!response.ok || body?.success !== true) {
        setError(body?.message ?? `Sign in failed (HTTP ${response.status}).`);
        setSubmitting(false);
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? `Could not reach the server: ${requestError.message}`
          : "Could not reach the server.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-margin-mobile py-space-xl md:px-margin-desktop">
      <div className="relative overflow-hidden rounded-xl bg-surface-container-low shadow-[0_12px_40px_rgba(0,0,0,0.65)]">
        <div className="fret-ribbon h-2.5 w-full border-b border-primary/20 opacity-40" />

        <form onSubmit={handleSubmit} className="flex flex-col gap-space-md p-space-lg">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="material-symbols-outlined text-[36px] text-primary">lock</span>
            <span className="font-label-sm text-label-sm uppercase tracking-[0.25em] text-primary">
              MAD CO CAFE
            </span>
            <h1 className="font-headline-md text-headline-md font-serif text-on-surface">
              Admin Console
            </h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Sign in to manage the order ledger and payment status.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="font-label-md text-label-md uppercase tracking-wider text-outline">
              Admin password
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="field"
              disabled={submitting}
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-error/40 bg-error-container/15 px-3 py-2 font-body-sm text-body-sm text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[16px] text-error">error</span>
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="pill-primary w-full px-6 py-3.5 uppercase tracking-wider shadow-[0_4px_24px_rgba(212,163,75,0.35)] hover:shadow-[0_4px_30px_rgba(212,163,75,0.55)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <span className="material-symbols-outlined animate-spin text-[18px]">
                progress_activity
              </span>
            ) : (
              <span className="material-symbols-outlined text-[18px]">login</span>
            )}
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          <Link
            href="/"
            className="text-center font-label-md text-label-md uppercase tracking-wider text-outline transition-colors hover:text-primary"
          >
            ← Back to the menu
          </Link>

          <p className="font-body-sm text-body-sm text-outline/80">
            The password lives in <code className="text-secondary">ADMIN_PASSWORD</code> in{" "}
            <code className="text-secondary">.env.local</code>.
          </p>
        </form>

        <div className="fret-ribbon h-2.5 w-full border-t border-primary/20 opacity-40" />
      </div>
    </div>
  );
}
