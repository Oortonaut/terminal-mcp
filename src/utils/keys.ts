/**
 * Key code mappings for terminal special keys
 * Maps human-readable key names to their ANSI escape sequences
 */

export const KEY_SEQUENCES: Record<string, string> = {
  // Control keys
  "Enter": "\r",
  "Tab": "\t",
  "Escape": "\x1b",
  "Backspace": "\x7f",
  "Delete": "\x1b[3~",

  // Arrow keys
  "ArrowUp": "\x1b[A",
  "ArrowDown": "\x1b[B",
  "ArrowRight": "\x1b[C",
  "ArrowLeft": "\x1b[D",

  // Navigation keys
  "Home": "\x1b[H",
  "End": "\x1b[F",
  "PageUp": "\x1b[5~",
  "PageDown": "\x1b[6~",
  "Insert": "\x1b[2~",

  // Function keys
  "F1": "\x1bOP",
  "F2": "\x1bOQ",
  "F3": "\x1bOR",
  "F4": "\x1bOS",
  "F5": "\x1b[15~",
  "F6": "\x1b[17~",
  "F7": "\x1b[18~",
  "F8": "\x1b[19~",
  "F9": "\x1b[20~",
  "F10": "\x1b[21~",
  "F11": "\x1b[23~",
  "F12": "\x1b[24~",

  // Ctrl combinations
  "Ctrl+A": "\x01",
  "Ctrl+B": "\x02",
  "Ctrl+C": "\x03",
  "Ctrl+D": "\x04",
  "Ctrl+E": "\x05",
  "Ctrl+F": "\x06",
  "Ctrl+G": "\x07",
  "Ctrl+H": "\x08",
  "Ctrl+I": "\x09",
  "Ctrl+J": "\x0a",
  "Ctrl+K": "\x0b",
  "Ctrl+L": "\x0c",
  "Ctrl+M": "\x0d",
  "Ctrl+N": "\x0e",
  "Ctrl+O": "\x0f",
  "Ctrl+P": "\x10",
  "Ctrl+Q": "\x11",
  "Ctrl+R": "\x12",
  "Ctrl+S": "\x13",
  "Ctrl+T": "\x14",
  "Ctrl+U": "\x15",
  "Ctrl+V": "\x16",
  "Ctrl+W": "\x17",
  "Ctrl+X": "\x18",
  "Ctrl+Y": "\x19",
  "Ctrl+Z": "\x1a",
  "Ctrl+[": "\x1b",
  "Ctrl+\\": "\x1c",
  "Ctrl+]": "\x1d",
  "Ctrl+^": "\x1e",
  "Ctrl+_": "\x1f",

  // Common shortcuts
  "Ctrl+Space": "\x00",
};

/**
 * Get the escape sequence for a key name
 * @param key - The key name (e.g., "Enter", "Ctrl+C", "ArrowUp")
 * @returns The escape sequence or null if not found
 */
export function getKeySequence(key: string): string | null {
  // Normalize key name
  const normalized = key.trim();

  // Check direct match
  if (KEY_SEQUENCES[normalized]) {
    return KEY_SEQUENCES[normalized];
  }

  // Check case-insensitive match
  const lowerKey = normalized.toLowerCase();
  for (const [name, seq] of Object.entries(KEY_SEQUENCES)) {
    if (name.toLowerCase() === lowerKey) {
      return seq;
    }
  }

  return null;
}

/**
 * Get all available key names
 */
export function getAvailableKeys(): string[] {
  return Object.keys(KEY_SEQUENCES);
}

interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const MODIFIER_WORDS: Record<string, keyof Modifiers> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  meta: "alt",
  shift: "shift",
};

const MODIFIER_SYMBOLS: Record<string, keyof Modifiers> = {
  "^": "ctrl",
  "!": "alt",
  "+": "shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  return: "Enter",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pgup: "PageUp",
  pgdn: "PageDown",
  del: "Delete",
  ins: "Insert",
};

/** Delimiters around a key escape in typed text, e.g. "ls<:Enter:>" */
export const KEY_OPEN = "<:";
export const KEY_CLOSE = ":>";

export const KEY_HINT = "Keys are written like <:Enter:> or <:ctrl-c:>; pass sendKeys: false to type text verbatim.";

/** A key name that cannot be encoded; the message is the reason, without the key name. */
export class KeyError extends Error {}

/** Control code for a character (Ctrl+C -> \x03), or null if Ctrl has no standard meaning for it. */
function controlCode(ch: string): string | null {
  if (ch === " " || ch === "@") return "\x00";
  if (ch === "?") return "\x7f";
  const code = ch.toUpperCase().charCodeAt(0);
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : null;
}

function encodeChar(ch: string, mods: Modifiers): string {
  let out = ch;
  if (mods.shift) {
    if (!/^[a-z]$/i.test(ch)) {
      throw new KeyError("shift only applies to letters and named keys; type the shifted character itself");
    }
    out = ch.toUpperCase();
  }
  if (mods.ctrl) {
    const ctrl = controlCode(out);
    if (ctrl === null) throw new KeyError(`no control code exists for "${out}"`);
    out = ctrl;
  }
  return mods.alt ? "\x1b" + out : out;
}

function encodeNamed(seq: string, mods: Modifiers): string {
  if (!mods.ctrl && !mods.alt && !mods.shift) return seq;

  // xterm modifier parameter: 1 + Shift(1) + Alt(2) + Ctrl(4)
  const param = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
  const letter = /^\x1b[[O]([A-Z])$/.exec(seq);
  if (letter) return `\x1b[1;${param}${letter[1]}`;
  const tilde = /^\x1b\[(\d+)~$/.exec(seq);
  if (tilde) return `\x1b[${tilde[1]};${param}~`;

  // Enter, Tab, Escape, Backspace: only Alt (ESC prefix) and Shift+Tab have standard encodings
  if (mods.ctrl || (mods.shift && seq !== "\t")) {
    throw new KeyError("this modifier combination has no standard terminal encoding");
  }
  const base = mods.shift ? "\x1b[Z" : seq;
  return mods.alt ? "\x1b" + base : base;
}

/**
 * Encode a key name as written between <: and :>, e.g. "Enter", "^C", "ctrl-c", "alt-ctrl-C", "!^C", "+Tab".
 * Modifiers are word prefixes (ctrl-, alt-, shift-; "+" also accepted as the separator) or
 * symbol prefixes (^ ctrl, ! alt, + shift). The remainder is a named key, or a single character
 * when at least one modifier is given. Throws KeyError if the name cannot be encoded.
 */
export function encodeKey(name: string): string {
  const mods: Modifiers = { ctrl: false, alt: false, shift: false };
  let rest = name;
  for (;;) {
    const word = /^(ctrl|control|alt|meta|shift)[-+](?=.)/i.exec(rest);
    if (word) {
      mods[MODIFIER_WORDS[word[1].toLowerCase()]] = true;
      rest = rest.slice(word[0].length);
      continue;
    }
    const symbol = rest.length > 1 ? MODIFIER_SYMBOLS[rest[0]] : undefined;
    if (symbol) {
      mods[symbol] = true;
      rest = rest.slice(1);
      continue;
    }
    break;
  }

  if (rest === "") throw new KeyError("empty key name");
  if ([...rest].length === 1) {
    // A bare character gains nothing from being written as a key; just type it
    if (!mods.ctrl && !mods.alt && !mods.shift) throw new KeyError("a single character needs a modifier");
    return encodeChar(rest, mods);
  }
  if (rest.toLowerCase() === "space") return encodeChar(" ", mods);

  const seq = getKeySequence(KEY_ALIASES[rest.toLowerCase()] ?? rest);
  if (seq === null) {
    throw new KeyError(
      "not a recognized key (use a name like Enter, Tab, Escape, Backspace, ArrowUp, Home, PageUp, F1, " +
        "with optional modifiers ctrl-/alt-/shift- or ^ ! +)"
    );
  }
  return encodeNamed(seq, mods);
}

export interface ParsedKeyInput {
  /** Bytes to write to the PTY */
  data: string;
  /** Number of literal characters typed */
  chars: number;
  /** Key names that were encoded, as written between the delimiters */
  keys: string[];
  /** Escapes that were typed literally instead, e.g. unrecognized keys and unmatched delimiters */
  warnings: string[];
}

/**
 * Parse text with embedded <:Key:> escapes. The delimiters rarely occur in real text, so there is
 * no escape for them; anything that is not a valid key (an unrecognized name, an unmatched "<:" or
 * ":>") is typed as-is and reported in warnings, so code like "T <: Number" still comes out as written.
 */
export function parseKeyInput(text: string): ParsedKeyInput {
  let data = "";
  let chars = 0;
  const keys: string[] = [];
  const warnings: string[] = [];

  const literal = (s: string) => {
    data += s;
    chars += s.length;
  };

  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(KEY_OPEN, i);
    const close = text.indexOf(KEY_CLOSE, i);

    if (close !== -1 && (open === -1 || close < open)) {
      warnings.push(`Unmatched "${KEY_CLOSE}" at position ${close}; typed literally`);
      literal(text.slice(i, close + KEY_CLOSE.length));
      i = close + KEY_CLOSE.length;
      continue;
    }
    if (open === -1) {
      literal(text.slice(i));
      break;
    }

    literal(text.slice(i, open));
    const start = open + KEY_OPEN.length;
    const end = text.indexOf(KEY_CLOSE, start);
    const nextOpen = text.indexOf(KEY_OPEN, start);
    if (end === -1 || (nextOpen !== -1 && nextOpen < end)) {
      // No closer before the next opener: only this opener is literal, and parsing resumes right
      // after it so a following <:Key:> still works
      warnings.push(`Unmatched "${KEY_OPEN}" at position ${open}; typed literally`);
      literal(KEY_OPEN);
      i = start;
      continue;
    }

    const name = text.slice(start, end);
    try {
      data += encodeKey(name);
      keys.push(name);
    } catch (error) {
      if (!(error instanceof KeyError)) throw error;
      warnings.push(`"${KEY_OPEN}${name}${KEY_CLOSE}" at position ${open}: ${error.message}; typed literally`);
      literal(KEY_OPEN + name + KEY_CLOSE);
    }
    i = end + KEY_CLOSE.length;
  }

  return { data, chars, keys, warnings };
}
