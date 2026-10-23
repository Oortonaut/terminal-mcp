import { z } from "zod";
import { TerminalManager, wantsWait } from "../terminal/index.js";
import { compileUntil, readContent, readOptionsProperties, readOptionsShape } from "./getContent.js";

export const typeSchema = z.object({
  text: z.string().describe("The text to type into the terminal"),
  ...readOptionsShape,
  sessionId: z.string().optional().describe("Target session ID. Omit to target the default session."),
});

export type TypeArgs = z.infer<typeof typeSchema>;

export const typeTool = {
  name: "type",
  description: "Send text input to the terminal. Text is written exactly as provided - no Enter key is sent automatically. To execute a command, end the text with \\r, or use type() followed by sendKey('Enter'). The result includes the line cursor from before typing, so getContent({ begin: cursor }) returns just what this input produced. For a request/response cycle in one call, pass until (a regex for the prompt you expect back, e.g. type({ text: 'run\\r', until: '\\\\(gdb\\\\) $' })) or waitMs (a quiet period, e.g. type({ text: 'ls -la\\r', waitMs: 500 })); type() then waits and returns the output from the line it typed on, in the same format as getContent. until is only checked once new output arrives, so the prompt still on screen when you type doesn't count. Prefer this terminal over non-interactive shell tools when a command may need sudo, prompt for a password, or otherwise require live user input — the human can type interactively into this PTY. Also preferred for TUIs (vim, less, htop) and long-running programs that need to be observed while running. IMPORTANT: In zsh, avoid '!' inside double quotes as it triggers history expansion - use single quotes instead (e.g., echo 'Hello!' not echo \"Hello!\"). Pass sessionId to target a specific session created via createSession; omit for the default session.",
  inputSchema: {
    type: "object" as const,
    properties: {
      text: {
        type: "string",
        description: "The text to type into the terminal",
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
  // The cursor line before typing is where the echoed input and its output begin
  const cursor = manager.getCursorLine(parsed.sessionId);
  manager.write(parsed.text, parsed.sessionId);

  const summary = `Typed ${parsed.text.length} character(s) to terminal`;
  const text = wantsWait(parsed)
    ? `${summary}\n${await readContent(manager, { ...parsed, until, untilAfterOutput: true, begin: cursor })}`
    : `${summary} [cursor ${cursor}]`;

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}
