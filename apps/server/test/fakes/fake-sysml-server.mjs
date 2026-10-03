// SysmlServer.java の代役(JSON Lines)。FAKE_MODE: ok | crash-on-start | hang | bad-line | hang-on-HANG
import { createInterface } from "node:readline";
const mode = process.env.FAKE_MODE ?? "ok";
if (mode === "crash-on-start") process.exit(3);
console.error(`PID ${process.pid}`);
console.log(JSON.stringify({ ready: true }));
if (mode === "bad-line") console.log("not json");
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, text } = JSON.parse(line);
  if (mode === "hang" || (mode === "hang-on-HANG" && text.includes("HANG"))) return;
  if (mode === "die-after-reply") {
    console.log(JSON.stringify({ id, ok: true, diagnostics: [], graph: { elements: [], dependencies: [], metadata: [], satisfies: [] } }));
    setTimeout(() => process.exit(0), 5);
    return;
  }
  if (text.includes("BAD")) console.log(JSON.stringify({ id, ok: false, diagnostics: [{ severity: "ERROR", message: "bad" }] }));
  else console.log(JSON.stringify({ id, ok: true, diagnostics: [], graph: { elements: [{ kind: "PartUsage", qualifiedName: "P::a", name: "a", owner: "P" }], dependencies: [], metadata: [], satisfies: [] } }));
});
