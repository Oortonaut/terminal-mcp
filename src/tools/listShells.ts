import { z } from "zod";
import { TerminalManager } from "../terminal/index.js";
import { listShells } from "../utils/shells.js";

export const listShellsSchema = z.object({});

export const listShellsTool = {
  name: "listShells",
  description: "List the shells installed on this machine. Each entry's name (or path) can be passed as createSession's shell; isDefault marks the shell used when none is given.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export function handleListShells(
  _manager: TerminalManager,
  _args: unknown
): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ shells: listShells() }, null, 2),
      },
    ],
  };
}
