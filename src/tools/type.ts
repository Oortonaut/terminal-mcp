import { z } from "zod";
import { TerminalManager, wantsWait } from "../terminal/index.js";
import { KEY_CLOSE, KEY_HINT, KEY_OPEN, parseKeyInput } from "../utils/keys.js";
import { compileUntil, readContent, readOptionsProperties, readOptionsShape } from "./getContent.js";

const TEXT_DESCRIPTION =
  "The text to type, or an array of strings typed in order. With sendKeys (the default), keys are written between <: and :>: " +
  "<:Enter:>, <:Tab:>, <:Escape:>, <:ArrowUp:>, <:F5:>, <:ctrl-c:>, <:^C:>, <:alt-ctrl-C:>. A newline is sent as Enter.";

const SEND_KEYS_DESCRIPTION =
  "Parse <:Key:> escapes in text. Defaults to true; set to false to type text verbatim (newlines are still sent as Enter).";

export const typeSchema = z.object({
  text: z.union([z.string(), z.array(z.string())]).describe(TEXT_DESCRIPTION),
  sendKeys: z.boolean().optional().default(true).describe(SEND_KEYS_DESCRIPTION),
  ...readOptionsShape,
  sessionId: z.string().optional().describe("Target session ID. Omit to target the default session."),
});

export type TypeArgs = z.infer<typeof typeSchema>;

export const typeTool = {
  name: "type",
  description: "Send text input to the terminal. Keys are embedded between <: and :>: <:Enter:>, <:Tab:>, <:Escape:>, <:Backspace:>, <:ArrowUp:>/<:ArrowDown:>/<:ArrowLeft:>/<:ArrowRight:>, <:Home:>, <:End:>, <:PageUp:>, <:PageDown:>, <:F1:>-<:F12:>. Modifiers are written as ctrl-, alt-, shift- (e.g. <:ctrl-c:>, <:alt-ctrl-C:>, <:ctrl-ArrowLeft:>) or as the prefixes ^ (ctrl), ! (alt), + (shift) (e.g. <:^C:>, <:!^C:>, <:+Tab:>); a single character needs a modifier (for a plain character, just type it). Unrecognized keys and unmatched <: or :> are typed literally and reported as warnings in the result. Nothing is added implicitly - end a command with <:Enter:> or a newline to run it. A newline in text is always sent as Enter (CR), as a terminal does when you paste, so multi-line text runs line by line in every shell; <:ctrl-j:> sends a bare LF. text may also be an array of strings, typed in order. Pass sendKeys: false to type text verbatim without parsing keys. The result includes the line cursor from before typing, so getContent({ begin: cursor }) returns just what this input produced. For a request/response cycle in one call, pass until (a regex for the prompt you expect back, e.g. type({ text: 'run<:Enter:>', until: '\\\\(gdb\\\\) $' })) or waitMs (a quiet period, e.g. type({ text: 'ls -la<:Enter:>', waitMs: 500 })); type() then waits and returns the output from the line it typed on, in the same format as getContent. until doesn't match until the screen has changed from how it was when you typed, so the prompt you're answering doesn't count. Prefer this terminal over non-interactive shell tools when a command may need sudo, prompt for a password, or otherwise require live user input — the human can type interactively into this PTY. Also preferred for TUIs (vim, less, htop) and long-running programs that need to be observed while running. IMPORTANT: In zsh, avoid '!' inside double quotes as it triggers history expansion - use single quotes instead (e.g., echo 'Hello!' not echo \"Hello!\"). Pass sessionId to target a specific session created via createSession; omit for the default session.",
  inputSchema: {
    type: "object" as const,
    properties: {
      text: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        description: TEXT_DESCRIPTION,
      },
      sendKeys: {
        type: "boolean",
        description: SEND_KEYS_DESCRIPTION,
        default: true,
      },
      ...readOptionsProperties,
      sessionId: {
        type: "string",
        description: "Target session ID. Omit to target the default session.",
      },
    },
    required: ["text"],
  },
};

export async function handleType(
  manager: TerminalManager,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = typeSchema.parse(args);
  const until = compileUntil(parsed.until);
  const segments = typeof parsed.text === "string" ? [parsed.text] : parsed.text;

  let data = "";
  let chars = 0;
  const keys: string[] = [];
  const warnings: string[] = [];
  for (const [index, text] of segments.entries()) {
    // A newline is sent as Enter (CR), as a terminal does on paste: cmd ignores a bare LF and
    // PSReadLine treats it as a continuation line, so only bash would otherwise run the line
    const segment = text.replace(/\r?\n/g, "\r");
    if (parsed.sendKeys) {
      const input = parseKeyInput(segment);
      data += input.data;
      chars += input.chars;
      keys.push(...input.keys);
      const where = typeof parsed.text === "string" ? "" : `text[${index}]: `;
      warnings.push(...input.warnings.map((w) => `${where}${w}`));
    } else {
      data += segment;
      chars += segment.length;
    }
  }

  // The cursor line before typing is where the echoed input and its output begin
  const cursor = manager.getCursorLine(parsed.sessionId);
  // What's on screen now (typically the prompt being answered) mustn't satisfy until
  const untilIgnore = until ? manager.textToCursor(cursor, parsed.sessionId) : undefined;
  manager.write(data, parsed.sessionId);

  const keySummary =
    keys.length > 0 ? ` and ${keys.length} key(s): ${keys.map((k) => KEY_OPEN + k + KEY_CLOSE).join(" ")}` : "";
  const summary = `Typed ${chars} character(s)${keySummary} to terminal`;
  const warningLines = warnings.length > 0 ? `\n${warnings.map((w) => `Warning: ${w}`).join("\n")}\n${KEY_HINT}` : "";
  const text = wantsWait(parsed)
    ? `${summary}${warningLines}\n${await readContent(manager, { ...parsed, until, untilIgnore, begin: cursor })}`
    : `${summary} [cursor ${cursor}]${warningLines}`;

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}
