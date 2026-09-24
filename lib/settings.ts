import { db } from "./db";
import { defaultMeasuringProvider, providers, type ProviderName } from "./providers";

export const PHASES = ["closed", "activity1", "activity2", "wrapup"] as const;
export type Phase = (typeof PHASES)[number];

const DEFAULTS: Record<string, string> = {
  phase: "closed",
  runs_per_test: "5",
};

export function getSetting(key: string): string {
  const row = db().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key] ?? "";
}

export function setSetting(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

/**
 * Who marks the answers and runs the checks. Kept separate from the bot on purpose: marking with the
 * same model you are testing is a weaker test. The admin can point both at one provider anyway.
 */
export function measuringProvider(): ProviderName {
  const row = db().prepare("SELECT value FROM settings WHERE key='marker_model'").get() as { value: ProviderName } | undefined;
  if (row && providers()[row.value]?.configured) return row.value;
  return defaultMeasuringProvider();
}

export const getPhase = () => getSetting("phase") as Phase;
export const getRunsPerTest = () => Number(getSetting("runs_per_test")) || 5;
/** The admin's pick. Before one is made, Azure — or the offline mock if Azure has no keys. */
export function getBotModel(): ProviderName {
  const row = db().prepare("SELECT value FROM settings WHERE key='bot_model'").get() as { value: ProviderName } | undefined;
  if (row) return row.value;
  return providers().azure.configured ? "azure" : "mock";
}
