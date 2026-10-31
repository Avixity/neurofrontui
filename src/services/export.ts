import type { Measurement } from "../types";
import { drawChart, type ChartData } from "../components/SignalChart";
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCsv(record: Measurement) {
  const lines = [
    "record_id,source,phase,timestamp_iso,elapsed_ms,channel,unit,value",
  ];
  for (const [phase, traces] of [
    ["measurement", record.traces],
    ["baseline", record.baseline.traces],
  ] as const) {
    for (const channel of ["primary", "temperature", "gsr"] as const) {
      for (const sample of traces[channel])
        lines.push(
          [
            record.id,
            record.device.source,
            phase,
            new Date(sample.timestamp).toISOString(),
            sample.t,
            channel,
            record.units[channel],
            sample.value,
          ]
            .map(csvCell)
            .join(","),
        );
    }
  }
  download(
    `neurofront-${record.id}.csv`,
    new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
}
function csvCell(value: unknown) {
  const text = String(value).replace(/^[=+@]/, "'$&");
  return `"${text.replace(/"/g, '""')}"`;
}
export function exportJson(value: unknown) {
  download(
    "neurofront-data.json",
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
}
export async function exportPng(
  record: Measurement,
  data: ChartData,
  title: string,
  date: string,
  notices: string[] = [],
) {
  const canvas = document.createElement("canvas");
  const count = ["primary", "temperature", "gsr"].filter(
    (key) => data.visibility[key as keyof typeof data.visibility],
  ).length;
  const header = 160 + notices.length * 60;
  canvas.width = 1600;
  canvas.height = header + Math.max(340, count * 250 + 70);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#111713";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#eff1e8";
  ctx.font = "32px system-ui";
  ctx.fillText(`NeuroFront · ${title}`, 72, 55);
  ctx.fillStyle = "#b4c0b7";
  ctx.font = "20px system-ui";
  ctx.fillText(date, 72, 96);
  notices.forEach((notice, index) => {
    ctx.fillText(notice, 72, 138 + index * 60, 1456);
  });
  ctx.save();
  ctx.translate(0, header);
  drawChart(ctx, canvas.width, canvas.height - header, {
    ...data,
    completed: true,
  });
  ctx.restore();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("export");
  download(`neurofront-${record.id}.png`, blob);
}
