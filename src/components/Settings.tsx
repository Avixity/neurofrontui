import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import type { Workspace } from "../useWorkspace";
import { exportAccount } from "../services/cloud";
import { exportJson } from "../services/export";
import { GraphControls } from "./GraphPanel";
import { Language, Notice, PageHeading, type Translate } from "./ui";
export function Settings({
  w,
  t,
  date,
  profileView,
}: {
  w: Workspace;
  t: Translate;
  date: (s: string) => string;
  profileView: boolean;
}) {
  const [name, setName] = useState(w.profile.displayName),
    [zone, setZone] = useState(w.profile.preferences.timeZone),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [deleting, setDeleting] = useState<"data" | "account" | null>(null),
    [confirmation, setConfirmation] = useState("");
  const prefs = w.profile.preferences;
  const zones = Array.from(
    new Set([prefs.timeZone, ...Intl.supportedValuesOf("timeZone")]),
  ).sort();
  return (
    <>
      <PageHeading
        eyebrow={t(profileView ? "nav.profile" : "nav.settings")}
        title={t(profileView ? "profile.title" : "settings.title")}
        description={t(
          profileView ? "profile.description" : "settings.guestHint",
        )}
      />
      <div className="settings-layout">
        <section className="settings-section">
          <h2>{t("profile.title")}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await w.updateProfile({
                ...w.profile,
                displayName: name,
                preferences: { ...prefs, timeZone: zone },
              });
              setBusy(false);
            }}
          >
            <label>
              {t("auth.name")}
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {w.session && (
              <label>
                {t("auth.email")}
                <input readOnly value={w.profile.email} />
              </label>
            )}
            <label>
              {t("profile.timeZone")}
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                {zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={busy}>
              {t(busy ? "common.saving" : "common.save")}
            </button>
          </form>
        </section>
        <section className="settings-section">
          <h2>{t("settings.preferences")}</h2>
          <div className="settings-language">
            <span>{t("common.language")}</span>
            <Language
              t={t}
              value={prefs.language}
              onChange={(language) => w.preferences({ ...prefs, language })}
            />
          </div>
          <GraphControls
            t={t}
            visibility={prefs.graphs}
            setVisibility={(graphs) => w.preferences({ ...prefs, graphs })}
            baseline={w.snapshot.baseline}
          />
          {w.session && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={prefs.saveChat}
                onChange={(e) =>
                  w.preferences({ ...prefs, saveChat: e.target.checked })
                }
              />
              {t("assistant.savePreference")}
            </label>
          )}
        </section>
      </div>
      <section className="settings-section baseline-library">
        <h2>{t("settings.baselines")}</h2>
        <p>{t("settings.baselineInUse")}</p>
        {!w.baselines.length ? (
          <p className="subtle">{t("settings.noBaselines")}</p>
        ) : (
          w.baselines.map((b) => (
            <div className="baseline-row" key={b.id}>
              <div>
                <strong>{date(b.createdAt)}</strong>
                <p className="micro">
                  {b.device.name} · {b.sampleCount} {t("common.samples")} ·{" "}
                  {b.algorithmVersion}
                </p>
                {b.device.source === "simulated" && (
                  <span className="micro">{t("device.simulated")}</span>
                )}
              </div>
              <div className="inline-actions">
                {w.saveStates[b.id] === "error" && (
                  <button
                    className="secondary"
                    onClick={() => void w.persist(b)}
                  >
                    {t("common.retry")}
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={
                    w.snapshot.phase === "baseline" ||
                    w.snapshot.phase === "capture"
                  }
                  aria-pressed={w.profile.activeBaselineId === b.id}
                  onClick={() => w.selectBaseline(b)}
                >
                  {t(
                    w.profile.activeBaselineId === b.id
                      ? "settings.active"
                      : "settings.makeActive",
                  )}
                </button>
                <button
                  className="icon-button"
                  aria-label={t("common.delete")}
                  disabled={
                    w.snapshot.phase === "baseline" ||
                    w.snapshot.phase === "capture"
                  }
                  onClick={() => {
                    if (confirm(t("common.confirmDelete")))
                      void w
                        .removeBaseline(b.id)
                        .catch((error) =>
                          w.setError(
                            error?.code === "baseline_in_use"
                              ? "settings.baselineInUse"
                              : "history.deleteFailed",
                          ),
                        );
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))
        )}
        {w.hasMoreBaselines && (
          <button
            className="secondary"
            disabled={w.loading}
            onClick={() => void w.moreBaselines()}
          >
            {t("settings.loadMore")}
          </button>
        )}
      </section>
      <section className="settings-section">
        <h2>{t("settings.danger")}</h2>
        <p>{t("settings.deleteHint")}</p>
        <div className="inline-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                exportJson(
                  w.session
                    ? await exportAccount()
                    : {
                        profile: w.profile,
                        baselines: w.baselines,
                        measurements: w.measurements,
                      },
                );
              } catch {
                w.setError("error.load");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={17} />
            {t("settings.exportData")}
          </button>
          {w.session && (
            <>
              <button
                className="danger-button"
                onClick={() => {
                  setDeleting("data");
                  setConfirmation("");
                }}
              >
                {t("settings.deleteData")}
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  setDeleting("account");
                  setConfirmation("");
                }}
              >
                {t("settings.deleteAccount")}
              </button>
            </>
          )}
        </div>
        {deleting && (
          <form
            className="delete-confirmation"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await w.clearAccountData(deleting);
                setDeleting(null);
                setMessage(t("settings.deleted"));
              } catch {
                w.setError("error.generic");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("settings.deleteConfirm")}
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="inline-actions">
              <button
                className="danger-button"
                disabled={confirmation !== "DELETE" || busy}
              >
                {t("common.confirm")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setDeleting(null)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
        {message && <Notice kind="success">{message}</Notice>}
      </section>
    </>
  );
}
