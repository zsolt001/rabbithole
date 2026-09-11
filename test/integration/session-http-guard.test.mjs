/** @protects session http guard capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.RABBITHOLE_NO_BROWSER = "1";
process.env.RABBITHOLE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-http-guard-"));

const { RabbitholeSession } = await import("../../src/node/transport/session.js");

const session = new RabbitholeSession({
  holeId: "http-guard",
  title: "HTTP guard",
  rootId: "root",
  nodes: [{
    id: "root", parent_id: null, title: "Root", markdown: "Root",
    base_url: null, base_url_source: null, origin: null,
    position: { x: 0, y: 0 }, size: null, font_scale: 1,
    collapsed: false, status: "answered", read: true,
    created_at: new Date().toISOString(), extensions: {},
  }],
  renderPage: () => "<!doctype html><title>guarded</title>",
});

try {
  await session.start();
  const port = new URL(session.url).port;

  const allowed = await fetch(`${session.url}/health`);
  assert.equal(allowed.status, 200);

  const foreignOrigin = await fetch(`${session.url}/events`, {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ type: "done" }),
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await foreignOrigin.json()).error.code, "forbidden_origin");

  const foreignHost = await request(`${session.url}/health`, { Host: `attacker.example:${port}` });
  assert.equal(foreignHost.status, 403);
  assert.equal(foreignHost.json.error.code, "forbidden_host");

  // A bare cross-origin GET carries no Origin header, so the Origin allowlist
  // alone cannot see it. A hostile page pulling content routes via <img> /
  // <iframe> / fetch is stamped by the browser with a cross-origin
  // Sec-Fetch-Site, which content routes must reject.
  const crossSiteSnapshot = await httpGet(`${session.url}/snapshot-hole`, { "Sec-Fetch-Site": "cross-site" });
  assert.equal(crossSiteSnapshot.status, 403);
  assert.equal(JSON.parse(crossSiteSnapshot.body).error.code, "forbidden_cross_origin");

  const sameSiteExport = await httpGet(`${session.url}/export`, { "Sec-Fetch-Site": "same-site" });
  assert.equal(sameSiteExport.status, 403);

  // The app's own requests are same-origin, and non-browser clients (and
  // browsers too old for Fetch Metadata) omit the header; both must still reach
  // the content.
  const sameOriginSnapshot = await httpGet(`${session.url}/snapshot-hole`, { "Sec-Fetch-Site": "same-origin" });
  assert.equal(sameOriginSnapshot.status, 200);
  const headerlessSnapshot = await httpGet(`${session.url}/snapshot-hole`, {});
  assert.equal(headerlessSnapshot.status, 200);

  // The top-level page shell is exempt so the app always renders, even when a
  // cross-origin link opens it; the shell carries no document content.
  const crossSitePage = await httpGet(`${session.url}/`, { "Sec-Fetch-Site": "cross-site" });
  assert.equal(crossSitePage.status, 200);
} finally {
  await session.close("test_complete");
  await fs.rm(process.env.RABBITHOLE_DIR, { recursive: true, force: true });
}

console.log("ok session HTTP guard: loopback Host and browser Origin are enforced");

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    });
    req.once("error", reject);
  });
}

// Raw GET that returns the body verbatim: Sec-Fetch-* are forbidden header
// names for fetch(), and content routes answer with HTML, not JSON.
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.once("error", reject);
  });
}
