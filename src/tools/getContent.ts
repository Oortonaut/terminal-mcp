import { z } from "zod";
import { TerminalManager, wantsWait, DEFAULT_MAX_WAIT_MS, MAX_WAIT_LIMIT_MS } from "../terminal/index.js";
import type { LineRead, WaitResult } from "../terminal/index.js";

export const DEFAULT_MAX_LINES = 100;

const row = z.number().int().nonnegative();
const ms = z.number().int().nonnegative();

/** Wait and size options shared with type() */
export const readOptionsShape = {
  maxLines: z
    .number()
    .int()
    .positive()
    .optional()
    .default(DEFAULT_MAX_LINES)
    .describe(`Return at most this many lines, keeping the last ones (default ${DEFAULT_MAX_LINES})`),
  until: z
    .string()
    .optional()
    .describe("Wait until this regex matches the text from begin up to the cursor; end it with $ to match a prompt"),
  waitMs: ms.optional().describe("Wait until output has been quiet this long before reading"),
  initialWaitMs: ms.optional().describe("How long to wait for output to start at all (default: waitMs)"),
  maxWaitMs: ms
    .max(MAX_WAIT_LIMIT_MS)
    .optional()
    .describe(`Cap on the whole wait, for output that never goes quiet (default ${DEFAULT_MAX_WAIT_MS})`),
};

export const readOptionsProperties = {
  maxLines: {
    type: "number",
    description: `Return at most this many lines, keeping the last ones (default ${DEFAULT_MAX_LINES}). The header says how to read any omitted lines.`,
    default: DEFAULT_MAX_LINES,
  },
  until: {
    type: "string",
    description: "Wait until this regex (JavaScript syntax) matches the new text up to the terminal cursor. $ matches at the cursor, so \"\\\\(gdb\\\\) $\" waits for gdb's prompt and \">>> $\" for Python's; without $ it matches anywhere in the new output. Works with any program, unlike guessing from silence.",
  },
  waitMs: {
    type: "number",
    description: "Wait until output has been quiet for this many milliseconds before reading. Pick it longer than the longest pause in the output you expect. With until, also ends the wait.",
  },
  initialWaitMs: {
    type: "number",
    description: "How long to wait for output to start at all (default: waitMs). If nothing arrives in time, returns what is there.",
  },
  maxWaitMs: {
    type: "number",
    description: `Cap on the whole wait in milliseconds (default ${DEFAULT_MAX_WAIT_MS}, max ${MAX_WAIT_LIMIT_MS})`,
  },
};

export const getContentSchema = z.object({
  visibleOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, only return the visible viewport content. If false, read lines from the scrollback buffer."),
  begin: row.optional().describe("First line number to return, e.g. the cursor from a previous result"),
  end: row.optional().describe("Line number to stop before (exclusive)"),
  ...readOptionsShape,
  sessionId: z.string().optional().describe("Target session ID. Omit to target the default session."),
});

export type GetContentArgs = z.infer<typeof getContentSchema>;

export const getContentTool = {
  name: "getContent",
  description: `Get terminal content as plain text. Every result starts with a header like [lines 812-860 · cursor 860]. Lines are numbered from the start of the session and keep their numbers as scrollback fills. The cursor is the line the terminal cursor is on; pass it back as begin to read only what came after (that line is included again, since it may still change). Returns at most maxLines lines (default ${DEFAULT_MAX_LINES}), keeping the last ones; the header says how to read the rest with begin/end. To wait for output first, pass until (a regex such as a prompt, e.g. getContent({ begin: 860, until: "\\\\(gdb\\\\) $" })) or waitMs (a quiet period). When a full-screen app (vim, less, htop) is running, returns its screen instead. Set visibleOnly=true for just the current viewport. Prefer this over takeScreenshot for reading command output. Pass sessionId to read a specific session.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      begin: {
        type: "number",
        description: "First line number to return, usually the cursor from a previous getContent or type result",
      },
      end: {
        type: "number",
        description: "Line number to stop before (exclusive); with begin, reads a fixed range such as omitted lines",
      },
      ...readOptionsProperties,
      visibleOnly: {
        type: "boolean",
        description: "If true, only return the visible viewport content, ignoring begin/end/maxLines. If false (default), read lines from the scrollback buffer.",
        default: false,
      },
      sessionId: {
        type: "string",
        description: "Target session ID. Omit to target the default session.",
      },
    },
    required: [],
  },
};

const WAIT_REASONS: Record<WaitResult["reason"], string> = {
  matched: "matched until",
  quiet: "output went quiet",
  "no-output": "no new output",
  "max-wait": "hit maxWaitMs",
  exited: "session exited",
};

const MISS_TAIL_CHARS = 40;

/** An until that didn't match, and the text it was tested against */
export interface UntilMiss {
  until: RegExp;
  text: string;
}

/**
 * The end of the last line before the cursor, quoted so trailing spaces and control characters
 * show: enough to see why a prompt pattern like "> $" missed a prompt that ends in ">".
 */
function describeMiss({ until, text }: UntilMiss): string {
  const line = text.slice(text.lastIndexOf("\n") + 1);
  const tail = line.length > MISS_TAIL_CHARS ? `…${line.slice(-MISS_TAIL_CHARS)}` : line;
  return `until ${until} never matched; text before the cursor ends ${JSON.stringify(tail)}`;
}

/** Header line plus lines, e.g. "[lines 812-860 · cursor 860]\n..." */
export function formatRead(read: LineRead, wait?: WaitResult, miss?: UntilMiss): string {
  const parts: string[] = [];
  if (read.alternate) {
    parts.push("full-screen app; showing its screen");
  } else if (read.firstRow === null) {
    parts.push("no lines");
  } else {
    parts.push(read.firstRow === read.lastRow ? `line ${read.firstRow}` : `lines ${read.firstRow}-${read.lastRow}`);
  }
  parts.push(`cursor ${read.cursor}`);
  if (read.omitted) {
    parts.push(
      `${read.omitted.count} earlier line(s) omitted; read them with begin: ${read.omitted.begin}, end: ${read.omitted.end}`
    );
  }
  if (read.lost > 0) {
    parts.push(`${read.lost} line(s) from begin already dropped from scrollback`);
  }
  if (wait) {
    parts.push(`waited ${(wait.waitedMs / 1000).toFixed(1)}s, ${WAIT_REASONS[wait.reason]}`);
  }
  if (miss) {
    parts.push(describeMiss(miss));
  }
  const header = `[${parts.join(" · ")}]`;
  return read.lines.length > 0 ? `${header}\n${read.lines.join("\n")}` : header;
}

/** Compile until up front so a bad pattern fails before anything is typed or waited on. */
export function compileUntil(pattern: string | undefined): RegExp | undefined {
  if (pattern === undefined) return undefined;
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid until pattern: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface ReadRequest {
  begin?: number;
  end?: number;
  maxLines?: number;
  until?: RegExp;
  /**
   * Text up to the cursor that never counts as a match: for type(), the screen as it was before
   * typing, where the old prompt would match at once. Comparing text rather than waiting for any
   * output matters because some line editors (e.g. PSReadLine) first send invisible sequences.
   */
  untilIgnore?: string;
  waitMs?: number;
  initialWaitMs?: number;
  maxWaitMs?: number;
  sessionId?: string;
}

/** Wait as the request asks (if at all); otherwise just let xterm catch up on output. */
async function waitAsRequested(manager: TerminalManager, request: ReadRequest): Promise<WaitResult | undefined> {
  const { until, untilIgnore, begin, sessionId } = request;
  if (!wantsWait(request)) {
    await manager.flush(sessionId);
    return undefined;
  }
  const matches = () => {
    const text = manager.textToCursor(begin, sessionId);
    return text !== untilIgnore && until!.test(text);
  };
  return manager.waitForOutput({ ...request, until: until && matches }, sessionId);
}

/** Optionally wait for output, then read and format lines. */
export async function readContent(manager: TerminalManager, request: ReadRequest): Promise<string> {
  const wait = await waitAsRequested(manager, request);
  if (wait?.reason === "exited") {
    return `[${WAIT_REASONS.exited}]`;
  }
  const read = manager.readLines(
    { begin: request.begin, end: request.end, maxLines: request.maxLines },
    request.sessionId
  );
  const miss =
    request.until && wait && wait.reason !== "matched"
      ? { until: request.until, text: manager.textToCursor(request.begin, request.sessionId) }
      : undefined;
  return formatRead(read, wait, miss);
}

export async function handleGetContent(
  manager: TerminalManager,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = getContentSchema.parse(args ?? {});
  const request = { ...parsed, until: compileUntil(parsed.until) };

  let text: string;
  if (parsed.visibleOnly) {
    await waitAsRequested(manager, { ...request, begin: undefined });
    const cursor = manager.getCursorLine(parsed.sessionId);
    text = `[screen · cursor ${cursor}]\n${manager.getVisibleContent(parsed.sessionId)}`;
  } else {
    text = await readContent(manager, request);
  }

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}
