/**
 * Shared tool definitions used by both MCP client and UI
 */

import { readOptionsProperties } from "./getContent.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "type",
    description:
      "Type text into the terminal, with keys between <: and :> (e.g. ls<:Enter:>, <:ctrl-c:>, <:^C:>, <:alt-ctrl-C:>, <:+Tab:>); unrecognized keys or unmatched <: :> are typed literally with a warning. Returns the line cursor from before typing; pass until (a regex for the prompt you expect, e.g. \"\\\\(gdb\\\\) $\") or waitMs (a quiet period) to get the output back in the same call",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          description: "The text to type, or an array of strings typed in order",
        },
        sendKeys: {
          type: "boolean",
          description: "Parse <:Key:> escapes in text (default: true); false types text verbatim",
          default: true,
        },
        ...readOptionsProperties,
      },
      required: ["text"],
    },
  },
  {
    name: "sendKey",
    description: "Send a special key to the terminal (e.g., enter, tab, ctrl+c)",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "The key to send (e.g., enter, tab, escape, up, down, left, right, ctrl+c, ctrl+d)",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "getContent",
    description:
      "Get terminal lines, headed by [lines A-B · cursor N]. Pass a previous cursor as begin to read only newer output; pass until (a prompt regex) or waitMs (a quiet period) to wait for output first",
    inputSchema: {
      type: "object",
      properties: {
        begin: {
          type: "number",
          description: "First line number to return, usually a previous cursor",
        },
        end: {
          type: "number",
          description: "Line number to stop before (exclusive)",
        },
        ...readOptionsProperties,
        visibleOnly: {
          type: "boolean",
          description: "If true, only return visible content (default: false)",
        },
      },
    },
  },
  {
    name: "takeScreenshot",
    description:
      "Take a screenshot of the terminal. Format 'text' (default) returns plain JSON. Format 'ansi' returns JSON with ANSI color escape codes preserved. Format 'png' returns a color screenshot image.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["text", "ansi", "png"],
          description:
            "Output format: 'text' (default) plain JSON, 'ansi' for colored text with ANSI codes, 'png' for color screenshot image",
        },
      },
    },
  },
  {
    name: "startRecording",
    description:
      "Start recording terminal output to an asciicast v2 file. Returns the recording ID and path where the file will be saved. Only one recording can be active at a time.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["v2"],
          description: "Recording format (default: v2, asciicast v2 format)",
        },
        mode: {
          type: "string",
          enum: ["always", "on-failure"],
          description:
            "Recording mode: always saves the recording, on-failure only saves if session exits with non-zero code (default: always)",
        },
        outputDir: {
          type: "string",
          description:
            "Directory to save the recording (default: ~/.local/state/terminal-mcp/recordings, or TERMINAL_MCP_RECORD_DIR env var)",
        },
        idleTimeLimit: {
          type: "number",
          description:
            "Max seconds between events in the recording (default: 2). Caps idle time to prevent long pauses during playback.",
        },
        maxDuration: {
          type: "number",
          description:
            "Max recording duration in seconds (default: 3600 = 60 minutes). Recording will auto-stop when this limit is reached.",
        },
        inactivityTimeout: {
          type: "number",
          description:
            "Stop recording after N seconds of no terminal output (default: 600 = 10 minutes). Resets on each output event.",
        },
      },
    },
  },
  {
    name: "stopRecording",
    description:
      "Stop a recording and finalize the asciicast file. Returns metadata about the saved recording including the file path and duration.",
    inputSchema: {
      type: "object",
      properties: {
        recordingId: {
          type: "string",
          description: "The recording ID returned by startRecording",
        },
      },
      required: ["recordingId"],
    },
  },
];

/**
 * Get just the tool names as an array
 */
export function getToolNames(): string[] {
  return toolDefinitions.map((t) => t.name);
}
