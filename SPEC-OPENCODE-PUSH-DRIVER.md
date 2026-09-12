# Flip rabbithole's blocking-listener model to a backend-driven push model (OpenCode)

## Context

Rabbithole's MCP tools `open_rabbithole` and `answer_branch` are deliberately
long-blocking "listener" calls: the agent calls them and the call parks on
`SessionListener.waitForEvent(signal)` (`src/node/mcp/hole-session/listener.js:19`)
until the human branches on the canvas. This works on **Claude Code**, whose
harness backgrounds a blocked MCP call after 120s and delivers the result later
— the call itself is never aborted.

It fails on **OpenCode**. OpenCode wires the model turn's `AbortSignal` into
every MCP `callTool` (`packages/opencode/src/mcp/catalog.ts:53-79`,
`signal: options.abortSignal`), and that signal fires at step/turn boundaries
beyond explicit user cancellation. When it fires, rabbithole's `waitForEvent`
resolves `{status:"cancelled"}` (`listener.js:42-46`), the session broadcasts
`agent_status attached:false reason:"cancelled"`, and the canvas shows **"The
agent stopped listening / The tool call was cancelled"** (`refreshStatus`,
`src/ui/transport-status.js:645-649`). Raising `mcp.<name>.timeout` does not
help — the abort path is independent of the timeout.

No server-only rabbithole change fixes this while the wait lives on the MCP
call, because OpenCode cancels the call client-side before rabbithole can
respond gracefully. The fix is to **move the "wait for the human" off the MCP
tool-call boundary entirely** and invert who drives: rabbithole's backend drives
the agent's OpenCode session, instead of the agent blocking inside a rabbithole
tool.

Intended outcome: on OpenCode, rabbithole sessions never sit on a blocking MCP
call, so nothing gets cancelled — while the terminal experience stays the same
(you still open the hole from the OpenCode terminal and watch tool calls there).
Claude Code's existing blocking behavior is left untouched.

## Approach — Variant A: attach to the live OpenCode terminal session

The MCP server process is a long-lived stdio subprocess of OpenCode; it stays
alive across the whole OpenCode session and already runs a per-session loopback
HTTP+SSE server the browser connects to. That persistent process becomes the
**driver**. The flip, end to end:

1. **Open (non-blocking).** Agent calls `open_rabbithole` from the terminal. In
   push mode it opens the hole, starts the session + loopback server + browser
   (unchanged: `SessionBase.start()`), registers the session with the push
   driver, and **returns immediately** — it does *not* call `waitForEvent`.
2. **Branch.** Human selects text and asks. The browser optimistically paints a
   pending node and `POST /events` a `branch_request`
   (`src/ui/ask-followups.js:490,578`). `RabbitholeSession.handleBranchRequest`
   (`src/node/mcp/hole-session/session.js:50`) creates the authoritative pending
   node and persists it — **unchanged**. Instead of `pushEvent` waking a blocked
   listener, the push driver composes a prompt from the delivered branch
   projection and calls OpenCode `POST /session/:id/prompt_async`.
3. **Answer (non-blocking).** The injected prompt lands in the agent's live
   session. The agent (optionally `read_rabbithole` first) generates the answer
   and calls `answer_branch` in **non-blocking** mode: `partial:true` chunks
   broadcast `node_progress` (existing streaming, `answer.js:119-136`); the final
   call broadcasts `node_answered` and **returns immediately** instead of
   re-arming `waitForEvent`. The pending node fills in via its `request_id`/
   `node_id` — same rendering path as today.
4. **No blocking MCP call ever exists.** The longest any rabbithole tool call
   runs is one answer generation, well within OpenCode's normal slow-tool
   tolerance. The human-wait now lives in the driver, woken by the browser's
   `POST /events` — no MCP `AbortSignal` is attached to a long-lived call.

The canvas gets content the same way it does now: the node is created by
rabbithole (browser-optimistic + server-authoritative) and filled by the agent's
non-blocking `answer_branch` broadcasts. The only difference the user sees in the
terminal is that the branch question *arrives as an injected prompt* rather than
being returned from a blocked call — the `answer_branch`/`read_rabbithole` tool
calls still show up in the OpenCode TUI exactly as today.

### The one genuinely new integration surface: session addressing

The driver must know **which OpenCode session** to inject prompts into and **at
what server URL**. OpenCode does not pass session context to MCP tools
(`catalog.ts` execute options expose only `abortSignal`) and injects no server
URL into MCP subprocess env (just `...process.env`, `mcp/index.ts:353`). So:

- **Server URL:** resolve from a configured env var (e.g.
  `RABBITHOLE_OPENCODE_URL`, set in the user's OpenCode `mcp.<name>.env`), with
  mDNS discovery of the `opencode-<port>` Bonjour service
  (`packages/opencode/src/server/mdns.ts`) as a fallback. Presence of a resolved
  URL is also the **mode switch**: configured ⇒ push mode; absent ⇒ existing
  blocking mode (Claude Code default).
- **Session ID:** subscribe to OpenCode's global event stream `GET /event`
  (`server/routes/instance/httpapi/groups/global.ts:88`) and **correlate the
  tool call that opened the hole** to its session. To make correlation
  deterministic, `open_rabbithole` embeds a nonce (e.g. the freshly minted
  `hole_id`) that appears in the tool-call input on the `/event` stream; the
  driver matches that nonce to the emitting `sessionID`, then drives that
  session via `POST /session/:id/prompt_async`
  (`groups/session.ts:96`, payload = `PromptInput` minus `sessionID`).

**This handshake is the primary risk and should be spiked first** (see
Verification). If correlation proves flaky with multiple concurrent sessions,
Variant B removes the problem entirely (rabbithole creates the session, so it
holds the handle) — see Option B below.

## Files to change (all in rabbithole; no OpenCode changes)

- **New: `src/node/mcp/opencode-driver.js`** — the push driver. Resolves the
  OpenCode server URL, subscribes to `GET /event`, maintains a
  `hole_id → {sessionID, serverURL}` map from the open-time nonce correlation,
  and exposes `driveBranch(session, deliveredEvent)` which composes a prompt and
  calls `POST /session/:id/prompt_async`. Serializes prompts per session (await
  the answer's completion on the event stream before injecting the next branch),
  mirroring today's single-listener serialization.
- **`src/node/mcp/open.js`** — add push-mode branches:
  - `openRabbithole`/`resumeRabbithole` (`:41`,`:89`): when push mode is active,
    after `createSession(...)` register with the driver (embedding the nonce)
    and **return an immediate ack** instead of `return session.waitForEvent(signal)`
    (`:86`,`:96`,`:143`).
  - Keep the `waitForEvent` path verbatim for the default (Claude Code) mode.
- **`src/node/mcp/hole-session/listener.js` / `session.js`** — in push mode,
  route browser branch events to `opencodeDriver.driveBranch(...)` instead of
  waking a blocked `waiter`. `pushEvent` (`listener.js:62`) already handles the
  "no waiter" case by queueing; the driver consumes from that same path. Reuse
  `deliverToAgent` (`listener.js:79`) to build the map/thread/notes projection
  the prompt needs.
- **`src/node/mcp/hole-session/answer.js`** — make the final `answer_branch`
  non-blocking in push mode: skip the `return this.waitForEvent(signal)` re-arm
  at `:171` (the `nonBlocking` final path at `:168-170` already returns
  immediately — generalize it to all push-mode finals).
- **`src/node/mcp/tools.js`** — `open_rabbithole`/`answer_branch` (`:88`,`:127`):
  in push mode, drop `withProgressKeepalive` (`:71`) and the `signal` threading
  (`:124`,`:163`); update the tool description strings so the agent understands
  branches now arrive as injected prompts rather than as a blocked call's return.
- **`src/node/mcp/main.js`** — instantiate/wire the driver at startup when a
  server URL resolves; tear it down on shutdown alongside `closeAllSessions`.

## What stays the same

`send_to_rabbithole`, `read_rabbithole`, `list_rabbitholes` (all already
non-blocking, no `signal`). The node store, `HoleEngine`/reducer, the per-session
loopback HTTP+SSE server, all browser↔process messaging (`POST /events`, `/sse`),
optimistic node creation, and the streaming render pipeline. Claude Code path:
untouched (blocking mode remains the default when no OpenCode URL is configured).

## Verification

1. **Spike the handshake first (highest risk).** Run `opencode serve`, set
   `RABBITHOLE_OPENCODE_URL`, confirm the driver can (a) subscribe to `GET /event`,
   (b) correlate an `open_rabbithole` call to its `sessionID` via the nonce, and
   (c) successfully `POST /session/:id/prompt_async` and see the prompt appear in
   the session. Do this before building the rest.
2. **End-to-end on OpenCode:** open a hole from the OpenCode terminal, branch
   several times on the canvas (including rapid successive branches to exercise
   per-session serialization), and confirm answers render with no "agent stopped
   listening" banner — including across a long idle wait that previously
   triggered the cancel.
3. **Regression on Claude Code:** with no OpenCode URL configured, confirm
   `open_rabbithole`/`answer_branch` still block and behave exactly as today.
4. **Streaming + resume:** verify `partial:true` chunks stream into the pending
   node, and that `resumeRabbithole {hole_id}` re-registers a session with the
   driver and replays saved pending asks (`requeueSavedAsks`, `answer.js:267`).

---

## Option B (deferred): rabbithole owns a headless OpenCode

Instead of attaching to the user's terminal session, rabbithole's backend runs
`opencode serve` itself and creates sessions via `POST /session` create. This
**removes the entire session-addressing problem** (rabbithole mints the session,
so it holds the ID and server URL directly) and is the cleaner long-term
architecture. The tradeoff: no terminal in the loop — the product becomes
canvas-first/headless. You could still attach an OpenCode TUI to the same
`opencode serve` to watch tool calls live, since the TUI is just another HTTP
client of that server.

Reuses the same push driver from Variant A (`opencode-driver.js`), swapping the
"correlate an existing session via `/event`" step for a "create a session via
`POST /session`" step. Worth adopting if Variant A's correlation handshake
proves fragile under concurrent sessions, or if the product direction shifts to
canvas-first. Not planned for now per the decision to keep the terminal-driven
flow.
