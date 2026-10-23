/**
 * Shell discovery and resolution: turns a shell name ("pwsh", "git-bash", "zsh") or path into
 * an executable path, and lists the shells available on this machine.
 */
import * as fs from "fs";
import * as path from "path";
import { getDefaultShell } from "./platform.js";

/** Environment variable that sets the default shell when --shell is not given */
export const SHELL_ENV_VAR = "TERMINAL_MCP_SHELL";

export interface ShellInfo {
  /** Name accepted by --shell, TERMINAL_MCP_SHELL and createSession */
  name: string;
  /** Resolved executable path */
  path: string;
  description: string;
  /** True for the shell used when none is specified */
  isDefault: boolean;
}

interface KnownShell {
  name: string;
  aliases: string[];
  description: string;
  /** Absolute paths to check, or bare commands to look up on PATH, in order of preference */
  candidates: () => Array<string | undefined>;
}

const isWindows = process.platform === "win32";

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Find a bare command on PATH, honoring PATHEXT on Windows. */
export function findOnPath(command: string): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  // PATHEXT is conventionally uppercase; Windows paths are case-insensitive, so lowercase reads better
  const exts = isWindows && path.extname(command) === ""
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase())
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** Git for Windows' bin\bash.exe, located from the usual install dirs or from git.exe on PATH. */
function gitBashCandidates(): Array<string | undefined> {
  const fromGit = findOnPath("git");
  return [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
    // git.exe lives in <Git>\cmd or <Git>\bin
    fromGit ? path.join(path.dirname(path.dirname(fromGit)), "bin", "bash.exe") : undefined,
  ];
}

function knownShells(): KnownShell[] {
  if (isWindows) {
    const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    return [
      {
        name: "cmd",
        aliases: [],
        description: "Windows Command Prompt",
        candidates: () => [process.env.COMSPEC, path.join(system32, "cmd.exe")],
      },
      {
        name: "powershell",
        aliases: ["windows-powershell"],
        description: "Windows PowerShell 5.1",
        candidates: () => [path.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"), "powershell"],
      },
      {
        name: "pwsh",
        aliases: ["powershell-core"],
        description: "PowerShell 7+",
        candidates: () => [
          "pwsh",
          process.env.ProgramFiles && path.join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe"),
        ],
      },
      {
        name: "git-bash",
        // Plain "bash" on PATH is often WSL's System32\bash.exe, which can't read our Windows-path rcfile
        aliases: ["bash", "gitbash"],
        description: "Git for Windows Bash",
        candidates: gitBashCandidates,
      },
      {
        name: "wsl",
        aliases: [],
        description: "Windows Subsystem for Linux (default distro; pass shellArgs [\"-d\", \"<distro>\"] for another)",
        candidates: () => [path.join(system32, "wsl.exe"), "wsl"],
      },
    ];
  }

  const onPath = (name: string, description: string): KnownShell => ({
    name,
    aliases: [],
    description,
    candidates: () => [name],
  });
  return [
    onPath("bash", "Bourne Again Shell"),
    onPath("zsh", "Z shell"),
    onPath("sh", "POSIX shell"),
    onPath("fish", "Friendly interactive shell"),
    onPath("dash", "Debian Almquist shell"),
    onPath("ksh", "KornShell"),
    onPath("tcsh", "TENEX C shell"),
    onPath("nu", "Nushell"),
    onPath("pwsh", "PowerShell 7+"),
  ];
}

function firstExisting(shell: KnownShell): string | null {
  for (const candidate of shell.candidates()) {
    if (!candidate) continue;
    const found = path.isAbsolute(candidate) ? (isFile(candidate) ? candidate : null) : findOnPath(candidate);
    if (found) return found;
  }
  return null;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (isWindows ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

function looksLikePath(spec: string): boolean {
  return path.isAbsolute(spec) || spec.includes("/") || (isWindows && spec.includes("\\"));
}

/** The shell spec used when none is given explicitly: $TERMINAL_MCP_SHELL, if set. */
function defaultSpec(): string | undefined {
  const fromEnv = process.env[SHELL_ENV_VAR]?.trim();
  return fromEnv ? fromEnv : undefined;
}

/**
 * Resolve a shell name or path to an executable path.
 *
 * Precedence for an omitted spec: $TERMINAL_MCP_SHELL, then the platform default ($SHELL, or
 * %COMSPEC% on Windows). Names are matched case-insensitively against the known shells for this
 * platform, then looked up on PATH. Throws if the shell cannot be found.
 */
export function resolveShell(spec?: string): string {
  const requested = spec?.trim() || defaultSpec();
  if (!requested) return getDefaultShell();

  if (looksLikePath(requested)) {
    if (isFile(requested)) return requested;
    throw new Error(`Shell not found: ${requested}`);
  }

  const lower = requested.toLowerCase().replace(/\.exe$/, "");
  const known = knownShells().find((s) => s.name === lower || s.aliases.includes(lower));
  const found = known ? firstExisting(known) : findOnPath(requested);
  if (found) return found;

  const available = listShells().map((s) => s.name);
  throw new Error(
    `Shell "${requested}" ${known ? "is not installed" : "was not found on PATH"}. ` +
      `Available shells: ${available.length > 0 ? available.join(", ") : "none detected"}; ` +
      `a full path to the executable also works.`
  );
}

/** List the shells available on this machine, with the default (if any) marked. */
export function listShells(): ShellInfo[] {
  let defaultPath: string | null = null;
  try {
    defaultPath = resolveShell();
  } catch {
    // A bad $TERMINAL_MCP_SHELL shouldn't stop us from listing what is installed
  }

  const shells: ShellInfo[] = [];
  const add = (name: string, shellPath: string, description: string) => {
    if (shells.some((s) => samePath(s.path, shellPath))) return;
    shells.push({ name, path: shellPath, description, isDefault: defaultPath !== null && samePath(shellPath, defaultPath) });
  };

  for (const shell of knownShells()) {
    const found = firstExisting(shell);
    if (found) add(shell.name, found, shell.description);
  }

  // Anything else registered in /etc/shells (e.g. /usr/local/bin/bash from Homebrew)
  if (!isWindows) {
    try {
      for (const line of fs.readFileSync("/etc/shells", "utf8").split("\n")) {
        const entry = line.trim();
        if (entry && !entry.startsWith("#") && isFile(entry)) add(entry, entry, "Listed in /etc/shells");
      }
    } catch {
      // /etc/shells is optional
    }
  }

  // The default may be something we don't know by name (e.g. $SHELL=/opt/bin/elvish)
  if (defaultPath && !shells.some((s) => s.isDefault) && isFile(defaultPath)) {
    shells.push({ name: defaultPath, path: defaultPath, description: "Default shell", isDefault: true });
  }

  return shells;
}
