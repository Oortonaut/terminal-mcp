import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";

const SHELL_DESCRIPTION =
  "Shell name (e.g. bash, zsh, fish, pwsh, powershell, cmd, git-bash, wsl; call listShells to see what is installed) " +
  "or path to a shell executable. Default: the server's --shell, then $TERMINAL_MCP_SHELL, then $SHELL (%COMSPEC% on Windows).";

const SHELL_ARGS_DESCRIPTION =
  "Extra arguments passed to the shell, e.g. [\"-d\", \"Ubuntu\"] for wsl or [\"-NoProfile\"] for pwsh. " +
  "Omitted: the server's --shell-arg values if no shell is given, otherwise none.";

export const createSessionSchema = z.object({
  shell: z.string().optional().describe(SHELL_DESCRIPTION),
  shellArgs: z.array(z.string()).optional().describe(SHELL_ARGS_DESCRIPTION),
  cols: z.number().int().positive().optional().describe("Terminal width in columns (default: 120)"),
  rows: z.number().int().positive().optional().describe("Terminal height in rows (default: 40)"),
});

export const createSessionTool = {
  name: "createSession",
  description: "Create a new terminal session and return its metadata. Use the returned sessionId in subsequent type/sendKey/getContent/takeScreenshot calls to address this session. The default session created on first use is separate from sessions created here. Pass shell to pick a different shell than the default (see listShells).",
  inputSchema: {
    type: "object" as const,
    properties: {
      shell: {
        type: "string",
        description: SHELL_DESCRIPTION,
      },
      shellArgs: {
        type: "array",
        items: { type: "string" },
        description: SHELL_ARGS_DESCRIPTION,
      },
      cols: {
        type: "number",
        description: "Terminal width in columns (default: 120)",
      },
      rows: {
        type: "number",
        description: "Terminal height in rows (default: 40)",
      },
    },
    required: [],
  },
};

export async function handleCreateSession(
  manager: TerminalManager,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = createSessionSchema.parse(args ?? {});
  const metadata = await manager.createSession(parsed);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(metadata, null, 2),
      },
    ],
  };
}
