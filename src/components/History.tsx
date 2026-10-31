import { useState } from "react";
import { ArrowLeft, ArrowUpRight, Trash2 } from "lucide-react";
import type { Workspace } from "../useWorkspace";
import type { Measurement } from "../types";
import { Empty, PageHeading, type Translate } from "./ui";
import { GraphPanel, chartLabels } from "./GraphPanel";
import { ResultDetails } from "./Measurement";
export function Trend({
  records,
  t,
  open,
  date,
}: {
  records: Measurement[];
  t: Translate;
  open: (m: Measurement) => void;
  date: (s: string) => string;
}) {
  const rows = records
    .filter((m) => m.status === "completed" && m.score !== null)
    .slice(0, 24)
    .reverse();
  return (
    <div className="trend">
      <div className="panel-heading">
        <h2>{t("history.trend")}</h2>
        <span className="micro">0–100</span>
      </div>
      <p className="micro">{t("history.trendHint")}</p>
      {!rows.length ? (
        <p className="subtle">{t("history.emptyHint")}</p>
      ) : (
        <div className="trend-bars">
          {rows.map((m, i) => {
            const changed =
              i > 0 &&
              (rows[i - 1].baselineId !== m.baselineId ||
                rows[i - 1].algorithmVersion !== m.algorithmVersion);
            return (
              <button
                key={m.id}
                onClick={() => open(m)}
                title={`${date(m.createdAt)}: ${m.score?.toFixed(1)}${changed ? " · " + t("history.newBaseline") : ""}`}
                aria-label={`${t("history.open")}, ${date(m.createdAt)}, ${m.score?.toFixed(1)}${changed ? ", " + t("history.newBaseline") : ""}`}
                className={changed ? "changed" : ""}
              >
                <span className="bar-score">{m.score?.toFixed(0)}</span>
                <span
                  className="bar"
                  style={{ height: Math.max(2, m.score || 0) + "%" }}
                />
                <span className="bar-label">{i + 1}</span>
                {changed && <i aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
export function History({
  w,
  t,
  date,
  selected,
  setSelected,
  explain,
  newMeasurement,
}: {
  w: Workspace;
  t: Translate;
  date: (s: string) => string;
  selected: string | null;
  setSelected: (id: string | null) => void;
  explain: (m: Measurement) => void;
  newMeasurement: () => void;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const record = w.measurements.find((m) => m.id === selected),
    prefs = w.profile.preferences;
  function localDay(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: prefs.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  }
  const rows = w.measurements.filter(
    (m) =>
      (!from || localDay(m.createdAt) >= from) &&
      (!to || localDay(m.createdAt) <= to),
  );
  if (record)
    return (
      <>
        <button className="text-button" onClick={() => setSelected(null)}>
          <ArrowLeft size={17} />
          {t("nav.history")}
        </button>
        <PageHeading
          eyebrow={t("history.open")}
          title={t("measure.results")}
          description={date(record.createdAt)}
          action={
            <button
              className="secondary"
              onClick={() => {
                if (confirm(t("common.confirmDelete")))
                  void w
                    .removeRecord(record.id)
                    .then(() => setSelected(null))
                    .catch(() => w.setError("history.deleteFailed"));
              }}
            >
              <Trash2 size={17} />
              {t("common.delete")}
            </button>
          }
        />
        <GraphPanel
          t={t}
          visibility={prefs.graphs}
          setVisibility={(graphs) => w.preferences({ ...prefs, graphs })}
          baseline={record.baseline}
          record={record}
          dateLabel={date(record.createdAt)}
          onError={() => w.setError("graph.exportFailed")}
          getData={() => ({
            traces: record.traces,
            baseline: record.baseline,
            units: record.units,
            visibility: prefs.graphs,
            labels: chartLabels(t),
            durationMs: 15000,
            completed: true,
          })}
        />
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
      </>
    );
  return (
    <>
      <PageHeading
        eyebrow={`02 / ${t("nav.history")}`}
        title={t("history.title")}
        description={t("history.description")}
      />
      <div className="history-filters">
        <label>
          {t("common.from")}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          {t("common.to")}
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <Trend records={rows} t={t} date={date} open={(m) => setSelected(m.id)} />
      <div className="session-list">
        {rows.map((m) => (
          <button
            key={m.id}
            className="session-row"
            onClick={() => setSelected(m.id)}
          >
            <span className="session-date">
              <strong>{date(m.createdAt)}</strong>
              <small>
                {t(
                  m.status === "completed"
                    ? "measure.completed"
                    : "measure.incomplete",
                )}
                {m.device.source === "simulated"
                  ? " · " + t("device.simulated")
                  : ""}
              </small>
            </span>
            <span>
              <small>{t("measure.score")}</small>
              <strong>{m.score?.toFixed(1) ?? t("common.none")}</strong>
            </span>
            <span className="session-channel">
              <small>{t("common.duration")}</small>
              <strong>
                {t("common.seconds", {
                  count: Number((m.durationMs / 1000).toFixed(1)),
                })}
              </strong>
            </span>
            <ArrowUpRight size={19} />
          </button>
        ))}
      </div>
      {!rows.length && (
        <Empty
          title={t(
            w.measurements.length ? "history.filteredEmpty" : "history.empty",
          )}
          description={t("history.emptyHint")}
          action={
            <button className="primary" onClick={newMeasurement}>
              {t("overview.new")}
            </button>
          }
        />
      )}{" "}
      {w.hasMore && (
        <button
          className="secondary"
          disabled={w.loading}
          onClick={() => void w.more()}
        >
          {t("history.loadMore")}
        </button>
      )}
    </>
  );
}
