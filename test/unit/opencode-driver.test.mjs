/** @protects the OpenCode push-driver's mode switch, nonce correlation, prompt composition, and per-session serialization. */
import assert from "node:assert/strict";
import {
  OpencodeDriver,
  composeBranchPrompt,
  findNonceInToolInput,
  resolveOpencodeUrl,
} from "../../src/node/mcp/opencode-driver.js";

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

serialized.stop();

console.log(
  "ok opencode-driver: URL resolution is the mode switch, nonce correlation matches tool-call input, " +
    "prompt composition carries session/request/question, and driveBranch serializes per OpenCode session"
);
