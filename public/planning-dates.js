export const BERLIN = "Europe/Berlin";
export const PLANNING_START_OFFSET = -2;
export const PLANNING_DAYS = 8;

const berlinFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BERLIN, year: "numeric", month: "2-digit", day: "2-digit"
});

export function berlinToday(now = new Date()) {
  const parts = berlinFormatter.formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Arithmetic on date labels, not 24-hour durations: Berlin days can be 23/25 hours.
export function addCalendarDays(iso, offset) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function planningDates(now = new Date()) {
  const today = berlinToday(now);
  return Array.from({length: PLANNING_DAYS}, (_, index) =>
    addCalendarDays(today, PLANNING_START_OFFSET + index));
}

export function visiblePlanningDays(days, now = new Date()) {
  const byDate = new Map(days.map(day => [day.date, day]));
  return planningDates(now).map(date => byDate.get(date) ?? {
    date, projects: [], absences: [], missing: true
  });
}
