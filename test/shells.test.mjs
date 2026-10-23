import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveShell, listShells } from "../dist/utils/shells.js";
import { spawnNode, sleep, waitFor, callTool, findResponse, initialize } from "./helpers.mjs";

const ENV_KEYS = ["PATH", "TERMINAL_MCP_SHELL", "ProgramFiles"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** A temp dir holding an empty "fakesh" executable, made the only entry on PATH. */
function fakeShellOnPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmcp-shells-"));
  const file = path.join(dir, process.platform === "win32" ? "fakesh.exe" : "fakesh");
  fs.writeFileSync(file, "");
  process.env.PATH = dir;
  process.env.ProgramFiles = dir;
  delete process.env.TERMINAL_MCP_SHELL;
  return { dir, file };
}

test("a path to an existing file is used as-is; a missing one is an error", () => {
  const { dir, file } = fakeShellOnPath();
  assert.equal(resolveShell(file), file);
  assert.throws(() => resolveShell(path.join(dir, "missing-sh")), /Shell not found: .*missing-sh/);
});

test("a bare name is looked up on PATH", () => {
  const { file } = fakeShellOnPath();
  assert.equal(resolveShell("fakesh"), file);
  assert.equal(resolveShell("  fakesh  "), file);
});

test("unknown and uninstalled shells fail with the list of available shells", () => {
  fakeShellOnPath();
  assert.throws(() => resolveShell("no-such-shell"), /"no-such-shell" was not found on PATH\. Available shells: /);
  // pwsh is a known name on every platform, but isn't on this PATH or under this ProgramFiles
  assert.throws(() => resolveShell("pwsh"), /"pwsh" is not installed\. Available shells: /);
});

test("TERMINAL_MCP_SHELL sets the default, and an explicit shell overrides it", () => {
  const { dir, file } = fakeShellOnPath();
  process.env.TERMINAL_MCP_SHELL = "fakesh";
  assert.equal(resolveShell(), file);
  assert.equal(resolveShell(""), file);

  const other = path.join(dir, "other-sh");
  fs.writeFileSync(other, "");
  assert.equal(resolveShell(other), other);
});

test("listShells marks the default, even when it isn't a known shell", () => {
  const { file } = fakeShellOnPath();
  process.env.TERMINAL_MCP_SHELL = file;
  const defaults = listShells().filter((s) => s.isDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].path, file);
});

test("listShells still works when TERMINAL_MCP_SHELL is invalid", () => {
  fakeShellOnPath();
  process.env.TERMINAL_MCP_SHELL = "no-such-shell";
  assert.ok(Array.isArray(listShells()));
  assert.throws(() => resolveShell(), /no-such-shell/);
});

test("createSession runs the chosen shell with shellArgs and reports them", async () => {
  const state = spawnNode(["dist/index.js", "--headless"]);
  try {
    await initialize(state);

    // node stands in for a shell: it echoes its arguments, then stays alive
    const script = "console.log('ARGV:' + process.argv.slice(1).join(',')); setInterval(() => {}, 1000)";
    callTool(state, 2, "createSession", { shell: process.execPath, shellArgs: ["-e", script, "a", "b c"] });
    const created = await waitFor(() => findResponse(state, 2));
    assert.ok(!created.result.isError, JSON.stringify(created));
    const meta = JSON.parse(created.result.content[0].text);
    assert.equal(meta.shell, process.execPath);
    assert.deepEqual(meta.shellArgs, ["-e", script, "a", "b c"]);

    let screen = "";
    for (let probeId = 100; probeId < 140 && !screen.includes("ARGV:a,b c"); probeId++) {
      callTool(state, probeId, "getContent", { sessionId: meta.sessionId });
      screen = (await waitFor(() => findResponse(state, probeId))).result.content[0].text;
      await sleep(100);
    }
    assert.match(screen, /ARGV:a,b c/);

    callTool(state, 3, "createSession", { shell: "no-such-shell" });
    const bad = await waitFor(() => findResponse(state, 3));
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /"no-such-shell" was not found on PATH/);

    callTool(state, 4, "listShells");
    const listed = await waitFor(() => findResponse(state, 4));
    assert.ok(Array.isArray(JSON.parse(listed.result.content[0].text).shells));
  } finally {
    state.child.stdin.end();
    await waitFor(() => state.exit !== null).catch(() => state.child.kill());
  }
});
