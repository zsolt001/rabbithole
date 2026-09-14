/** @protects bridge pairing-token log hygiene. */
import assert from "node:assert/strict";

import { pairingUrl, bridgeStartupOutput } from "../../src/node/bridge/main.js";

const token = "a".repeat(64);
const url = "http://127.0.0.1:41414";
const pairUrl = pairingUrl(token);

// 1. Non-interactive by default: the bearer token must never reach the banner
//    (stdout) or the machine log lines (stderr), because those get captured by
//    systemd/docker/CI logs. The listen URL is still announced.
{
  const { banner, stderrLines } = bridgeStartupOutput({
    url,
    pairUrl,
    token,
    stdoutIsTTY: false,
    stderrIsTTY: false,
    emitTokenEnv: "",
  });
  assert.ok(!banner.includes(token), "redacted banner must not carry the token");
  assert.ok(
    !stderrLines.join("\n").includes(token),
    "non-TTY stderr must not carry the token",
  );
  assert.ok(
    stderrLines.some((line) => line.includes(`listening on ${url}`)),
    "non-TTY run still announces the listen URL",
  );
}

// 2. Explicit opt-in (RABBITHOLE_BRIDGE_EMIT_TOKEN=1) restores the token for
//    automation that legitimately needs it (packaging smoke test, headless setup).
{
  const { banner, stderrLines } = bridgeStartupOutput({
    url,
    pairUrl,
    token,
    stdoutIsTTY: false,
    stderrIsTTY: false,
    emitTokenEnv: "1",
  });
  assert.ok(banner.includes(pairUrl), "opt-in banner carries the pairing link");
  assert.ok(
    stderrLines.some((line) => line === `Pairing token: ${token}`),
    "opt-in emits the parseable token line",
  );
}

// 3. Interactive terminal shows the human the link; the machine log block stays
//    silent because stderr is itself a TTY (no capture risk).
{
  const { banner, stderrLines } = bridgeStartupOutput({
    url,
    pairUrl,
    token,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    emitTokenEnv: "",
  });
  assert.ok(banner.includes(pairUrl), "interactive banner carries the pairing link");
  assert.equal(stderrLines.length, 0, "interactive stderr prints no machine log lines");
}

console.log("bridge-startup: ok");
