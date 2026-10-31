import { ArrowRight, Bluetooth, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Workspace } from "../useWorkspace";
import type { Measurement as RecordType, SaveState } from "../types";
import { GraphPanel, chartLabels } from "./GraphPanel";
import { Busy, Notice, PageHeading, type Translate } from "./ui";
export function ResultDetails({
  record,
  t,
  date,
  state,
  retry,
  explain,
  saveNotes,
}: {
  record: RecordType;
  t: Translate;
  date: (value: string) => string;
  state?: SaveState;
  retry: () => void;
  explain: () => void;
  saveNotes: (notes: string, tags: string[]) => Promise<void>;
}) {
  const [notes, setNotes] = useState(record.notes),
    [tags, setTags] = useState(record.tags.join(", ")),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const quality =
    record.quality.status === "good"
      ? "measure.qualityGood"
      : record.quality.status === "poor"
        ? "measure.qualityPoor"
        : "measure.qualityLimited";
  return (
    <section className="result-panel">
      <div className="result-summary">
        <div className="score-block">
          <p className="eyebrow">{t("measure.score")}</p>
          <strong>
            {record.score === null ? t("common.none") : record.score.toFixed(1)}
          </strong>
          <p>
            {t(
              record.status === "completed"
                ? "measure.completed"
                : "measure.incomplete",
            )}
          </p>
        </div>
        <div className="result-metadata">
          <dl>
            <div>
              <dt>{t("common.date")}</dt>
              <dd>{date(record.createdAt)}</dd>
            </div>
            <div>
              <dt>{t("common.duration")}</dt>
              <dd>
                {t("common.seconds", {
                  count: Number((record.durationMs / 1000).toFixed(1)),
                })}
              </dd>
            </div>
            <div>
              <dt>{t("measure.quality")}</dt>
              <dd>{t(quality)}</dd>
            </div>
            <div>
              <dt>{t("measure.baselineUsed")}</dt>
              <dd>{date(record.baseline.createdAt)}</dd>
            </div>
            <div>
              <dt>{t("measure.availableChannels")}</dt>
              <dd>
                {(["primary", "temperature", "gsr"] as const)
                  .filter((c) => record.traces[c].length)
                  .map((c) => t(`graph.${c}`))
                  .join(", ") || t("common.none")}
              </dd>
            </div>
          </dl>
          <p className="micro">
            {t("common.version")}: {record.algorithmVersion}
          </p>
        </div>
      </div>
      <p className="subtle">{t("app.experimental")}</p>
      {record.device.source === "simulated" && (
        <Notice>{t("device.simulationNotice")}</Notice>
      )}
      <div className="result-actions">
        <span
          className={`save-status ${state === "error" ? "error-text" : ""}`}
        >
          {state === "saving" ? (
            <Busy label={t("common.saving")} />
          ) : (
            t(
              state === "saved"
                ? "history.saved"
                : state === "error"
                  ? "measure.saveFailed"
                  : "measure.localOnly",
            )
          )}
        </span>
        {state === "error" && (
          <button className="secondary" onClick={retry}>
            {t("common.retry")}
          </button>
        )}
        <button className="secondary" onClick={explain}>
          <Sparkles size={17} />
          {t("measure.explain")}
        </button>
      </div>
      <form
        className="notes-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError(false);
          setSaved(false);
          try {
            await saveNotes(
              notes,
              tags
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 12),
            );
            setSaved(true);
          } catch {
            setError(true);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          {t("common.notes")}
          <textarea
            rows={3}
            maxLength={4000}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(false);
            }}
            placeholder={t("measure.notesHint")}
          />
        </label>
        <label>
          {t("common.tags")}
          <input
            value={tags}
            onChange={(e) => {
              setTags(e.target.value);
              setSaved(false);
            }}
            maxLength={480}
            placeholder={t("measure.tagsHint")}
          />
        </label>
        <div className="inline-actions">
          <button className="secondary" disabled={saving}>
            {t(
              saving ? "common.saving" : saved ? "common.saved" : "common.save",
            )}
          </button>
          {error && <span role="alert">{t("error.save")}</span>}
        </div>
      </form>
    </section>
  );
}
export function MeasurementView({
  workspace: w,
  t,
  date,
  learn,
  explain,
}: {
  workspace: Workspace;
  t: Translate;
  date: (v: string) => string;
  learn: (id: string) => void;
  explain: (record: RecordType) => void;
}) {
  const s = w.snapshot,
    active = s.phase === "baseline" || s.phase === "capture";
  const [choice, setChoice] = useState(false);
  const record =
    s.result && (s.phase === "complete" || s.phase === "interrupted")
      ? w.measurements.find((m) => m.id === s.result!.id) || s.result
      : null;
  const prefs = w.profile.preferences,
    baseline = record?.baseline || s.baseline;
  const startNew = () => {
    w.acquisition.reset();
    setChoice(false);
  };
  const startCalibration = () => {
    setChoice(true);
    w.acquisition.startBaseline();
  };
  return (
    <>
      <PageHeading
        eyebrow={`01 / ${t("nav.measure")}`}
        title={t(record ? "measure.results" : "measure.title")}
        description={t(record ? "measure.resultHint" : "measure.description")}
        action={
          record ? (
            <button className="primary" onClick={startNew}>
              {t("measure.next")}
              <ArrowRight size={18} />
            </button>
          ) : undefined
        }
      />
      <div className="measurement-layout">
        <div className="measurement-main">
          <GraphPanel
            t={t}
            visibility={prefs.graphs}
            setVisibility={(graphs) => w.preferences({ ...prefs, graphs })}
            baseline={baseline}
            record={record}
            dateLabel={record ? date(record.createdAt) : undefined}
            onError={() => w.setError("graph.exportFailed")}
            notice={t("device.receiptTime")}
            getData={() => {
              const state = w.acquisition.getSnapshot();
              let traces = record?.traces || w.acquisition.getTraces();
              if (!active && !record && traces.primary.length) {
                const end = traces.primary.at(-1)!.t,
                  start = Math.max(0, end - 15000);
                traces = {
                  ...traces,
                  primary: traces.primary
                    .filter((p) => p.t >= start)
                    .map((p) => ({ ...p, t: p.t - start })),
                };
              }
              return {
                traces,
                baseline,
                units: record?.units || baseline?.units,
                visibility: prefs.graphs,
                labels: chartLabels(t),
                durationMs: record
                  ? 15000
                  : state.phase === "baseline"
                    ? 20000
                    : 15000,
                completed: !!record,
              };
            }}
          />
          {record && (
            <ResultDetails
              key={record.id}
              record={record}
              t={t}
              date={date}
              state={w.saveStates[record.id]}
              retry={() => void w.persist(record)}
              explain={() => explain(record)}
              saveNotes={(notes, tags) => w.notes(record, notes, tags)}
            />
          )}
        </div>
        <aside className="session-panel">
          <p className="eyebrow">{t("measure.session")}</p>
          <div className={`connection-state ${s.connected ? "connected" : ""}`}>
            <Bluetooth size={18} />
            <span>
              {t(
                s.connected
                  ? "device.connected"
                  : w.connection.status === "connecting"
                    ? "device.connecting"
                    : "device.disconnected",
              )}
            </span>
          </div>
          {!s.connected ? (
            <>
              <h2>{t("device.connect")}</h2>
              <p>{t("device.instructions")}</p>
              <button
                className="primary full"
                disabled={
                  w.connection.status === "connecting" ||
                  w.connection.status === "unavailable"
                }
                onClick={() => void w.client.connect()}
              >
                {t("device.connect")}
                <ArrowRight size={17} />
              </button>
              {w.connection.status === "unavailable" && (
                <p>{t("device.unavailable")}</p>
              )}
            </>
          ) : active ? (
            <>
              <h2>
                {t(
                  s.phase === "baseline"
                    ? "measure.calibrating"
                    : "measure.measuring",
                )}
              </h2>
              <p>{t("measure.calibrationHint")}</p>
              <div
                className="timer"
                role="timer"
                aria-label={t("measure.remaining", {
                  count: Math.ceil(s.remainingMs / 1000),
                })}
              >
                {Math.ceil(s.remainingMs / 1000)}
                <small>s</small>
              </div>
              <progress max={1} value={s.progress} />
              <p className="micro">
                {t("graph.sampleCount", { count: s.sampleCount })}
              </p>
              <button
                className="secondary full"
                onClick={() => {
                  w.acquisition.cancel();
                  setChoice(false);
                }}
              >
                {t("common.cancel")}
              </button>
            </>
          ) : (
            <>
              <h2>{t("measure.choose")}</h2>
              <p>{t("measure.chooseHint")}</p>
              {w.availableBaselines.length > 0 ? (
                <>
                  <label className="baseline-select">
                    {t("measure.older")}
                    <select
                      value={s.baselineCompatible ? s.baseline?.id || "" : ""}
                      onChange={(e) => {
                        const b = w.availableBaselines.find(
                          (b) => b.id === e.target.value,
                        );
                        if (b) {
                          w.selectBaseline(b);
                          setChoice(false);
                        }
                      }}
                    >
                      <option value="" disabled>
                        {t("measure.useSaved")}
                      </option>
                      {w.availableBaselines.map((b) => (
                        <option key={b.id} value={b.id}>
                          {date(b.createdAt)} · {b.device.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {s.baselineCompatible && (
                    <button
                      className="primary full"
                      onClick={() => {
                        if (choice) w.acquisition.startCapture();
                        else setChoice(true);
                      }}
                    >
                      {t(choice ? "measure.start" : "measure.useSaved")}
                      <ArrowRight size={17} />
                    </button>
                  )}
                </>
              ) : (
                <p className="micro">{t("measure.noCompatible")}</p>
              )}
              <button
                className={
                  w.availableBaselines.length
                    ? "secondary full"
                    : "primary full"
                }
                onClick={startCalibration}
              >
                <RotateCcw size={17} />
                {t(
                  w.availableBaselines.length
                    ? "measure.recalibrate"
                    : "measure.calibrate",
                )}
              </button>
              {w.hasMoreBaselines && (
                <button
                  className="text-button"
                  disabled={w.loading}
                  onClick={() => void w.moreBaselines()}
                >
                  {t("settings.loadMore")}
                </button>
              )}
              <p className="micro">{t("measure.keepPrevious")}</p>
            </>
          )}
          {s.issue && (
            <Notice kind={s.issue === "cancelled" ? "info" : "error"}>
              {t(`measure.${s.issue}`)}
            </Notice>
          )}
          {baseline && (
            <div className="baseline-info">
              <p className="eyebrow">{t("graph.baseline")}</p>
              <strong>{date(baseline.createdAt)}</strong>
              <p className="micro">
                {baseline.sampleCount} · {t("common.samples")}
              </p>
              <span className="micro">{baseline.device.name}</span>
              {w.saveStates[baseline.id] === "error" && (
                <button
                  className="text-button"
                  onClick={() => void w.persist(baseline)}
                >
                  {t("common.retry")}
                </button>
              )}
            </div>
          )}
          <button
            className="guide-link"
            onClick={() => learn("preparing-a-measurement")}
          >
            {t("measure.setupGuide")}
            <ArrowRight size={17} />
          </button>
          <p className="micro">{t("device.protocolNote")}</p>
        </aside>
      </div>
    </>
  );
}
