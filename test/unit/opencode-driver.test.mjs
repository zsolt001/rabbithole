/** @protects the OpenCode push-driver's mode switch, nonce correlation, prompt composition, and per-session serialization. */
import assert from "node:assert/strict";
import {
  OpencodeDriver,
  composeBranchPrompt,
  composeConvertPrompt,
  findNonceInToolInput,
  resetOpencodeDriverForTesting,
  resolveOpencodeUrl,
  setOpencodeDriverForTesting,
} from "../../src/node/mcp/opencode-driver.js";
import { RabbitholeSession } from "../../src/node/mcp/hole-session/session.js";

async function rejectsSoon(promise, pattern, timeoutMs = 100) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("promise did not settle before timeout")), timeoutMs);
  });
  await assert.rejects(Promise.race([promise, timeout]), pattern);
}

// ---- resolveOpencodeUrl: the mode switch ----------------------------------

assert.equal(
  resolveOpencodeUrl({ env: {} }),
  null,
  "no env var and no mdnsLookup must resolve to null (blocking mode stays default)"
);
assert.equal(
  resolveOpencodeUrl({ env: { RABBITHOLE_OPENCODE_URL: "http://127.0.0.1:4096/" } }),
  "http://127.0.0.1:4096",
  "a configured URL is normalized (trailing slash stripped)"
);
assert.equal(
  resolveOpencodeUrl({ env: { RABBITHOLE_OPENCODE_URL: "not-a-url" } }),
  null,
  "a malformed env value does not activate push mode"
);
assert.equal(
  resolveOpencodeUrl({ env: {}, mdnsLookup: () => ({ port: 5555 }) }),
  "http://127.0.0.1:5555",
  "mdnsLookup is used as a fallback when the env var is absent"
);
assert.equal(
  resolveOpencodeUrl({
    env: { RABBITHOLE_OPENCODE_URL: "http://127.0.0.1:4096" },
    mdnsLookup: () => ({ port: 5555 }),
  }),
  "http://127.0.0.1:4096",
  "the env var wins over mdnsLookup when both are present"
);
assert.equal(
  resolveOpencodeUrl({ env: {}, mdnsLookup: () => null }),
  null,
  "an mdnsLookup that finds nothing still falls back to null (blocking mode)"
);
assert.equal(
  resolveOpencodeUrl({
    env: {},
    mdnsLookup: () => {
      throw new Error("boom");
    },
  }),
  null,
  "a throwing mdnsLookup is absorbed, not propagated"
);

// ---- findNonceInToolInput: correlation matching ---------------------------

assert.equal(findNonceInToolInput({ hole_id: "abc123" }, "abc123"), true, "matches a top-level field");
assert.equal(
  findNonceInToolInput({ input: { hole_id: "abc123" } }, "abc123"),
  true,
  "matches a nested field"
);
assert.equal(
  findNonceInToolInput({ args: ["abc123", "other"] }, "abc123"),
  true,
  "matches inside an array"
);
assert.equal(findNonceInToolInput({ hole_id: "xyz" }, "abc123"), false, "does not match a different string");
const cyclic = { hole_id: "xyz" };
cyclic.self = cyclic;
assert.equal(findNonceInToolInput(cyclic, "abc123"), false, "a cyclic object does not hang or throw");
assert.equal(findNonceInToolInput(null, "abc123"), false, "null input is handled");

// ---- composeBranchPrompt: pure prompt text ---------------------------------

const deliveredEvent = {
  status: "branch_request",
  session_id: "sess-1",
  request_id: "req-1",
  hole_id: "hole-1",
  parent_node_title: "Intro",
  question: "What is a monad?",
  lineage: ["Root", "Intro"],
  selected_text: "monads wrap effects",
};
const prompt = composeBranchPrompt(deliveredEvent);
assert.match(prompt, /sess-1/, "prompt carries the session_id");
assert.match(prompt, /req-1/, "prompt carries the request_id");
assert.match(prompt, /What is a monad\?/, "prompt carries the question text");
assert.match(prompt, /answer_branch/, "prompt tells the agent how to reply");

// ---- composeConvertPrompt: PDF conversion injected prompt ------------------

const convertEvent = {
  status: "convert_request",
  session_id: "sess-c",
  request_id: "req-c",
  node_id: "node-c",
  hole_id: "hole-c",
  page_count: 2,
  pages: [
    { n: 1, image_path: "/tmp/holes/hole-c/convert-1.png" },
    { n: 2, image_path: "/tmp/holes/hole-c/convert-2.png" },
  ],
  rules: "Transcribe faithfully.",
};
const convertPrompt = composeConvertPrompt(convertEvent);
assert.match(convertPrompt, /req-c/, "convert prompt carries the request_id");
assert.match(convertPrompt, /convert-1\.png/, "convert prompt lists each page image path");
assert.match(convertPrompt, /convert-2\.png/, "convert prompt lists every page, not just the first");
assert.match(convertPrompt, /Transcribe faithfully\./, "convert prompt carries the transcription rules");
assert.match(convertPrompt, /answer_branch/, "convert prompt tells the agent how to reply");

// ---- OpencodeDriver: nonce correlation via a synthetic event --------------

const driver = new OpencodeDriver({ serverUrl: "http://127.0.0.1:9999", fetchImpl: async () => {
  throw new Error("fetch must not be called by handleEvent");
} });
driver.registerHole("hole-42", "hole-42");
assert.equal(driver.resolveSession("hole-42"), null, "no session before correlation");
// Confirmed wire shape (live spike): message.part.updated -> properties.part
// with part.type "tool" and args at part.state.input.
driver.handleEvent({
  type: "message.part.updated",
  properties: {
    sessionID: "ses_abc",
    part: { type: "tool", tool: "open_rabbithole", state: { status: "running", input: { hole_id: "hole-42" } } },
  },
});
assert.deepEqual(
  driver.resolveSession("hole-42"),
  { sessionID: "ses_abc", serverURL: "http://127.0.0.1:9999" },
  "a tool-call-shaped event carrying the nonce in state.input correlates the hole to its session"
);
driver.unregisterHole("hole-42");
assert.equal(driver.resolveSession("hole-42"), null, "unregisterHole drops the correlation");

// The minted hole_id is a *return* value of open_rabbithole, so it surfaces in
// the tool's output string, not the model-supplied input — correlate on that too.
driver.registerHole("hole-out", "hole-out");
driver.handleEvent({
  type: "message.part.updated",
  properties: {
    sessionID: "ses_out",
    part: {
      type: "tool",
      tool: "open_rabbithole",
      state: { status: "completed", input: {}, output: '{"status":"listening","hole_id":"hole-out"}' },
    },
  },
});
assert.deepEqual(
  driver.resolveSession("hole-out"),
  { sessionID: "ses_out", serverURL: "http://127.0.0.1:9999" },
  "a nonce echoed back in the tool output string correlates the hole to its session"
);

// A resumed session can requeue its saved asks before the open_rabbithole tool
// result has correlated the hole to this OpenCode conversation. The prompt must
// wait for correlation rather than being dropped during that window.
const delayedPosts = [];
const delayed = new OpencodeDriver({
  serverUrl: "http://127.0.0.1:9999",
  idleTimeoutMs: 50,
  fetchImpl: async (url, init) => {
    delayedPosts.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true };
  },
});
delayed.registerHole("hole-delayed", "hole-delayed");
let delayedConfirmed = 0;
const delayedDelivery = delayed.driveBranch(
  { holeId: "hole-delayed" },
  { status: "branch_request", session_id: "sess-delayed", request_id: "req-delayed", question: "Did resume preserve me?" },
  () => { delayedConfirmed += 1; }
);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(delayedPosts.length, 0, "an uncorrelated branch waits instead of posting to an unknown session");
assert.equal(delayedConfirmed, 0, "waiting for correlation is not reported as agent delivery");
delayed.handleEvent({
  type: "message.part.updated",
  properties: {
    sessionID: "ses-delayed",
    part: { type: "tool", state: { status: "completed", output: '{"hole_id":"hole-delayed"}' } },
  },
});
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(delayedPosts.length, 1, "correlation flushes the saved branch exactly once");
assert.equal(delayedConfirmed, 1, "successful prompt injection confirms agent delivery exactly once");
assert.match(delayedPosts[0].body.parts[0].text, /Did resume preserve me\?/, "the delayed prompt retains its question");
delayed.handleEvent({ type: "session.idle", properties: { sessionID: "ses-delayed" } });
await delayedDelivery;
delayed.stop();

// A configured but unreachable endpoint must fail visibly instead of enabling
// push mode and holding every branch forever waiting for impossible nonce
// correlation.
const unreachable = new OpencodeDriver({
  serverUrl: "http://127.0.0.1:4599",
  correlationTimeoutMs: 10,
  fetchImpl: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:4599"); },
});
unreachable.start();
unreachable.registerHole("hole-unreachable", "hole-unreachable");
await rejectsSoon(
  unreachable.driveBranch(
    { holeId: "hole-unreachable" },
    { status: "branch_request", session_id: "sess-unreachable", request_id: "req-unreachable", question: "Do not hang" }
  ),
  /did not correlate.*4599/i
);
unreachable.stop();

// Delivery failure must be visible on the pending card and detach the agent;
// logging alone leaves the canvas claiming that work is still queued forever.
const failedPush = new OpencodeDriver({ serverUrl: "http://127.0.0.1:4599" });
failedPush.driveBranch = async () => { throw new Error("OpenCode endpoint is unreachable"); };
setOpencodeDriverForTesting(failedPush);
const failedSession = new RabbitholeSession({
  holeId: "hole-failed-push",
  title: "Failed push",
  rootId: "root",
  nodes: [{
    id: "root", parent_id: null, title: "Root", markdown: "Root", position: { x: 0, y: 0 },
    size: null, font_scale: 1, collapsed: false, status: "answered", read: true,
    created_at: new Date().toISOString(),
  }],
  isResume: false,
  renderPage: () => "",
});
failedSession.handleBranchRequest({
  parent_id: "root", request_id: "req-failed-push", node_id: "node-failed-push", question: "Reach me",
});
await new Promise((resolve) => setTimeout(resolve, 0));
const failedNodeEvent = failedSession.outboundEvents.map((entry) => entry.data).find((event) => event.type === "node_error");
assert.equal(failedNodeEvent?.node_id, "node-failed-push", "push failure marks the pending card with an error");
assert.equal(failedNodeEvent?.code, "opencode_delivery_failed");
assert.equal(failedSession.agentAttached, false, "push failure marks the agent detached");
failedSession.close("test_complete");
await failedSession.saveChain.flush();
resetOpencodeDriverForTesting();

// Reopening a hole from a new OpenCode conversation must replace the old
// correlation. Until the new tool result arrives, branches wait rather than
// being injected into the dead conversation.
const reopenedPosts = [];
const reopened = new OpencodeDriver({
  serverUrl: "http://127.0.0.1:9999",
  idleTimeoutMs: 50,
  fetchImpl: async (url, init) => {
    reopenedPosts.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true };
  },
});
reopened.registerHole("hole-reopened", "hole-reopened");
reopened.handleEvent({ type: "message.part.updated", properties: { sessionID: "ses-old", part: { type: "tool", state: { output: "hole-reopened" } } } });
assert.equal(reopened.resolveSession("hole-reopened")?.sessionID, "ses-old");
reopened.registerHole("hole-reopened", "hole-reopened");
assert.equal(reopened.resolveSession("hole-reopened"), null, "reopening invalidates the stale conversation correlation");
const reopenedDelivery = reopened.driveBranch(
  { holeId: "hole-reopened" },
  { status: "branch_request", session_id: "sess-reopened", request_id: "req-reopened", question: "Use the new conversation" }
);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(reopenedPosts.length, 0, "a reopened branch is not sent to the stale conversation");
reopened.handleEvent({ type: "message.part.updated", properties: { sessionID: "ses-new", part: { type: "tool", state: { output: "hole-reopened" } } } });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.match(reopenedPosts[0].url, /\/session\/ses-new\/prompt_async$/, "the reopened branch is sent to the current conversation");
reopened.handleEvent({ type: "session.idle", properties: { sessionID: "ses-new" } });
await reopenedDelivery;
reopened.stop();

// A transient prompt endpoint failure retries the same request rather than
// leaving the canvas waiting for an answer the agent never received.
let retryAttempts = 0;
let retryConfirmed = 0;
const retried = new OpencodeDriver({
  serverUrl: "http://127.0.0.1:9999",
  idleTimeoutMs: 50,
  promptRetryDelayMs: 1,
  fetchImpl: async () => {
    retryAttempts += 1;
    return { ok: retryAttempts > 1, status: retryAttempts > 1 ? 204 : 503 };
  },
});
retried.registerHole("hole-retry", "hole-retry");
retried.handleEvent({ type: "message.part.updated", properties: { sessionID: "ses-retry", part: { type: "tool", state: { output: "hole-retry" } } } });
const retryDelivery = retried.driveBranch(
  { holeId: "hole-retry" },
  { status: "branch_request", session_id: "sess-retry", request_id: "req-retry", question: "Retry me" },
  () => { retryConfirmed += 1; }
);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(retryAttempts, 2, "a transient prompt failure is retried once and then delivered");
assert.equal(retryConfirmed, 1, "only the successful retry confirms delivery");
retried.handleEvent({ type: "session.idle", properties: { sessionID: "ses-retry" } });
await retryDelivery;
retried.stop();

// ---- OpencodeDriver: per-session prompt serialization ----------------------

const postedBodies = [];
const serialized = new OpencodeDriver({
  serverUrl: "http://127.0.0.1:9999",
  idleTimeoutMs: 50,
  fetchImpl: async (url, init) => {
    postedBodies.push({ url, body: init.body });
    return { ok: true };
  },
});
serialized.registerHole("hole-a", "hole-a");
serialized.handleEvent({ type: "message.part.updated", properties: { sessionID: "ses-shared", part: { type: "tool", state: { input: { hole_id: "hole-a" } } } } });

let firstResolved = false;
const first = serialized.driveBranch({ holeId: "hole-a" }, { session_id: "s", request_id: "r1", question: "first" });
first.then(() => { firstResolved = true; });

// Give the driver's microtask queue a beat to POST the first prompt before
// asserting the second one is still queued behind it.
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(postedBodies.length, 1, "the first prompt is posted immediately");
assert.equal(firstResolved, false, "the first driveBranch does not resolve until an idle signal arrives");

const second = serialized.driveBranch({ holeId: "hole-a" }, { session_id: "s", request_id: "r2", question: "second" });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(postedBodies.length, 1, "a second branch for the same session is not injected until the first completes");

serialized.handleEvent({ type: "session.idle", properties: { sessionID: "ses-shared" } });
await first;
assert.equal(firstResolved, true, "the idle signal resolves the first driveBranch");

// The first idle signal unblocked the queue and let the second branch's own
// _driveOne start (posting its prompt); it now awaits its own idle signal.
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(postedBodies.length, 2, "the second prompt is posted only after the first session-idle signal");
serialized.handleEvent({ type: "session.idle", properties: { sessionID: "ses-shared" } });
await second;

// Different sessions are not serialized against each other.
serialized.registerHole("hole-b", "hole-b");
serialized.handleEvent({ type: "message.part.updated", properties: { sessionID: "ses-other", part: { type: "tool", state: { input: { hole_id: "hole-b" } } } } });
const third = serialized.driveBranch({ holeId: "hole-b" }, { session_id: "s", request_id: "r3", question: "third" });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(postedBodies.length, 3, "an unrelated session's branch is not blocked behind hole-a's queue");
serialized.handleEvent({ type: "session.idle", properties: { sessionID: "ses-other" } });
await third;

// A convert_request is driven with the convert prompt, not the branch prompt.
const convertPosts = [];
const convertDriver = new OpencodeDriver({
  serverUrl: "http://127.0.0.1:9999",
  idleTimeoutMs: 50,
  fetchImpl: async (url, init) => {
    convertPosts.push(JSON.parse(String(init.body)));
    return { ok: true };
  },
});
convertDriver.registerHole("hole-c", "hole-c");
convertDriver.handleEvent({ type: "message.part.updated", properties: { sessionID: "ses-c", part: { type: "tool", state: { input: { hole_id: "hole-c" } } } } });
convertDriver.driveBranch(
  { holeId: "hole-c" },
  { status: "convert_request", session_id: "sess-c", request_id: "req-c", node_id: "n1", pages: [{ n: 1, image_path: "/tmp/p1.png" }], rules: "Transcribe.", page_count: 1 }
);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(convertPosts.length, 1, "the convert_request is injected as a prompt");
assert.match(convertPosts[0].parts[0].text, /\/tmp\/p1\.png/, "the injected convert prompt is the convert prompt (carries page image paths)");
convertDriver.stop();

serialized.stop();

console.log(
  "ok opencode-driver: URL resolution is the mode switch, nonce correlation matches tool-call input, " +
    "prompt composition carries session/request/question, and driveBranch serializes per OpenCode session"
);
