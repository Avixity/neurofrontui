"use strict"

const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const handler = require("./assistant-api.js")
const accountConfig = require("./account-config-api.js")

const publicFiles = new Set([
  "index.html", "email-preview.html", "styles.css", "app.js", "language.js", "language-data.js",
  "capture-language.js", "capture-history.js", "resource-data.js", "resources.js",
  "setup-viewer.js", "score-config.js", "assistant-language.js", "assistant.js",
  "assistant-avatar.webp", "icon-512.png", "image.png", "NEUROFRONTLOGO.png"
  , "account-store.js", "account-ui.js", "account-language.js", "supabase-2.118.0.js"
])
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".webp": "image/webp" }

function createServer() {
  return http.createServer(async (request, response) => {
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname) } catch { response.writeHead(400).end(); return }
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
    if (pathname === "/api/assistant") { await handler(request, response); return }
    if (pathname === "/api/account-config") { await accountConfig(request, response); return }
    const filename = pathname === "/" ? "index.html" : pathname.slice(1)
    if (!["GET", "HEAD"].includes(request.method) || !publicFiles.has(filename)) { response.writeHead(404).end("Not found"); return }
    fs.readFile(path.join(__dirname, filename), (error, data) => {
      if (error) { response.writeHead(404).end("Not found"); return }
      response.writeHead(200, { "Content-Type": mime[path.extname(filename)], "Cache-Control": "no-store" })
      response.end(request.method === "HEAD" ? undefined : data)
    })
  })
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 5180
  createServer().listen(port, "127.0.0.1", () => console.log(`NeuroFront local preview: http://localhost:${port}`))
}

module.exports = { createServer, publicFiles }
