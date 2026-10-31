import type { Features } from "../types";

export const ALGORITHM_VERSION = "legacy-activity-v1";
export const ACQUISITION_VERSION = "notification-v1";
export const SCHEMA_VERSION = 2;

export function computeSignalFeatures(samples: readonly number[]): Features {
  if (!samples.length)
    return { mean: 0, rms: 0, stdDev: 0, peakToPeak: 0, derivativeMean: 0 };
  let sum = 0,
    squareSum = 0,
    min = Infinity,
    max = -Infinity,
    derivativeSum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    sum += value;
    squareSum += value * value;
    if (value < min) min = value;
    if (value > max) max = value;
    if (index > 0) derivativeSum += Math.abs(value - samples[index - 1]);
  }
  const mean = sum / samples.length;
  let varianceSum = 0;
  for (const value of samples) varianceSum += (value - mean) ** 2;
  return {
    mean,
    rms: Math.sqrt(squareSum / samples.length),
    stdDev: Math.sqrt(varianceSum / samples.length),
    peakToPeak: max - min,
    derivativeMean:
      samples.length > 1 ? derivativeSum / (samples.length - 1) : 0,
  };
}

export function compositeActivity(features: Features): number {
  return (
    features.stdDev * 0.5 +
    features.peakToPeak * 0.35 +
    features.derivativeMean * 0.15
  );
}

export function calculateScore(current: Features, baseline: Features): number {
  const baselineActivity = Math.max(1, compositeActivity(baseline));
  const currentActivity = compositeActivity(current);
  const relativeDelta = (currentActivity - baselineActivity) / baselineActivity;
  return Math.min(100, Math.max(0, 50 + relativeDelta * 38));
}

export type LegacyScoreBand = "relaxed" | "balanced" | "elevated" | "high";
export function scoreBand(score: number): LegacyScoreBand {
  return score < 35
    ? "relaxed"
    : score < 60
      ? "balanced"
      : score < 78
        ? "elevated"
        : "high";
}

export function summarizeActivity(samples: readonly number[]) {
  const features = computeSignalFeatures(samples);
  const minimum = samples.length ? Math.min(...samples) : 0;
  const peak = samples.length ? Math.max(...samples) : 0;
  const activity =
    features.peakToPeak / Math.max(12, Math.abs(features.mean) * 0.25) +
    features.stdDev / Math.max(5, Math.abs(features.mean) * 0.12);
  const band: "stable" | "moderate" | "high" =
    activity >= 1.9 ? "high" : activity >= 1.1 ? "moderate" : "stable";
  return { average: features.mean, peak, minimum, activity, band };
}
