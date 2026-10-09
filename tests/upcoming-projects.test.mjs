import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { chromium } from "playwright";

// Run the actual collector against a synthetic DOM, never a PlanCraft account.
const source = await readFile(new URL("../scripts/update-plancraft.mjs", import.meta.url), "utf8");
const functionSource = source.slice(source.indexOf("async function readUpcomingProjects("), source.indexOf("\nasync function readPlannedProjectNames("));
const context = vm.createContext({PROJECTS_URL: "https://example.invalid/folders", gotoWithRetry: async () => {}});
vm.runInContext(functionSource, context);
let browser;
before(async () => { browser = await chromium.launch({headless: true}); });
after(async () => { await browser?.close(); });

async function fixture(t, {preselected = false, missing = false, rejectSelection = false} = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(1000);
  await page.setContent(
    '<base href="https://example.invalid/">' +
    '<section role="region" aria-label="Filter">' +
    '<input name="search" placeholder="Suche">' +
    '<button role="combobox" aria-label="Status" aria-expanded="false">Status</button>' +
    '</section>' +
    // Popup is portalled outside the region. The table has the same Status text.
    '<div role="listbox" hidden>' +
    '<div role="option" aria-selected="' + preselected + '">Datum festlegen</div>' +
    (missing ? '' : '<div role="option" aria-selected="false">Terminiert</div>') +
    '</div>' +
    '<table><thead><tr><th><button id="sort">Status</button></th></tr></thead>' +
    '<tbody><tr><td><a href="https://example.invalid/folders/sample">Example project</a></td>' +
    '<td></td><td></td><td>Datum festlegen</td><td>12.10.2026</td></tr></tbody></table>' +
    '<script>' +
    'const combo = document.querySelector("[role=combobox]");' +
    'const list = document.querySelector("[role=listbox]");' +
    'combo.onclick = () => { list.hidden = false; combo.setAttribute("aria-expanded", "true"); };' +
    'combo.onkeydown = event => { if(event.key === "Escape") { list.hidden = true; combo.setAttribute("aria-expanded", "false"); } };' +
    'document.querySelector("#sort").onclick = () => document.body.dataset.sorted = "true";' +
    'for(const option of list.children) option.onclick = () => {' +
    (rejectSelection ? '' : 'option.setAttribute("aria-selected", option.getAttribute("aria-selected") === "true" ? "false" : "true");') +
    '};</script>'
  );
  return page;
}

test("upcoming-project filter uses listbox options, not the table Status button or row text", async t => {
  const page = await fixture(t);
  const result = await context.readUpcomingProjects(page);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{name: "Example project", endDate: "2026-10-12"}]);
  assert.equal(await page.locator("body").getAttribute("data-sorted"), null);
  assert.deepEqual(await page.getByRole("option", {includeHidden: true}).evaluateAll(options => options.map(option => option.getAttribute("aria-selected"))), ["true", "true"]);
  assert.equal(await page.getByRole("combobox", {name: "Status", exact: true}).getAttribute("aria-expanded"), "false");
});

test("an already selected target status is not toggled off", async t => {
  const page = await fixture(t, {preselected: true});
  await context.readUpcomingProjects(page);
  assert.deepEqual(await page.getByRole("option", {includeHidden: true}).evaluateAll(options => options.map(option => option.getAttribute("aria-selected"))), ["true", "true"]);
});

test("a missing status option rejects collection instead of returning unfiltered projects", async t => {
  const page = await fixture(t, {missing: true});
  await assert.rejects(context.readUpcomingProjects(page), /Terminiert/);
});

test("a click that does not select the status rejects collection", async t => {
  const page = await fixture(t, {rejectSelection: true});
  await assert.rejects(context.readUpcomingProjects(page), /Datum festlegen/);
});
