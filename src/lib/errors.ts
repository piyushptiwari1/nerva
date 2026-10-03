export function errorMessage(error: unknown, fallback = "The operation failed. Please retry."): string {
  const seen = new Set<unknown>();
  function message(value: unknown): string | null {
    if (typeof value === "string" && value.trim()) return value;
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const details = value as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "cause"]) {
      const result = message(details[key]);
      if (result) return result;
    }
    return null;
  }
  return message(error) ?? fallback;
}