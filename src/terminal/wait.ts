/**
 * Waiting for terminal output, for request/response style tool calls.
 */

export interface OutputSource {
  /** Increments on every chunk of PTY output */
  outputCount(): number;
  /** Date.now() of the most recent output */
  lastOutputAt(): number;
  isActive(): boolean;
  /** Call listener each time xterm finishes parsing a chunk of output; returns an unsubscribe */
  onOutputParsed(listener: () => void): () => void;
}

export interface WaitOptions {
  /** Return once output has been quiet this long (0: as soon as any output arrives) */
  waitMs?: number;
  /** How long to wait for output to start at all (default: waitMs) */
  initialWaitMs?: number;
  /** Return as soon as this is true */
  until?: () => boolean;
  /** Only test until once new output has arrived (when the screen may still show a stale match) */
  untilAfterOutput?: boolean;
  /** Hard cap on the whole wait, so a stream that never ends can't hang the call */
  maxWaitMs?: number;
}

export type WaitReason = "matched" | "quiet" | "no-output" | "max-wait" | "exited";

export interface WaitResult {
  reason: WaitReason;
  waitedMs: number;
}

export const DEFAULT_MAX_WAIT_MS = 30_000;
export const MAX_WAIT_LIMIT_MS = 600_000;
/** Re-check at least this often so an exiting session doesn't hold the call until a long timer fires */
const POLL_MS = 250;

/** True if the options ask for any waiting at all. */
export function wantsWait(options: { waitMs?: number; initialWaitMs?: number; until?: unknown }): boolean {
  return options.waitMs !== undefined || options.initialWaitMs !== undefined || options.until !== undefined;
}

/**
 * Wait for output. Ends when until() is true; or, if waitMs or initialWaitMs is given, when no
 * output starts within initialWaitMs or output then stays quiet for waitMs. Never longer than
 * maxWaitMs in total.
 */
export function waitForOutput(source: OutputSource, options: WaitOptions): Promise<WaitResult> {
  const quietRule = options.waitMs !== undefined || options.initialWaitMs !== undefined;
  const waitMs = options.waitMs ?? 0;
  const initialWaitMs = options.initialWaitMs ?? waitMs;
  const maxWaitMs = Math.min(options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, MAX_WAIT_LIMIT_MS);

  const start = Date.now();
  const startCount = source.outputCount();
  const deadline = start + maxWaitMs;

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    let unsubscribe = () => {};
    let finished = false;

    const check = () => {
      if (finished) return;
      const now = Date.now();
      const done = (reason: WaitReason) => {
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        resolve({ reason, waitedMs: now - start });
      };

      if (!source.isActive()) return done("exited");
      const sawOutput = source.outputCount() !== startCount;
      if (options.until && (sawOutput || !options.untilAfterOutput) && options.until()) return done("matched");

      let target = deadline;
      if (quietRule) {
        target = sawOutput ? source.lastOutputAt() + waitMs : start + initialWaitMs;
        if (now >= target) return done(sawOutput ? "quiet" : "no-output");
      }
      if (now >= deadline) return done("max-wait");

      clearTimeout(timer);
      timer = setTimeout(check, Math.max(1, Math.min(target, deadline, now + POLL_MS) - now));
    };

    unsubscribe = source.onOutputParsed(check);
    check();
  });
}
