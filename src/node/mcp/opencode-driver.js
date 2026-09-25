import { error as logError, log } from "../shared/logger.js";

const CORRELATION_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export function resolveOpencodeUrl(env = process.env) {
  const value = env.RABBITHOLE_OPENCODE_URL;
  if (typeof value !== "string" || !value.trim()) return null;
  const url = value.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch { return null; }
}

export function composeBranchPrompt(event) {
  const lines = [
    "Rabbithole (push mode): a canvas branch needs an answer. This is an injected prompt, not a tool result.",
    "Answer with answer_branch using the ids below. Do not call open_rabbithole again.",
    `session_id: ${event.session_id}`,
    `request_id: ${event.request_id}`,
    `hole_id: ${event.hole_id}`,
    `Question: ${event.question || "(use the selected text and instruction)"}`,
  ];
  if (event.selected_text) lines.push(`Selected text:\n${event.selected_text}`);
  if (event.lens) lines.push(`Lens: ${event.lens}`);
  if (event.instruction) lines.push(`Instruction: ${event.instruction}`);
  return lines.join("\n");
}

function contains(value, needle, seen = new Set(), depth = 0) {
  if (value == null || depth > 6) return false;
  if (typeof value === "string") return value.includes(needle);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).slice(0, 200).some((entry) => contains(entry, needle, seen, depth + 1));
}

export class OpencodeDriver {
  constructor({ serverUrl = resolveOpencodeUrl(), fetchImpl = fetch } = {}) {
    this.serverUrl = serverUrl;
    this.fetchImpl = fetchImpl;
    this.holes = new Map();
    this.pending = new Set();
    this.waiters = new Map();
    this.queues = new Map();
    this.running = false;
    this.controller = null;
  }
  isActive() { return Boolean(this.serverUrl); }
  registerHole(holeId) { if (this.isActive()) { this.holes.delete(holeId); this.pending.add(holeId); } }
  unregisterHole(holeId) { this.pending.delete(holeId); this.holes.delete(holeId); }
  start() { if (this.isActive() && !this.running) { this.running = true; this.consume(); } }
  stop() {
    this.running = false;
    this.controller?.abort();
    for (const set of this.waiters.values()) for (const resolve of set) resolve();
    this.waiters.clear();
  }
  handleEvent(raw) {
    const event = raw?.payload || raw;
    const sessionID = event?.properties?.sessionID || event?.properties?.part?.sessionID || event?.properties?.info?.sessionID;
    if (sessionID) for (const holeId of [...this.pending]) if (contains(event, holeId)) {
      this.pending.delete(holeId); this.holes.set(holeId, sessionID); log(`OpenCode driver correlated hole ${holeId}`);
    }
    if (event?.type === "session.idle" || event?.type === "session.status" && event?.properties?.status?.type === "idle") {
      const set = this.waiters.get(sessionID);
      this.waiters.delete(sessionID);
      for (const resolve of set || []) resolve();
    }
  }
  async consume() {
    while (this.running) {
      try {
        this.controller = new AbortController();
        const response = await this.fetchImpl(`${this.serverUrl}/global/event`, { signal: this.controller.signal, headers: { accept: "text/event-stream" } });
        if (!response.ok || !response.body) throw new Error(`event stream responded ${response.status}`);
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
        while (this.running) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true }); let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
            const json = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (json) try { this.handleEvent(JSON.parse(json)); } catch {}
          }
        }
      } catch (error) { if (this.running) logError(`OpenCode event stream error: ${error.message}`); }
      if (this.running) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  waitForSession(holeId) {
    return new Promise((resolve, reject) => {
      const until = Date.now() + CORRELATION_TIMEOUT_MS;
      const poll = () => {
        const sessionID = this.holes.get(holeId);
        if (sessionID) return resolve(sessionID);
        if (Date.now() >= until) return reject(new Error(`OpenCode session did not correlate for hole ${holeId}`));
        setTimeout(poll, 50);
      };
      poll();
    });
  }
  waitForIdle(sessionID) {
    return new Promise((resolve) => {
      const set = this.waiters.get(sessionID) || new Set(); set.add(resolve); this.waiters.set(sessionID, set);
      const timer = setTimeout(() => { set.delete(resolve); if (!set.size) this.waiters.delete(sessionID); resolve(); }, IDLE_TIMEOUT_MS);
      timer.unref?.();
    });
  }
  driveBranch(session, event, onDelivered) {
    const prior = this.queues.get(session.holeId) || Promise.resolve();
    const next = prior.then(async () => {
      const sessionID = await this.waitForSession(session.holeId);
      const idle = this.waitForIdle(sessionID);
      const response = await this.fetchImpl(`${this.serverUrl}/session/${sessionID}/prompt_async`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: composeBranchPrompt(event) }] }),
      });
      if (!response.ok) throw new Error(`prompt_async responded ${response.status}`);
      onDelivered?.(); await idle;
    });
    this.queues.set(session.holeId, next.catch(() => {}));
    return next;
  }
}

let singleton = null;
export function getOpencodeDriver() { if (!singleton) singleton = new OpencodeDriver(); return singleton; }
export function teardownOpencodeDriver() { singleton?.stop(); singleton = null; }
