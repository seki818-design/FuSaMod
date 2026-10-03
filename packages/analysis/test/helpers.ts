import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElementGraph } from "@fusamod/sysml-graph";
import { parseSafetyData, type SafetyData } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const proj = (f: string) => resolve(here, "../../../projects/ev-powertrain", f);

export const demoGraph = (): ElementGraph => JSON.parse(readFileSync(proj("model.graph.json"), "utf8")) as ElementGraph;
export const demoSafety = (): SafetyData => {
  const r = parseSafetyData(JSON.parse(readFileSync(proj("safety.json"), "utf8")));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.data;
};

export const P = "EvPowertrainDemo::";
export const VEH = `${P}vehicle`;
export const PT = `${VEH}::powertrain`;
export const VCU = `${PT}::vcu`;
export const INV = `${PT}::inverter`;
export const GD = `${INV}::gateDriver`;
export const MOT = `${PT}::motor`;
export const SM = `${PT}::safetyMonitor`;
