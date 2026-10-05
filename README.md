# Seilworx Team Dashboard

Public, German-language TV dashboard for the SG Seilworx team. GitHub Actions signs in to PlanCraft with Playwright, reads the two previous days, today, and the following five days, and publishes the static dashboard to GitHub Pages. It shows projects only when at least one employee is assigned and also shows the PlanCraft absence types **Krank**, **Urlaub**, and **Unbezahlter Urlaub**.

The TV display rotates automatically between the planning view (three minutes) and **Schulungen & Termine** (two minutes). The second view sorts employees by their earliest known climbing, medical, or first-aid expiry and separates booked appointments from items that are not yet booked.

Scheduled runs generate the current employee assignments inside the deployment artifact. They do **not** create new planning-data commits in this public repository.

The **Noch nicht eingeplant** list shows active projects in PlanCraft's **Datum festlegen** or **Terminiert** status only while their scheduled end date has not passed and no employee allocation appears in the planner. It excludes projects already shown in the dashboard calendar and checks future planner dates through the latest listed project date (at least 30 days ahead).

## One-time setup

### 1. Add the two PlanCraft secrets

Open **Settings → Secrets and variables → Actions → New repository secret** and create:

| Name | Value |
|---|---|
| `PLANCRAFT_EMAIL` | The normal email address used to sign in to PlanCraft |
| `PLANCRAFT_PASSWORD` | The PlanCraft password |

Never put the password into a repository file, issue, commit, or chat.

### 2. Enable GitHub Pages

Open **Settings → Pages** and set **Source** to **GitHub Actions**.

### 3. Run the first update

Open **Actions → Update and publish dashboard → Run workflow → Run workflow**. When the green check appears, the site will be available at:

`https://chadbray.github.io/SeilworxDashboard/`

## Automatic updates

The workflow runs hourly from 05:00 through 17:00, Monday–Friday, in `Europe/Berlin`, including daylight-saving-time changes. A failed login or invalid planner response stops the deployment, leaving the last working dashboard online.

The displayed eight calendar dates always follow the current date in `Europe/Berlin`: two previous days, today, and five following days, including weekends. The browser checks for a date change every 30 seconds and immediately when the tab is shown or the window regains focus. This rollover does not depend on a successful data refresh. Dates absent from the last published snapshot are marked **Noch keine Planungsdaten**, never as unassigned days. Both the display and the collector use calendar-date arithmetic so DST and month/year boundaries preserve eight distinct dates.

An open dashboard checks for newly published planning data every five minutes and updates without a manual browser refresh. It also performs one protected full-page reload at 04:55 Europe/Berlin each day so a permanently open TV browser picks up new site assets.

## Manual update and troubleshooting

- Run now: **Actions → Update and publish dashboard → Run workflow**
- Logs: open the latest run under **Actions**, then open the failed job and step.
- Retry a publishing failure: choose **Re-run failed jobs**. The separate publish job reuses the successful build artifact without collecting PlanCraft again or uploading a duplicate. If all jobs are rerun, the build uses a new attempt-specific artifact name; publishing receives that exact name from the build output.
- Pause: use **Actions → Update and publish dashboard → … → Disable workflow**.
- Resume: use **Enable workflow** and run it once manually.
- Change the password: update only the `PLANCRAFT_PASSWORD` repository secret.

PlanCraft may change its page structure. If a run reports that the planner structure was not recognized, the selectors in `scripts/update-plancraft.mjs` need a maintenance update.

## Local verification

Run `npm run check` for JavaScript syntax and the date-window/collector-navigation regression tests. It does not log in to PlanCraft or change planning data.

## Manual course appointments

Maintain course appointments in `public/certificates.json`; scheduled PlanCraft refreshes only replace `schedule.json` in the deployment artifact. Page two (`#certificates`) shows all future or ongoing booked appointments and dated entries with `status: "pending"` and `booked: false`, without a near-term limit. A `displayLabel` overrides the visible course wording without changing stored booking data or status. Otherwise, pending registrations are labeled **unbestätigt** beside the course. All rows use the same compact person/course and date-badge layout. Multi-day courses show their inclusive date range; additional scheduling details remain in the source data without being shown in the appointment list. This list is independent of the eight-day work-planning view.
