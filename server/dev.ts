import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { nodeHandler } from "./node.js";

for (const path of [".env.local", ".env"]) {
  if (existsSync(path)) process.loadEnvFile(path);
}
process.env.APP_ORIGIN ||= "http://localhost:5180";
const port = Number(process.env.API_PORT || 5181);
createServer(nodeHandler).listen(port, "127.0.0.1", () => {
  console.log(`NeuroFront local API: http://127.0.0.1:${port}`);
});
