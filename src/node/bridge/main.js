import { spawn } from "node:child_process";

import { log, error as logError, warn } from "../shared/logger.js";
import { createBridge } from "./server.js";

const BRIDGE_VERSION = "0.4.0";
const DEFAULT_PORT = 41414;

export { createBridge } from "./server.js";

export function pairingUrl(token, port = DEFAULT_PORT) {
  const portParam = port === DEFAULT_PORT ? "" : `&bridge_port=${port}`;
  return `https://rabbithole.ing/#bridge=${token}${portParam}`;
}

function openInBrowser(url) {
  const [command, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/* The startup print is the one screen every user of this feature reads; stderr
   keeps the parseable log lines, stdout gets the human ones. The pairing link
   carries a 256-bit bearer token, so it is only rendered when a token holder is
   actually present to read it — see bridgeStartupOutput. */
function renderBanner({ url, pairUrl, opened, tty, revealToken }) {
  const bold = (text) => (tty ? `\u001B[1m${text}\u001B[0m` : text);
  const dim = (text) => (tty ? `\u001B[2m${text}\u001B[0m` : text);
  const linkBlock = revealToken
    ? `  ${bold("→")} Open this link to connect your browser:\n\n`
      + `    ${bold(pairUrl)}\n`
      + (opened ? `\n    ${dim("Opening it for you…")}\n` : "")
    : `  ${bold("→")} Pairing link hidden — it carries a bearer token and this\n`
      + `    run has no interactive terminal. Re-run in a terminal, or set\n`
      + `    ${bold("RABBITHOLE_BRIDGE_EMIT_TOKEN=1")} to print it (keep it out of logs).\n`;
  return `\n  ${bold("Rabbithole bridge")} ${dim(`· ${url}`)}\n`
    + `  ${dim("Answers on rabbithole.ing come from Claude Code / Codex on this computer.")}\n\n`
    + linkBlock
    + `\n  ${dim("Keep this running while you use Rabbithole. Ctrl-C stops it.")}\n\n`;
}

/* Decide whether the bearer token may appear in output, then compose both the
   stdout banner and the non-TTY stderr log lines from that single decision. A
   token holder is present only when stdout is an interactive terminal; every
   other run (systemd, docker, tmux/CI capture, plain pipe) persists its output
   to logs, so the token is withheld unless RABBITHOLE_BRIDGE_EMIT_TOKEN=1
   explicitly opts a headless consumer back in. */
export function bridgeStartupOutput({
  url,
  pairUrl,
  token,
  opened = false,
  stdoutIsTTY = false,
  stderrIsTTY = false,
  emitTokenEnv,
}) {
  const revealToken = Boolean(stdoutIsTTY) || emitTokenEnv === "1";
  const banner = renderBanner({ url, pairUrl, opened, tty: stdoutIsTTY, revealToken });
  const stderrLines = [];
  if (!stderrIsTTY) {
    stderrLines.push(`Rabbithole bridge listening on ${url}`);
    if (revealToken) stderrLines.push(`Pairing token: ${token}`);
  }
  return { banner, stderrLines, revealToken };
}

export async function runBridge({
  port = DEFAULT_PORT,
  newToken = false,
  autoOpen = true,
  env = process.env,
} = {}) {
  const bridge = await createBridge({
    port,
    newToken,
    env,
    version: BRIDGE_VERSION,
    logger: { warn },
  });
  await bridge.start();
  const pairUrl = pairingUrl(bridge.token, bridge.port);
  // First run (or --new-token) means no browser is paired yet — opening the
  // link is the setup, so do it for the user. Reruns stay quiet: the browser
  // already holds the token and reconnects on its own.
  const opened = autoOpen && bridge.tokenCreated && process.stdout.isTTY && openInBrowser(pairUrl);
  // A single decision drives both streams: the human banner on stdout and the
  // parseable log lines that machine consumers (test harnesses, process
  // managers) read from piped stderr. Both withhold the token off a TTY unless
  // RABBITHOLE_BRIDGE_EMIT_TOKEN=1, so log capture never persists the bearer.
  const { banner, stderrLines } = bridgeStartupOutput({
    url: bridge.url,
    pairUrl,
    token: bridge.token,
    opened,
    stdoutIsTTY: process.stdout.isTTY,
    stderrIsTTY: process.stderr.isTTY,
    emitTokenEnv: env.RABBITHOLE_BRIDGE_EMIT_TOKEN,
  });
  process.stdout.write(banner);
  for (const line of stderrLines) log(line);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down bridge`);
    try {
      await bridge.close();
      process.exitCode = 0;
    } catch (error) {
      logError(`Bridge shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }
  return bridge;
}
