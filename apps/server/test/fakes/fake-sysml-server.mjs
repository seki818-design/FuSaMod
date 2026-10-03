// SysmlServer.java の代役(JSON Lines)。FAKE_MODE: ok | crash-on-start | hang | bad-line
import { createInterface } from "node:readline";
const mode = process.env.FAKE_MODE ?? "ok";
if (mode === "crash-on-start") process.exit(3);
console.log(JSON.stringify({ ready: true }));
if (mode === "bad-line") console.log("not json");
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, text } = JSON.parse(line);
  if (mode === "hang") return;
  if (text.includes("BAD")) console.log(JSON.stringify({ id, ok: false, diagnostics: [{ severity: "ERROR", message: "bad" }] }));
  else console.log(JSON.stringify({ id, ok: true, diagnostics: [], graph: { elements: [{ kind: "PartUsage", qualifiedName: "P::a", name: "a", owner: "P" }], dependencies: [], metadata: [], satisfies: [] } }));
});
