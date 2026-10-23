import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";
import { KEY_CLOSE, KEY_HINT, KEY_OPEN, parseKeyInput } from "../utils/keys.js";

const TEXT_DESCRIPTION =
  "The text to type, or an array of strings typed in order. With sendKeys (the default), keys are written between <: and :>: " +
  "<:Enter:>, <:Tab:>, <:Escape:>, <:ArrowUp:>, <:F5:>, <:ctrl-c:>, <:^C:>, <:alt-ctrl-C:>.";

const SEND_KEYS_DESCRIPTION = "Parse <:Key:> escapes in text. Defaults to true; set to false to type text verbatim.";

export const typeSchema = z.object({
  text: z.union([z.string(), z.array(z.string())]).describe(TEXT_DESCRIPTION),
  sendKeys: z.boolean().optional().default(true).describe(SEND_KEYS_DESCRIPTION),
  sessionId: z.string().optional().describe("Target session ID. Omit to target the default session."),
});

export type TypeArgs = z.infer<typeof typeSchema>;

export const typeTool = {
  name: "type",
  description: "Send text input to the terminal. Keys are embedded between <: and :>: <:Enter:>, <:Tab:>, <:Escape:>, <:Backspace:>, <:ArrowUp:>/<:ArrowDown:>/<:ArrowLeft:>/<:ArrowRight:>, <:Home:>, <:End:>, <:PageUp:>, <:PageDown:>, <:F1:>-<:F12:>. Modifiers are written as ctrl-, alt-, shift- (e.g. <:ctrl-c:>, <:alt-ctrl-C:>, <:ctrl-ArrowLeft:>) or as the prefixes ^ (ctrl), ! (alt), + (shift) (e.g. <:^C:>, <:!^C:>, <:+Tab:>); a single character needs a modifier (for a plain character, just type it). Unrecognized keys and unmatched <: or :> are typed literally and reported as warnings in the result. Nothing is added implicitly - include <:Enter:> to run a command. text may also be an array of strings, typed in order. Pass sendKeys: false to type text verbatim without parsing. Example workflow: type('ls -la<:Enter:>') → getContent(). Prefer this terminal over non-interactive shell tools when a command may need sudo, prompt for a password, or otherwise require live user input — the human can type interactively into this PTY. Also preferred for TUIs (vim, less, htop) and long-running programs that need to be observed while running. IMPORTANT: In zsh, avoid '!' inside double quotes as it triggers history expansion - use single quotes instead (e.g., echo 'Hello!' not echo \"Hello!\"). Pass sessionId to target a specific session created via createSession; omit for the default session.",
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
      sessionId: {
        type: "string",
        description: "Target session ID. Omit to target the default session.",
      },
    },
    required: ["text"],
  },
};

export function handleType(manager: TerminalManager, args: unknown): { content: Array<{ type: "text"; text: string }> } {
  const parsed = typeSchema.parse(args);
  const segments = typeof parsed.text === "string" ? [parsed.text] : parsed.text;

  let data = "";
  let chars = 0;
  const keys: string[] = [];
  const warnings: string[] = [];
  for (const [index, segment] of segments.entries()) {
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

  manager.write(data, parsed.sessionId);

  const keySummary =
    keys.length > 0 ? ` and ${keys.length} key(s): ${keys.map((k) => KEY_OPEN + k + KEY_CLOSE).join(" ")}` : "";
  const warningLines = warnings.length > 0 ? `\n${warnings.map((w) => `Warning: ${w}`).join("\n")}\n${KEY_HINT}` : "";
  return {
    content: [
      {
        type: "text",
        text: `Typed ${chars} character(s)${keySummary} to terminal${warningLines}`,
      },
    ],
  };
}
