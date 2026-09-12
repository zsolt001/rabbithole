/**
 * Push driver for the OpenCode backend (Variant A: attach to the live
 * terminal session — see SPEC-OPENCODE-PUSH-DRIVER.md).
 *
 * Rabbithole's default behavior is to block inside a listener MCP call
 * (`SessionListener.waitForEvent`) until the human branches. That is fine on
 * Claude Code, whose harness backgrounds a long-blocked call after 120s. It
 * is not fine on OpenCode, which wires the model turn's AbortSignal into
 * every MCP call and aborts it at step boundaries, so a long-blocked call
 * gets cancelled out from under the ask.
 *
 * The fix does not touch that default: it adds an opt-in push mode that
 * activates only when an OpenCode server URL resolves (env var, mDNS
 * fallback). When active, the process's own MCP subprocess drives the
 * agent's live OpenCode session over HTTP (`POST /session/:id/prompt_async`)
 * instead of ever parking a tool call. `getOpencodeDriver().isActive()` is
 * the single switch every call site in open.js / listener.js / answer.js /
 * tools.js checks; when it is false, nothing here is reachable and behavior
 * is byte-for-byte the existing blocking path.
 *
 * SSE note: OpenCode's global event stream (`GET /event`, mounted under the
 * server's "global" HTTP API group) is consumed by hand-parsing
 * `text/event-stream` frames off a `fetch` response body, not the global
 * `EventSource` API. Two independent reasons: (1) this package's CI matrix
 * tests Node 18.x/20.x/22.x (`.github/workflows/ci.yml`, `engines: >=18` in
 * package.json) and global `EventSource` only landed in Node v22.3.0, so
 * 18.x/20.x would not have it; (2) even on this machine's Node v24.18.0,
 * `typeof EventSource` is `"undefined"` — it is not exposed as a global
 * here either. Global `fetch` has been available since Node 18, so a small
 * dependency-free SSE reader over `fetch(...).body` works across the whole
 * support matrix without adding a runtime dependency.
 */
import { log, error as logError } from "../shared/logger.js";

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const RECONNECT_DELAY_MS = 2000;
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_KEYS = 200;

// Isolated behind one constant so the exact wire event-type string can be
// corrected from a live spike (`opencode serve` + `curl -N /event`) without
// touching correlation or serialization logic. Candidates observed in the
// OpenCode source (`packages/opencode/src/session/status.ts`): a
// `SessionStatusEvent.Idle` publication carrying `{ sessionID }`, whose
// serialized `type` was not pinned to a literal string from static reading
// alone.
const IDLE_EVENT_TYPES = new Set(["session.idle", "idle"]);

/**
 * Resolve the OpenCode server base URL that activates push mode. Presence of
 * a non-null return IS the mode switch every caller checks via
 * `driver.isActive()`.
 *
 * Synchronous by design: tool descriptions are registered once per process
 * (the MCP SDK used here has no per-call dynamic description), so the mode
 * decision has to be available the moment anything first asks for it, not
 * after an awaited network round trip. `RABBITHOLE_OPENCODE_URL` (the
 * documented primary mechanism) is a synchronous env read. mDNS discovery of
 * `opencode-<port>` is described in the spec as a *fallback*; this function
 * accepts an injectable, synchronous `mdnsLookup()` for that fallback and
 * unit-test coverage, but ships with no real Bonjour client wired in (see
 * README/report deviations — adding a new runtime dependency for a fallback
 * path was out of scope for this pass).
 * @param {{env?: NodeJS.ProcessEnv, mdnsLookup?: () => ({port: number} | null)}} [options]
 * @returns {string | null}
 */
export function resolveOpencodeUrl({ env = process.env, mdnsLookup } = {}) {
  const fromEnv = normalizeServerUrl(env.RABBITHOLE_OPENCODE_URL);
  if (fromEnv) return fromEnv;
  if (typeof mdnsLookup !== "function") return null;
  try {
    const found = mdnsLookup();
    if (found && Number.isFinite(found.port) && found.port > 0) return `http://127.0.0.1:${Math.floor(found.port)}`;
  } catch (error) {
    logError(`OpenCode mDNS discovery failed: ${error.message}`);
  }
  return null;
}

function normalizeServerUrl(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    new URL(trimmed);
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * Recursively scan a tool-call input for a string value equal to `nonce`.
 * Bounded depth and key count so an adversarial or merely large payload
 * cannot hang correlation; cycle-safe via a `seen` set.
 * @param {unknown} input
 * @param {string} nonce
 * @param {number} [depth]
 * @param {Set<object>} [seen]
 * @returns {boolean}
 */
export function findNonceInToolInput(input, nonce, depth = 0, seen = new Set()) {
  if (input == null || depth > MAX_SCAN_DEPTH) return false;
  if (typeof input === "string") return input === nonce;
  if (Array.isArray(input)) {
    if (input.length > MAX_SCAN_KEYS) return false;
    return input.some((item) => findNonceInToolInput(item, nonce, depth + 1, seen));
  }
  if (typeof input === "object") {
    if (seen.has(input)) return false;
    seen.add(input);
    const keys = Object.keys(input);
    if (keys.length > MAX_SCAN_KEYS) return false;
    return keys.some((key) => findNonceInToolInput(input[key], nonce, depth + 1, seen));
  }
  return false;
}

/**
 * Compose the prompt text injected into the agent's live OpenCode session
 * for one branch. `deliveredEvent` is the already-projected
 * `deliverToAgent(event)` result (map/thread/notes included) — this
 * function only renders it to text; it must not recompute any of that
 * projection (reuse, not reinvent, per the spec).
 * @param {Record<string, any>} deliveredEvent
 * @returns {string}
 */
export function composeBranchPrompt(deliveredEvent) {
  const lines = [];
  lines.push(
    "Rabbithole (push mode): a new branch was asked on the open canvas. " +
      "This text is an injected prompt, not a tool result — answer it by " +
      "calling answer_branch with the ids below. Read the canvas map/thread " +
      "if you need more context (read_rabbithole); do not call open_rabbithole " +
      "again for this hole."
  );
  lines.push(`session_id: ${deliveredEvent.session_id}`);
  lines.push(`request_id: ${deliveredEvent.request_id}`);
  if (deliveredEvent.hole_id) lines.push(`hole_id: ${deliveredEvent.hole_id}`);
  if (deliveredEvent.parent_node_title) lines.push(`Parent document: ${deliveredEvent.parent_node_title}`);
  if (Array.isArray(deliveredEvent.lineage) && deliveredEvent.lineage.length) {
    lines.push(`Lineage: ${deliveredEvent.lineage.join(" > ")}`);
  }
  if (deliveredEvent.selected_text) lines.push(`Selected text:\n${deliveredEvent.selected_text}`);
  lines.push(`Question: ${deliveredEvent.question || "(no question text — use lens/instruction below)"}`);
  if (deliveredEvent.lens) lines.push(`Lens: ${deliveredEvent.lens}`);
  if (deliveredEvent.instruction) lines.push(`Instruction: ${deliveredEvent.instruction}`);
  if (deliveredEvent.anchor?.block) lines.push(`Anchor block: ${deliveredEvent.anchor.block}`);
  if (Array.isArray(deliveredEvent.thread) && deliveredEvent.thread.length) {
    lines.push("Undelivered lineage (fetch an omitted entry with read_rabbithole node_ids if you need it):");
    for (const entry of deliveredEvent.thread) {
      lines.push(`- ${entry.id}${entry.omitted ? " (omitted, too large to attach)" : ""}: ${entry.title ?? ""}`);
    }
  }
  if (Array.isArray(deliveredEvent.notes) && deliveredEvent.notes.length) {
    lines.push(
      `Margin notes: ${deliveredEvent.notes.length} note(s) accompany this ask; ` +
        "call read_rabbithole {hole_id, notes:true} if their content matters here."
    );
  }
  lines.push(
    `Reply with answer_branch {session_id: ${JSON.stringify(deliveredEvent.session_id)}, ` +
      `request_id: ${JSON.stringify(deliveredEvent.request_id)}, ...}. ` +
      "Its final call returns immediately in push mode and does not block."
  );
  return lines.join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function extractSessionID(event) {
  return (
    event?.properties?.sessionID ||
    event?.properties?.info?.sessionID ||
    event?.properties?.part?.sessionID ||
    event?.sessionID ||
    null
  );
}

function looksLikeToolEvent(event) {
  return typeof event?.type === "string" && (event.type.includes("tool") || event.type.includes("part"));
}

/**
 * Drives one OpenCode session over HTTP instead of a rabbithole tool call
 * blocking on it. Every method is safe to call when inactive (`isActive()`
 * false) — callers still gate on `isActive()` first so an inactive driver
 * is never exercised on the default (Claude Code) path.
 */
export class OpencodeDriver {
  /**
   * @param {{
   *   serverUrl?: string | null,
   *   fetchImpl?: typeof fetch,
   *   idleTimeoutMs?: number,
   *   reconnectDelayMs?: number,
   * }} [options]
   */
  constructor({ serverUrl = null, fetchImpl = fetch, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, reconnectDelayMs = RECONNECT_DELAY_MS } = {}) {
    this.serverUrl = serverUrl;
    this.fetchImpl = fetchImpl;
    this.idleTimeoutMs = idleTimeoutMs;
    this.reconnectDelayMs = reconnectDelayMs;

    /** @type {Map<string, string>} nonce -> hole_id */
    this.pendingNonces = new Map();
    /** @type {Map<string, {sessionID: string, serverURL: string}>} hole_id -> session */
    this.holeToSession = new Map();
    /** @type {Map<string, Set<() => void>>} sessionID -> idle-wait resolvers */
    this.idleWaiters = new Map();
    /** @type {Map<string, Promise<void>>} sessionID -> serialized prompt chain */
    this.sessionQueues = new Map();

    this.stopped = true;
    this.abortController = null;
    this.readLoopPromise = null;
  }

  isActive() {
    return Boolean(this.serverUrl);
  }

  /** Begin (or resume, after `stop()`) consuming the global event stream. No-op when inactive. */
  start() {
    if (!this.isActive() || !this.stopped) return;
    this.stopped = false;
    this.readLoopPromise = this._runReadLoop();
  }

  /** Stop consuming events and release anything waiting on an idle signal. */
  stop() {
    this.stopped = true;
    this.abortController?.abort();
    this.abortController = null;
    for (const waiters of this.idleWaiters.values()) for (const resolve of waiters) resolve();
    this.idleWaiters.clear();
  }

  /**
   * Register a hole for nonce correlation. `nonce` defaults to the hole id
   * itself, per the spec ("the minted hole_id is the nonce"). Idempotent —
   * safe to call again on resume of an already-correlated hole.
   */
  registerHole(holeId, nonce = holeId) {
    if (!this.isActive() || this.holeToSession.has(holeId)) return;
    this.pendingNonces.set(nonce, holeId);
  }

  unregisterHole(holeId) {
    this.holeToSession.delete(holeId);
    for (const [nonce, hid] of this.pendingNonces) {
      if (hid === holeId) this.pendingNonces.delete(nonce);
    }
  }

  resolveSession(holeId) {
    return this.holeToSession.get(holeId) || null;
  }

  /**
   * Handle one already-parsed global-event payload. Exposed directly (not
   * just reachable through the network read loop) so correlation/idle logic
   * is unit-testable with hand-built fixtures.
   * @param {any} rawEvent
   */
  handleEvent(rawEvent) {
    const event = rawEvent?.payload ?? rawEvent;
    if (!event || typeof event !== "object") return;
    this._correlateNonce(event);
    this._observeIdle(event);
  }

  _correlateNonce(event) {
    if (!this.pendingNonces.size || !looksLikeToolEvent(event)) return;
    const sessionID = extractSessionID(event);
    if (!sessionID) return;
    for (const [nonce, holeId] of [...this.pendingNonces]) {
      if (findNonceInToolInput(event, nonce)) {
        this.holeToSession.set(holeId, { sessionID, serverURL: this.serverUrl });
        this.pendingNonces.delete(nonce);
        log(`OpenCode driver correlated hole ${holeId} to session ${sessionID}`);
      }
    }
  }

  _observeIdle(event) {
    if (typeof event?.type !== "string" || !IDLE_EVENT_TYPES.has(event.type)) return;
    const sessionID = extractSessionID(event);
    if (!sessionID) return;
    const waiters = this.idleWaiters.get(sessionID);
    if (!waiters) return;
    this.idleWaiters.delete(sessionID);
    for (const resolve of waiters) resolve();
  }

  _waitForIdle(sessionID) {
    return new Promise((resolve) => {
      const set = this.idleWaiters.get(sessionID) || new Set();
      set.add(resolve);
      this.idleWaiters.set(sessionID, set);
      const timer = setTimeout(() => {
        set.delete(resolve);
        resolve();
      }, this.idleTimeoutMs);
      timer.unref?.();
    });
  }

  /**
   * Compose and inject the prompt for one branch, serialized behind any
   * still-in-flight prompt for the same OpenCode session (await the prior
   * answer's completion, observed as an idle signal on the event stream,
   * before injecting the next branch) — mirrors today's single-listener
   * serialization without touching it.
   * @param {{holeId: string}} session
   * @param {Record<string, any>} deliveredEvent
   */
  driveBranch(session, deliveredEvent) {
    const target = this.resolveSession(session.holeId);
    if (!target) {
      logError(`OpenCode driver has no correlated session for hole ${session.holeId}; branch ${deliveredEvent.request_id} was not injected`);
      return Promise.resolve();
    }
    const prior = this.sessionQueues.get(target.sessionID) || Promise.resolve();
    const next = prior.then(() => this._driveOne(target, deliveredEvent));
    this.sessionQueues.set(
      target.sessionID,
      next.catch(() => {})
    );
    return next;
  }

  async _driveOne(target, deliveredEvent) {
    const prompt = composeBranchPrompt(deliveredEvent);
    const idle = this._waitForIdle(target.sessionID);
    try {
      await this._postPrompt(target, prompt);
    } catch (error) {
      logError(`OpenCode prompt_async failed for session ${target.sessionID}: ${error.message}`);
    }
    await idle;
  }

  async _postPrompt(target, prompt) {
    // Body shape: PromptPayload = PromptInput minus sessionID
    // (packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:70
    // in the OpenCode source). The exact required fields beyond a text part
    // were not independently confirmed against a live server — correct this
    // one function from the live spike before relying on it.
    const response = await this.fetchImpl(`${target.serverURL}/session/${target.sessionID}/prompt_async`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }),
    });
    if (!response.ok) throw new Error(`prompt_async responded ${response.status}`);
  }

  async _runReadLoop() {
    while (!this.stopped) {
      try {
        await this._consumeOnce();
      } catch (error) {
        if (!this.stopped) logError(`OpenCode event stream error: ${error.message}`);
      }
      if (this.stopped) break;
      await sleep(this.reconnectDelayMs);
    }
  }

  async _consumeOnce() {
    this.abortController = new AbortController();
    // Endpoint mount path per the live spike must be confirmed (the OpenCode
    // source mounts the "global" HTTP API group's `event` endpoint at
    // `GlobalPaths.event`; the spec text and the source disagree on whether
    // that resolves to `/event` or `/global/event` at the server root — this
    // is exactly the "spike the handshake first" risk the spec calls out).
    const response = await this.fetchImpl(`${this.serverUrl}/event`, {
      signal: this.abortController.signal,
      headers: { accept: "text/event-stream" },
    });
    if (!response.ok || !response.body) throw new Error(`OpenCode event stream responded ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        this._handleFrame(frame);
      }
    }
  }

  _handleFrame(frame) {
    const dataLines = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (!dataLines.length) return;
    let payload;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    this.handleEvent(payload);
  }
}

/** @type {OpencodeDriver | null} */
let singleton = null;

/**
 * Process-wide driver singleton, lazily resolved on first access so mode
 * decisions (tool descriptions at registration time, push-mode branches at
 * call time) are consistent regardless of which module happens to import
 * this one first.
 */
export function getOpencodeDriver() {
  if (!singleton) singleton = new OpencodeDriver({ serverUrl: resolveOpencodeUrl() });
  return singleton;
}

/** Stop the singleton driver's event stream and drop it. Call at MCP shutdown. */
export function teardownOpencodeDriver() {
  if (!singleton) return;
  singleton.stop();
  singleton = null;
}

/** Test-only: install a specific driver instance as the singleton. */
export function setOpencodeDriverForTesting(driver) {
  singleton = driver;
}

/** Test-only: drop the singleton so the next `getOpencodeDriver()` re-resolves it. */
export function resetOpencodeDriverForTesting() {
  singleton = null;
}
