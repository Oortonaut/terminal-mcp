import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForOutput } from "../dist/terminal/wait.js";
import { sleep } from "./helpers.mjs";

/** An OutputSource whose output is driven by emit(); each emit counts as parsed immediately. */
function fakeSource() {
  let count = 0;
  let last = 0;
  let active = true;
  const parsed = new Set();
  return {
    outputCount: () => count,
    lastOutputAt: () => last,
    isActive: () => active,
    onOutputParsed(listener) {
      parsed.add(listener);
      return () => parsed.delete(listener);
    },
    listenerCount: () => parsed.size,
    emit() {
      count++;
      last = Date.now();
      for (const listener of parsed) listener();
    },
    exit() {
      active = false;
    },
  };
}

/** Emit at each delay (ms from now). */
function emitAt(source, delays) {
  for (const d of delays) setTimeout(() => source.emit(), d);
}

test("returns once output has been quiet for waitMs", async () => {
  const source = fakeSource();
  emitAt(source, [20, 60, 100]);
  const result = await waitForOutput(source, { waitMs: 150 });
  assert.equal(result.reason, "quiet");
  // Last output at ~100ms, then 150ms of quiet
  assert.ok(result.waitedMs >= 240 && result.waitedMs < 600, `waited ${result.waitedMs}ms`);
});

test("gives up after initialWaitMs when nothing arrives", async () => {
  const source = fakeSource();
  const result = await waitForOutput(source, { waitMs: 1000, initialWaitMs: 80 });
  assert.equal(result.reason, "no-output");
  assert.ok(result.waitedMs >= 75 && result.waitedMs < 500, `waited ${result.waitedMs}ms`);
});

test("initialWaitMs defaults to waitMs", async () => {
  const source = fakeSource();
  const result = await waitForOutput(source, { waitMs: 80 });
  assert.equal(result.reason, "no-output");
  assert.ok(result.waitedMs >= 75, `waited ${result.waitedMs}ms`);
});

test("with only initialWaitMs, returns as soon as output starts", async () => {
  const source = fakeSource();
  emitAt(source, [50]);
  const result = await waitForOutput(source, { initialWaitMs: 2000 });
  assert.equal(result.reason, "quiet");
  assert.ok(result.waitedMs < 500, `waited ${result.waitedMs}ms`);
});

test("maxWaitMs caps output that never goes quiet", async () => {
  const source = fakeSource();
  const stream = setInterval(() => source.emit(), 10);
  try {
    const result = await waitForOutput(source, { waitMs: 100, maxWaitMs: 200 });
    assert.equal(result.reason, "max-wait");
    assert.ok(result.waitedMs >= 195 && result.waitedMs < 700, `waited ${result.waitedMs}ms`);
  } finally {
    clearInterval(stream);
  }
});

test("output from before the call does not count as new output", async () => {
  const source = fakeSource();
  source.emit();
  await sleep(20);
  const result = await waitForOutput(source, { waitMs: 60 });
  assert.equal(result.reason, "no-output");
});

test("an exiting session ends the wait promptly", async () => {
  const source = fakeSource();
  setTimeout(() => source.exit(), 50);
  const result = await waitForOutput(source, { waitMs: 5000 });
  assert.equal(result.reason, "exited");
  assert.ok(result.waitedMs < 1000, `waited ${result.waitedMs}ms`);
});

test("until ends the wait as soon as it matches, re-checked on each parsed output", async () => {
  const source = fakeSource();
  emitAt(source, [20, 40, 60]);
  const result = await waitForOutput(source, { until: () => source.outputCount() >= 2 });
  assert.equal(result.reason, "matched");
  // Matched on the second output (~40ms), well before the third or any poll-only timing
  assert.ok(result.waitedMs >= 35 && result.waitedMs < 250, `waited ${result.waitedMs}ms`);
  assert.equal(source.listenerCount(), 0, "unsubscribes when done");
});

test("until matches immediately if already true", async () => {
  const already = await waitForOutput(fakeSource(), { until: () => true });
  assert.equal(already.reason, "matched");
  assert.ok(already.waitedMs < 20);
});

test("until alone ignores silence and waits up to maxWaitMs", async () => {
  const source = fakeSource();
  emitAt(source, [10]);
  const result = await waitForOutput(source, { until: () => false, maxWaitMs: 200 });
  assert.equal(result.reason, "max-wait");
  assert.ok(result.waitedMs >= 195, `waited ${result.waitedMs}ms`);
});

test("until and waitMs combine: whichever comes first ends the wait", async () => {
  const quietFirst = fakeSource();
  emitAt(quietFirst, [10]);
  const quiet = await waitForOutput(quietFirst, { until: () => false, waitMs: 60 });
  assert.equal(quiet.reason, "quiet");

  const matchFirst = fakeSource();
  emitAt(matchFirst, [10, 20, 30]);
  const matched = await waitForOutput(matchFirst, { until: () => matchFirst.outputCount() === 3, waitMs: 1000 });
  assert.equal(matched.reason, "matched");
  assert.ok(matched.waitedMs < 500, `waited ${matched.waitedMs}ms`);
});
