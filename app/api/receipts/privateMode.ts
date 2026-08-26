export function privateModeEnabled(environment: Record<string, string | undefined> = process.env) {
  return ["1", "true", "yes", "private"].includes((environment.DSE_PRIVATE_MODE ?? "").trim().toLowerCase());
}
