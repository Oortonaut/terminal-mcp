/**
 * Stable line numbering and ranged reads over an xterm buffer.
 *
 * Rows are numbered from 0 at session start and keep their numbers as scrollback fills and old
 * rows are trimmed, so a client can hold a number (a "cursor") and later read only what follows it.
 */
import xtermHeadless from "@xterm/headless";

type Terminal = InstanceType<typeof xtermHeadless.Terminal>;

export interface LineReadOptions {
  /** First row to read (inclusive). Defaults to the oldest row still in scrollback. */
  begin?: number;
  /** Row to stop before (exclusive). Defaults to the end of the buffer. */
  end?: number;
  /** Keep only the last maxLines lines, reporting the rest as omitted */
  maxLines?: number;
}

export interface LineRead {
  /** Logical lines: rows joined across soft wraps, trailing whitespace trimmed */
  lines: string[];
  /** Row number of the first returned line, or null if none */
  firstRow: number | null;
  /** Row number of the last row of the last returned line, or null if none */
  lastRow: number | null;
  /** Row the terminal cursor is on: the one row that may still change */
  cursor: number;
  /** Lines dropped by maxLines, with the row range that reads them back */
  omitted: { count: number; begin: number; end: number } | null;
  /** Rows requested via begin that were already trimmed from scrollback */
  lost: number;
  /** A full-screen app is on the alternate screen; lines is that screen and begin/end don't apply */
  alternate: boolean;
}

/** The slice of xterm's internal line list (CircularList) that reports trimming */
interface TrimmableLines {
  readonly length: number;
  onTrim(listener: (amount: number) => void): { dispose(): void };
}

/**
 * The normal buffer's internal line list. xterm's public API has no trim event, and onScroll is
 * not a substitute: it also fires for scroll-region scrolls (which trim nothing) and for ESC[3J.
 */
function internalLines(terminal: Terminal): TrimmableLines | null {
  const lines = (terminal as unknown as { _core?: { buffers?: { normal?: { lines?: unknown } } } })._core?.buffers
    ?.normal?.lines as Partial<TrimmableLines> | undefined;
  return lines && typeof lines.onTrim === "function" ? (lines as TrimmableLines) : null;
}

export class LineTracker {
  /** Rows trimmed from the start of the normal buffer since the session began */
  private trimmedRows = 0;
  private lines: TrimmableLines | null = null;
  private trimSubscription: { dispose(): void } | null = null;
  /** Fallback if xterm internals change: approximate trimming from scroll events */
  private scrolls = 0;
  /** True when trimming is tracked exactly via xterm's line list */
  readonly exact: boolean;

  constructor(private readonly terminal: Terminal) {
    this.exact = internalLines(terminal) !== null;
    if (this.exact) {
      this.attach();
      // A full reset (ESC c) replaces the buffer and fires this before writing anything new
      terminal.buffer.onBufferChange(() => this.attach());
    } else {
      terminal.onScroll(() => {
        if (terminal.buffer.active.type === "normal") this.scrolls++;
      });
    }
  }

  private attach(): void {
    const lines = internalLines(this.terminal);
    if (!lines || lines === this.lines) return;
    // The old buffer was replaced wholesale, so all of its rows are gone
    if (this.lines) this.trimmedRows += this.lines.length;
    this.trimSubscription?.dispose();
    this.lines = lines;
    this.trimSubscription = lines.onTrim((amount) => (this.trimmedRows += amount));
  }

  private trimmed(): number {
    return this.exact ? this.trimmedRows : this.scrolls - this.terminal.buffer.normal.baseY;
  }

  /** Row number of the terminal cursor on the normal buffer. */
  cursor(): number {
    const buffer = this.terminal.buffer.normal;
    return this.trimmed() + buffer.baseY + buffer.cursorY;
  }

  /**
   * Resize the terminal. The oldest row keeps its number; rows after it can renumber when a width
   * change rewraps them.
   */
  resize(cols: number, rows: number): void {
    const trimmed = this.trimmed();
    this.terminal.resize(cols, rows);
    if (!this.exact) this.scrolls = trimmed + this.terminal.buffer.normal.baseY;
  }

  read(options: LineReadOptions = {}): LineRead {
    const cursor = this.cursor();

    if (this.terminal.buffer.active.type === "alternate") {
      const screen = this.terminal.buffer.active;
      const lines: string[] = [];
      for (let y = 0; y < this.terminal.rows; y++) {
        lines.push(screen.getLine(y)?.translateToString(true) ?? "");
      }
      trimTrailingBlank(lines);
      return { lines, firstRow: null, lastRow: null, cursor, omitted: null, lost: 0, alternate: true };
    }

    const buffer = this.terminal.buffer.normal;
    const trimmed = this.trimmed();
    const total = trimmed + buffer.length;
    const lost = options.begin !== undefined && options.begin < trimmed ? trimmed - options.begin : 0;

    const start = this.logicalStart(options.begin ?? trimmed);
    const end = clamp(options.end ?? total, start, total);

    const logical: Array<{ row: number; lastRow: number; text: string }> = [];
    for (let row = start; row < end; row++) {
      const line = buffer.getLine(row - trimmed);
      if (!line) continue;
      const text = line.translateToString(false);
      const previous = logical[logical.length - 1];
      if (line.isWrapped && previous) {
        previous.text += text;
        previous.lastRow = row;
      } else {
        logical.push({ row, lastRow: row, text });
      }
    }
    for (const line of logical) line.text = line.text.trimEnd();
    while (logical.length > 0 && logical[logical.length - 1].text === "") logical.pop();

    let omitted: LineRead["omitted"] = null;
    const maxLines = options.maxLines ?? Infinity;
    if (logical.length > maxLines) {
      const cut = logical.length - maxLines;
      omitted = { count: cut, begin: logical[0].row, end: logical[cut].row };
      logical.splice(0, cut);
    }

    return {
      lines: logical.map((l) => l.text),
      firstRow: logical[0]?.row ?? null,
      lastRow: logical[logical.length - 1]?.lastRow ?? null,
      cursor,
      omitted,
      lost,
      alternate: false,
    };
  }

  /**
   * Text from row begin up to the terminal cursor, with soft-wrapped rows joined and the cursor's
   * row cut at the cursor column, so a pattern ending in $ means "sitting at the cursor". On the
   * alternate screen, the screen's text up to the cursor.
   */
  textToCursor(begin?: number): string {
    const active = this.terminal.buffer.active;
    const rows: Array<{ text: string; wrapped: boolean }> = [];

    if (active.type === "alternate") {
      for (let y = 0; y <= active.cursorY; y++) {
        const line = active.getLine(y);
        const text = y === active.cursorY ? line?.translateToString(false, 0, active.cursorX) : line?.translateToString(true);
        rows.push({ text: text ?? "", wrapped: line?.isWrapped ?? false });
      }
    } else {
      const trimmed = this.trimmed();
      const cursorRow = this.cursor();
      for (let row = this.logicalStart(begin ?? trimmed); row <= cursorRow; row++) {
        const line = active.getLine(row - trimmed);
        if (!line) continue;
        const atCursor = row === cursorRow;
        const nextWrapped = !atCursor && (active.getLine(row - trimmed + 1)?.isWrapped ?? false);
        const text = atCursor ? line.translateToString(false, 0, active.cursorX) : line.translateToString(!nextWrapped);
        rows.push({ text, wrapped: line.isWrapped });
      }
    }

    return rows.reduce((out, row, i) => (i > 0 && !row.wrapped ? `${out}\n${row.text}` : out + row.text), "");
  }

  /** Clamp a row number into the buffer and move it back to the start of its logical line. */
  private logicalStart(row: number): number {
    const buffer = this.terminal.buffer.normal;
    const trimmed = this.trimmed();
    let start = clamp(row, trimmed, trimmed + buffer.length);
    while (start > trimmed && buffer.getLine(start - trimmed)?.isWrapped) start--;
    return start;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function trimTrailingBlank(lines: string[]): void {
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
}
