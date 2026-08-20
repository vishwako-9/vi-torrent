import { checks, testRoot } from "./_isolate.js";
/**
 * The windowless launcher script.
 *
 * `vi-torrent.exe` is a console application, so a browser launching it makes
 * Windows allocate a console — a window flashed even when all that happened
 * was a link being passed to a session already open. User-reported. The
 * registry therefore points at `wscript.exe` (GUI subsystem, no console)
 * running a generated VBScript, which does the probe hidden and only opens a
 * terminal when there is no window to hand the link to.
 *
 * **This suite exists because the first version did not compile.** A VBScript
 * Sub called with parentheses and its result discarded is a syntax error, and
 * the failure mode is vicious: wscript raises a MODAL dialog and waits for
 * someone to click OK. Clicking a magnet link simply hung, with no console to
 * show why. Reading the script cannot catch that — only compiling it can.
 */
import { shimSource, plannedChanges } from "../src/register.js";
import { NO_INSTANCE } from "../src/handoff.js";
import fs from "fs";
import path from "path";

const { ck, done } = checks();

const EXE = "C:\\Users\\someone\\.bun\\bin\\vi-torrent.exe";
const source = shimSource(EXE);

// --- content ---
ck("the shim embeds the absolute path to the executable", source.includes(EXE));
ck("it probes with --handoff", source.includes("--handoff"));
ck("it runs the probe hidden and waits", source.includes(", 0, True)"));
ck("it opens a visible window only in the fallback", source.includes(", 1, False)"));
ck("it tests for the no-instance code", source.includes(`If code = ${NO_INSTANCE} Then`));
// wscript splits on CRLF; a lone LF file is one giant line and will not run.
ck("it uses CRLF line endings", source.includes("\r\n") && !/[^\r]\n/.test(source));

// --- the registry points at wscript, not the console app ---
const command = `"C:\\Windows\\System32\\wscript.exe" "C:\\x\\open-link.vbs" "%1"`;
const changes = plannedChanges(command);
ck("every command entry uses the given launcher",
  changes.filter(c => c.key.endsWith("command")).every(c => c.data === command));
ck("the magnet key still declares URL Protocol",
  changes.some(c => c.name === "URL Protocol"));

// --- IT MUST COMPILE ---
if (process.platform === "win32") {
  const file = path.join(testRoot, "shim-compile.vbs");
  fs.writeFileSync(file, source, "utf8");

  // With no arguments the script quits 2 before running anything. So exit 2
  // means "compiled and ran"; a compile error is exit 1 with a message on
  // stderr. Nothing is launched either way.
  const result = Bun.spawnSync(
    [path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cscript.exe"), "//nologo", file],
    { stdout: "pipe", stderr: "pipe" },
  );
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

  ck("the shim COMPILES under the real script host",
    !/compilation error|syntax error/i.test(output));
  ck("...and reaches its own no-arguments guard", result.exitCode === 2);
  if (result.exitCode !== 2) console.log("       cscript said: " + output.trim());
} else {
  // Not a skip that hides a hole: the shim only ever runs on Windows.
  ck("the shim is Windows-only, so compilation is checked there", true);
  ck("...and this platform has no script host to check it with", true);
}

done();
