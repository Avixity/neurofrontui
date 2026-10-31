import { spawn } from "node:child_process";
const processes = [
  spawn(process.execPath, ["--import", "tsx", "server/dev.ts"], {
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: "inherit",
    windowsHide: true,
  }),
];
const stop = () => processes.forEach((child) => child.kill());
process.on("SIGINT", () => {
  stop();
  process.exit();
});
process.on("SIGTERM", () => {
  stop();
  process.exit();
});
for (const child of processes)
  child.on("exit", (code) => {
    if (code) {
      stop();
      process.exit(code);
    }
  });
