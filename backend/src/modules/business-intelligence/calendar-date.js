const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Checks a strict YYYY-MM-DD calendar date without relying on Date.parse()
 * normalization. UTC round-tripping rejects impossible days and months.
 */
export function isValidCalendarDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  // setUTCFullYear avoids Date.UTC's special handling of years 0 through 99.
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}
