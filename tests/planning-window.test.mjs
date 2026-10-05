import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { addCalendarDays, planningDates } from "../public/planning-dates.js";

// Exercise the actual collector navigation without credentials or a PlanCraft login.
const source = await readFile(new URL("../scripts/update-plancraft.mjs", import.meta.url), "utf8");
const functionSource = source.slice(source.indexOf("async function readPlanningWindow("), source.indexOf("\nconst browser="));

function fixture(instant, windows, initial, {stuck = false, omit = null} = {}) {
  const wanted = planningDates(new Date(instant));
  let index = initial;
  const clicks = [];
  const locator = direction => ({
    first() { return this; }, or() { return this; },
    async isVisible() { return true; },
    async click() { clicks.push(direction); if (!stuck) index += direction; }
  });
  const page = {locator: selector => locator(selector.includes("prev") ? -1 : 1), getByRole: () => locator(0), async waitForTimeout() {}};
  const context = vm.createContext({
    planningDates: () => wanted,
    async readBoard(_page, remaining) {
      const visibleDates = windows[index] ?? [];
      return {visibleDates, dates: visibleDates.filter(date => remaining.includes(date) && date !== omit).map(date => ({date})), resources: [{id: "employee"}]};
    },
    assemble: (_raw, dates) => ({days: dates.map(date => ({date, projects: [], absences: []}))})
  });
  vm.runInContext(`${functionSource}\nthis.readPlanningWindow=readPlanningWindow;`, context);
  return {run: () => context.readPlanningWindow(page), wanted, clicks};
}

const week = first => Array.from({length: 7}, (_, index) => addCalendarDays(first, index));

for (const day of ["2026-10-05", "2026-10-09", "2026-10-11"]) {
  test(`collector reaches both sides of weekly window on ${day}`, async () => {
    const f = fixture(`${day}T12:00:00Z`, [week("2026-09-28"), week("2026-10-05"), week("2026-10-12")], 1);
    const result = await f.run();
    assert.deepEqual(Array.from(result.days, day => day.date), f.wanted);
    assert.ok(f.clicks.length > 0);
  });
}

test("collector can cross a month boundary", async () => {
  const month = (first, length) => Array.from({length}, (_, index) => addCalendarDays(first, index));
  const f = fixture("2026-10-30T12:00:00Z", [month("2026-10-01", 31), month("2026-11-01", 30)], 0);
  assert.deepEqual(Array.from((await f.run()).days, day => day.date), f.wanted);
  assert.deepEqual(f.clicks, [1]);
});

test("persisted single-day view still collects all eight dates", async () => {
  const windows = Array.from({length: 8}, (_, index) => [addCalendarDays("2026-10-03", index)]);
  const f = fixture("2026-10-05T12:00:00Z", windows, 2);
  assert.deepEqual(Array.from((await f.run()).days, day => day.date), f.wanted);
});

test("stuck navigation fails safely", async () => {
  const f = fixture("2026-10-09T12:00:00Z", [week("2026-10-05")], 0, {stuck: true});
  await assert.rejects(f.run(), /navigation did not advance/);
});

test("missing interior source date fails rather than inventing an empty day", async () => {
  const f = fixture("2026-10-05T12:00:00Z", [Array.from({length: 8}, (_, index) => addCalendarDays("2026-10-03", index))], 0, {omit: "2026-10-06"});
  await assert.rejects(f.run(), /did not expose required date 2026-10-06/);
});
