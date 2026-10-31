import type { ResourceCopy } from "./types";
export const en: ResourceCopy = {
  headings: ["The idea", "In practice"],
  categories: {
    device: "The device",
    baseline: "Your baseline",
    signals: "Signal quality",
    results: "Your results",
  },
  articles: {
    "what-neurofront-measures": [
      "What NeuroFront measures",
      "A real prototype with a clearly defined data path.",
      "The fabric headband connects by wire to a separate controller. An AD8232 ECG front end conditions small electrical signals; it is not an EEG sensor or a way to read thoughts.",
      "This app receives the first numeric field in each Bluetooth notification as the primary signal, in raw device units. It does not turn that trace into a clinical ECG report or a verified heart-rate reading.",
    ],
    "personal-baseline": [
      "Your own resting baseline",
      "A recorded reference for this setup and session.",
      "Calibration records a 20-second window starting when you press Record baseline. Each sample is timestamped when the browser receives it. Usable incoming data is required; a timer alone cannot create a baseline.",
      "Rest comfortably and keep the contacts steady. A new baseline replaces the active reference only after calibration succeeds. A changed setup or calculation may require a fresh baseline.",
    ],
    "preparing-a-measurement": [
      "Prepare for a measurement",
      "A short checklist for a useful recording.",
      "Follow the prototype team’s placement instructions, power on the separate controller and support the connecting cable. Sit comfortably and check that the primary trace is receiving data.",
      "Choose a compatible baseline or record 20 seconds at rest. Then start the 15-second capture. Keep this tab active and avoid adjusting the contacts during recording; add any relevant context to your notes afterward.",
    ],
    "signal-quality": [
      "Understand signal quality",
      "Movement and contact can change the trace.",
      "An electrical signal can include movement, poor electrode contact and electrical interference. A large spike does not establish a stressful event. A nearly flat trace is not proof of relaxation.",
      "Review missing samples, gaps and quality notes before comparing scores. If the signal is interrupted or unusually flat, check the setup and record again. Incomplete recordings should not be treated as complete measurements.",
    ],
    "sensor-channels": [
      "Know which channels are measured",
      "Available hardware is different from received data.",
      "The prototype includes an electrical front end, a skin-conductance sensor and a thermistor. Skin conductance relates to sweat-gland activity and can respond to several stimuli; it is not specific to stress.",
      "The current firmware protocol supplies only the primary signal. Temperature and GSR therefore wait for received data; the app does not invent values. Graph visibility changes the display, not acquisition or calculation.",
    ],
    "experimental-score": [
      "How the experimental score works",
      "A comparison of signal variation, not a diagnosis.",
      "Activity combines standard deviation, peak-to-peak range and mean absolute change between successive samples with weights 0.50, 0.35 and 0.15. The score compares current activity with baseline activity and is limited to 0–100.",
      "The divisor is the larger of baseline activity and 1. Equal activity gives 50 only when this minimum has no effect. Two unchanging signals can instead produce 12. The score is not a stress percentage, a trained AI prediction or a validated clinical threshold.",
    ],
    "comparing-baseline": [
      "Compare with the right reference",
      "Keep the baseline fixed while viewing your recording.",
      "The baseline trace is a recorded reference, not a moving target that follows the live signal. A completed session keeps the exact baseline snapshot and calculation version used for its result.",
      "Compare similar setups and check signal quality first. Selecting a different baseline for a future capture does not rewrite older results. Changes in contact or motion can change the score without identifying a change in stress.",
    ],
    "reading-history": [
      "Read your history with context",
      "Each session is a snapshot, not a verdict.",
      "Review the recording date, baseline, source, quality and notes together. Baseline and calculation changes matter when comparing sessions. Simulated input is test data and must remain distinct from physical device recordings.",
      "Guest readings remain in the current tab session. Account records are saved only when the app confirms it. Share exports deliberately, and use trends to ask questions rather than diagnose yourself or compare your worth with others.",
    ],
    troubleshooting: [
      "When a recording does not work",
      "Check the connection before interpreting the result.",
      "Device connection needs a supported browser with Web Bluetooth, such as Chrome or Edge on a supported platform. Keep the controller powered, choose NeuroFront in the device picker and check its wired contacts.",
      "If data stops, reconnect and review the setup. Keep the tab active throughout calibration and capture. If account saving fails, keep the result open to retry or export it; a connection problem should not create a false successful reading.",
    ],
  },
};
