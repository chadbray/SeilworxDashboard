import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (await readFile(new URL("../public/app.js", import.meta.url), "utf8"))
  .replace(/^import[^\n]*\n/, "")
  .split("\nstart().catch")[0];
const data = JSON.parse(await readFile(new URL("../public/certificates.json", import.meta.url), "utf8"));
const names = ["Felix Duchemin", "Matias Alejandro Carvalho"];

function render(today, appointments = data.appointments) {
  const elements = new Map();
  const context = vm.createContext({
    Date, Intl, BERLIN: "Europe/Berlin", berlinToday: () => today,
    document: {querySelector: selector => {
      if (!elements.has(selector)) elements.set(selector, {innerHTML: "", textContent: ""});
      return elements.get(selector);
    }}
  });
  vm.runInContext(source + "\nthis.renderCertificates=renderCertificates;", context);
  context.renderCertificates({...data, appointments});
  return elements.get("#appointmentRows").innerHTML;
}

test("both KSK registrations contain all six days and the Berlin daily schedule", () => {
  const courses = data.appointments.filter(item => item.type === "KSK FISAT Level 3");
  assert.equal(courses.length, 2);
  assert.deepEqual(courses.map(item => item.name).sort(), names);
  for (const course of courses) {
    assert.equal(course.booked, false);
    assert.equal(course.status, "pending");
    assert.equal(course.date, "2027-04-02");
    assert.equal(course.endDate, "2027-04-07");
    assert.equal(course.time, "täglich 09:00–17:00 Uhr");
    assert.equal(course.timeZone, "Europe/Berlin");
    assert.equal(course.location, "KSK Ausbildungscenter, Grüner Brunnenweg 182, 50827 Köln");
    assert.equal(course.note, "Inklusive Samstag und Sonntag");
  }
});

test("future courses are visible now without hiding existing booked appointments", () => {
  const html = render("2026-10-05");
  for (const name of names) assert.ok(html.includes(name));
  assert.equal((html.match(/class="appointment booked"/g) ?? []).length, 4);
  assert.equal((html.match(/ · unbestätigt/g) ?? []).length, 2);
  assert.ok(html.includes("06.10.2026 · 08:30–16:30 Uhr"));
  for (const detail of ["KSK Ausbildungscenter", "Grüner Brunnenweg", "09:00–17:00", "Europe/Berlin", "Samstag und Sonntag", " detailed"]) assert.ok(!html.includes(detail));
  assert.equal((html.match(/<em>02\.04\.–07\.04\.2027<\/em>/g) ?? []).length, 2);
});

test("courses remain visible across the weekend and through their inclusive end date", () => {
  for (const day of ["2027-04-02", "2027-04-03", "2027-04-04", "2027-04-07"]) {
    const html = render(day);
    for (const name of names) assert.ok(html.includes(name));
  }
  const ended = render("2027-04-08");
  for (const name of names) assert.ok(!ended.includes(name));
});

test("undated unbooked needs stay hidden while booked entries without a date remain visible", () => {
  const html = render("2026-10-05", [
    {name: "Undated need", type: "Course", booked: false, date: null},
    {name: "Undated pending", type: "Course", booked: false, status: "pending", date: null},
    {name: "Booked without date", type: "Course", booked: true, date: null}
  ]);
  assert.ok(!html.includes("Undated need"));
  assert.ok(!html.includes("Undated pending"));
  assert.ok(html.includes("Booked without date"));
});

test("compact appointment names and courses escape markup", () => {
  const html = render("2026-10-05", [{
    name: "<participant>", type: "<course>", booked: false, status: "pending",
    date: "2027-04-02", location: "<address>", note: "<note>"
  }]);
  for (const value of ["participant", "course"]) {
    assert.ok(html.includes("&lt;" + value + "&gt;"));
    assert.ok(!html.includes("<" + value + ">"));
  }
});
