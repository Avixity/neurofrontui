import { describe, expect, it, vi } from "vitest";
import {
  chartDomain,
  chartFingerprint,
  drawChart,
  wrapChartLabel,
  type ChartData,
} from "../src/components/SignalChart";
import { emptyTraces, type Baseline, type Sample } from "../src/types";

const samples = (...values: number[]): Sample[] =>
  values.map((value, i) => ({
    value,
    t: i * 100,
    timestamp: 1_800_000_000_000 + i * 100,
  }));
const data = (): ChartData => ({
  traces: { ...emptyTraces(), primary: samples(1, 2, 3) },
  baseline: {
    id: "reference",
    traces: { ...emptyTraces(), primary: samples(1, 2, 1) },
  } as Baseline,
  visibility: { primary: true, temperature: false, gsr: false, baseline: true },
  labels: {
    primary: "Primary signal",
    temperature: "Temperature",
    gsr: "Conductance",
    waiting: "Waiting",
    baseline: "Saved baseline reference",
    elapsed: "Elapsed time",
    empty: "No channels",
    raw: "device units",
  },
  durationMs: 15000,
});

describe("chart display and export", () => {
  it("keeps a baseline anchored domain until actual values require more room", () => {
    const reference = samples(0, 10, 0),
      initial = chartDomain([], reference, "primary");
    expect(chartDomain(samples(2, 5), reference, "primary")).toEqual(initial);
    const expanded = chartDomain(samples(-1000, 5000), reference, "primary");
    expect(expanded.low).toBeLessThan(-1000);
    expect(expanded.high).toBeGreaterThan(5000);
    expect(initial.low).toBe(-10);
    expect(initial.high).toBe(20);
  });
  it("uses finite nonzero domains for missing or constant channels", () => {
    for (const channel of ["primary", "temperature", "gsr"] as const) {
      for (const values of [[], samples(7, 7)]) {
        const result = chartDomain(values, [], channel);
        expect(Number.isFinite(result.low + result.high + result.span)).toBe(
          true,
        );
        expect(result.span).toBeGreaterThan(0);
      }
    }
  });
  it("does not redraw identical immutable sample tails but tracks labels, switches and new data", () => {
    const original = data(),
      key = chartFingerprint(original);
    expect(chartFingerprint(structuredClone(original))).toBe(key);
    const later = data();
    later.traces.primary.push({
      t: 300,
      timestamp: 1_800_000_000_300,
      value: 9,
    });
    expect(chartFingerprint(later)).not.toBe(key);
    for (const modified of [
      { ...original, visibility: { ...original.visibility, baseline: false } },
      {
        ...original,
        labels: { ...original.labels, baseline: "Localized reference" },
      },
      { ...original, durationMs: 20000 },
    ])
      expect(chartFingerprint(modified)).not.toBe(key);
  });
  it("draws a localized baseline legend into the canvas used by PNG export", () => {
    const methods = [
      "fillRect",
      "fillText",
      "beginPath",
      "moveTo",
      "lineTo",
      "stroke",
      "setLineDash",
      "save",
      "rect",
      "clip",
      "restore",
    ];
    const ctx = Object.fromEntries(
      methods.map((name) => [name, vi.fn()]),
    ) as unknown as CanvasRenderingContext2D;
    ctx.measureText = (text) => ({ width: text.length * 7 }) as TextMetrics;
    const chart = data();
    drawChart(ctx, 1600, 340, chart);
    expect(ctx.fillText).toHaveBeenCalledWith(
      "Saved baseline reference",
      106,
      25,
    );
    vi.mocked(ctx.fillText).mockClear();
    drawChart(ctx, 1600, 340, {
      ...chart,
      visibility: { ...chart.visibility, baseline: false },
    });
    expect(
      vi
        .mocked(ctx.fillText)
        .mock.calls.some(([text]) => text === "Saved baseline reference"),
    ).toBe(false);
  });
  it("does not redraw when only a hidden channel receives more samples", () => {
    const chart = data();
    chart.visibility.primary = false;
    const key = chartFingerprint(chart);
    chart.traces.primary.push({
      t: 300,
      timestamp: 1_800_000_000_300,
      value: 9,
    });
    expect(chartFingerprint(chart)).toBe(key);
  });
  it("renders supplied record units instead of assuming a channel calibration", () => {
    const methods = [
      "fillRect",
      "fillText",
      "beginPath",
      "moveTo",
      "lineTo",
      "stroke",
      "setLineDash",
      "save",
      "rect",
      "clip",
      "restore",
    ];
    const ctx = Object.fromEntries(
      methods.map((name) => [name, vi.fn()]),
    ) as unknown as CanvasRenderingContext2D;
    ctx.measureText = (text) => ({ width: text.length * 7 }) as TextMetrics;
    const chart = data();
    chart.units = { primary: "mV", temperature: "°C", gsr: "µS" };
    drawChart(ctx, 1600, 340, chart);
    expect(
      vi
        .mocked(ctx.fillText)
        .mock.calls.some(([text]) => text === "Primary signal · mV"),
    ).toBe(true);
    expect(chartFingerprint(chart)).not.toBe(chartFingerprint(data()));
  });
  it("wraps long localized channel labels while retaining complete readable text", () => {
    const ctx = {
      measureText: (text: string) => ({
        width:
          [
            ...new Intl.Segmenter("ta", { granularity: "grapheme" }).segment(
              text,
            ),
          ].length * 10,
      }),
    } as CanvasRenderingContext2D;
    const text = "முதன்மை சமிக்ஞை · சாதன அலகுகள்";
    const lines = wrapChartLabel(ctx, text, 150);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(text);
    expect(lines.every((line) => ctx.measureText(line).width <= 150)).toBe(
      true,
    );
  });
});
