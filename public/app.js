const BERLIN = "Europe/Berlin";
const PLANNING_REFRESH_MS = 5 * 60 * 1000;
const CERTIFICATE_REFRESH_MS = 5 * 60 * 1000;
const WEATHER_REFRESH_MS = 3 * 60 * 60 * 1000;
const SCREEN_DURATIONS = [3 * 60 * 1000, 2 * 60 * 1000];
const WEATHER_FIELDS = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max";

const planning = document.querySelector("#planning");
const weatherRows = document.querySelector("#weatherRows");
let schedule = null;
let certificateData = null;
let currentScreen = 0;
let rotationTimer = null;

const dateValue = (iso) => new Date(`${iso}T12:00:00`);
const fmt = (iso, options) => new Intl.DateTimeFormat("de-DE", {...options, timeZone:BERLIN}).format(dateValue(iso));
const initials = (name) => name.replace(/\([^)]*\)/g, "").split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join("");
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const icon = (code) => code===0?"☀":code<=3?"☁":code<=48?"≋":code<=67?"🌧":code<=77?"❄":code<=82?"🌦":"⛈";
const certificateDate = iso => iso ? new Date(`${iso}T12:00:00`) : null;
const certificateFmt = iso => iso ? new Intl.DateTimeFormat("de-DE",{timeZone:BERLIN,day:"2-digit",month:"2-digit",year:"numeric"}).format(certificateDate(iso)) : "Nicht hinterlegt";
const berlinToday = () => new Intl.DateTimeFormat("en-CA",{timeZone:BERLIN,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const certificateCutoff = () => {
  const cutoff=certificateDate(berlinToday());
  cutoff.setMonth(cutoff.getMonth()+6);
  return cutoff;
};
const expiresWithinSixMonths = iso => iso && certificateDate(iso)<=certificateCutoff();

function renderSchedule(data){
  schedule=data;
  const nowDate = new Intl.DateTimeFormat("en-CA",{timeZone:BERLIN,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const first=data.days[0]?.date, last=data.days.at(-1)?.date;
  document.querySelector("#dateRange").textContent = first && last ? `${fmt(first,{day:"numeric",month:"long"})} – ${fmt(last,{day:"numeric",month:"long",year:"numeric"})}` : "Keine Planungsdaten";
  const checked=new Date(data.checkedAt);
  document.querySelector("#checkedAt").textContent=`↻ Planung zuletzt geprüft: ${new Intl.DateTimeFormat("de-DE",{timeZone:BERLIN,day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(checked)} Uhr`;
  planning.innerHTML=data.days.map(day=>{
    const weekend=[0,6].includes(dateValue(day.date).getDay());
    const today=day.date===nowDate;
    const assignedProjects=day.projects.filter(project=>Array.isArray(project.team)&&project.team.length>0);
    const absences=(Array.isArray(day.absences)?day.absences:[]).filter(status=>Array.isArray(status.team)&&status.team.length>0);
    const projectCards=assignedProjects.map(project=>`<section class="project"><h2>${escapeHtml(project.name)}</h2><div class="people">${project.team.map(person=>`<div class="person"><span class="avatar">${escapeHtml(initials(person))}</span><span>${escapeHtml(person)}</span></div>`).join("")}</div></section>`).join("");
    const absenceCards=absences.map(status=>`<section class="project absence absence-${escapeHtml(status.type)}"><h2>${status.type==="sick"?"🤒":status.type==="holiday"?"🌴":"🌵"} ${escapeHtml(status.label)}</h2><div class="people">${status.team.map(person=>`<div class="person"><span class="avatar">${escapeHtml(initials(person))}</span><span>${escapeHtml(person)}</span></div>`).join("")}</div></section>`).join("");
    const cards=projectCards||absenceCards?`${projectCards}${absenceCards}`:`<div class="empty"><div><strong>${weekend?"Wochenende":"Keine Einsätze"}</strong><span>Keine Mitarbeiter eingeteilt</span></div></div>`;
    return `<article class="day${today?" today":""}${weekend?" weekend":""}"><header class="day-head"><small>${fmt(day.date,{weekday:"long"})}${today?'<span class="today-pill">Heute</span>':""}</small><strong>${fmt(day.date,{day:"2-digit",month:"short"})}</strong></header><div class="projects">${cards}</div></article>`;
  }).join("");
  renderWeatherLoading();
}

function renderWeatherLoading(){
  if(!schedule)return;
  weatherRows.innerHTML=schedule.days.map((d,i)=>`<div class="weather-row${i===0?" today":""}"><div class="loading">Wird geladen …</div></div>`).join("");
}

const finite=(...values)=>values.find(v=>typeof v==="number"&&Number.isFinite(v))??0;
async function weatherJson(endpoint){
  const url=new URL(endpoint);
  url.search=new URLSearchParams({latitude:"50.7753",longitude:"6.0839",daily:WEATHER_FIELDS,timezone:BERLIN,forecast_days:"8",wind_speed_unit:"kmh"});
  const response=await fetch(url,{cache:"no-store"});
  if(!response.ok)throw new Error("Wetter nicht verfügbar");
  return response.json();
}

async function refreshWeather(){
  if(!schedule)return;
  try{
    const [dwdResult,ecmwfResult]=await Promise.allSettled([weatherJson("https://api.open-meteo.com/v1/dwd-icon"),weatherJson("https://api.open-meteo.com/v1/ecmwf")]);
    const primary=dwdResult.status==="fulfilled"?dwdResult.value:await weatherJson("https://api.open-meteo.com/v1/forecast");
    const alternate=ecmwfResult.status==="fulfilled"?ecmwfResult.value:null;
    const altIndex=new Map((alternate?.daily?.time??[]).map((d,i)=>[d,i]));
    const byDate=new Map(primary.daily.time.map((date,i)=>{
      const ai=altIndex.get(date); const a=alternate?.daily;
      return [date,{code:finite(primary.daily.weather_code[i],a?.weather_code?.[ai],3),max:finite(primary.daily.temperature_2m_max[i],a?.temperature_2m_max?.[ai]),min:finite(primary.daily.temperature_2m_min[i],a?.temperature_2m_min?.[ai]),rain:finite(primary.daily.precipitation_sum[i],a?.precipitation_sum?.[ai]),chance:finite(primary.daily.precipitation_probability_max[i],a?.precipitation_probability_max?.[ai]),wind:finite(primary.daily.wind_speed_10m_max[i],a?.wind_speed_10m_max?.[ai]),gust:finite(primary.daily.wind_gusts_10m_max[i],a?.wind_gusts_10m_max?.[ai])}];
    }));
    weatherRows.innerHTML=schedule.days.map((day,i)=>{
      const w=byDate.get(day.date);
      if(!w)return `<div class="weather-row${i===0?" today":""}"><div class="loading">Nicht verfügbar</div></div>`;
      return `<div class="weather-row${i===0?" today":""}"><div class="weather-top"><span class="weather-date">${fmt(day.date,{weekday:"short",day:"2-digit",month:"2-digit"})}</span><span><span class="weather-icon">${icon(w.code)}</span> <span class="temps">${Math.round(w.max)}°<em>/${Math.round(w.min)}°</em></span></span></div><div class="weather-bottom"><span>🌧 <strong>${Math.round(w.chance)}%</strong> ${w.rain.toFixed(1)} mm</span><span>💨 <strong>${Math.round(w.wind)}/${Math.round(w.gust)}</strong></span></div></div>`;
    }).join("");
    document.querySelector("#weatherTime").textContent=`Wetterstand: ${new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit",timeZone:BERLIN}).format(new Date())} Uhr · automatisch alle 3 Stunden`;
  }catch(error){
    weatherRows.innerHTML=schedule.days.map((d,i)=>`<div class="weather-row${i===0?" today":""}"><div class="loading">Nicht verfügbar</div></div>`).join("");
    document.querySelector("#weatherTime").textContent="Wetter derzeit nicht verfügbar";
  }
}

async function start(){
  currentScreen=window.location.hash==="#certificates"?1:0;
  showScreen(currentScreen);
  document.querySelectorAll("[data-screen-target]").forEach(button=>button.addEventListener("click",()=>{
    showScreen(Number(button.dataset.screenTarget),{updateHash:true});
    scheduleNextScreen();
  }));
  window.addEventListener("hashchange",()=>{
    showScreen(window.location.hash==="#certificates"?1:0);
    scheduleNextScreen();
  });
  await refreshPlanning();
  await refreshCertificates().catch(error=>{document.querySelector("#certificateRows").innerHTML=`<div class="certificate-error">${escapeHtml(error.message)}</div>`;});
  window.setInterval(()=>refreshPlanning().catch(()=>{}),PLANNING_REFRESH_MS);
  window.setInterval(()=>refreshCertificates().catch(()=>{}),CERTIFICATE_REFRESH_MS);
  window.setInterval(refreshWeather,WEATHER_REFRESH_MS);
  window.setInterval(reloadBeforeFirstUpdate,30*1000);
  reloadBeforeFirstUpdate();
  scheduleNextScreen();
}

async function refreshPlanning(){
  const response=await fetch(`schedule.json?t=${Date.now()}`,{cache:"no-store"});
  if(!response.ok)throw new Error("Planungsdaten konnten nicht geladen werden");
  const data=await response.json();
  if(!Array.isArray(data.days)||data.days.length!==8)throw new Error("Ungültige Planungsdaten");
  if(!schedule||data.checkedAt!==schedule.checkedAt||JSON.stringify(data.days)!==JSON.stringify(schedule.days)){
    renderSchedule(data);
    await refreshWeather();
  }
}

function reloadBeforeFirstUpdate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:BERLIN,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const value=type=>parts.find(part=>part.type===type)?.value;
  const date=`${value("year")}-${value("month")}-${value("day")}`;
  if(value("hour")==="04"&&value("minute")==="55"&&sessionStorage.getItem("dailyReloadDate")!==date){
    sessionStorage.setItem("dailyReloadDate",date);
    window.location.reload();
  }
}

async function refreshCertificates(){
  const response=await fetch(`certificates.json?t=${Date.now()}`,{cache:"no-store"});
  if(!response.ok)throw new Error("Zertifikatsdaten konnten nicht geladen werden");
  const data=await response.json();
  if(!Array.isArray(data.employees)||!Array.isArray(data.appointments))throw new Error("Ungültige Zertifikatsdaten");
  if(!certificateData||JSON.stringify(data)!==JSON.stringify(certificateData))renderCertificates(data);
}

function certificateStatus(iso){
  if(!iso)return {className:"missing",label:"Nicht hinterlegt",sort:Infinity};
  const days=Math.round((certificateDate(iso)-certificateDate(berlinToday()))/86400000);
  if(days<0)return {className:"expired",label:`Abgelaufen · ${certificateFmt(iso)}`,sort:certificateDate(iso).getTime()};
  if(days<=30)return {className:"urgent",label:`${certificateFmt(iso)} · ${days} Tage`,sort:certificateDate(iso).getTime()};
  if(days<=90)return {className:"soon",label:`${certificateFmt(iso)} · ${days} Tage`,sort:certificateDate(iso).getTime()};
  return {className:"valid",label:certificateFmt(iso),sort:certificateDate(iso).getTime()};
}

function renderCertificates(data){
  certificateData=data;
  document.querySelector("#certificateChecked").textContent=`Stand: ${new Intl.DateTimeFormat("de-DE",{timeZone:BERLIN,day:"2-digit",month:"2-digit",year:"numeric"}).format(certificateDate(data.asOf))}`;
  const employees=data.employees.map(employee=>{
    const states={climbing:certificateStatus(employee.climbing),medical:certificateStatus(employee.medical),firstAid:certificateStatus(employee.firstAid)};
    return {...employee,states,sort:states.climbing.sort};
  }).filter(employee=>expiresWithinSixMonths(employee.climbing)).sort((a,b)=>a.sort-b.sort||a.name.localeCompare(b.name,"de"));
  document.querySelector("#certificateRows").innerHTML=employees.length?employees.map(employee=>`<div class="certificate-row"><strong>${escapeHtml(employee.name)}</strong><span class="certificate-cell ${employee.states.climbing.className}">${escapeHtml(employee.states.climbing.label)}</span><span class="certificate-cell reference">${escapeHtml(certificateFmt(employee.medical))}</span><span class="certificate-cell reference">${escapeHtml(certificateFmt(employee.firstAid))}</span></div>`).join(""):`<div class="certificate-error">Keine Kletterzertifikate laufen in den nächsten sechs Monaten ab</div>`;
  const appointments=data.appointments.filter(item=>item.booked).sort((a,b)=>(a.date??"9999-12-31").localeCompare(b.date??"9999-12-31")||a.name.localeCompare(b.name,"de"));
  document.querySelector("#appointmentRows").innerHTML=appointments.map(item=>`<div class="appointment ${item.booked?"booked":"open"}"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.type)}</span></div><em>${item.booked?item.date?certificateFmt(item.date):"Gebucht · Datum fehlt":"Noch nicht gebucht"}</em></div>`).join("");
}

function showScreen(index,{updateHash=false}={}){
  currentScreen=index;
  [...document.querySelectorAll(".screen")].forEach((screen,screenIndex)=>{
    screen.classList.toggle("active",screenIndex===currentScreen);
    screen.setAttribute("aria-hidden",String(screenIndex!==currentScreen));
  });
  [...document.querySelectorAll("[data-screen-target]")].forEach((button,buttonIndex)=>{
    button.classList.toggle("active",buttonIndex===currentScreen);
    button.setAttribute("aria-current",buttonIndex===currentScreen?"page":"false");
  });
  document.querySelector("#viewTitle").textContent=currentScreen===0?"Einsatzplanung · Aachen":"Schulungen & Termine";
  if(updateHash){
    const hash=currentScreen===1?"#certificates":"#planning";
    history.replaceState(null,"",hash);
  }
}

function scheduleNextScreen(){
  window.clearTimeout(rotationTimer);
  rotationTimer=window.setTimeout(()=>{
    showScreen((currentScreen+1)%2,{updateHash:true});
    scheduleNextScreen();
  },SCREEN_DURATIONS[currentScreen]);
}

start().catch(error=>{planning.innerHTML=`<div class="empty"><strong>${escapeHtml(error.message)}</strong></div>`;});
