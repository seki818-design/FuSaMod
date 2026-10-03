import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject, parseSafetyData, type SafetyData } from "@fusamod/analysis";
import type { ElementGraph } from "@fusamod/sysml-graph";
import { RefIndex } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const proj = resolve(here, "../../../projects/ev-powertrain");

export const graph = (): ElementGraph => JSON.parse(readFileSync(resolve(proj, "model.graph.json"), "utf8")) as ElementGraph;
export const safety = (): SafetyData => {
  const r = parseSafetyData(JSON.parse(readFileSync(resolve(proj, "safety.json"), "utf8")));
  if (!r.ok) throw new Error(r.errors.join());
  return r.data;
};
export const refs = (): RefIndex =>
  new RefIndex(readdirSync(resolve(proj, "refs")).map((name) => ({ name, text: readFileSync(resolve(proj, "refs", name), "utf8") })));

export const ctx = (message: string, s: SafetyData = safety()) => ({
  message,
  projectName: "EV パワートレイン",
  analysis: analyzeProject(graph(), s),
  safety: s,
  refs: refs(),
});
