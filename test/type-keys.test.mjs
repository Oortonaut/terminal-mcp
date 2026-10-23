import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeyInput } from "../dist/utils/keys.js";
import { handleType } from "../dist/tools/type.js";

const data = (text) => parseKeyInput(text).data;

test("plain text passes through unchanged", () => {
  assert.deepEqual(parseKeyInput("ls -la"), { data: "ls -la", chars: 6, keys: [], warnings: [] });
});

test("named keys are encoded, case-insensitively", () => {
  assert.equal(data("ls<:Enter:>"), "ls\r");
  assert.equal(data("<:enter:><:TAB:><:Escape:><:esc:>"), "\r\t\x1b\x1b");
  assert.equal(data("<:ArrowUp:><:up:><:PageDown:><:F1:><:F5:>"), "\x1b[A\x1b[A\x1b[6~\x1bOP\x1b[15~");
});

test("ctrl is accepted as a word or as ^, in any case", () => {
  for (const k of ["<:^C:>", "<:^c:>", "<:ctrl-c:>", "<:Ctrl-C:>", "<:CTRL+C:>", "<:control-c:>"]) {
    assert.equal(data(k), "\x03", k);
  }
  assert.equal(data("<:^[:>"), "\x1b");
  assert.equal(data("<:ctrl-space:>"), "\x00");
  assert.equal(data("<:^?:>"), "\x7f");
});

test("alt and ctrl combine in either order, as words or symbols", () => {
  for (const k of ["<:alt-ctrl-C:>", "<:ctrl-alt-C:>", "<:!^C:>", "<:^!C:>", "<:alt-^C:>", "<:meta-ctrl-c:>"]) {
    assert.equal(data(k), "\x1b\x03", k);
  }
  assert.equal(data("<:!x:>"), "\x1bx");
  assert.equal(data("<:alt-Enter:>"), "\x1b\r");
});

test("shift uppercases letters and maps Shift+Tab", () => {
  assert.equal(data("<:+a:>"), "A");
  assert.equal(data("<:shift-a:>"), "A");
  assert.equal(data("<:+Tab:>"), "\x1b[Z");
  assert.equal(data("<:!+Tab:>"), "\x1b\x1b[Z");
});

test("modified cursor and function keys use xterm modifier parameters", () => {
  assert.equal(data("<:ctrl-ArrowLeft:>"), "\x1b[1;5D");
  assert.equal(data("<:^+Right:>"), "\x1b[1;6C");
  assert.equal(data("<:!Home:>"), "\x1b[1;3H");
  assert.equal(data("<:+F1:>"), "\x1b[1;2P");
  assert.equal(data("<:ctrl-Delete:>"), "\x1b[3;5~");
});

test("a modifier symbol can itself be the modified character", () => {
  assert.equal(data("<:^^:>"), "\x1e");
  assert.equal(data("<:alt--:>"), "\x1b-");
  assert.equal(data("<:!+:>"), "\x1b+");
  assert.equal(data("<:alt-::>"), "\x1b:");
});

test("braces and other brackets are ordinary text", () => {
  for (const text of ["echo {a,b}", "fn() { }", "{{ .Name }}", "find . -exec rm {} \\;", "<div>", "a < b > c"]) {
    assert.deepEqual(parseKeyInput(text), { data: text, chars: text.length, keys: [], warnings: [] }, text);
  }
});

/** Assert text is typed back exactly as written, with one warning per pattern. */
function assertLiteral(text, ...patterns) {
  const { data: out, chars, keys, warnings } = parseKeyInput(text);
  assert.equal(out, text);
  assert.equal(chars, text.length);
  assert.deepEqual(keys, []);
  assert.equal(warnings.length, patterns.length, warnings.join("\n"));
  patterns.forEach((p, i) => assert.match(warnings[i], p));
}

test("bad escapes are typed literally with a warning", () => {
  assertLiteral("echo <:nope:>", /"<:nope:>" at position 5: not a recognized key.*typed literally/);
  assertLiteral("oops <:Enter", /Unmatched "<:" at position 5/);
  assertLiteral("oops :>", /Unmatched ":>" at position 5/);
  assertLiteral("<::>", /empty key name/);
  assertLiteral("<:c:><:+:><: :>", ...Array(3).fill(/a single character needs a modifier/));
  assertLiteral("<:+1:>", /shift only applies to letters/);
  assertLiteral("<:^1:>", /no control code/);
  assertLiteral("<:ctrl-Enter:>", /no standard terminal encoding/);
});

test("code that uses the delimiters comes out as written", () => {
  assertLiteral("f(x::T) where T <: Number", /Unmatched "<:" at position 16/);
  assertLiteral("let y = x :> IFoo", /Unmatched ":>" at position 10/);
  assertLiteral("<:>", /Unmatched "<:" at position 0/);
});

test("a stray opener does not swallow a following key", () => {
  const { data: out, keys, warnings } = parseKeyInput("a <:b <:Enter:>");
  assert.equal(out, "a <:b \r");
  assert.deepEqual(keys, ["Enter"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Unmatched "<:" at position 2/);
});

function fakeManager() {
  const writes = [];
  return { writes, write: (d, sessionId) => writes.push({ d, sessionId }), getCursorLine: () => 7 };
}

test("handleType concatenates an array of segments into one write", async () => {
  const m = fakeManager();
  const result = await handleType(m, { text: ["vim x<:Enter:>", "ihi<:Escape:>", ":wq<:Enter:>"], sessionId: "s1" });
  assert.deepEqual(m.writes, [{ d: "vim x\rihi\x1b:wq\r", sessionId: "s1" }]);
  assert.equal(
    result.content[0].text,
    "Typed 11 character(s) and 3 key(s): <:Enter:> <:Escape:> <:Enter:> to terminal [cursor 7]"
  );
});

test("handleType with sendKeys: false types escapes verbatim", async () => {
  const m = fakeManager();
  const result = await handleType(m, { text: ["echo ", "<:Enter:>"], sendKeys: false });
  assert.deepEqual(m.writes, [{ d: "echo <:Enter:>", sessionId: undefined }]);
  assert.equal(result.content[0].text, "Typed 14 character(s) to terminal [cursor 7]");
});

test("handleType types bad escapes literally and reports them as warnings", async () => {
  const m = fakeManager();
  const result = await handleType(m, { text: ["ok<:Enter:>", "echo <:c:><:Enter:>"] });
  assert.deepEqual(m.writes, [{ d: "ok\recho <:c:>\r", sessionId: undefined }]);
  assert.equal(result.isError, undefined);
  const lines = result.content[0].text.split("\n");
  assert.equal(lines[0], "Typed 12 character(s) and 2 key(s): <:Enter:> <:Enter:> to terminal [cursor 7]");
  assert.match(lines[1], /^Warning: text\[1\]: "<:c:>" at position 5: a single character needs a modifier; typed literally$/);
  assert.match(lines[2], /sendKeys: false/);
  assert.equal(lines.length, 3);
});
