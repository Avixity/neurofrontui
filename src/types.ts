export type Channel = "primary" | "temperature" | "gsr";
export type Source = "bluetooth" | "simulated";
export type Sample = { t: number; timestamp: number; value: number };
export type Traces = Record<Channel, Sample[]>;
export type Features = {
  mean: number;
  rms: number;
  stdDev: number;
  peakToPeak: number;
  derivativeMean: number;
};
export type Quality = {
  status: "good" | "limited" | "poor";
  issues: string[];
  validSamples: number;
  invalidPackets: number;
  maxGapMs: number;
};
export type DeviceInfo = {
  name: string;
  id?: string;
  serviceUuid: string;
  characteristicUuid: string;
  protocol: string;
  setup: string;
  timestampSource: "browser-receipt";
  source: Source;
};
export type Baseline = {
  id: string;
  createdAt: string;
  durationMs: number;
  sampleCount: number;
  traces: Traces;
  units: Record<Channel, string>;
  features: Features;
  quality: Quality;
  device: DeviceInfo;
  algorithmVersion: string;
  acquisitionVersion: string;
  schemaVersion: number;
};
export type Measurement = {
  id: string;
  createdAt: string;
  durationMs: number;
  sampleCount: number;
  traces: Traces;
  units: Record<Channel, string>;
  features: Features;
  quality: Quality;
  device: DeviceInfo;
  algorithmVersion: string;
  acquisitionVersion: string;
  schemaVersion: number;
  baselineId: string;
  baseline: Baseline;
  score: number | null;
  status: "completed" | "interrupted";
  notes: string;
  tags: string[];
};
export type GraphVisibility = Record<Channel | "baseline", boolean>;
export type Preferences = {
  language: string;
  timeZone: string;
  graphs: GraphVisibility;
  saveChat: boolean;
};
export type Profile = {
  displayName: string;
  email: string;
  preferences: Preferences;
  activeBaselineId: string | null;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
export type Conversation = {
  id: string;
  createdAt: string;
  title: string;
  language: string;
  messages: ChatMessage[];
};
export type SaveState = "local" | "saving" | "saved" | "error";
export const DEFAULT_GRAPHS: GraphVisibility = {
  primary: true,
  temperature: false,
  gsr: false,
  baseline: true,
};
export const emptyTraces = (): Traces => ({
  primary: [],
  temperature: [],
  gsr: [],
});
