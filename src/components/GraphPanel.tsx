import { Download, Check } from "lucide-react";
import type { Baseline, GraphVisibility, Measurement } from "../types";
import { SignalChart, type ChartData, type ChartLabels } from "./SignalChart";
import { exportCsv, exportPng } from "../services/export";
import type { Translate } from "./ui";
export function chartLabels(t: Translate): ChartLabels {
  return {
    primary: t("graph.primary"),
    temperature: t("graph.temperature"),
    gsr: t("graph.gsr"),
    baseline: t("graph.baseline"),
    waiting: t("device.waiting"),
    elapsed: t("graph.elapsed"),
    empty: t("graph.noChannels"),
    raw: t("device.rawUnits"),
  };
}
export function GraphControls({
  t,
  visibility,
  setVisibility,
  baseline,
}: {
  t: Translate;
  visibility: GraphVisibility;
  setVisibility: (v: GraphVisibility) => void;
  baseline?: Baseline | null;
}) {
  const keys = ["primary", "temperature", "gsr", "baseline"] as const;
  return (
    <div className="graph-options">
      <div
        className="graph-switches"
        role="group"
        aria-label={t("graph.visibility")}
      >
        {keys.map((key) => (
          <button
            key={key}
            className={`graph-chip ${key}`}
            aria-pressed={visibility[key]}
            disabled={key === "baseline" && !baseline?.traces.primary.length}
            onClick={() =>
              setVisibility({ ...visibility, [key]: !visibility[key] })
            }
          >
            <span className="check-square">
              {visibility[key] && <Check size={12} />}
            </span>
            {t(`graph.${key}`)}
          </button>
        ))}
      </div>
      <p className="micro">
        {baseline?.traces.primary.length
          ? t("graph.visibilityHint")
          : t("graph.noBaseline")}
      </p>
    </div>
  );
}
export function GraphPanel({
  t,
  getData,
  visibility,
  setVisibility,
  baseline,
  record,
  notice,
  dateLabel,
  onError,
}: {
  t: Translate;
  getData: () => ChartData;
  visibility: GraphVisibility;
  setVisibility: (v: GraphVisibility) => void;
  baseline?: Baseline | null;
  record?: Measurement | null;
  notice?: string;
  dateLabel?: string;
  onError: () => void;
}) {
  const data = getData();
  return (
    <section className="graph-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {record ? t("graph.preview") : t("measure.graphTitle")}
          </p>
          <h2>{t("graph.primary")}</h2>
        </div>
        {record && (
          <div className="export-actions">
            <button
              className="icon-button"
              title={t("graph.exportPng")}
              aria-label={t("graph.exportPng")}
              onClick={() =>
                void exportPng(
                  record,
                  getData(),
                  t("graph.preview"),
                  dateLabel || new Date(record.createdAt).toLocaleString(),
                  [
                    t("app.experimental"),
                    ...(record.device.source === "simulated"
                      ? [t("device.simulationNotice")]
                      : []),
                    ...(record.status === "interrupted"
                      ? [t("measure.incomplete")]
                      : []),
                  ],
                ).catch(onError)
              }
            >
              <Download size={18} />
              <span>PNG</span>
            </button>
            <button
              className="icon-button"
              title={t("graph.exportCsv")}
              aria-label={t("graph.exportCsv")}
              onClick={() => {
                try {
                  exportCsv(record);
                } catch {
                  onError();
                }
              }}
            >
              <Download size={18} />
              <span>CSV</span>
            </button>
          </div>
        )}
      </div>
      <GraphControls
        t={t}
        visibility={visibility}
        setVisibility={setVisibility}
        baseline={baseline}
      />
      <SignalChart getData={getData} label={t("measure.graphTitle")} />
      <dl className="graph-readouts">
        {(["primary", "temperature", "gsr"] as const)
          .filter((channel) => visibility[channel])
          .map((channel) => {
            const sample = data.traces[channel].at(-1);
            const rawUnit =
              data.units?.[channel] || data.baseline?.units[channel];
            const unit =
              rawUnit === "device units" ? t("device.rawUnits") : rawUnit;
            return (
              <div key={channel}>
                <dt>{t(`graph.${channel}`)}</dt>
                <dd>
                  {sample ? (
                    <>
                      <strong>{sample.value.toFixed(2)}</strong>{" "}
                      <small>{unit}</small>
                    </>
                  ) : (
                    t("device.waiting")
                  )}
                </dd>
              </div>
            );
          })}
      </dl>
      <div className="chart-foot">
        <span className="legend-live">
          {t(record ? "graph.preview" : "graph.live")}
        </span>
        {visibility.baseline && baseline && (
          <span className="legend-baseline">{t("graph.baseline")}</span>
        )}
        {notice && <span>{notice}</span>}
      </div>
    </section>
  );
}
