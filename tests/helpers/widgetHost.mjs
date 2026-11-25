// Test harness for the widget: the real backend (dev server: in-memory SQLite, mock AI) on one port, and
// separate "plumber's websites" on other ports so every widget request is genuinely cross-origin.
import { createServer } from "node:http";
import { startDevServer } from "../../scripts/dev-server.mjs";
import { platformRepo, forBusiness } from "../../src/db/tenant.js";

export async function startWidgetWorld({ clientLimit = { limit: 1000, windowMs: 60_000 }, apiPort = 0 } = {}) {
  // choose a free port first so the API's own origin is known
  const probe = createServer(); await new Promise((r) => probe.listen(apiPort, "127.0.0.1", r)); const port = probe.address().port; await new Promise((r) => probe.close(r));
  const api = await startDevServer({ port, dbPath: ":memory:", clientLimit, scheduleMs: 60_000 });
  const apiOrigin = `http://127.0.0.1:${port}`;
  const platform = platformRepo(api.db);
  const servers = [];

  const pageHtml = ({ key, attrs = "", extraHead = "", extraBody = "", scriptTags = 1 }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Host plumbing site</title>${extraHead}</head><body><main><h1>Host site</h1><p>Some page content.</p></main>${extraBody}${Array.from({ length: scriptTags }, () => `<script src="${apiOrigin}/widget.js" data-site-key="${key}" ${attrs} async></script>`).join("")}</body></html>`;

  /** A website on its own port. `site.html` can be replaced by a test. */
  async function site(html = "") {
    const s = { html, port: 0, origin: "", url: "" };
    const srv = createServer((req, res) => {
      if (req.url.split("?")[0] !== "/") { res.writeHead(404); return res.end("nf"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(typeof s.html === "function" ? s.html() : s.html);
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    servers.push(srv);
    s.port = srv.address().port; s.origin = `http://127.0.0.1:${s.port}`; s.url = `${s.origin}/`;
    return s;
  }

  /** Registers a business whose only allowed website is a fresh host site that embeds the widget. */
  async function business({ id, name, key, status = "active", html = {} }) {
    const s = await site();
    s.html = pageHtml({ key, ...html });
    await platform.createBusiness({ id, name, industry: "plumbing", siteKey: key, origins: [s.origin] });
    if (status !== "active") await api.db.run("UPDATE businesses SET status = ? WHERE id = ?", [status, id]);
    return { id, name, key, site: s, T: forBusiness(api.db, id) };
  }
  return { api, apiOrigin, platform, business, site, pageHtml, async close() { for (const s of servers) s.close(); await api.close().catch(() => {}); } };
}
