import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnNode, waitFor, callTool, findResponse, initialize } from "./helpers.mjs";

/** Call a tool and return its text result. */
async function call(state, id, name, args) {
  callTool(state, id, name, args);
  const response = await waitFor(() => findResponse(state, id), { timeoutMs: 30000 });
  assert.ok(!response.result.isError, JSON.stringify(response));
  return response.result.content[0].text;
}

test("type with waitMs returns the command's output, capped, and begin/end page through it", async () => {
  const state = spawnNode(["dist/index.js", "--headless"]);
  try {
    await initialize(state);
    // Let the shell finish starting up before typing
    const startup = await call(state, 2, "getContent", { waitMs: 1000, initialWaitMs: 5000 });
    assert.match(startup, /^\[(lines \d+-\d+|line \d+|no lines) · cursor \d+/);

    // Works the same in cmd, bash, zsh and pwsh
    const command = `node -e "for (let i = 0; i < 150; i++) console.log('row' + i)"\r`;
    const result = await call(state, 3, "type", { text: command, waitMs: 1500, initialWaitMs: 5000 });
    const [summary, header, ...lines] = result.split("\n");
    assert.match(summary, /^Typed \d+ character\(s\) to terminal$/);
    const omitted = header.match(/(\d+) earlier line\(s\) omitted; read them with begin: (\d+), end: (\d+)/);
    assert.ok(omitted, `expected an omitted note in: ${header}`);
    assert.match(header, /waited \d+\.\ds, output went quiet\]$/);
    assert.equal(lines.length, 100);
    assert.ok(lines.includes("row149"), "the tail of the output is kept");
    assert.ok(!lines.includes("row0"), "the head of the output is omitted");

    const [, count, begin, end] = omitted.map(Number);
    const earlier = (await call(state, 4, "getContent", { begin, end })).split("\n");
    assert.equal(earlier.length - 1, count);
    assert.ok(earlier.some((l) => l.includes("for (let i = 0")), "the omitted part starts with the typed command");
    assert.ok(earlier.includes("row0"));

    // Without a wait, type returns the cursor; reading from it shows only the new command
    const typed = await call(state, 5, "type", { text: "echo after_marker\r" });
    const cursor = Number(typed.match(/\[cursor (\d+)\]$/)?.[1]);
    assert.ok(Number.isInteger(cursor), typed);
    const after = await call(state, 6, "getContent", { begin: cursor, waitMs: 1000 });
    assert.match(after, /after_marker/);
    assert.doesNotMatch(after, /row149/);
  } finally {
    state.child.stdin.end();
    await waitFor(() => state.exit !== null).catch(() => state.child.kill());
  }
});

test("type with until waits for a program's own prompt, not the one already on screen", async () => {
  const state = spawnNode(["dist/index.js", "--headless"]);
  try {
    await initialize(state);
    await call(state, 2, "getContent", { waitMs: 1000, initialWaitMs: 5000 });

    // The Node REPL stands in for gdb, python, etc.: its prompt is "> "
    const started = await call(state, 3, "type", { text: "node -i\r", until: "> $", maxWaitMs: 20000 });
    assert.match(started, /waited \d+\.\ds, matched until\]/);

    // "> " is already on screen when this is typed; the wait must hold out for the next one
    const expr = "await new Promise((r) => setTimeout(r, 700)), 'done' + 1\r";
    const result = await call(state, 4, "type", { text: expr, until: "> $", maxWaitMs: 20000 });
    const waited = Number(result.match(/waited (\d+\.\d)s, matched until\]/)?.[1]);
    assert.ok(waited >= 0.6, `should wait for the result, waited ${waited}s:\n${result}`);
    assert.match(result, /'done1'/);

    const badPattern = await (async () => {
      callTool(state, 5, "type", { text: "x", until: "(" });
      return (await waitFor(() => findResponse(state, 5))).result;
    })();
    assert.equal(badPattern.isError, true);
    assert.match(badPattern.content[0].text, /Invalid until pattern/);

    await call(state, 6, "type", { text: ".exit\r", waitMs: 500 });
  } finally {
    state.child.stdin.end();
    await waitFor(() => state.exit !== null).catch(() => state.child.kill());
  }
});
