# Local installation

Use this procedure to install the current checkout as a real global npm
package and point Claude Code and OpenCode at the same installed MCP server.

Do not use `npm install -g .` for this purpose. npm installs a local directory
as a symbolic link, so the purported installation continues to execute files
from the development checkout. Packing first produces the same detached layout
as a published package.

## Prerequisites

- Node.js 18 or newer
- npm
- A built and verified `live` branch
- Claude Code and/or OpenCode installed

Run all repository commands from the Rabbithole checkout.

## Build and verify

```bash
git switch live
git status --short --branch
npm install
npm run build
npm run check:dist
```

The worktree should contain only changes you intend to install. Generated
`dist/` files must be current before packaging.

## Create a package tarball

Use a temporary directory outside the repository so the tarball does not dirty
the worktree:

```bash
package_dir="$(mktemp -d)"
package_name="$(npm pack --pack-destination "$package_dir" --silent)"
package_file="$package_dir/$package_name"
```

Inspect the `npm pack` output. It should include the MCP entrypoint, source
files, and built `dist/` assets.

## Install the packaged build

```bash
npm uninstall -g @shlokkhemani/rabbithole
npm install -g "$package_file"
```

Resolve the installation path from npm rather than hardcoding a Node or DevBar
version:

```bash
install_dir="$(npm root -g)/@shlokkhemani/rabbithole"
server_path="$install_dir/bin/mcp-server.js"
test -f "$server_path"
test ! -L "$install_dir"
```

The final check is important. If `install_dir` is a symbolic link, Rabbithole
was installed from the checkout instead of from the package tarball.

## Configure Claude Code

Claude Code should run the installed entrypoint with Node:

```bash
claude mcp remove rabbithole -s user
claude mcp add rabbithole -s user -- node "$server_path"
claude mcp get rabbithole
```

The reported `Args` value should equal `server_path`.

## Configure OpenCode

OpenCode uses the same installed entrypoint, plus the push-driver URL required
for canvas questions to re-enter the active session:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "server": {
    "hostname": "127.0.0.1",
    "port": 4599
  },
  "mcp": {
    "rabbithole": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/from/npm-root-g/@shlokkhemani/rabbithole/bin/mcp-server.js"
      ],
      "environment": {
        "RABBITHOLE_OPENCODE_URL": "http://127.0.0.1:4599"
      },
      "enabled": true,
      "timeout": 86400000
    }
  }
}
```

Update only the `mcp.rabbithole` entry in
`~/.config/opencode/opencode.json`; preserve the rest of the existing config.
Replace the example command path with the value of `server_path`.

OpenCode loads configuration at startup. Quit and restart it with the same
host and port used by `RABBITHOLE_OPENCODE_URL`:

```bash
opencode --hostname 127.0.0.1 --port 4599
```

## Verify both clients

Smoke-test the installed server without opening a browser:

```bash
RABBITHOLE_NO_BROWSER=1 node "$server_path" </dev/null
```

Expected stderr includes:

```text
Rabbithole MCP server running on stdio
Received stdin_end, shutting down
```

Then verify client registration:

```bash
claude mcp get rabbithole
opencode mcp list
```

Both clients should report `rabbithole` as connected and show the same
`server_path`.

## Updating the local installation

After new work is merged into `live`, repeat the build, pack, uninstall, and
install steps. Reinstalling from a fresh tarball replaces the detached package
contents. Client configuration only needs to change when `npm root -g` changes,
for example after switching the active DevBar or Node installation.
