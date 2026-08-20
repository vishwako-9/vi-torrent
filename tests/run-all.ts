/**
 * Runs every suite in this folder, one child process each.
 *
 * Separate processes are not tidiness: the engine is a module singleton with
 * a session file behind it, so two suites in one process would share state.
 *
 * A suite that emits NO checks is reported as a failure. That is not
 * paranoia - a refactor once left a suite silently emitting nothing, and the
 * sweep happily reported zero failures.
 */
import fs from "fs";
import path from "path";

const dir = import.meta.dir;
const suites = fs.readdirSync(dir)
  .filter(f => /^test-.*\.tsx?$/.test(f))
  .sort();

let totalPass = 0, totalFail = 0;
const broken: string[] = [];

for (const suite of suites) {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, "--conditions=browser", "run", path.join(dir, suite)],
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = proc.stdout.toString() + proc.stderr.toString();
  const pass = (out.match(/^PASS - /gm) ?? []).length;
  const fail = (out.match(/^FAIL - /gm) ?? []).length;
  totalPass += pass;
  totalFail += fail;

  const ok = fail === 0 && pass > 0 && proc.exitCode === 0;
  if (!ok) broken.push(suite);
  console.log(
    `${ok ? "ok  " : "FAIL"} ${suite.padEnd(28)} ${pass} passed` +
    (fail ? `, ${fail} failed` : "") +
    (pass === 0 ? "  <- emitted no checks" : "") +
    (proc.exitCode !== 0 ? `  <- exit ${proc.exitCode}` : ""),
  );
  if (!ok) for (const line of out.split("\n").filter(l => l.startsWith("FAIL - "))) console.log("       " + line);
}

console.log(`\n${suites.length} suites, ${totalPass} checks passed, ${totalFail} failed`);
if (broken.length) {
  console.log("broken: " + broken.join(", "));
  process.exit(1);
}
