const BERLIN = "Europe/Berlin";
const WEATHER_REFRESH_MS = 3 * 60 * 60 * 1000;
const WEATHER_FIELDS = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max";

const planning = document.querySelector("#planning");
const weatherRows = document.querySelector("#weatherRows");
let schedule = null;

const dateValue = (iso) => new Date(`${iso}T12:00:00`);
const fmt = (iso, options) => new Intl.DateTimeFormat("de-DE", {...options, timeZone:BERLIN}).format(dateValue(iso));
const initials = (name) => name.replace(/\([^)]*\)/g, "").split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join("");
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const icon = (code) => code===0?"☀":code<=3?"☁":code<=48?"≋":code<=67?"🌧":code<=77?"❄":code<=82?"🌦":"⛈";

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
    const cards=day.projects.length?day.projects.map(project=>`<section class="project"><h2>${escapeHtml(project.name)}</h2><div class="people">${project.team.map(person=>`<div class="person"><span class="avatar">${escapeHtml(initials(person))}</span><span>${escapeHtml(person)}</span></div>`).join("")}</div></section>`).join(""):`<div class="empty"><div><strong>${weekend?"Wochenende":"Keine Einsätze"}</strong><span>Keine Projekte eingeteilt</span></div></div>`;
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
  const response=await fetch(`schedule.json?t=${Date.now()}`,{cache:"no-store"});
  if(!response.ok)throw new Error("Planungsdaten konnten nicht geladen werden");
  const data=await response.json();
  if(!Array.isArray(data.days)||data.days.length!==8)throw new Error("Ungültige Planungsdaten");
  renderSchedule(data); await refreshWeather(); window.setInterval(refreshWeather,WEATHER_REFRESH_MS);
}

start().catch(error=>{planning.innerHTML=`<div class="empty"><strong>${escapeHtml(error.message)}</strong></div>`;});
