# Rabbithole

An infinite canvas for learning. Open a document, ask at any point, and follow each answer into a new document.

[![Rabbithole branching canvas demo](website/public/demo-ask-poster.jpg)](https://rabbithole.ing)

**[Open the web app](https://rabbithole.ing)** · **[Explore the offline architecture tour](docs/tour.html)**

Rabbithole has two hosts and one canvas:

- The static web app uses your chosen model endpoint or the coding-agent subscription already signed in on your machine.
- The MCP server lets Claude Code, Codex, and other MCP clients answer while the canvas, storage, and local transport stay on your machine.

No account, telemetry, or hosted document store. Web documents live in your browser. MCP documents live under `~/.rabbithole/` unless `RABBITHOLE_DIR` overrides it.

## Web

Visit [rabbithole.ing](https://rabbithole.ing), then paste a question or URL, drop Markdown or PDF, or import a Rabbithole file.

The web app supports OpenRouter, local and custom OpenAI-compatible endpoints, and the optional subscription bridge:

```bash
npx @shlokkhemani/rabbithole bridge
```

The bridge prints a private pairing link and connects the page to an installed, signed-in Claude Code or Codex CLI. It binds only to loopback.

## MCP quick start

Requires Node 18+ and a browser.

Claude Code:

```bash
claude mcp add rabbithole -- npx -y github:shlokkhemani/rabbithole
```

Codex:

```bash
codex mcp add rabbithole -- npx -y github:shlokkhemani/rabbithole
```

Then start a fresh agent session and say:

> Open this document in Rabbithole.

The tool call stays pending while the agent listens for canvas asks. If a client enforces a short MCP tool timeout, raise that client's timeout; saved asks survive disconnects and resume.

### OpenCode (push mode)

OpenCode wires the model turn's abort signal into every MCP call, so a listener that blocks past the turn is cancelled with "agent stopped listening" — the pending-call model above never gets to resume. Rabbithole handles this by running as a **push driver** instead: the tool call returns immediately, and when the canvas produces an ask, the MCP server injects a prompt into your live OpenCode session over HTTP rather than parking on a blocking call.

Enable it by pointing the server at OpenCode's HTTP address with `RABBITHOLE_OPENCODE_URL`, then launch the TUI with that same HTTP port. In OpenCode 1.18, the top-level `--port` flag controls the live TUI server; the `server.port` config value alone is not applied by a plain `opencode` launch:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rabbithole": {
      "type": "local",
      "command": ["npx", "-y", "github:shlokkhemani/rabbithole"],
      "environment": { "RABBITHOLE_OPENCODE_URL": "http://127.0.0.1:4599" },
      "enabled": true
    }
  }
}
```

```bash
opencode --hostname 127.0.0.1 --port 4599
```

The URL's port must match the TUI's `--port`. Verify it before opening a hole with `curl http://127.0.0.1:4599/global/health`. Without `RABBITHOLE_OPENCODE_URL` the server stays in the default blocking-listener mode, so this changes nothing for Claude Code, Codex, or other clients.

## Develop

```bash
git clone https://github.com/shlokkhemani/rabbithole.git
cd rabbithole
npm install
npm run build
npm test
```

Useful references:

- [Product and architecture tour](docs/01-tour.md)
- [Generated module map](docs/generated/module-map.md)
- [Generated command map](docs/generated/commands.md)
- [Testing model](docs/05-contribute.md)
- [Compatibility contract](docs/compatibility.md)
- [Design system](docs/design-system.md)
- [Historical proposals](docs/proposals/README.md)

The canvas and frozen snapshots remain self-contained HTML. The browser bundles in `dist/` are committed so the package can run without an install-time build.

## License

MIT. See [LICENSE](LICENSE).
