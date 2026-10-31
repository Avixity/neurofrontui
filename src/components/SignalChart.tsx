import { useEffect, useRef } from "react";
import type {
  Baseline,
  Channel,
  GraphVisibility,
  Sample,
  Traces,
} from "../types";

export type ChartLabels = Record<Channel, string> & {
  waiting: string;
  baseline: string;
  elapsed: string;
  empty: string;
  raw: string;
};
export type ChartData = {
  traces: Traces;
  baseline?: Baseline | null;
  visibility: GraphVisibility;
  durationMs?: number;
  labels: ChartLabels;
  completed?: boolean;
  units?: Record<Channel, string>;
};
const colors: Record<Channel, string> = {
  primary: "#a7d8c6",
  temperature: "#e4b774",
  gsr: "#9bbadf",
};
const channels: Channel[] = ["primary", "temperature", "gsr"];
export function chartDomain(
  values: readonly Sample[],
  reference: readonly Sample[],
  channel: Channel,
) {
  const extent = (samples: readonly Sample[]) => {
    let low = Infinity,
      high = -Infinity;
    for (const sample of samples) {
      low = Math.min(low, sample.value);
      high = Math.max(high, sample.value);
    }
    return { low, high };
  };
  const minimumSpan = channel === "primary" ? 26 : 1;
  const base = extent(reference.length ? reference : values);
  if (!Number.isFinite(base.low))
    return { low: -minimumSpan / 2, high: minimumSpan / 2, span: minimumSpan };
  const center = (base.low + base.high) / 2;
  const initialSpan = Math.max(
    minimumSpan,
    (base.high - base.low) * (reference.length ? 3 : 1.25),
  );
  const current = extent(values);
  const margin = Math.max(
    minimumSpan * 0.05,
    (current.high - current.low) * 0.05,
  );
  const low = Math.min(center - initialSpan / 2, current.low - margin);
  const high = Math.max(center + initialSpan / 2, current.high + margin);
  return { low, high, span: high - low };
}

function sampleKey(samples: readonly Sample[]) {
  const first = samples[0],
    last = samples.at(-1);
  return `${samples.length}:${first?.t}:${first?.value}:${last?.t}:${last?.value}:${last?.timestamp}`;
}
export function wrapChartLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (part: string) => {
    const next = line ? `${line} ${part}` : part;
    if (ctx.measureText(next).width <= width) {
      line = next;
      return;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (ctx.measureText(part).width <= width) {
      line = part;
      return;
    }
    const segments = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(part);
    for (const { segment } of segments) {
      if (line && ctx.measureText(line + segment).width > width) {
        lines.push(line);
        line = "";
      }
      line += segment;
    }
  };
  text.split(/\s+/).forEach(push);
  if (line) lines.push(line);
  return lines;
}
export function chartFingerprint(data: ChartData) {
  return JSON.stringify([
    data.durationMs,
    data.completed,
    data.labels,
    data.units,
    data.baseline?.units,
    channels.map((channel) => [
      data.visibility[channel],
      data.visibility[channel] ? sampleKey(data.traces[channel]) : "",
    ]),
    data.visibility.baseline,
    channels.map((channel) =>
      data.visibility[channel]
        ? [data.baseline?.id, sampleKey(data.baseline?.traces[channel] ?? [])]
        : "",
    ),
  ]);
}

export function drawChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: ChartData,
) {
  const { traces, baseline, visibility, labels } = data;
  const visible = channels.filter((channel) => visibility[channel]);
  ctx.fillStyle = "#151b18";
  ctx.fillRect(0, 0, width, height);
  if (!visible.length) {
    ctx.fillStyle = "#aab8ae";
    ctx.font = "15px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(labels.empty, width / 2, height / 2);
    return;
  }
  const left = width < 500 ? 58 : 72,
    right = width - 24,
    top = 43,
    row = (height - top - 40) / visible.length;
  const duration = data.durationMs || 15000;
  if (
    visibility.baseline &&
    visible.some((channel) => baseline?.traces[channel].length)
  ) {
    ctx.strokeStyle = "#a0ada3";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(left, 21);
    ctx.lineTo(left + 25, 21);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#b4c0b7";
    ctx.font = "12px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(labels.baseline, left + 34, 25);
  }
  visible.forEach((channel, index) => {
    const values = traces[channel];
    const reference =
      baseline?.traces[channel].filter((sample) => sample.t <= duration) || [];
    const storedUnit = data.units?.[channel] ?? baseline?.units?.[channel];
    const unit =
      storedUnit === "device units"
        ? labels.raw
        : (storedUnit ??
          (channel === "primary"
            ? labels.raw
            : channel === "temperature"
              ? "°C"
              : "µS"));
    ctx.font = "500 14px system-ui";
    ctx.textAlign = "left";
    ctx.fillStyle = colors[channel];
    const heading = wrapChartLabel(
      ctx,
      `${labels[channel]} · ${unit}`,
      right - left,
    );
    const yTop = top + index * row + 26 + (heading.length - 1) * 18,
      yBottom = top + (index + 1) * row - 36;
    heading.forEach((line, lineIndex) =>
      ctx.fillText(line, left, top + index * row + 11 + lineIndex * 18),
    );
    const { low, high, span } = chartDomain(values, reference, channel);
    const pointX = (t: number) =>
      left + (Math.max(0, t) / duration) * (right - left);
    const pointY = (value: number) =>
      yBottom - ((value - low) / span) * (yBottom - yTop);
    ctx.font = "12px ui-monospace,monospace";
    for (let line = 0; line < 3; line++) {
      const y = yTop + ((yBottom - yTop) * line) / 2;
      ctx.strokeStyle = "#2b3630";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = "#a9b7ad";
      ctx.textAlign = "right";
      ctx.fillText(
        (high - (span * line) / 2).toFixed(channel === "primary" ? 0 : 1),
        left - 12,
        y + 4,
      );
    }
    const path = (samples: typeof values, isReference: boolean) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, yTop - 2, right - left, yBottom - yTop + 4);
      ctx.clip();
      ctx.strokeStyle = isReference ? "#c4cec4" : colors[channel];
      ctx.globalAlpha = isReference ? 0.28 : 1;
      ctx.setLineDash(isReference ? [4, 5] : []);
      ctx.lineWidth = isReference ? 1 : 1.7;
      ctx.beginPath();
      let previous = -Infinity;
      for (const sample of samples) {
        if (sample.t < 0 || sample.t > duration) continue;
        const x = pointX(sample.t),
          y = pointY(sample.value);
        if (sample.t - previous > 1000) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        previous = sample.t;
      }
      ctx.stroke();
      ctx.restore();
    };
    if (visibility.baseline && reference.length) path(reference, true);
    path(values, false);
    if (!values.length) {
      ctx.fillStyle = "#aab8ae";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(
        labels.waiting,
        (left + right) / 2,
        (yTop + yBottom) / 2 - 10,
      );
    }
    if (index === visible.length - 1) {
      ctx.fillStyle = "#a9b7ad";
      ctx.font = "12px ui-monospace,monospace";
      for (let mark = 0; mark <= 3; mark++) {
        ctx.textAlign = mark === 0 ? "left" : mark === 3 ? "right" : "center";
        ctx.fillText(
          `${(((duration / 1000) * mark) / 3).toFixed(0)}s`,
          left + ((right - left) * mark) / 3,
          yBottom + 24,
        );
      }
      ctx.textAlign = "center";
      ctx.fillText(labels.elapsed, (left + right) / 2, height - 10);
    }
  });
  ctx.setLineDash([]);
}

export function SignalChart({
  getData,
  label,
  revision = 0,
}: {
  getData: () => ChartData;
  label: string;
  revision?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    read = useRef(getData),
    version = useRef(revision);
  read.current = getData;
  version.current = revision;
  const visibility = getData().visibility;
  const visibleCount = channels.filter((channel) => visibility[channel]).length;
  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext("2d");
    let frame = 0,
      last = 0,
      shown = false,
      width = 0,
      height = 0,
      prior = "",
      draws = 0;
    const draw = (time: number) => {
      frame = 0;
      if (!shown || document.hidden) return;
      if (time - last >= 1000 / 30 && width > 0 && height > 0 && ctx) {
        last = time;
        const ratio = Math.min(devicePixelRatio || 1, 1.5),
          data = read.current();
        const fingerprint = `${width}:${height}:${ratio}:${version.current}:${chartFingerprint(data)}`;
        if (fingerprint !== prior) {
          prior = fingerprint;
          const w = Math.round(width * ratio),
            h = Math.round(height * ratio);
          if (element.width !== w || element.height !== h) {
            element.width = w;
            element.height = h;
          }
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          drawChart(ctx, width, height, data);
          element.dataset.draws = String(++draws);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!frame && shown && !document.hidden)
        frame = requestAnimationFrame(draw);
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else wake();
    };
    const resize = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      width = rect.width;
      height = rect.height;
      wake();
    });
    const observer = new IntersectionObserver((entries) => {
      shown = entries[0].isIntersecting;
      cancelAnimationFrame(frame);
      frame = 0;
      wake();
    });
    resize.observe(element);
    observer.observe(element);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className="signal-canvas"
      style={{ height: Math.max(280, visibleCount * 230 + 70) }}
      role="img"
      aria-label={label}
    />
  );
}
