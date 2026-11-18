import test from "node:test";
import assert from "node:assert/strict";
import { isValidCalendarDate } from "../src/modules/business-intelligence/calendar-date.js";

test("accepts valid calendar dates", () => {
  for (const value of [
    "2024-02-29",
    "2026-02-28",
    "2026-04-30",
    "2026-12-31",
    "0001-01-01"
  ]) {
    assert.equal(isValidCalendarDate(value), true, value);
  }
});

test("rejects impossible calendar dates and invalid formats", () => {
  for (const value of [
    "2026-02-29",
    "2026-02-31",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-01-32",
    "2026-2-01",
    "26-02-01",
    "",
    null,
    20261118
  ]) {
    assert.equal(isValidCalendarDate(value), false, String(value));
  }
});
