import { useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import * as auth from "../services/auth";
import { Busy, Language, Notice, type Translate } from "./ui";
import type { Locale } from "../i18n";
export function Auth({
  t,
  language,
  setLanguage,
  onGuest,
  onClose,
  recovery = false,
}: {
  t: Translate;
  language: string;
  setLanguage: (language: Locale) => void;
  onGuest: () => void;
  onClose?: () => void;
  recovery?: boolean;
}) {
  const [mode, setMode] = useState<
    "signin" | "signup" | "recover" | "password"
  >(recovery ? "password" : "signin");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const title =
    mode === "signin"
      ? "auth.signIn"
      : mode === "signup"
        ? "auth.signUp"
        : mode === "recover"
          ? "auth.recover"
          : "auth.updatePassword";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (
      mode !== "password" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      setError(t("auth.invalidEmail"));
      return;
    }
    if (mode !== "recover" && !password) {
      setError(t("auth.required"));
      return;
    }
    if ((mode === "signup" || mode === "password") && password.length < 8) {
      setError(t("auth.minimumPassword"));
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await auth.signIn(email.trim(), password);
        onClose?.();
      }
      if (mode === "signup") {
        const result = await auth.signUp(email.trim(), password, name);
        if (result.session) onClose?.();
        else setSuccess(t("auth.verifySent"));
      }
      if (mode === "recover") {
        await auth.recover(email.trim());
        setSuccess(t("auth.recoverySent"));
      }
      if (mode === "password") {
        await auth.updatePassword(password);
        setSuccess(t("auth.passwordUpdated"));
      }
    } catch {
      setError(t(mode === "password" ? "error.recovery" : "auth.failure"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <a href="https://neurofrontweb.vercel.app" aria-label="NeuroFront">
          <img src="/logo.svg" alt="NeuroFront" />
        </a>
        <Language t={t} value={language} onChange={setLanguage} />
      </header>
      <div className="auth-grid">
        <section className="auth-story">
          <p className="eyebrow">NEUROFRONT / {t("app.prototype")}</p>
          <h1>{t("auth.welcome")}</h1>
          <p>{t("auth.description")}</p>
          <div className="auth-art" aria-hidden="true">
            <svg viewBox="0 0 600 190">
              <path className="reference-line" d="M0 110H600" />
              <path d="M0 110H75l12-10 10 10h35l8-21 7 66 9-137 8 115 10-23h55l12-11 10 11h43l9-20 7 67 9-136 9 113 10-24h58l12-9 11 9h40l8-21 7 66 9-137 9 116 10-24H600" />
            </svg>
            <div>
              <span>01 / {t("graph.primary")}</span>
              <span>02 / {t("graph.baseline")}</span>
            </div>
          </div>
          <p className="auth-footnote">{t("app.experimental")}</p>
        </section>
        <section className="auth-form">
          <div className="auth-tabs">
            <button
              aria-pressed={mode === "signin"}
              onClick={() => {
                setMode("signin");
                setError("");
                setSuccess("");
              }}
            >
              {t("auth.signIn")}
            </button>
            <button
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup");
                setError("");
                setSuccess("");
              }}
            >
              {t("auth.signUp")}
            </button>
          </div>
          <h2>{t(title)}</h2>
          {!auth.cloudConfigured && <Notice>{t("auth.unavailable")}</Notice>}
          <form onSubmit={submit} noValidate>
            {mode === "signup" && (
              <label>
                {t("auth.name")}
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </label>
            )}
            {mode !== "password" && (
              <label>
                {t("auth.email")}
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
            )}
            {mode !== "recover" && (
              <label>
                {t(mode === "password" ? "auth.newPassword" : "auth.password")}
                <input
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
            )}
            {mode === "signin" && (
              <button
                type="button"
                className="text-button forgot"
                onClick={() => setMode("recover")}
              >
                {t("auth.forgot")}
              </button>
            )}
            {error && <Notice kind="error">{error}</Notice>}
            {success && (
              <Notice kind="success">
                <Check size={16} />
                {success}
              </Notice>
            )}
            <button
              className="primary full"
              disabled={busy || !auth.cloudConfigured}
            >
              {busy ? (
                <Busy label={t("common.loading")} />
              ) : (
                <>
                  {t(title)}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          {auth.providerEnabled() && (
            <button
              className="secondary full"
              onClick={() => {
                void auth
                  .signInWithProvider()
                  .catch(() => setError(t("auth.failure")));
              }}
            >
              {t("auth.google")}
            </button>
          )}
          <div className="guest-entry">
            <button className="secondary full" onClick={onGuest}>
              {t("auth.guest")}
              <ArrowRight size={18} />
            </button>
            <p>{t("auth.guestNotice")}</p>
          </div>
          {onClose && (
            <button className="text-button" onClick={onClose}>
              {t("common.back")}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
