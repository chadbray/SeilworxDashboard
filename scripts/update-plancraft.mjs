import { chromium } from "playwright";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMAIL=process.env.PLANCRAFT_EMAIL;
const PASSWORD=process.env.PLANCRAFT_PASSWORD;
const PLANNER_URL=process.env.PLANCRAFT_PLANNER_URL || "https://plancraft.com/app/zqAGTaKY2nys/planner";
const OUTPUT=path.resolve("public/schedule.json");

if(!EMAIL||!PASSWORD){
  console.error("PLANCRAFT_EMAIL and PLANCRAFT_PASSWORD are required.");
  process.exit(1);
}

function berlinDate(offset=0){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(Date.now()+offset*86400000));
  const get=t=>parts.find(p=>p.type===t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function clean(value){return String(value??"").replace(/\s+/g," ").trim();}
async function gotoWithRetry(page,url){
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
      return;
    }catch(error){
      lastError=error;
      // PlanCraft occasionally replaces the initial app navigation while it
      // redirects to its login shell. Chromium reports that as ERR_ABORTED
      // even though the replacement page is already loading normally.
      if(/ERR_ABORTED/.test(error.message)&&page.url()!=="about:blank"){
        await page.waitForLoadState("domcontentloaded",{timeout:15000}).catch(()=>{});
        return;
      }
      if(attempt<3)await page.waitForTimeout(1500*attempt);
    }
  }
  throw lastError;
}
function validate(data){
  if(!data||!Array.isArray(data.days)||data.days.length!==8)throw new Error("Expected exactly eight planning days.");
  for(const day of data.days){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Array.isArray(day.projects)||!Array.isArray(day.absences))throw new Error("Invalid planning response.");
    for(const project of day.projects)if(!project.name||!Array.isArray(project.team)||project.team.length<1)throw new Error("A project is missing its name or assigned team.");
    for(const absence of day.absences)if(!["sick","holiday","unpaid-holiday"].includes(absence.type)||!absence.label||!Array.isArray(absence.team)||absence.team.length<1)throw new Error("An absence is missing its type, label, or employees.");
  }
}

async function login(page){
  await gotoWithRetry(page,PLANNER_URL);
  const password=page.locator('input[type="password"], input[name="password"]').first();
  const planner=page.locator('.fc-timeline-slot, [data-date], .fc-event').first();
  await password.or(planner).waitFor({state:"visible",timeout:30000});
  if(await password.isVisible()){
    const email=page.locator('input[type="email"], input[name="email"], input[autocomplete="username"]').first();
    await email.waitFor({state:"visible",timeout:15000});
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    await page.getByRole("button",{name:/anmelden|einloggen|log in|sign in/i}).first().click();
    await page.waitForURL(url=>!url.pathname.includes("/login"),{timeout:30000}).catch(()=>{});
  }
  await gotoWithRetry(page,PLANNER_URL);
  if(await page.locator('input[type="password"], input[name="password"]').first().isVisible({timeout:10000}).catch(()=>false))throw new Error("PlanCraft rejected the login. Check the GitHub Secrets.");
}

async function openPlanner(page){
  const todayButton=page.getByRole("button",{name:/heute|today/i}).first();
  if(await todayButton.isVisible({timeout:5000}).catch(()=>false))await todayButton.click();
  await page.waitForSelector('.fc-timeline-slot, [data-date], .fc-event',{timeout:30000});
  await page.waitForTimeout(2500);
}

async function readBoard(page){
  return page.evaluate(({wantedDates})=>{
    const clean=v=>String(v??"").replace(/\s+/g," ").trim();
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const dates=[...document.querySelectorAll('.fc-timeline-slot[data-date], .fc-col-header-cell[data-date], [role="columnheader"][data-date]')].map(el=>({date:el.getAttribute("data-date")?.slice(0,10),...rect(el)})).filter(x=>wantedDates.includes(x.date)&&x.width>1);
    if(!dates.length){
      for(const el of document.querySelectorAll('.fc-timeline-slot-cushion[aria-label]')){
        const parent=el.closest('[data-date]'); const date=parent?.getAttribute("data-date")?.slice(0,10);
        if(date&&wantedDates.includes(date))dates.push({date,...rect(parent)});
      }
    }
    const uniqueDates=[...new Map(dates.map(d=>[d.date,d])).values()];
    const resources=[...document.querySelectorAll('.fc-datagrid-cell.fc-resource')].filter(el=>el.querySelector('[data-testid^="resource-member-"]')).map(el=>({id:el.getAttribute("data-resource-id"),name:clean(el.querySelector('.fc-datagrid-cell-main')?.textContent||el.textContent),...rect(el)})).filter(x=>x.id&&x.name&&x.height>3);
    const events=[...document.querySelectorAll('a.fc-event.allocation')].map(el=>({name:clean(el.querySelector('.fc-event-title,.fc-event-main-frame,.fc-event-main')?.textContent||el.getAttribute("aria-label")||el.textContent),resourceId:el.closest('[data-resource-id]')?.getAttribute('data-resource-id'),...rect(el)})).filter(x=>x.name&&x.width>1&&x.height>1);
    const absenceTypes={"🤒":{type:"sick",label:"Krank"},"🌴":{type:"holiday",label:"Urlaub"},"🌵":{type:"unpaid-holiday",label:"Unbezahlter Urlaub"}};
    const absences=[...document.querySelectorAll('a.fc-event.time-entry')].map(el=>{
      const marker=clean(el.textContent);
      return absenceTypes[marker]?{...absenceTypes[marker],resourceId:el.closest('[data-resource-id]')?.getAttribute('data-resource-id'),...rect(el)}:null;
    }).filter(x=>x&&x.width>1&&x.height>1);
    return {dates:uniqueDates,resources,events,absences};
  },{wantedDates:Array.from({length:8},(_,i)=>berlinDate(i))});
}

function assemble(raw){
  const days=Array.from({length:8},(_,i)=>({date:berlinDate(i),projects:[],absences:[]}));
  const projectMaps=new Map(days.map(d=>[d.date,new Map()]));
  const absenceMaps=new Map(days.map(d=>[d.date,new Map()]));
  for(const event of raw.events){
    const employee=raw.resources.find(r=>r.id===event.resourceId)?.name||raw.resources.filter(r=>Math.min(r.bottom,event.bottom)-Math.max(r.top,event.top)>2).sort((a,b)=>Math.abs((a.top+a.bottom-event.top-event.bottom)) - Math.abs((b.top+b.bottom-event.top-event.bottom)))[0]?.name;
    if(!employee)continue;
    for(const date of raw.dates){
      const overlap=Math.min(date.right,event.right)-Math.max(date.left,event.left);
      if(overlap<=2)continue;
      const projectName=clean(event.name).replace(/^\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\s*/,"");
      if(!projectName)continue;
      const projects=projectMaps.get(date.date); if(!projects)continue;
      if(!projects.has(projectName))projects.set(projectName,new Set());
      projects.get(projectName).add(employee);
    }
  }
  for(const absence of raw.absences){
    const employee=raw.resources.find(r=>r.id===absence.resourceId)?.name;
    if(!employee)continue;
    for(const date of raw.dates){
      const overlap=Math.min(date.right,absence.right)-Math.max(date.left,absence.left);
      if(overlap<=2)continue;
      const statuses=absenceMaps.get(date.date); if(!statuses)continue;
      if(!statuses.has(absence.type))statuses.set(absence.type,{type:absence.type,label:absence.label,team:new Set()});
      statuses.get(absence.type).team.add(employee);
    }
  }
  for(const day of days){
    day.projects=[...projectMaps.get(day.date)].map(([name,team])=>({name,team:[...team].sort((a,b)=>a.localeCompare(b,"de"))})).sort((a,b)=>a.name.localeCompare(b.name,"de"));
    day.absences=[...absenceMaps.get(day.date).values()].map(status=>({...status,team:[...status.team].sort((a,b)=>a.localeCompare(b,"de"))})).sort((a,b)=>["sick","holiday","unpaid-holiday"].indexOf(a.type)-["sick","holiday","unpaid-holiday"].indexOf(b.type));
  }
  return {checkedAt:new Date().toISOString(),days};
}

const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:2800,height:1800},locale:"de-DE",timezoneId:"Europe/Berlin"});
  await login(page); await openPlanner(page);
  const raw=await readBoard(page);
  if(raw.dates.length<1||raw.resources.length<1)throw new Error(`Planner structure was not recognized (${raw.dates.length} dates, ${raw.resources.length} employees).`);
  const data=assemble(raw); validate(data);
  await mkdir(path.dirname(OUTPUT),{recursive:true});
  const temp=`${OUTPUT}.tmp`;
  await writeFile(temp,`${JSON.stringify(data,null,2)}\n`,{encoding:"utf8",mode:0o600});
  await rename(temp,OUTPUT);
  console.log(`Planning updated successfully: ${data.days.length} days, ${data.days.reduce((n,d)=>n+d.projects.length,0)} projects, ${data.days.reduce((n,d)=>n+d.absences.reduce((total,status)=>total+status.team.length,0),0)} absence entries.`);
}catch(error){
  console.error(`Planning update failed: ${error.message}`);
  process.exitCode=1;
}finally{await browser.close();}
