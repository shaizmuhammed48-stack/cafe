/**
 * Server-side configuration.
 *
 * Every value is read from the environment at call time (never at module
 * import time) so that a missing variable produces a helpful runtime error
 * instead of a mysterious build failure. Secrets stay on the server — this
 * module must only ever be imported from route handlers / server code.
 */

export interface AppConfig {
  scriptUrl: string;
  timeoutMs: number;
  adminPassword: string;
  sessionSecret: string;
  sessionTtlMs: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TTL_HOURS = 12;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Values that ship in the template files before a real deployment exists.
 *
 * These are structurally valid `/exec` URLs, so pattern checking alone would let
 * them through and produce a confusing HTTP 404 straight from Google. Detecting
 * them here turns that into an accurate "not configured yet" answer instead.
 */
const PLACEHOLDER_PATTERNS = [/PASTE_DEPLOYMENT_ID/i, /example\.com/i];

export function isPlaceholderScriptUrl(url: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(url));
}

export type ScriptUrlProblem = "missing" | "placeholder";

/**
 * The configured backend URL. `GOOGLE_APPS_SCRIPT_URL` wins, but
 * `APPS_SCRIPT_URL` (used by the `?type=…` data layer) is accepted as a
 * fallback so a single variable is enough to run the whole app.
 */
function rawScriptUrl(): string {
  const primary = (process.env.GOOGLE_APPS_SCRIPT_URL ?? "").trim();
  if (primary) return primary;
  return (process.env.APPS_SCRIPT_URL ?? "").trim();
}

/** Why no usable backend URL is available (null when one is configured). */
export function getScriptUrlProblem(): ScriptUrlProblem | null {
  const raw = rawScriptUrl();
  if (!raw) return "missing";
  if (isPlaceholderScriptUrl(raw)) return "placeholder";
  return null;
}

/** Actionable instructions for an unusable GOOGLE_APPS_SCRIPT_URL. */
export function getScriptUrlHint(problem: ScriptUrlProblem): string {
  if (problem === "placeholder") {
    return "GOOGLE_APPS_SCRIPT_URL in .env.local still contains the placeholder value " +
      "PASTE_DEPLOYMENT_ID, so no real Apps Script deployment has been configured yet. " +
      "Deploy google-apps-script/Code.gs as a Web app (Execute as: Me, Who has access: Anyone), " +
      "then paste the real URL that ends in /exec into .env.local and restart the dev server.";
  }
  return "Neither GOOGLE_APPS_SCRIPT_URL nor APPS_SCRIPT_URL is set in .env.local. " +
    "Deploy google-apps-script/Code.gs as a Web app and paste the /exec URL there, " +
    "then restart the dev server.";
}

export function getScriptUrl(): string | null {
  const raw = rawScriptUrl();
  if (!raw) return null;
  if (isPlaceholderScriptUrl(raw)) return null;
  return raw;
}

export function getTimeoutMs(): number {
  return parsePositiveInt(process.env.APPS_SCRIPT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

export function isAdminConfigured(): boolean {
  return Boolean((process.env.ADMIN_PASSWORD ?? "").trim());
}

export function getAdminPassword(): string {
  const value = (process.env.ADMIN_PASSWORD ?? "").trim();
  if (!value) {
    throw new Error(
      "ADMIN_PASSWORD is not set. Add it to .env.local to enable the admin order console.",
    );
  }
  return value;
}

export function getSessionSecret(): string {
  const explicit = (process.env.ADMIN_SESSION_SECRET ?? "").trim();
  if (explicit) return explicit;
  const password = (process.env.ADMIN_PASSWORD ?? "").trim();
  if (!password) {
    throw new Error(
      "Neither ADMIN_SESSION_SECRET nor ADMIN_PASSWORD is set. Add them to .env.local.",
    );
  }
  // Deterministic fallback so a single env var is enough to get started.
  return `madco-cafe::${password}`;
}

export function getSessionTtlMs(): number {
  return parsePositiveInt(process.env.ADMIN_SESSION_TTL_HOURS, DEFAULT_TTL_HOURS) * 3_600_000;
}

export function getConfigOrThrow(): AppConfig {
  const scriptUrl = getScriptUrl();
  if (!scriptUrl) {
    throw new Error(
      "GOOGLE_APPS_SCRIPT_URL is not configured. Deploy the Apps Script backend " +
        "(google-apps-script/Code.gs) and put the /exec URL into .env.local.",
    );
  }
  return {
    scriptUrl,
    timeoutMs: getTimeoutMs(),
    adminPassword: getAdminPassword(),
    sessionSecret: getSessionSecret(),
    sessionTtlMs: getSessionTtlMs(),
  };
}
