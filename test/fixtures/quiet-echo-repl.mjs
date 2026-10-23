// A REPL that behaves like PSReadLine: raw input with no echo, and on each keystroke it first sends
// an invisible sequence (hide cursor) before replying ~400ms later with a fresh "> " prompt.
// The invisible output arrives while the old prompt is still under the cursor, so a wait that
// treated "any new output" as "the screen moved on" would match that stale prompt.
const ESC = "\x1b";
process.stdin.setRawMode?.(true);
process.stdout.write("> ");
process.stdin.on("data", (data) => {
  process.stdout.write(`${ESC}[?25l`);
  if (data.includes("\x03")) process.exit(0);
  if (data.includes("\r")) {
    setTimeout(() => process.stdout.write(`\r\nreply\r\n${ESC}[?25h> `), 400);
  }
});
