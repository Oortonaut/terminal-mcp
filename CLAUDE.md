# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install        # Install dependencies (includes native node-pty compilation)
npm run build      # Compile TypeScript to dist/
npm run dev        # Run directly with tsx (no build needed)
```

## Architecture Overview

Terminal MCP is a headless terminal emulator exposed via Model Context Protocol (MCP). It has three operating modes:

### Tri-Mode Architecture

1. **Headless Mode** (`--headless` flag): Self-contained MCP server with embedded PTY
   - Spawns PTY internally, serves MCP directly over stdio
   - No TTY, socket, or separate interactive session needed
   - `src/index.ts` → `startServer()` from `src/server.ts` (eagerly inits session)
   - **Recommended for MCP client configs** (CI, containers, non-interactive environments)

2. **Interactive Mode** (stdin is TTY, no `--headless`): User runs `terminal-mcp` in their terminal
   - Spawns a PTY shell process, pipes I/O to user's terminal
   - Exposes a Unix socket at `/tmp/terminal-mcp.sock` for AI tool access
   - `src/index.ts` → `startInteractiveMode()` → creates `TerminalManager` + `createToolProxyServer()`

3. **MCP Client Mode** (stdin is not TTY, no `--headless`): Claude Code spawns `terminal-mcp` as MCP server
   - Connects to the Unix socket from interactive mode
   - Serves MCP protocol over stdio to Claude Code
   - `src/client.ts` → `startMcpClientMode()` → proxies tool calls to socket

### Key Components

**Terminal Layer** (`src/terminal/`):
- `session.ts`: Core integration of `node-pty` (PTY process) + `@xterm/headless` (terminal emulation). Handles shell-specific prompt customization via temp rc files. Resolves its shell through `src/utils/shells.ts`, which maps names (`pwsh`, `git-bash`, `wsl`, `zsh`, ...) or paths to executables, applying `--shell` → `TERMINAL_MCP_SHELL` → platform default.
- `lines.ts`: `LineTracker` gives every row a stable number from session start (counting rows trimmed from scrollback via xterm's internal line list, since the public API has no trim event) and reads ranges by number, joining soft-wrapped rows. Backs `getContent`'s `begin`/`end`/`maxLines`, the cursor in its header, and `textToCursor` (what `until` patterns match against).
- `wait.ts`: `waitForOutput` — ends when the `until` predicate matches (re-checked each time xterm parses output), or, with `waitMs`/`initialWaitMs`, when output doesn't start or goes quiet; always capped by `maxWaitMs`. Shared by `getContent` and `type`; `type` snapshots the text up to the cursor before typing and passes it as `untilIgnore`, so the prompt it's answering doesn't match (comparing text, not "any output arrived", because line editors like PSReadLine send invisible sequences first).
- `manager.ts`: Multi-session manager. Owns a map of `TerminalSession`s plus a single `RecordingManager` and (optional) `SandboxController`. The "default" session is auto-created on first use and is the implicit target of any tool call without a `sessionId`. Idle non-default sessions are GC'd on a 60s interval.

**Tool Layer** (`src/tools/`):
- Each tool has: Zod schema, tool definition object, handler function
- Pattern: `export const fooTool = {...}` + `export function handleFoo(manager, args)`
- Single-session tools: `type`, `sendKey`, `getContent`, `takeScreenshot` (formats: `text`, `ansi`, `png`). All accept an optional `sessionId` to target a specific session; omit for the default.
- Recording tools: `startRecording`, `stopRecording`. Recording is process-wide — when active, it captures output from all sessions in the manager.
- Multi-session tools: `createSession` (optional `shell` name/path and `shellArgs`), `listSessions`, `listShells`, `destroySession`. The default session cannot be destroyed.

**Setup Layer** (`src/setup/`):
- `clients.ts`: One adapter per supported AI tool (codex, copilot, gemini, opencode, claude-code, claude-desktop). Each adapter knows the client's config path, format (JSON or TOML), and the exact MCP server schema that client expects. Most use the standard `mcpServers` JSON shape via `makeMcpServersJsonAdapter`; codex (TOML) and opencode (different schema entirely — top-level `mcp`, command as array) have their own adapters.
- `index.ts`: Orchestrates the `terminal-mcp setup` subcommand — flag parsing happens in `src/index.ts`, this module handles client selection (auto-detect or explicit `--client`), per-client install/uninstall, and result printing. Writes are atomic (write-to-temp + rename) and always create a `.bak` of the original.

**Transport Layer** (`src/transport/`):
- `socket.ts`: Unix socket server for tool proxying between modes. Also has `SocketTransport` class implementing MCP's Transport interface.

### Data Flow

```
Headless Mode:
Claude Code
    ↕ (MCP JSON-RPC over stdio)
MCP Server (server.ts) + TerminalManager + PTY
    ↕
Shell Process

Interactive + Client Mode:
User Terminal                        Claude Code
    ↕ (raw PTY I/O)                     ↕ (MCP JSON-RPC over stdio)
TerminalSession                      MCP Server (client.ts)
    ↕                                   ↕ (custom JSON-RPC over socket)
Tool Proxy Server ←───────────────→ Socket Client
```

## Code Conventions

- ES Modules with `.js` extensions in imports (NodeNext module resolution)
- Zod for runtime validation of tool arguments
- Tools return `{ content: [{ type: "text", text: string }], isError?: boolean }` (except `takeScreenshot` png format which returns `{ type: "image", data: string, mimeType: string }`)
- Key sequences are in `src/utils/keys.ts` (ANSI escape codes)
