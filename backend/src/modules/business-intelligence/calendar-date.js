const DATE_PATTERN = /^\\d{4}-\\d{2}-\\d{2}$/;

/**
 * Checks a strict YYYY-MM-DD calendar date without relying on Date.parse()
 * normalization. Uses UTC round-tripping to reject impossible days/months.
 */
export function isValidCalendarDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}
