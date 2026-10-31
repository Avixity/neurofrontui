import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".work", "server-esm-check");
const compiled = new Set();

async function compile(relative) {
  if (compiled.has(relative)) return;
  compiled.add(relative);
  const sourcePath = path.resolve(root, relative);
  assert(
    sourcePath.startsWith(root),
    "Runtime dependency must stay in the project",
  );
  const source = await readFile(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: relative,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const destination = path.join(output, relative.replace(/\.ts$/, ".js"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, outputText);

  const emitted = ts.createSourceFile(
    destination,
    outputText,
    ts.ScriptTarget.Latest,
  );
  for (const statement of emitted.statements) {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    )
      continue;
    const specifier = statement.moduleSpecifier;
    if (
      !specifier ||
      !ts.isStringLiteral(specifier) ||
      !specifier.text.startsWith(".")
    )
      continue;
    assert(
      specifier.text.endsWith(".js"),
      `${relative}: runtime import ${specifier.text} needs a .js extension`,
    );
    const dependency = path.normalize(
      path.join(path.dirname(relative), specifier.text.replace(/\.js$/, ".ts")),
    );
    await compile(dependency);
  }
}

const entrypoints = (await readdir(path.join(root, "api"))).filter((name) =>
  name.endsWith(".ts"),
);
for (const name of entrypoints) await compile(path.join("api", name));
const handlers = await Promise.all(
  entrypoints.map(async (name) => {
    const url = pathToFileURL(
      path.join(output, "api", name.replace(/\.ts$/, ".js")),
    ).href;
    const module = await import(url);
    assert.equal(
      typeof module.default,
      "function",
      `${name} must export a handler`,
    );
    return module.default;
  }),
);

// Exercise the unconfigured deployment without using credentials or provider calls.
for (const key of [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ASSISTANT_MODEL",
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "ASSISTANT_SIGNING_SECRET",
  "APP_ORIGIN",
  "VERCEL",
])
  delete process.env[key];
const server = createServer(handlers[0]);
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${origin}/api/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    cloudConfigured: false,
    databaseReady: false,
    assistantAvailable: false,
    reason: "assistant_unavailable",
  });
  for (const route of ["assistant", "assistant-session"]) {
    const result = await fetch(`${origin}/api/${route}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(
      result.status,
      503,
      `${route} must fail gracefully when unconfigured`,
    );
  }
  const account = await fetch(`${origin}/api/account`, {
    method: "DELETE",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(account.status, 401);
  console.log(
    `Plain Node ESM: ${entrypoints.length} API entrypoints imported; status 200, assistant services 503, unauthenticated account 401.`,
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
