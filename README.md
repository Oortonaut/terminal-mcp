<p align="center">
  <img src="logo.png" alt="Terminal MCP" width="600">
</p>

<p align="center">
  <strong>Let AI see and interact with your terminal.</strong>
</p>

<p align="center">
  Terminal MCP gives LLMs a shared view of your terminal session. Perfect for debugging CLIs and TUI applications in real-time, or letting AI drive terminal-based tools autonomously.
</p>

## Install

```bash
npm install -g @ellery/terminal-mcp
```

Or via install script:

```bash
curl -fsSL https://raw.githubusercontent.com/elleryfamilia/terminal-mcp/main/install.sh | bash
```

### Configure your AI tools

Wire `terminal-mcp` into the MCP config of every AI tool installed on your machine in one shot:

```bash
terminal-mcp setup                      # detect & install for all detected tools
terminal-mcp setup --dry-run            # preview without writing
terminal-mcp setup --client claude-code,gemini   # specific tools only
terminal-mcp setup --uninstall          # remove the entry from each tool
```

Supported clients (each gets the right schema for its config format):

| Client | Config file | Format |
|---|---|---|
| OpenAI Codex CLI | `~/.codex/config.toml` | TOML |
| GitHub Copilot CLI | `~/.copilot/mcp-config.json` | JSON |
| Gemini CLI | `~/.gemini/settings.json` | JSON |
| OpenCode | `~/.config/opencode/opencode.json` | JSON |
| Claude Code | `~/.claude.json` | JSON |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) / `%APPDATA%\Claude\claude_desktop_config.json` (Windows) | JSON |

A `.bak` of any pre-existing config is written next to the original on first install. The `terminal-mcp` entry is added without disturbing other servers or unrelated keys; running `setup` again is a no-op.

### Upgrading

```bash
npm install -g @ellery/terminal-mcp@latest
```

Interactive mode will print a banner on next launch when a newer release is available — `terminal-mcp` checks the npm registry once per day and caches the result. Headless and MCP-client modes never check or print anything (so MCP stdio stays clean). To opt out entirely, set `NO_UPDATE_NOTIFIER=1` or pass `--no-update-notifier`.

## Features

- **Full Terminal Emulation**: Uses xterm.js headless for accurate VT100/ANSI emulation
- **Cross-Platform PTY**: Native pseudo-terminal support via node-pty (macOS, Linux, Windows)
- **MCP Protocol**: Implements Model Context Protocol for AI assistant integration
- **Session Recording**: Record terminal sessions to asciicast format for playback with asciinema
- **Simple API**: Nine tools covering input, observation, recording, and session lifecycle
- **Headless Mode**: Run as a standalone MCP server without a TTY — ideal for CI, containers, and non-interactive environments
- **Multi-Session**: Run multiple isolated terminal sessions in one process, addressed by `sessionId`
- **Sandbox Mode**: Optional security restrictions for filesystem and network access

## Building from Source

```bash
npm install
npm run build
```

## Usage

### MCP Configuration

Add to your MCP client settings:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "terminal-mcp"
    }
  }
}
```

With custom options:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "terminal-mcp",
      "args": ["--cols", "100", "--rows", "30", "--shell", "/bin/zsh"]
    }
  }
}
```

### Command-Line Options

```
terminal-mcp [OPTIONS]

Options:
  --cols <number>        Terminal width in columns (default: 120)
  --rows <number>        Terminal height in rows (default: 40)
  --shell <name|path>    Shell to use: a name (see Choosing a Shell) or a path
                         (default: $TERMINAL_MCP_SHELL, then $SHELL, or %COMSPEC% on Windows)
  --shell-arg <arg>      Extra argument for the shell; repeat for several
  --list-shells          List the shells installed on this machine and exit
  --headless             Run in headless mode (embedded PTY + MCP over stdio, no TTY needed)
  --sandbox              Enable sandbox mode (restricts filesystem/network)
  --sandbox-config <path> Load sandbox config from JSON file
  --version, -v          Show version number
  --help, -h             Show help message

Recording Options:
  --record [mode]     Enable recording (default mode: always)
                      Modes: always, on-failure, off
  --record-dir <dir>  Recording output directory
                      (default: ~/.local/state/terminal-mcp/recordings)
  --idle-time-limit <sec>   Max idle time between events (default: 2s)
  --max-duration <sec>      Max recording duration (default: 3600s)
  --inactivity-timeout <sec>  Stop after no output (default: 600s)

Multi-Session Options:
  --max-sessions <n>           Max concurrent sessions (default: 5)
  --session-idle-timeout <sec> Idle non-default sessions are auto-destroyed
                               after this period (default: 600s)

Environment Variables:
  TERMINAL_MCP_SHELL       Default shell (name or path) when --shell is not given
  TERMINAL_MCP_RECORD_DIR  Default recording output directory
```

### Choosing a Shell

`--shell`, `TERMINAL_MCP_SHELL` and `createSession`'s `shell` all accept either a path or a name. Run `terminal-mcp --list-shells` (or call the `listShells` tool) to see what's installed.

| Platform | Names |
|----------|-------|
| Windows | `cmd`, `powershell` (5.1), `pwsh` (7+), `git-bash` (alias `bash`), `wsl` |
| macOS / Linux | `bash`, `zsh`, `sh`, `fish`, `dash`, `ksh`, `tcsh`, `nu`, `pwsh`, plus anything in `/etc/shells` |

Any other name is looked up on `PATH`. On Windows, `bash` means Git Bash rather than `System32\bash.exe`, which is WSL. For WSL, use `wsl`, adding `--shell-arg -d --shell-arg Ubuntu` to pick a distro.

The shell is chosen in this order: `createSession`'s `shell`, then `--shell`, then `TERMINAL_MCP_SHELL`, then the platform default. `--shell-arg` values go to the default shell; `createSession` takes its own `shellArgs`, and a session created with a different `shell` doesn't inherit `--shell-arg`.

```json
{
  "mcpServers": {
    "terminal": {
      "command": "terminal-mcp",
      "args": ["--headless", "--shell", "pwsh", "--shell-arg", "-NoProfile"]
    }
  }
}
```

## Headless Mode

By default, Terminal MCP uses a **dual-process architecture**: you run `terminal-mcp` in an interactive terminal (which creates a Unix socket), then your MCP client spawns a second instance that connects to that socket. This requires a TTY.

**Headless mode** (`--headless`) eliminates this requirement by spawning an embedded PTY internally and serving MCP directly over stdio in a single process. No interactive terminal session, no socket — just a self-contained MCP server with a built-in terminal.

### When to use headless mode

- **CI/CD pipelines** — no TTY available
- **Docker containers** — no interactive shell to run alongside
- **Remote/cloud environments** — MCP servers spawned by automation
- **Simplified setup** — single process, no socket coordination needed

### Configuration

```json
{
  "mcpServers": {
    "terminal": {
      "command": "terminal-mcp",
      "args": ["--headless", "--cols", "120", "--rows", "40"]
    }
  }
}
```

### How it works

```
MCP Client (Claude Code, etc.)
    │ STDIO (JSON-RPC)
    ▼
terminal-mcp --headless
    ├── MCP Server (stdio transport)
    ├── Terminal Emulator (@xterm/headless)
    └── Embedded PTY (node-pty)
            │
            ▼
        Shell Process (bash, zsh, etc.)
```

In headless mode, the terminal session is initialized eagerly at startup, so all tools (`type`, `sendKey`, `getContent`, `takeScreenshot`, `startRecording`, `stopRecording`, `createSession`, `listSessions`, `listShells`, `destroySession`) are available immediately.

## MCP Tools

All input/output tools (`type`, `sendKey`, `getContent`, `takeScreenshot`) accept an optional `sessionId` argument. Omit it to target the default session; pass the ID returned by `createSession` to drive a specific session.

### `type`
Send text input to the terminal. Keys can be embedded between `<:` and `:>`, so a whole interaction fits in one call. `text` may be a string or an array of strings typed in order.

```json
{
  "name": "type",
  "arguments": {
    "text": "run<:Enter:>",
    "until": "\\(gdb\\) $"
  }
}
```

Key escapes (parsed unless `"sendKeys": false`):

| Escape | Sends |
|--------|-------|
| `<:Enter:>`, `<:Tab:>`, `<:Escape:>`, `<:Backspace:>`, `<:Delete:>`, `<:ArrowUp:>`, `<:Home:>`, `<:PageUp:>`, `<:F1:>`–`<:F12:>`, … | The named key (same names as `sendKey`; case-insensitive) |
| `<:ctrl-c:>`, `<:alt-x:>`, `<:shift-Tab:>`, `<:alt-ctrl-C:>`, `<:ctrl-alt-C:>` | Key with modifiers (`ctrl`/`alt`/`shift` words, any order) |
| `<:^C:>`, `<:!x:>`, `<:+Tab:>`, `<:!^C:>` | Same, using prefixes `^` = ctrl, `!` = alt, `+` = shift |

A single character needs at least one modifier (`<:^C:>`; for a plain `c`, just type `c`). Anything between the delimiters that isn't a recognized key, and any unmatched `<:` or `:>`, is typed literally and reported as a warning in the result, so code like `T <: Number` comes out as written. Pass `"sendKeys": false` to type text verbatim with no parsing or warnings.

With a wait option, `type` makes a request/response cycle in one call. It waits, then returns everything from the line it typed on, in `getContent`'s format. It accepts the same `until`, `waitMs`, `initialWaitMs`, `maxWaitMs` and `maxLines` (see [Waiting for output](#waiting-for-output)). `type` doesn't count an `until` match until the screen has changed from how it was when you typed, because the prompt you're answering would otherwise match straight away.

Without a wait, it returns the cursor from before typing (`Typed 11 character(s) to terminal [cursor 3]`), so `getContent({ begin: 3 })` reads just that command's output.

### `sendKey`
Send special keys or key combinations.

```json
{
  "name": "sendKey",
  "arguments": {
    "key": "Enter"
  }
}
```

Supported keys:
- Basic: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`
- Arrow: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- Navigation: `Home`, `End`, `PageUp`, `PageDown`, `Insert`
- Function: `F1` through `F12`
- Control: `Ctrl+A` through `Ctrl+Z`, `Ctrl+C`, `Ctrl+D`, etc.

### `getContent`
Get terminal lines as plain text. Every result starts with a header:

```
[lines 59-158 · cursor 158 · 53 earlier line(s) omitted; read them with begin: 6, end: 59]
row52
...
```

Lines are numbered from the start of the session and keep their numbers as scrollback fills and old lines are dropped. The **cursor** is the line the terminal cursor is on. Pass it back as `begin` to read only what came after; that line is included again, because it's the one that may still change, like a prompt or progress bar. Soft-wrapped rows are joined into one line.

```json
{
  "name": "getContent",
  "arguments": { "begin": 158, "until": "Breakpoint \\d+,", "maxWaitMs": 60000 }
}
```

| Argument | Description |
|----------|-------------|
| `begin` | First line number to return, usually a previous cursor |
| `end` | Line number to stop before (exclusive), e.g. to read omitted lines |
| `maxLines` | Return at most this many lines, keeping the last ones (default 100) |
| `until`, `waitMs`, `initialWaitMs`, `maxWaitMs` | Wait for output first; see below |
| `visibleOnly` | Return just the visible screen instead |

The header also reports lines already dropped from scrollback, and how long it waited and why it stopped. When a full-screen app (vim, less, htop) is running, the result is that app's screen.

#### Waiting for output

`type` and `getContent` can wait before reading. With no wait option, they read immediately.

| Option | Ends the wait when |
|--------|--------------------|
| `until` | This regex (JavaScript syntax) matches the new text, from `begin` up to the terminal cursor |
| `waitMs` | Output has been quiet this many milliseconds |
| `initialWaitMs` | No output has started within this many milliseconds (default: `waitMs`) |
| `maxWaitMs` | This many milliseconds have passed in total (default 30000, max 600000) |

`until` works with any program, because you say what its prompt looks like. Without the `m` flag, `$` means "at the cursor", so `\(gdb\) $` means gdb is waiting at its prompt, `>>> $` means Python is, and `\$ $` matches a typical bash prompt. A pattern without `$`, like `Breakpoint \d+,`, matches anywhere in the new output. If the wait ends without a match, the header quotes the end of the line before the cursor, so a near miss is easy to spot, such as `> $` against cmd's prompt, which ends in `>` with no space:

```
[lines 9-12 · cursor 12 · waited 30.0s, hit maxWaitMs · until /> $/ never matched; text before the cursor ends "C:\\dev\\terminal-mcp>"]
```

`waitMs` is the fallback when you don't know the prompt. The shell echoes what you type immediately, so choose a `waitMs` longer than the longest silence you expect from the command. Options can be combined; whichever condition is met first ends the wait, and the header says which one.

### `takeScreenshot`
Capture the terminal state. Supports three output formats:

| Format | Description |
|--------|-------------|
| `text` (default) | JSON with plain text content, cursor position, and dimensions |
| `ansi` | JSON with ANSI color escape codes preserved in the content field |
| `png` | Color screenshot as a PNG image (requires `@resvg/resvg-js`) |

```json
{
  "name": "takeScreenshot",
  "arguments": { "format": "text" }
}
```

The `ansi` format reconstructs SGR escape sequences from the terminal's cell buffer, preserving 16-color, 256-color, and 24-bit truecolor attributes along with bold, dim, italic, and underline styles.

The `png` format returns an MCP `image` content block with base64-encoded PNG data, rendered with the One Dark color theme and macOS-style window chrome.

### `startRecording`
Start recording terminal output to an asciicast v2 file.

```json
{
  "name": "startRecording",
  "arguments": {
    "mode": "always",
    "idleTimeLimit": 2,
    "maxDuration": 3600
  }
}
```

Options:
- `mode`: `always` (save all) or `on-failure` (save only on non-zero exit)
- `outputDir`: Custom output directory
- `idleTimeLimit`: Max seconds between events (caps pauses in playback)
- `maxDuration`: Auto-stop after N seconds
- `inactivityTimeout`: Auto-stop after N seconds of no output

### `stopRecording`
Stop a recording and finalize the asciicast file.

```json
{
  "name": "stopRecording",
  "arguments": {
    "recordingId": "abc123"
  }
}
```

### `createSession`
Create a new terminal session and return its metadata. Use the returned `sessionId` to target this session in subsequent tool calls.

```json
{
  "name": "createSession",
  "arguments": {
    "shell": "zsh",
    "shellArgs": ["-l"],
    "cols": 100,
    "rows": 30
  }
}
```

All arguments are optional. `shell` is a name or path (see [Choosing a Shell](#choosing-a-shell)); `shellArgs` are extra arguments for it. Returns the resolved shell path:

```json
{
  "sessionId": "3029d",
  "shell": "/bin/zsh",
  "shellArgs": ["-l"],
  "cols": 100,
  "rows": 30,
  "createdAt": "2026-04-25T12:58:01.072Z",
  "lastActivityAt": "2026-04-25T12:58:01.072Z",
  "isDefault": false
}
```

### `listSessions`
List all active sessions including the default. Reports configured limits.

```json
{ "name": "listSessions", "arguments": {} }
```

### `listShells`
List the shells installed on this machine. Any entry's `name` or `path` can be passed as `createSession`'s `shell`; `isDefault` marks the shell used when none is given.

```json
{ "name": "listShells", "arguments": {} }
```

```json
{
  "shells": [
    { "name": "zsh", "path": "/bin/zsh", "description": "Z shell", "isDefault": true },
    { "name": "bash", "path": "/bin/bash", "description": "Bourne Again Shell", "isDefault": false }
  ]
}
```

### `destroySession`
Destroy a session by ID. The default session cannot be destroyed.

```json
{
  "name": "destroySession",
  "arguments": { "sessionId": "3029d" }
}
```

## Multi-Session

By default, every tool call without a `sessionId` targets a single auto-created **default session** — the same behavior the project has always had. Pass `sessionId` to drive multiple isolated PTYs from one process.

- The default session is created on first use and cannot be destroyed.
- Additional sessions are created by `createSession` and tracked until they're destroyed or idle-evicted (`--session-idle-timeout`, default 600s).
- Concurrent sessions are capped at `--max-sessions` (default 5).
- An active recording captures output from all sessions in the process.

Typical use case: an AI agent driving a long-running build in one session while running diagnostics in another, without command interleaving.

## Sandbox Mode

Run the terminal with restricted filesystem and network access:

```bash
# Interactive permission configuration
terminal-mcp --sandbox

# With a config file
terminal-mcp --sandbox --sandbox-config ~/.terminal-mcp-sandbox.json
```

The interactive mode shows a TUI dialog to configure permissions:

<p align="center">
  <img src="sandbox-permissions.png" alt="Sandbox Permissions Dialog" width="400">
</p>
- **Read/Write**: Full access (current directory, /tmp, caches)
- **Read-Only**: Can read but not modify (home directory)
- **Blocked**: No access (SSH keys, cloud credentials, auth tokens)

Example config file:

```json
{
  "filesystem": {
    "readWrite": [".", "/tmp", "~/.cache"],
    "readOnly": ["~"],
    "blocked": ["~/.ssh", "~/.aws", "~/.gnupg"]
  },
  "network": {
    "mode": "all"
  }
}
```

Platform support:
- **macOS**: Full support via sandbox-exec (Seatbelt)
- **Linux**: Full support via bubblewrap (requires `bwrap` installed)
- **Windows**: Graceful fallback (runs without sandbox)

See [Sandbox Documentation](./docs/sandbox.md) for detailed configuration options.

## Recording

Terminal MCP can record sessions to [asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/) format, compatible with [asciinema](https://asciinema.org/) for playback.

### Quick Start

```bash
# Start with recording enabled
terminal-mcp --record

# Run your commands, then exit
exit

# Output shows the saved file path:
# Recordings saved:
#   ~/.local/state/terminal-mcp/recordings/20240115_143022.cast
#
# Play with: asciinema play <file>
```

### Playback

Install asciinema to play back recordings:

```bash
# macOS
brew install asciinema

# Linux/pip
pip install asciinema

# Play a recording
asciinema play ~/.local/state/terminal-mcp/recordings/20240115_143022.cast

# Play at 2x speed
asciinema play -s 2 recording.cast
```

### Recording Modes

- **`always`** (default): Save every recording
- **`on-failure`**: Only save if the session exits with a non-zero code (useful for debugging failed CI runs)

```bash
# Only save recordings when something fails
terminal-mcp --record=on-failure
```

### MCP Tool Recording

AI assistants can also control recording programmatically via MCP tools:

1. Call `startRecording` to begin capturing
2. Perform terminal operations
3. Call `stopRecording` to finalize and save

This enables AI-driven workflows like "record this debugging session" or "capture this demo".

## Architecture

Terminal MCP has three operating modes:

| Mode | Flag | Stdin | Description |
|------|------|-------|-------------|
| **Interactive** | *(default)* | TTY | User gets a shell; AI connects via Unix socket |
| **Client** | *(default)* | non-TTY | Connects to an interactive session's socket, serves MCP over stdio |
| **Headless** | `--headless` | any | Self-contained: embedded PTY + MCP server over stdio |

### Headless mode (recommended for MCP configs)

```
MCP Client (Claude Code, etc.)
    │ STDIO (JSON-RPC)
    ▼
terminal-mcp --headless
    ├── MCP SDK (@modelcontextprotocol/sdk)
    ├── Terminal Emulator (@xterm/headless)
    └── Embedded PTY (node-pty)
            │
            ▼
        Shell Process (bash, zsh, etc.)
```

### Interactive + Client mode (two-process)

```
terminal-mcp (interactive, in your terminal)
    ├── User shell (stdin/stdout)
    └── Unix socket server (/tmp/terminal-mcp.sock)
            ▲
            │ JSON-RPC over socket
            ▼
terminal-mcp (client, spawned by MCP client)
    └── MCP server (stdio transport)
```

## Example Session

```bash
# Run a command and get its output in one call
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"type","arguments":{"text":"ls -la<:Enter:>","waitMs":500}}}

# Or step by step: type returns a cursor...
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"type","arguments":{"text":"make<:Enter:>"}}}

# ...and getContent reads only what came after it, once output goes quiet
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"getContent","arguments":{"begin":42,"waitMs":2000}}}
```

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Run with tsx (development)
```

## Documentation

See the [docs](./docs/) folder for detailed documentation:

- [Overview](./docs/index.md)
- [Installation](./docs/installation.md)
- [Tools Reference](./docs/tools.md)
- [Recording](./docs/recording.md)
- [Configuration](./docs/configuration.md)
- [Sandbox Mode](./docs/sandbox.md)
- [Examples](./docs/examples.md)
- [Architecture](./docs/architecture.md)

## Requirements

- Node.js 18.0.0 or later
- Windows 10 version 1809 or later (for ConPTY support)

## License

MIT
