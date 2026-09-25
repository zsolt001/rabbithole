/** @protects OpenCode push-mode correlation and prompt delivery. */
import assert from "node:assert/strict";
import { OpencodeDriver, composeBranchPrompt, resolveOpencodeUrl } from "../../src/node/mcp/opencode-driver.js";

assert.equal(resolveOpencodeUrl({ RABBITHOLE_OPENCODE_URL: "http://127.0.0.1:4599/" }), "http://127.0.0.1:4599");
assert.equal(resolveOpencodeUrl({ RABBITHOLE_OPENCODE_URL: "ftp://example.test" }), null);
assert.match(composeBranchPrompt({ session_id: "session", request_id: "request", hole_id: "hole", question: "Why?" }), /request_id: request/);

const calls = [];
let driver;
driver = new OpencodeDriver({
  serverUrl: "http://127.0.0.1:4599",
  fetchImpl: async (url, init) => {
    calls.push({ url, init });
    driver.handleEvent({ payload: { type: "session.idle", properties: { sessionID: "open-session" } } });
    return new Response(null, { status: 204 });
  },
});
driver.registerHole("hole");
driver.handleEvent({ payload: { type: "message.part.updated", properties: { sessionID: "open-session", part: { state: { output: "hole" } } } } });
await driver.driveBranch({ holeId: "hole" }, { status: "branch_request", session_id: "rh-session", request_id: "request", hole_id: "hole", question: "Why?" });
assert.equal(calls[0].url, "http://127.0.0.1:4599/session/open-session/prompt_async");
assert.match(calls[0].init.body, /request_id: request/);

console.log("opencode driver unit contracts ok");
