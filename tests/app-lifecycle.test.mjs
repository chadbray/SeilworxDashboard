import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { berlinToday, planningDates, visiblePlanningDays } from "../public/planning-dates.js";

// Execute the real application functions with a minimal DOM and controllable
// clock/network. No browser, credentials, or live services are required.
const source = (await readFile(new URL("../public/app.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]*\n/, "")
  .split("\nstart().catch")[0];
const RealDate = Date;
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(initial = "2026-10-05T21:59:59Z") {
  let instant = initial;
  class ClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return new RealDate(instant).getTime(); }
  }
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: "", textContent: "", classList: {toggle() {}}, setAttribute() {}
    });
    return elements.get(selector);
  };
  const requests = [];
  const intervals = [];
  const listeners = {window: new Map(), document: new Map()};
  const register = scope => (name, handler) => {
    const handlers = listeners[scope].get(name) ?? [];
    handlers.push(handler);
    listeners[scope].set(name, handlers);
  };
  const document = {
    hidden: false, querySelector: element, querySelectorAll: () => [],
    addEventListener: register("document")
  };
  const context = vm.createContext({
    Date: ClockDate, Intl, URL, URLSearchParams, BERLIN: "Europe/Berlin",
    berlinToday: () => berlinToday(new RealDate(instant)),
    visiblePlanningDays: days => visiblePlanningDays(days, new RealDate(instant)),
    document,
    window: {
      location: {hash: "", reload() {}}, clearTimeout() {}, setTimeout() {},
      setInterval: (handler, ms) => intervals.push({handler, ms}),
      addEventListener: register("window")
    },
    history: {replaceState() {}}, sessionStorage: {getItem: () => null, setItem() {}},
    fetch: url => new Promise((resolve, reject) => {
      const request = {url: String(url), instant, settled: false};
      request.resolve = data => {
        request.settled = true;
        resolve({ok: true, json: async () => data});
      };
      request.reject = () => { request.settled = true; reject(new Error("offline")); };
      requests.push(request);
    })
  });
  vm.runInContext(`${source}\nthis.api={start,refreshPlanning,refreshWeather,dateValue};`, context);
  const pending = kind => requests.filter(request => !request.settled && (
    kind === "weather" ? request.url.startsWith("https://api.open-meteo.com/") :
    request.url.startsWith(`${kind}.json`)
  ));
  const feed = (at = instant, name = "Example") => ({
    checkedAt: at,
    days: planningDates(new RealDate(at)).map(date => ({
      date, projects: date === berlinToday(new RealDate(at)) ? [{name, team: ["Test"]}] : [], absences: []
    })),
    upcomingProjects: []
  });
  const weather = (request, value = 20) => {
    const dates = planningDates(new RealDate(request.instant));
    const fields = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max"];
    request.resolve({daily: Object.fromEntries([
      ["time", dates], ...fields.map(field => [field, dates.map(() => field === "weather_code" ? 3 : value)])
    ])});
  };
  const settleWeather = value => pending("weather").forEach(request => weather(request, value));
  const settleCertificates = () => pending("certificates").forEach(request => request.resolve({
    asOf: berlinToday(new RealDate(instant)), employees: [], appointments: []
  }));
  const f = {
    api: context.api, element, requests, pending, intervals, listeners, document,
    feed, weather, settleWeather, settleCertificates,
    setNow: value => { instant = value; },
    tick: ms => intervals.filter(timer => timer.ms === ms).forEach(timer => timer.handler()),
    dispatch: (scope, name) => (listeners[scope].get(name) ?? []).forEach(handler => handler()),
    async load(data = feed()) {
      const startup = context.api.start();
      pending("schedule")[0].resolve(data);
      await flush();
      settleWeather();
      await flush();
      settleCertificates();
      await startup;
    }
  };
  return f;
}

function assertWindow(f, today, first, last) {
  const html = f.element("#planning").innerHTML;
  const dates = [...html.matchAll(/<article data-date="([^"]+)"/g)].map(match => match[1]);
  assert.equal(dates.length, 8);
  assert.equal(dates[0], first);
  assert.equal(dates[2], today);
  assert.equal(dates[7], last);
  assert.equal((html.match(/class="day today(?: |")/g) ?? []).length, 1);
  assert.match(html, new RegExp(`data-date="${today}" class="day today`));
}

test("30-second timer rolls an offline open tab over Berlin midnight", async () => {
  const f = fixture();
  await f.load();
  assertWindow(f, "2026-10-05", "2026-10-03", "2026-10-10");
  f.setNow("2026-10-05T22:00:00Z");
  f.tick(30_000);
  f.pending("weather").forEach(request => request.reject());
  f.tick(300_000);
  f.pending("schedule").forEach(request => request.reject());
  f.pending("certificates").forEach(request => request.reject());
  await flush();
  assertWindow(f, "2026-10-06", "2026-10-04", "2026-10-11");
  assert.match(f.element("#planning").innerHTML, /Noch keine Planungsdaten/);
  assert.match(f.element("#weatherRows").innerHTML, /data-date="2026-10-06" class="weather-row today"/);
});

test("unchanged schedule payload cannot freeze the new calendar day", async () => {
  const f = fixture();
  const oldFeed = f.feed();
  await f.load(oldFeed);
  f.setNow("2026-10-05T22:00:00Z");
  const refresh = f.api.refreshPlanning();
  f.pending("schedule")[0].resolve(oldFeed);
  await flush();
  f.settleWeather();
  await refresh;
  assertWindow(f, "2026-10-06", "2026-10-04", "2026-10-11");
});

for (const [scope, event] of [["window", "focus"], ["window", "pageshow"], ["document", "visibilitychange"]]) {
  test(`${event} resumes a tab after several calendar days`, async () => {
    const f = fixture();
    const oldFeed = f.feed();
    await f.load(oldFeed);
    f.setNow("2026-10-09T10:00:00Z");
    f.dispatch(scope, event);
    assertWindow(f, "2026-10-09", "2026-10-07", "2026-10-14");
    assert.equal(f.pending("schedule").length, 1);
    f.pending("schedule")[0].resolve(oldFeed);
    f.settleWeather();
    await flush();
    assertWindow(f, "2026-10-09", "2026-10-07", "2026-10-14");
  });
}

test("hidden visibility event waits until the document is visible", async () => {
  const f = fixture();
  await f.load();
  f.setNow("2026-10-06T12:00:00Z");
  f.document.hidden = true;
  f.dispatch("document", "visibilitychange");
  assert.equal(f.pending("schedule").length, 0);
  f.document.hidden = false;
  f.dispatch("document", "visibilitychange");
  assertWindow(f, "2026-10-06", "2026-10-04", "2026-10-11");
  f.pending("schedule").forEach(request => request.reject());
  f.settleWeather();
  await flush();
});

test("initial failed fetch leaves retry timers active and recovers", async () => {
  const f = fixture();
  const startup = f.api.start();
  assert.equal(f.intervals.length, 4);
  f.pending("schedule")[0].reject();
  await flush();
  f.settleWeather();
  await flush();
  f.pending("certificates")[0].reject();
  await startup;
  assertWindow(f, "2026-10-05", "2026-10-03", "2026-10-10");
  f.tick(300_000);
  f.pending("schedule")[0].resolve(f.feed(undefined, "Recovered project"));
  f.settleCertificates();
  await flush();
  f.settleWeather();
  await flush();
  assert.match(f.element("#planning").innerHTML, /Recovered project/);
});

test("hung initial fetch cannot block recovery or overwrite a newer response", async () => {
  const f = fixture("2026-10-05T04:00:00Z");
  const staleFeed = f.feed(undefined, "Stale project");
  const startup = f.api.start();
  const originalRequest = f.pending("schedule")[0];
  assert.equal(f.intervals.length, 4);
  f.setNow("2026-10-05T04:05:00Z");
  f.tick(300_000);
  f.pending("schedule").at(-1).resolve(f.feed(undefined, "Current project"));
  f.settleCertificates();
  await flush();
  f.settleWeather();
  await flush();
  assert.match(f.element("#planning").innerHTML, /Current project/);
  originalRequest.resolve(staleFeed);
  await flush();
  f.settleWeather();
  f.settleCertificates();
  await startup;
  assert.match(f.element("#planning").innerHTML, /Current project/);
  assert.doesNotMatch(f.element("#planning").innerHTML, /Stale project/);
});

test("older weather response cannot overwrite aligned post-midnight weather", async () => {
  const f = fixture();
  await f.load();
  const oldRefresh = f.api.refreshWeather();
  const oldRequests = f.pending("weather");
  f.setNow("2026-10-05T22:00:00Z");
  f.tick(30_000);
  f.pending("weather").filter(request => !oldRequests.includes(request)).forEach(request => f.weather(request, 28));
  await flush();
  oldRequests.forEach(request => f.weather(request, 11));
  await oldRefresh;
  const html = f.element("#weatherRows").innerHTML;
  assert.match(html, /28°/);
  assert.doesNotMatch(html, /11°/);
  assert.match(html, /data-date="2026-10-06" class="weather-row today"/);
  assert.match(html, /data-date="2026-10-11"/);
  assert.doesNotMatch(html, /data-date="2026-10-03"/);
});

test("date-only display values use explicit UTC noon", () => {
  const f = fixture();
  assert.equal(f.api.dateValue("2026-01-05").toISOString(), "2026-01-05T12:00:00.000Z");
});
