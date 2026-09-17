import { db } from "./db";
import { providers, type ProviderName } from "./providers";

export const PHASES = ["closed", "activity1", "demo", "activity2", "wrapup"] as const;
export type Phase = (typeof PHASES)[number];

const DEFAULTS: Record<string, string> = {
  phase: "closed",
  runs_per_test: "5",
  cached_demo: "0",
  cached_demo_cursor: "0",
};

export function getSetting(key: string): string {
  const row = db().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key] ?? "";
}

export function setSetting(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

export const getPhase = () => getSetting("phase") as Phase;
export const getRunsPerTest = () => Number(getSetting("runs_per_test")) || 5;
/** The admin's pick. Before one is made, Azure — or the offline mock if Azure has no keys. */
export function getBotModel(): ProviderName {
  const row = db().prepare("SELECT value FROM settings WHERE key='bot_model'").get() as { value: ProviderName } | undefined;
  if (row) return row.value;
  return providers().azure.configured ? "azure" : "mock";
}
export const cachedDemoOn = () => getSetting("cached_demo") === "1";
