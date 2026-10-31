import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bluetooth,
  BookOpen,
  ChevronDown,
  History as HistoryIcon,
  House,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
  User,
} from "lucide-react";
import {
  createTranslator,
  isLocale,
  isLocaleLoaded,
  loadLocale,
  localeDirection,
  type Locale,
  type TranslationKey,
} from "./i18n";
import { useWorkspace } from "./useWorkspace";
import { ViewBoundary } from "./components/ViewBoundary";
import type { Measurement } from "./types";
import { Auth } from "./components/Auth";
import { MeasurementView } from "./components/Measurement";
import { History, Trend } from "./components/History";
const Learn = lazy(() =>
  import("./components/Learn").then((module) => ({ default: module.Learn })),
);
const Assistant = lazy(() =>
  import("./components/Assistant").then((module) => ({
    default: module.Assistant,
  })),
);
const Settings = lazy(() =>
  import("./components/Settings").then((module) => ({
    default: module.Settings,
  })),
);
import { Busy, Empty, Language, Notice, PageHeading } from "./components/ui";
type View =
  | "overview"
  | "measure"
  | "history"
  | "learn"
  | "assistant"
  | "profile"
  | "settings";
const navigation = [
  { id: "overview", icon: House },
  { id: "measure", icon: Activity },
  { id: "history", icon: HistoryIcon },
  { id: "learn", icon: BookOpen },
  { id: "assistant", icon: Sparkles },
] as const;
export default function App() {
  const w = useWorkspace(),
    [view, setView] = useState<View>("overview"),
    [authOpen, setAuthOpen] = useState(false),
    [menu, setMenu] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [article, setArticle] = useState<string | null>(null),
    [context, setContext] = useState<Measurement | null>(null);
  const [assistantVisited, setAssistantVisited] = useState(false);
  const main = useRef<HTMLElement>(null),
    accountMenu = useRef<HTMLDivElement>(null);
  const requestedLanguage: Locale = isLocale(w.profile.preferences.language)
    ? w.profile.preferences.language
    : "en";
  const [loadedLanguage, setLoadedLanguage] = useState<Locale>("en"),
    [languageBusy, setLanguageBusy] = useState(false);
  const language: Locale = isLocaleLoaded(requestedLanguage)
    ? requestedLanguage
    : loadedLanguage;
  const t = useMemo(() => createTranslator(language), [language]);
  const date = useMemo(() => {
    try {
      const formatter = new Intl.DateTimeFormat(language, {
        timeZone: w.profile.preferences.timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      });
      return (value: string) => formatter.format(new Date(value));
    } catch {
      return (value: string) => new Date(value).toLocaleString();
    }
  }, [language, w.profile.preferences.timeZone]);
  const languageRequest = useRef(0);
  const changeLanguage = async (language: Locale) => {
    const request = ++languageRequest.current;
    setLanguageBusy(true);
    try {
      await loadLocale(language);
      if (request === languageRequest.current) {
        setLoadedLanguage(language);
        w.preferences({ ...w.profile.preferences, language });
      }
    } catch {
      if (request === languageRequest.current) w.setError("error.offline");
    } finally {
      if (request === languageRequest.current) setLanguageBusy(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    if (!isLocaleLoaded(requestedLanguage)) {
      setLanguageBusy(true);
      void loadLocale(requestedLanguage)
        .then(() => {
          if (!disposed) setLoadedLanguage(requestedLanguage);
        })
        .catch(() => {
          if (!disposed) w.setError("error.offline");
        })
        .finally(() => {
          if (!disposed) setLanguageBusy(false);
        });
    }
    return () => {
      disposed = true;
    };
  }, [requestedLanguage]);
  function navigate(next: View) {
    if (next === "assistant") setAssistantVisited(true);
    setView(next);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() =>
      main.current
        ?.querySelector<HTMLElement>("h1")
        ?.focus({ preventScroll: true }),
    );
  }
  function newMeasurement() {
    if (!running) w.acquisition.reset();
    navigate("measure");
  }
  function learn(id: string) {
    setArticle(id);
    navigate("learn");
  }
  function explain(record: Measurement) {
    setContext(record);
    navigate("assistant");
  }
  function review(record: Measurement) {
    setSelected(record.id);
    navigate("history");
  }
  useEffect(() => {
    const fonts: Partial<Record<Locale, string>> = {
      hi: "Devanagari",
      mr: "Devanagari",
      bn: "Bengali",
      as: "Bengali",
      pa: "Gurmukhi",
      gu: "Gujarati",
      ta: "Tamil",
      te: "Telugu",
      kn: "Kannada",
      ml: "Malayalam",
      or: "Oriya",
      ur: "Arabic",
    };
    const script = fonts[language];
    if (!script) return;
    const id = "script-font-" + script;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Noto+Sans+" +
      script +
      ":wght@400;500;600&display=swap";
    document.head.append(link);
  }, [language]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = localeDirection(language);
    document.title = "NeuroFront";
  }, [language]);
  useEffect(() => {
    setSelected(null);
    setContext(null);
    setMenu(false);
  }, [w.identity]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: PointerEvent) => {
      if (!accountMenu.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        accountMenu.current
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const latest = w.measurements.find((m) => m.status === "completed"),
    baseline = w.baselines.find((b) => b.id === w.profile.activeBaselineId),
    running = w.snapshot.phase === "baseline" || w.snapshot.phase === "capture";
  if (!w.entered || authOpen || w.recovery)
    return (
      <Auth
        key={w.recovery ? "recovery" : "auth"}
        t={t}
        language={language}
        setLanguage={changeLanguage}
        recovery={w.recovery}
        onGuest={() => {
          w.enter();
          setAuthOpen(false);
          w.setRecovery(false);
        }}
        onClose={
          w.entered
            ? () => {
                setAuthOpen(false);
                w.setRecovery(false);
              }
            : undefined
        }
      />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("common.continue")}
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="https://neurofrontweb.vercel.app"
          aria-label="NeuroFront"
        >
          <img src="/logo.svg" alt="NeuroFront" />
        </a>
        <p className="sidebar-label">{t("app.subtitle")}</p>
        <nav aria-label="NeuroFront">
          {navigation.map(({ id, icon: Icon }) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              <span>{t(`nav.${id}`)}</span>
              {view === id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="eyebrow">{t("app.prototype")}</span>
          <a
            href="https://neurofrontweb.vercel.app"
            target="_blank"
            rel="noreferrer"
          >
            {t("app.mainSite")}
            <ArrowUpRight size={16} />
          </a>
          <p>{t("app.experimental")}</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>NeuroFront</span>
            <span>/</span>
            <strong>{t(`nav.${view}`)}</strong>
          </div>
          <div className="topbar-controls">
            <button
              aria-label={t(
                w.snapshot.connected
                  ? "device.disconnect"
                  : w.connection.status === "connecting"
                    ? "device.connecting"
                    : "device.connect",
              )}
              className={`device-control ${w.snapshot.connected ? "is-connected" : ""}`}
              disabled={
                w.connection.status === "connecting" ||
                w.connection.status === "unavailable"
              }
              onClick={() =>
                w.snapshot.connected
                  ? w.client.disconnect()
                  : void w.client.connect()
              }
            >
              <Bluetooth size={17} />
              <span className="desktop-device-label">
                {t(
                  w.snapshot.connected
                    ? "device.disconnect"
                    : w.connection.status === "connecting"
                      ? "device.connecting"
                      : "device.connect",
                )}
              </span>
              <span className="mobile-device-label">{t("device.title")}</span>
              <i />
            </button>
            <Language t={t} value={language} onChange={changeLanguage} />
            <div className="account-menu" ref={accountMenu}>
              <button
                className="account-trigger"
                aria-label={t("common.account")}
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <span className="avatar">
                  {w.profile.displayName ? (
                    w.profile.displayName[0].toLocaleUpperCase()
                  ) : (
                    <User size={17} />
                  )}
                </span>
                <span className="account-name">
                  {w.profile.displayName || t("common.guest")}
                </span>
                <ChevronDown size={14} />
              </button>
              {menu && (
                <div className="account-dropdown">
                  <button onClick={() => navigate("profile")}>
                    <User size={16} />
                    {t("nav.profile")}
                  </button>
                  <button onClick={() => navigate("settings")}>
                    <SettingsIcon size={16} />
                    {t("nav.settings")}
                  </button>
                  {w.session ? (
                    <>
                      <p>{t("auth.switchNotice")}</p>
                      <button
                        onClick={() => {
                          setMenu(false);
                          void w
                            .signOut()
                            .catch(() => w.setError("auth.sessionExpired"));
                        }}
                      >
                        <LogOut size={16} />
                        {t("auth.signOut")}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setMenu(false);
                        setAuthOpen(true);
                      }}
                    >
                      <LogOut size={16} />
                      {t("auth.signIn")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" ref={main}>
          <div className="page-notices">
            {languageBusy && <Busy label={t("common.loading")} />}
            {w.error && (
              <Notice
                kind="error"
                close={{
                  label: t("common.dismiss"),
                  action: () => w.setError(null),
                }}
              >
                {t(w.error as TranslationKey)}
                {w.error === "error.load" && (
                  <button className="text-button" onClick={() => void w.load()}>
                    {t("common.retry")}
                  </button>
                )}
              </Notice>
            )}
            {w.connection.error && (
              <Notice kind="error">{t(`device.${w.connection.error}`)}</Notice>
            )}
            {w.loading && <Busy label={t("common.loading")} />}
            {!w.session && (
              <div className="guest-notice">
                <span className="status-dot" />
                {t("auth.guestNotice")}
              </div>
            )}
            {w.pendingGuest && (
              <Notice>
                {t("auth.guestPending")}
                <div className="inline-actions">
                  <button
                    className="primary"
                    disabled={w.loading}
                    onClick={() => void w.importGuest()}
                  >
                    {t("auth.saveGuest")}
                  </button>
                  <button className="text-button" onClick={w.discardGuest}>
                    {t("auth.discardGuest")}
                  </button>
                </div>
              </Notice>
            )}
            {w.simulator && (
              <Notice>
                <strong>{t("device.simulated")}</strong> ·{" "}
                {t("device.simulationNotice")}
                <div className="simulation-controls">
                  <button onClick={() => w.simulator?.setMode("rest")}>
                    {t("graph.baseline")}
                  </button>
                  <button onClick={() => w.simulator?.setMode("active")}>
                    {t("graph.primary")}
                  </button>
                  <button onClick={() => w.simulator?.setMode("silent")}>
                    {t("device.waiting")}
                  </button>
                </div>
              </Notice>
            )}
            {running && view !== "measure" && (
              <button
                className="recording-banner"
                onClick={() => navigate("measure")}
              >
                <Activity size={18} />
                {t(
                  w.snapshot.phase === "baseline"
                    ? "measure.calibrating"
                    : "measure.measuring",
                )}{" "}
                ·{" "}
                {t("measure.remaining", {
                  count: Math.ceil(w.snapshot.remainingMs / 1000),
                })}
                <ArrowRight size={18} />
              </button>
            )}
          </div>
          <ViewBoundary
            key={view + "-" + w.identity}
            t={t}
            measure={() => navigate("measure")}
          >
            <Suspense fallback={<Busy label={t("common.loading")} />}>
              {view === "overview" && (
                <>
                  <PageHeading
                    eyebrow={t("overview.greeting", {
                      name: w.profile.displayName || t("common.guest"),
                    })}
                    title={t("overview.title")}
                    description={t("overview.description")}
                    action={
                      <button className="primary" onClick={newMeasurement}>
                        {t("overview.new")}
                        <ArrowRight size={18} />
                      </button>
                    }
                  />
                  <section className="overview-intro">
                    <div className="overview-statement">
                      <span className="eyebrow">
                        01 / {t("overview.baseline")}
                      </span>
                      <h2>
                        {baseline
                          ? t("measure.baselineReady")
                          : t("overview.noBaseline")}
                      </h2>
                      <p>
                        {baseline
                          ? date(baseline.createdAt)
                          : t("overview.noBaselineHint")}
                      </p>
                      <button className="text-button" onClick={newMeasurement}>
                        {t(baseline ? "measure.useSaved" : "measure.calibrate")}
                        <ArrowRight size={18} />
                      </button>
                    </div>
                    <div className="overview-signal" aria-hidden="true">
                      <svg viewBox="0 0 480 190">
                        <defs>
                          <pattern
                            id="grid"
                            width="40"
                            height="40"
                            patternUnits="userSpaceOnUse"
                          >
                            <path
                              d="M40 0H0V40"
                              fill="none"
                              stroke="#34463b"
                              strokeWidth=".7"
                            />
                          </pattern>
                        </defs>
                        <rect width="480" height="190" fill="url(#grid)" />
                        <path d="M15 105H70l10-8 10 8h27l8-15 6 36 7-94 7 86 8-13h45l10-8 9 8h29l8-15 6 36 7-94 7 86 8-13h44l10-8 10 8h30l8-15 6 36 7-94 7 86 8-13H465" />
                      </svg>
                      <span className="micro">{t("app.tagline")}</span>
                    </div>
                  </section>
                  <div className="overview-stats">
                    <div>
                      <span className="eyebrow">{t("device.title")}</span>
                      <strong>
                        {t(
                          w.snapshot.connected
                            ? "device.connected"
                            : "device.disconnected",
                        )}
                      </strong>
                      <p>{t("device.setup")}</p>
                    </div>
                    <div>
                      <span className="eyebrow">{t("overview.sessions")}</span>
                      <strong>
                        {new Intl.NumberFormat(language).format(
                          w.measurements.filter((m) => m.status === "completed")
                            .length,
                        )}
                        {w.hasMore ? "+" : ""}
                      </strong>
                      <p>{t(w.session ? "history.saved" : "overview.local")}</p>
                    </div>
                    <div>
                      <span className="eyebrow">{t("overview.latest")}</span>
                      <strong>
                        {latest?.score?.toFixed(1) ?? t("common.none")}
                      </strong>
                      <p>
                        {latest
                          ? date(latest.createdAt)
                          : t("overview.noSessionsHint")}
                      </p>
                    </div>
                  </div>
                  <div className="overview-lower">
                    <section>
                      <div className="section-heading">
                        <h2>{t("overview.summary")}</h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("history")}
                        >
                          {t("nav.history")}
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      {latest ? (
                        <Trend
                          records={w.measurements}
                          t={t}
                          date={date}
                          open={review}
                        />
                      ) : (
                        <Empty
                          title={t("overview.noSessions")}
                          description={t("overview.noSessionsHint")}
                        />
                      )}
                    </section>
                    <button
                      className="learn-feature"
                      onClick={() => learn("personal-baseline")}
                    >
                      <BookOpen size={26} />
                      <span className="eyebrow">{t("nav.learn")}</span>
                      <h2>{t("overview.shortcut")}</h2>
                      <p>{t("overview.shortcutHint")}</p>
                      <ArrowUpRight size={24} />
                    </button>
                  </div>
                  {w.connection.status === "unavailable" && (
                    <Notice>{t("device.unavailable")}</Notice>
                  )}
                </>
              )}
              {view === "measure" && (
                <MeasurementView
                  workspace={w}
                  t={t}
                  date={date}
                  learn={learn}
                  explain={explain}
                />
              )}
              {view === "history" && (
                <History
                  w={w}
                  t={t}
                  date={date}
                  selected={selected}
                  setSelected={setSelected}
                  explain={explain}
                  newMeasurement={newMeasurement}
                />
              )}
              {view === "learn" && (
                <Learn
                  t={t}
                  locale={language}
                  w={w}
                  articleId={article}
                  setArticleId={(id) => {
                    setArticle(id);
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                />
              )}

              {(view === "profile" || view === "settings") && (
                <Settings
                  key={`${view}-${w.identity}`}
                  w={w}
                  t={t}
                  date={date}
                  profileView={view === "profile"}
                />
              )}
            </Suspense>
          </ViewBoundary>
          {assistantVisited && (
            <div hidden={view !== "assistant"}>
              <ViewBoundary
                key={w.identity}
                t={t}
                measure={() => navigate("measure")}
              >
                <Suspense fallback={<Busy label={t("common.loading")} />}>
                  <Assistant
                    key={w.identity}
                    locale={language}
                    t={t}
                    w={w}
                    context={context}
                    learn={learn}
                    date={date}
                  />
                </Suspense>
              </ViewBoundary>
            </div>
          )}
          <footer className="app-footer">
            <span>NeuroFront</span>
            <p>{t("app.experimental")}</p>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="NeuroFront">
        {navigation.map(({ id, icon: Icon }) => (
          <button
            key={id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={20} />
            <span>{t(`nav.${id}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
