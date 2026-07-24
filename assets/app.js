const PREVIEW_DATA={editionLabel:'Awaiting first published edition',cutoffLabel:'No successful Sunday snapshot yet',updatedLabel:'Waiting for stats.fm update',sourceStatus:'Repository ready',isPreview:true,charts:{songs:{week:{items:[]},month:{items:[]},year:{items:[]},allTime:{items:[]},custom:{items:[]}},artists:{week:{items:[]},month:{items:[]},year:{items:[]},allTime:{items:[]},custom:{items:[]}},albums:{week:{items:[]},month:{items:[]},year:{items:[]},allTime:{items:[]},custom:{items:[]}}}};

const API='https://api.stats.fm/api/v1';
const STATS_USER='31c4puiblaxm3wzzwg3hfc7t75yq';
const CUSTOM_MIN='2020-11-01';
const accents=['#caff4b','#708cff','#bb73ff','#ffd16f','#ff7189'];
const playlists=[
  {name:'On Repeat',id:'37i9dQZF1EpnTClO2dDlBN',url:'https://open.spotify.com/playlist/37i9dQZF1EpnTClO2dDlBN?si=7b2193162a804969'},
  {name:'P1',id:'44rjeQwL3zcZJY4h1RWxGv',url:'https://open.spotify.com/playlist/44rjeQwL3zcZJY4h1RWxGv?si=73e2dad69e124960&pt=139c8cb31efc0ec19d7ebda26e39d79f'},
  {name:'720S',id:'7u6vXVHXiZXY64MGiWPLgd',url:'https://open.spotify.com/playlist/7u6vXVHXiZXY64MGiWPLgd?si=d64caeeb69d64ef0&pt=77d60c2d1e4974100cb1d76ed9c6face'},
  {name:'Repeat Rewind',id:'37i9dQZF1EpPWup4plZPDb',url:'https://open.spotify.com/playlist/37i9dQZF1EpPWup4plZPDb?si=2b328c1d3d1c4283'}
];
const categoryMap={
  songs:{endpoint:'tracks',key:'track'},
  artists:{endpoint:'artists',key:'artist'},
  albums:{endpoint:'albums',key:'album'}
};

let data=null;
let state={category:'songs',period:'week',playlist:0,customStart:'',customEnd:'',customLoading:false};
const customCache=new Map();
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>n==null?'—':new Intl.NumberFormat('en-US').format(Math.round(n));
const mins=ms=>{
  if(ms==null)return'—';
  const m=Math.round(ms/60000);
  return m>=60?Math.floor(m/60)+'h '+m%60+'m':m+'m'
};
const initials=s=>String(s||'?').split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();

function labelCategory(c){return c==='songs'?'SONGS':c==='artists'?'ARTISTS':'ALBUMS'}
function labelPeriod(p){return p==='week'?'THIS WEEK':p==='month'?'THIS MONTH':p==='year'?'THIS YEAR':p==='custom'?'CUSTOM RANGE':'ALL TIME'}

function movement(x){
  if(x.previousRank==null)return '<span class="move new">NEW</span>';
  const d=x.previousRank-x.rank;
  if(d>0)return `<span class="move up">▲ ${d}</span>`;
  if(d<0)return `<span class="move down">▼ ${Math.abs(d)}</span>`;
  return '<span class="move">— EVEN</span>'
}

function trendText(x,period){
  const d=Number(x.trajectoryDelta||0);
  const sign=d>0?'+':'';
  if(period==='year'||period==='allTime')return `${sign}${d} INDEX`;
  return `${sign}${d}% PACE`
}

function points(values){
  const arr=Array.isArray(values)&&values.length?values:[0,0,0,0,0];
  const W=205,H=52,P=4,min=Math.min(...arr),max=Math.max(...arr);
  const span=Math.max(.001,max-min);
  return arr.map((v,i)=>{
    const x=P+(i/Math.max(1,arr.length-1))*(W-P*2);
    const y=H-P-((v-min)/span)*(H-P*2);
    return x.toFixed(1)+','+y.toFixed(1)
  }).join(' ')
}

function artMarkup(x,category,accent){
  const cls=category==='artists'?'art artist-art':'art';
  if(x.image)return `<img class="${cls}" src="${esc(x.image)}" alt="${esc(x.name)} official artwork" onerror="this.outerHTML='<div class=&quot;${cls} art-fallback&quot; style=&quot;--accent:${accent}&quot;>${esc(initials(x.name))}</div>'">`;
  return `<div class="${cls} art-fallback" style="--accent:${accent}">${esc(initials(x.name))}</div>`
}

function render(){
  document.querySelectorAll('.category').forEach(b=>b.classList.toggle('active',b.dataset.category===state.category));
  document.querySelectorAll('.period').forEach(b=>b.classList.toggle('active',b.dataset.period===state.period));
  $('customRangePanel').classList.toggle('active',state.period==='custom');
  $('title').textContent='TOP 5 '+labelCategory(state.category)+' '+labelPeriod(state.period);
  const chart=data?.charts?.[state.category]?.[state.period];
  $('range').textContent=chart?.rangeLabel||(state.period==='custom'?'CHOOSE A START AND END DATE':'NO PUBLISHED RANGE');

  if(!chart?.items?.length){
    let message='This chart has no supported public data in the current edition.';
    if(state.period==='custom'){
      message=state.customLoading
        ?'Building the custom leaderboard from stats.fm…'
        :'Choose dates above and press Run Range. Switching Songs, Artists or Albums keeps the same selected dates.';
    }
    $('board').innerHTML=`<div class="empty">${esc(message)}</div>`;
    renderAnalysis(chart);
    return
  }

  $('board').innerHTML=chart.items.map((x,i)=>{
    const accent=accents[i%accents.length];
    const sub=state.category==='songs'?x.artist:state.category==='albums'?x.artist:(x.genres?.slice(0,2).join(' · ')||'ARTIST');
    const sparkPoints=points(x.trajectory);
    const showDays=state.period==='week'||state.period==='month'||state.period==='custom';
    const active=showDays?(x.activeDays??'—'):'CUMULATIVE';
    return `<article class="card" style="--accent:${accent};animation-delay:${i*75}ms">
      <div class="rank">${x.rank}</div>
      ${artMarkup(x,state.category,accent)}
      <div class="main">
        <div class="rowtop">
          <div><h3 class="name">${esc(x.name)}</h3><p class="sub">${esc(sub||'')}</p></div>
          <div class="badges">${movement(x)}<span class="trend-badge">${esc(trendText(x,state.period))}</span></div>
        </div>
        <div class="metrics">
          <div class="metric"><small>PLAYS</small><strong>${num(x.plays)}</strong></div>
          <div class="metric"><small>LISTENING</small><strong>${mins(x.playedMs)}</strong></div>
          <div class="metric"><small>${showDays?'ACTIVE DAYS':'SCOPE'}</small><strong>${active}</strong></div>
          <div class="metric"><small>PEAK · TENURE</small><strong>${x.peakRank?'#'+x.peakRank:'—'} · ${esc(x.chartTenure||'—')}</strong></div>
        </div>
        <div class="meter"><i style="width:${Math.max(5,Math.min(100,x.powerScore??10))}%"></i></div>
      </div>
      <div class="score-pane">
        <div class="score-line"><strong>${x.powerScore==null?'—':Math.round(x.powerScore)}</strong><small>POWER</small></div>
        <svg class="spark" viewBox="0 0 205 52" preserveAspectRatio="none" aria-label="${esc(x.trajectoryCaption||'Trajectory')}">
          <line class="sparkline-base" x1="4" x2="201" y1="47" y2="47"></line>
          <polygon points="4,52 ${sparkPoints} 201,52"></polygon>
          <polyline points="${sparkPoints}"></polyline>
        </svg>
        <div class="spark-caption">${esc(x.trajectoryCaption||chart.trajectoryMethod||'SUPPORTED TRAJECTORY')}</div>
      </div>
    </article>`
  }).join('');
  renderAnalysis(chart)
}

function renderAnalysis(chart){
  const a=chart?.analysis||{};
  $('headline').textContent=a.headline||'No supported chart to analyze.';
  $('writeup').textContent=a.writeup||(state.period==='custom'?'Run a custom date range to build an on-demand analyst report.':'The source returned no usable entries for this view.');
  $('leader').textContent=a.leader||chart?.items?.[0]?.name||'—';
  $('bigMove').textContent=a.biggestMove||'—';
  $('closeRace').textContent=a.closestRace||'—'
}

function setPlaylist(index){
  state.playlist=(index+playlists.length)%playlists.length;
  const p=playlists[state.playlist];
  $('playlistName').textContent=p.name;
  $('playlistOpen').href=p.url;
  $('playlistFrame').src=`https://open.spotify.com/embed/playlist/${encodeURIComponent(p.id)}?utm_source=generator&theme=0`;
  $('playlistFrame').title=p.name+' Spotify playlist';
  $('playlistCount').textContent=String(state.playlist+1).padStart(2,'0')+' / '+String(playlists.length).padStart(2,'0');
  document.querySelectorAll('.dot-btn').forEach((dot,i)=>dot.classList.toggle('active',i===state.playlist))
}

function initCarousel(){
  $('playlistDots').innerHTML=playlists.map((p,i)=>`<button class="dot-btn${i===0?' active':''}" aria-label="Show ${esc(p.name)}" data-index="${i}"></button>`).join('');
  document.querySelectorAll('.dot-btn').forEach(dot=>dot.onclick=()=>setPlaylist(Number(dot.dataset.index)));
  $('playlistPrev').onclick=()=>setPlaylist(state.playlist-1);
  $('playlistNext').onclick=()=>setPlaylist(state.playlist+1);
  $('playlistPanel').addEventListener('keydown',e=>{
    if(e.key==='ArrowLeft'){e.preventDefault();setPlaylist(state.playlist-1)}
    if(e.key==='ArrowRight'){e.preventDefault();setPlaylist(state.playlist+1)}
  });
  let startX=null,startY=null;
  $('playlistStage').addEventListener('touchstart',e=>{const t=e.changedTouches[0];startX=t.clientX;startY=t.clientY},{passive:true});
  $('playlistStage').addEventListener('touchend',e=>{
    if(startX==null)return;
    const t=e.changedTouches[0],dx=t.clientX-startX,dy=t.clientY-startY;
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)setPlaylist(state.playlist+(dx<0?1:-1));
    startX=startY=null
  },{passive:true});
  setPlaylist(0)
}

function isoToday(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(p=>p.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`
}

function addDays(dateString,amount){
  const [y,m,d]=dateString.split('-').map(Number);
  const date=new Date(Date.UTC(y,m-1,d+amount));
  return date.toISOString().slice(0,10)
}

function dayCountInclusive(start,end){
  const a=Date.parse(start+'T00:00:00Z');
  const b=Date.parse(end+'T00:00:00Z');
  return Math.round((b-a)/86400000)+1
}

function easternMidnightMs(dateString){
  const [y,m,d]=dateString.split('-').map(Number);
  let guess=Date.UTC(y,m-1,d,5,0,0);
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<2;i++){
    const parts=formatter.formatToParts(new Date(guess));
    const values=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const rendered=Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day),Number(values.hour),Number(values.minute),Number(values.second));
    const desired=Date.UTC(y,m-1,d,0,0,0);
    guess+=desired-rendered
  }
  return guess
}

function easternDateKey(raw){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(raw));
  const get=type=>parts.find(p=>p.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`
}

async function apiGet(path,params){
  const query=new URLSearchParams(params);
  const response=await fetch(`${API}${path}?${query}`,{headers:{Accept:'application/json'},mode:'cors'});
  if(!response.ok)throw new Error(`stats.fm returned ${response.status}`);
  return response.json()
}

function normalizeTop(raw,category){
  const config=categoryMap[category];
  const obj=raw?.[config.key]||{};
  const artists=obj.artists||[];
  const albums=obj.albums||[];
  let image=obj.image||'';
  if(!image)image=albums.find(x=>x.image)?.image||'';
  if(!image)image=artists.find(x=>x.image)?.image||'';
  return {id:String(obj.id||''),name:obj.name||'Unknown',artist:artists.map(a=>a.name).filter(Boolean).join(', '),genres:obj.genres||[],image,plays:Number(raw.streams??raw.count??0),playedMs:Number(raw.playedMs??raw.durationMs??0),sourceRank:raw.position??null}
}

async function customTop(category,startMs,endMs){
  const config=categoryMap[category];
  const payload=await apiGet(`/users/${encodeURIComponent(STATS_USER)}/top/${config.endpoint}`,{after:String(startMs),before:String(endMs),limit:'30',offset:'0'});
  return (payload.items||[]).map(x=>normalizeTop(x,category)).filter(x=>x.id)
}

function aggregateRank(items){
  const maxPlays=Math.max(1,...items.map(x=>x.plays));
  const maxMs=Math.max(1,...items.map(x=>x.playedMs));
  return items.map(item=>({...item,powerScore:100*(.75*item.plays/maxPlays+.25*item.playedMs/maxMs)})).sort((a,b)=>b.powerScore-a.powerScore||b.plays-a.plays||b.playedMs-a.playedMs).map((item,index)=>({...item,rank:index+1}))
}

function bucket(values,count){
  if(!values.length)return Array(count).fill(0);
  const size=values.length/count;
  const out=[];
  for(let i=0;i<count;i++){
    const start=Math.floor(i*size);
    let end=Math.floor((i+1)*size);
    if(i===count-1)end=values.length;
    out.push(values.slice(start,Math.max(start+1,end)).reduce((a,b)=>a+b,0))
  }
  return out
}

async function customDaily(category,itemId,startDate,endDate,startMs,endMs){
  const endpoint=categoryMap[category].endpoint;
  const payload=await apiGet(`/users/${encodeURIComponent(STATS_USER)}/streams/${endpoint}/${encodeURIComponent(itemId)}/stats/per-day`,{after:String(startMs),before:String(endMs),timeZone:'America/New_York'});
  let rows=payload?.items?.days||payload?.items||{};
  if(rows?.days)rows=rows.days;
  const normalized={};
  Object.entries(rows||{}).forEach(([key,row])=>{
    const local=easternDateKey(key);
    const existing=normalized[local]||{count:0,durationMs:0};
    normalized[local]={count:existing.count+Number(row.count??row.streams??0),durationMs:existing.durationMs+Number(row.durationMs??row.playedMs??0)}
  });
  const days=dayCountInclusive(startDate,endDate);
  const daily=[];
  for(let i=0;i<days;i++){
    const key=addDays(startDate,i);
    daily.push(normalized[key]||{count:0,durationMs:0})
  }
  return daily
}

function customAnalysis(items,category,start,end){
  if(!items.length)return {};
  const leader=items[0];
  const changes=items.filter(x=>x.previousRank!=null).map(x=>[x.previousRank-x.rank,x]);
  const biggestUp=changes.length?changes.reduce((a,b)=>b[0]>a[0]?b:a):null;
  const biggestDown=changes.length?changes.reduce((a,b)=>b[0]<a[0]?b:a):null;
  const gap=items.length>1?Math.abs(items[0].powerScore-items[1].powerScore):null;
  const kind={songs:'song',artists:'artist',albums:'album'}[category];
  let writeup=`${leader.name} leads the custom ${kind} rankings from ${start} through ${end} with ${num(leader.plays)} plays. `;
  if(biggestUp&&biggestUp[0]>0)writeup+=`${biggestUp[1].name} makes the strongest rise versus the immediately preceding equal-length range, gaining ${biggestUp[0]} positions. `;
  if(biggestDown&&biggestDown[0]<0)writeup+=`${biggestDown[1].name} has the largest decline at ${Math.abs(biggestDown[0])} positions. `;
  if(gap!=null)writeup+=gap<5?`The lead is narrow at ${gap.toFixed(1)} Power Score points.`:`The leader holds a ${gap.toFixed(1)}-point margin.`;
  return {headline:`${leader.name} controls the custom No. 1 position.`,writeup,leader:leader.name,biggestMove:biggestUp&&biggestUp[0]>0?`${biggestUp[1].name} +${biggestUp[0]}`:'Stable board',closestRace:gap==null?'—':`${gap.toFixed(1)} PTS`}
}

async function buildCustomChart(category,startDate,endDate){
  const startMs=easternMidnightMs(startDate);
  const endMs=easternMidnightMs(addDays(endDate,1));
  const duration=endMs-startMs;
  const previousEnd=startMs;
  const previousStart=startMs-duration;
  const [currentRaw,previousRaw]=await Promise.all([customTop(category,startMs,endMs),customTop(category,previousStart,previousEnd)]);
  const current=aggregateRank(currentRaw);
  const previous=aggregateRank(previousRaw);
  const previousPositions=new Map(previous.map(x=>[x.id,x.rank]));
  const enriched=await Promise.all(current.slice(0,5).map(async item=>{
    let daily=[];
    try{daily=await customDaily(category,item.id,startDate,endDate,startMs,endMs)}catch(error){daily=[]}
    const raw=daily.map(x=>x.count);
    const pointCount=raw.length<=14?raw.length:Math.min(12,Math.max(4,Math.ceil(raw.length/7)));
    const trajectory=raw.length<=14?raw:bucket(raw,pointCount);
    const first=trajectory[0]||0;
    const last=trajectory.at(-1)||0;
    const delta=Math.round(((last-first)/Math.max(1,first))*1000)/10;
    const previousRank=previousPositions.get(item.id)??null;
    return {...item,previousRank,peakRank:Math.min(item.rank,previousRank??item.rank),chartTenure:'CUSTOM',activeDays:daily.filter(x=>x.count>0).length,trajectory,trajectoryDelta:delta,trajectoryCaption:raw.length<=14?'CUSTOM RANGE · DAILY ACTIVITY':`CUSTOM RANGE · ${pointCount} CHECKPOINTS`}
  }));
  return {rangeLabel:`${startDate} — ${endDate} · EASTERN TIME · COMPARED WITH PRIOR EQUAL-LENGTH RANGE`,trajectoryMethod:enriched[0]?.trajectoryCaption||'CUSTOM RANGE',items:enriched,analysis:customAnalysis(enriched,category,startDate,endDate)}
}

function setCustomStatus(message,type=''){
  $('customStatus').textContent=message;
  $('customStatus').className='custom-range-status'+(type?` ${type}`:'')
}

async function runCustomRange(){
  const start=$('customStart').value;
  const end=$('customEnd').value;
  const today=isoToday();
  if(!start||!end)return setCustomStatus('Choose both a start date and an end date.','error');
  if(start<CUSTOM_MIN)return setCustomStatus('The earliest supported date is November 1, 2020.','error');
  if(end>today)return setCustomStatus('The end date cannot be later than today.','error');
  if(start>end)return setCustomStatus('The start date must come before the end date.','error');
  state.customStart=start;
  state.customEnd=end;
  const key=`${state.category}:${start}:${end}`;
  const cached=customCache.get(key);
  if(cached){
    data.charts[state.category].custom=cached;
    setCustomStatus('Loaded the saved custom result for this browser session.','success');
    render();
    return
  }
  state.customLoading=true;
  $('customApply').disabled=true;
  data.charts[state.category].custom={items:[],analysis:{},rangeLabel:`${start} — ${end}`};
  setCustomStatus(`Building ${labelCategory(state.category).toLowerCase()} rankings from stats.fm…`);
  render();
  try{
    const chart=await buildCustomChart(state.category,start,end);
    customCache.set(key,chart);
    data.charts[state.category].custom=chart;
    setCustomStatus(`Custom ${labelCategory(state.category).toLowerCase()} rankings loaded. The official Sunday edition was not changed.`,'success')
  }catch(error){
    data.charts[state.category].custom={items:[],analysis:{},rangeLabel:`${start} — ${end}`};
    setCustomStatus(`Could not load this range: ${error.message}. The official charts are unchanged.`,'error')
  }finally{
    state.customLoading=false;
    $('customApply').disabled=false;
    render()
  }
}

function showCustomForCategory(){
  if(state.period!=='custom')return;
  const start=$('customStart').value;
  const end=$('customEnd').value;
  const key=start&&end?`${state.category}:${start}:${end}`:'';
  data.charts[state.category].custom=key&&customCache.has(key)?customCache.get(key):{items:[],analysis:{},rangeLabel:start&&end?`${start} — ${end}`:'CHOOSE A START AND END DATE'}
}

function initCustomRange(){
  const today=isoToday();
  const defaultStart=addDays(today,-29);
  $('customStart').max=today;
  $('customEnd').max=today;
  $('customStart').value=defaultStart<CUSTOM_MIN?CUSTOM_MIN:defaultStart;
  $('customEnd').value=today;
  state.customStart=$('customStart').value;
  state.customEnd=today;
  $('customToday').onclick=()=>{$('customEnd').value=isoToday();setCustomStatus('End date set to today. Press Run Range to refresh.')};
  $('customApply').onclick=runCustomRange;
  [$('customStart'),$('customEnd')].forEach(input=>input.addEventListener('keydown',event=>{if(event.key==='Enter')runCustomRange()}))
}

async function boot(){
  let live=false;
  try{
    const r=await fetch('./data/latest.json',{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    data=await r.json();
    live=true
  }catch(e){data=PREVIEW_DATA}
  for(const category of Object.keys(categoryMap)){
    data.charts[category]??={};
    data.charts[category].custom??={items:[],analysis:{},rangeLabel:'CHOOSE A START AND END DATE'}
  }
  $('source').textContent=(data.sourceStatus||'STATS.FM').toUpperCase();
  $('edition').textContent=(data.editionLabel||'LATEST EDITION').toUpperCase();
  $('cutoff').textContent=data.cutoffLabel||'—';
  $('updated').textContent=data.updatedLabel||'—';
  $('previewFlag').style.display=(data.isPreview||!live)?'inline-flex':'none';
  $('modeNote').textContent=(data.isPreview||!live)?'PREVIEW FALLBACK ACTIVE':'PUBLISHED DATA ACTIVE';
  render()
}

document.querySelectorAll('.category').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;showCustomForCategory();render()});
document.querySelectorAll('.period').forEach(b=>b.onclick=()=>{state.period=b.dataset.period;if(state.period==='custom')showCustomForCategory();render()});
initCarousel();
initCustomRange();
boot();