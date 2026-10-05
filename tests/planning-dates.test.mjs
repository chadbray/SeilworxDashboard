import test from "node:test";
import assert from "node:assert/strict";
import { addCalendarDays, berlinToday, planningDates, visiblePlanningDays } from "../public/planning-dates.js";

const cases = [
  ["2026-10-05T04:00:00Z", "2026-10-05", "2026-10-03", "2026-10-10"],
  ["2026-10-05T21:59:59Z", "2026-10-05", "2026-10-03", "2026-10-10"],
  ["2026-10-05T22:00:00Z", "2026-10-06", "2026-10-04", "2026-10-11"],
  ["2026-03-29T00:30:00Z", "2026-03-29", "2026-03-27", "2026-04-03"],
  ["2026-03-29T22:30:00Z", "2026-03-30", "2026-03-28", "2026-04-04"],
  ["2026-10-25T00:30:00Z", "2026-10-25", "2026-10-23", "2026-10-30"],
  ["2026-10-25T01:30:00Z", "2026-10-25", "2026-10-23", "2026-10-30"],
  ["2026-10-25T22:30:00Z", "2026-10-25", "2026-10-23", "2026-10-30"],
  ["2026-10-25T23:00:00Z", "2026-10-26", "2026-10-24", "2026-10-31"],
  ["2026-10-31T23:00:00Z", "2026-11-01", "2026-10-30", "2026-11-06"],
  ["2026-12-31T23:00:00Z", "2027-01-01", "2026-12-30", "2027-01-06"],
  ["2028-02-28T23:00:00Z", "2028-02-29", "2028-02-27", "2028-03-05"]
];

for (const [instant, today, first, last] of cases) {
  test(`eight Berlin calendar dates at ${instant}`, () => {
    const dates = planningDates(new Date(instant));
    assert.equal(berlinToday(new Date(instant)), today);
    assert.equal(dates.length, 8);
    assert.equal(new Set(dates).size, 8);
    assert.equal(dates[0], first);
    assert.equal(dates[2], today);
    assert.equal(dates[7], last);
    dates.slice(1).forEach((date, index) => assert.equal(date, addCalendarDays(dates[index], 1)));
  });
}

test("old snapshot keeps real assignments and marks missing dates explicitly", () => {
  const source = planningDates(new Date("2026-10-02T12:00:00Z")).map(date => ({
    date, projects: date === "2026-10-05" ? [{name: "Example", team: ["Test"]}] : [], absences: []
  }));
  const before = JSON.stringify(source);
  const visible = visiblePlanningDays(source, new Date("2026-10-05T12:00:00Z"));
  assert.deepEqual(visible.map(day => day.date), planningDates(new Date("2026-10-05T12:00:00Z")));
  assert.strictEqual(visible[2], source.find(day => day.date === "2026-10-05"));
  assert.deepEqual(visible.filter(day => day.missing).map(day => day.date), ["2026-10-08", "2026-10-09", "2026-10-10"]);
  assert.equal(JSON.stringify(source), before);
});

test("missing feed still produces eight truthful unavailable dates", () => {
  const visible = visiblePlanningDays([], new Date("2026-10-05T12:00:00Z"));
  assert.equal(visible.length, 8);
  assert.ok(visible.every(day => day.missing && !day.projects.length && !day.absences.length));
});
