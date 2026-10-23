import { test } from "node:test";
import assert from "node:assert/strict";
import xtermHeadless from "@xterm/headless";
import { LineTracker } from "../dist/terminal/lines.js";

const { Terminal } = xtermHeadless;

/** A 20x5 terminal with 10 rows of scrollback, so trimming starts after 15 rows. */
function makeTerminal() {
  const terminal = new Terminal({ cols: 20, rows: 5, scrollback: 10, allowProposedApi: true });
  const tracker = new LineTracker(terminal);
  const write = (data) => new Promise((resolve) => terminal.write(data, resolve));
  const writeLines = async (from, to) => {
    for (let i = from; i < to; i++) await write(`line ${i}\r\n`);
  };
  return { terminal, tracker, write, writeLines };
}

const range = (from, to) => Array.from({ length: to - from }, (_, i) => `line ${from + i}`);

test("rows keep their numbers after scrollback trims old ones", async () => {
  const { tracker, writeLines } = makeTerminal();
  await writeLines(0, 40);
  const read = tracker.read();
  assert.deepEqual(read.lines, range(26, 40));
  assert.equal(read.firstRow, 26);
  assert.equal(read.lastRow, 39);
  assert.equal(read.cursor, 40);
  assert.equal(read.lost, 0);
});

test("begin reads only newer rows, and reports rows already trimmed", async () => {
  const { tracker, writeLines } = makeTerminal();
  await writeLines(0, 40);
  assert.deepEqual(tracker.read({ begin: 35 }).lines, range(35, 40));

  const stale = tracker.read({ begin: 20 });
  assert.equal(stale.lost, 6);
  assert.equal(stale.firstRow, 26);

  const cursor = tracker.cursor();
  await writeLines(40, 43);
  assert.deepEqual(tracker.read({ begin: cursor }).lines, range(40, 43));
});

test("maxLines keeps the tail and says how to read the rest", async () => {
  const { tracker, writeLines } = makeTerminal();
  await writeLines(0, 40);
  const read = tracker.read({ maxLines: 3 });
  assert.deepEqual(read.lines, range(37, 40));
  assert.deepEqual(read.omitted, { count: 11, begin: 26, end: 37 });
  assert.deepEqual(tracker.read({ begin: 26, end: 37 }).lines, range(26, 37));
});

test("soft-wrapped rows come back as one line, even when begin points mid-line", async () => {
  const { tracker, write } = makeTerminal();
  const long = "abcdefghij".repeat(5); // 50 chars over 20 columns: rows 1-3
  await write(`first\r\n${long}\r\nlast\r\n`);
  assert.deepEqual(tracker.read().lines, ["first", long, "last"]);
  const fromMiddle = tracker.read({ begin: 2 });
  assert.deepEqual(fromMiddle.lines, [long, "last"]);
  assert.equal(fromMiddle.firstRow, 1);
});

test("a full-screen app's screen is returned without disturbing numbering", async () => {
  const { tracker, write, writeLines } = makeTerminal();
  await writeLines(0, 3);
  await write("\x1b[?1049h\x1b[HVIM SCREEN");
  const inApp = tracker.read({ begin: 0 });
  assert.equal(inApp.alternate, true);
  assert.deepEqual(inApp.lines, ["VIM SCREEN"]);
  assert.equal(inApp.cursor, 3);

  await write("\x1b[?1049l");
  await writeLines(3, 5);
  const after = tracker.read();
  assert.equal(after.alternate, false);
  assert.deepEqual(after.lines, range(0, 5));
  assert.equal(after.cursor, 5);
});

test("clearing scrollback keeps numbering and reports the cleared rows as lost", async () => {
  const { tracker, write, writeLines } = makeTerminal();
  await writeLines(0, 40);
  await write("\x1b[3J");
  assert.equal(tracker.cursor(), 40);
  const read = tracker.read({ begin: 30 });
  assert.equal(read.firstRow, 36);
  assert.equal(read.lost, 6);
  assert.deepEqual(read.lines, range(36, 40));
});

test("trimming is tracked exactly through xterm's line list", () => {
  // If an xterm upgrade breaks this, LineTracker silently falls back to approximate numbering
  assert.equal(makeTerminal().tracker.exact, true);
});

test("scroll-region scrolls (e.g. progress bars) don't shift numbering", async () => {
  const { tracker, write, writeLines } = makeTerminal();
  await writeLines(0, 40);
  // Scroll rows 2-4 six times, as a pinned-footer progress UI does; nothing enters scrollback
  await write("\x1b[2;4r\x1b[4;1H" + "x\n".repeat(6) + "\x1b[r\x1b[5;1H");
  const read = tracker.read({ begin: 26, end: 36 });
  assert.equal(read.firstRow, 26);
  assert.deepEqual(read.lines, range(26, 36));
});

test("a full reset continues numbering after the old rows", async () => {
  const { tracker, write, writeLines } = makeTerminal();
  await writeLines(0, 40);
  const before = tracker.cursor();
  await write("\x1bc");
  await writeLines(100, 102);
  const read = tracker.read();
  assert.deepEqual(read.lines, ["line 100", "line 101"]);
  assert.ok(read.firstRow > before, `first row ${read.firstRow} should follow ${before}`);
  assert.equal(tracker.read({ begin: before }).lost, read.firstRow - before);
});

test("resizing without rewrapping keeps every row's number", async () => {
  const { tracker, writeLines } = makeTerminal();
  await writeLines(0, 40);
  tracker.resize(15, 8);
  const read = tracker.read();
  assert.equal(read.firstRow, 26);
  assert.deepEqual(read.lines, range(26, 40));
  assert.equal(read.cursor, 40);
});

test("textToCursor ends at the cursor, so $ means 'sitting at a prompt'", async () => {
  const { tracker, write } = makeTerminal();
  await write("(gdb) run\r\nStarting program\r\n(gdb) ");
  assert.equal(tracker.textToCursor(), "(gdb) run\nStarting program\n(gdb) ");
  assert.match(tracker.textToCursor(), /\(gdb\) $/);
  assert.equal(tracker.textToCursor(1), "Starting program\n(gdb) ");

  // Typed-but-unsubmitted input after the prompt no longer matches
  await write("next");
  assert.doesNotMatch(tracker.textToCursor(), /\(gdb\) $/);
  // Text after the cursor isn't included
  await write("\x1b[2D");
  assert.equal(tracker.textToCursor(2), "(gdb) ne");
});

test("textToCursor joins soft-wrapped rows", async () => {
  const { tracker, write } = makeTerminal();
  const long = "abcdefghij".repeat(3); // 30 chars over 20 columns
  await write(`${long}\r\n>>> `);
  assert.equal(tracker.textToCursor(), `${long}\n>>> `);
  assert.equal(tracker.textToCursor(1), `${long}\n>>> `, "begin inside a wrapped line starts at the line");
});
