import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getAuthStatus, login, type AuthStatus } from "./auth-client.js";
import { useLanguage } from "./i18n/language-context.js";

/** Lets a logged-in App show a "log out" control only when there's actually a session worth ending — see App.tsx's header. */
const AuthRequiredContext = createContext(false);
export function useAuthRequired(): boolean {
  return useContext(AuthRequiredContext);
}

/**
 * v0.18: gates the entire app behind a password check — see
 * apps/server/src/auth.ts for the server side. `App` (and therefore its
 * WebSocket-connecting effect) never mounts until this resolves
 * authenticated, so there's no separate "don't open the socket yet" logic
 * needed in App.tsx itself.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAuthStatus()
      .then(setStatus)
      // A failed status check (server unreachable, etc.) shouldn't itself
      // lock the operator out — fall back to "no gate", same as before this
      // feature existed. The actual API calls will fail on their own if a
      // real auth requirement is in effect.
      .catch(() => setStatus({ authRequired: false, authenticated: true, passwordConfigured: false }));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(password);
      setPassword("");
      setStatus((prev) => (prev ? { ...prev, authenticated: true } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === null) return null;
  if (!status.authRequired || status.authenticated) {
    return <AuthRequiredContext.Provider value={status.authRequired}>{children}</AuthRequiredContext.Provider>;
  }

  return (
    <div className="auth-gate">
      <form className="auth-gate-form" onSubmit={handleSubmit} aria-labelledby="auth-gate-heading">
        <h1 id="auth-gate-heading">{t.loginHeading}</h1>
        <p>{t.loginDescription}</p>
        {!status.passwordConfigured && (
          <p className="form-error" role="alert">
            {t.loginNoPasswordConfigured}
          </p>
        )}
        <label className="sr-only" htmlFor="auth-gate-password">
          {t.loginPasswordLabel}
        </label>
        <input
          id="auth-gate-password"
          type="password"
          placeholder={t.loginPasswordPlaceholder}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
          disabled={!status.passwordConfigured}
        />
        <button type="submit" disabled={submitting || !status.passwordConfigured}>
          {submitting ? t.loginSubmitting : t.loginSubmit}
        </button>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
