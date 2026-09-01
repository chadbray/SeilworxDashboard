# Seilworx Team Dashboard

Public, German-language TV dashboard for the SG Seilworx team. GitHub Actions signs in to PlanCraft with Playwright, reads today plus the following seven days, and publishes the static dashboard to GitHub Pages. It shows projects only when at least one employee is assigned and also shows the PlanCraft absence types **Krank**, **Urlaub**, and **Unbezahlter Urlaub**.

Scheduled runs generate the current employee assignments inside the deployment artifact. They do **not** create new planning-data commits in this public repository.

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

## Manual update and troubleshooting

- Run now: **Actions → Update and publish dashboard → Run workflow**
- Logs: open the latest run under **Actions**, then open the failed job and step.
- Pause: use **Actions → Update and publish dashboard → … → Disable workflow**.
- Resume: use **Enable workflow** and run it once manually.
- Change the password: update only the `PLANCRAFT_PASSWORD` repository secret.

PlanCraft may change its page structure. If a run reports that the planner structure was not recognized, the selectors in `scripts/update-plancraft.mjs` need a maintenance update.
