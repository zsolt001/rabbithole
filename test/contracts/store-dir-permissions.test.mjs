/** @protects private-by-default permissions on the on-disk hole store. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FsStore } from "../../src/node/fs-store.js";

// ~/.rabbithole holds every persisted document. Created under the default
// umask it is typically 0755 — world-readable — so a co-resident local
// account can read another user's holes. The bridge token dir already pins
// 0700; the document store must match.

test("the store directory is created private to the owner (0700)", { skip: process.platform === "win32" }, async () => {
  const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-perms-")), "store");
  const previous = process.env.RABBITHOLE_DIR;
  process.env.RABBITHOLE_DIR = dir;
  try {
    await new FsStore().saveHole({
      hole_id: "perms-hole",
      title: "Perms",
      root_id: "root",
      created_at: "2026-09-11T00:00:00.000Z",
      nodes: [{ id: "root", parent_id: null, title: "Root", markdown: "body", status: "answered" }],
    });
    const mode = (await fs.stat(dir)).mode & 0o777;
    assert.equal(mode & 0o077, 0, `store dir must not be group/other accessible, got ${mode.toString(8)}`);
  } finally {
    if (previous === undefined) delete process.env.RABBITHOLE_DIR;
    else process.env.RABBITHOLE_DIR = previous;
  }
});
