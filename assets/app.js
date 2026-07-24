const PREVIEW_DATA={editionLabel:'Awaiting first published edition',cutoffLabel:'No successful Sunday snapshot yet',updatedLabel:'Waiting for stats.fm update',sourceStatus:'Repository ready',isPreview:true,charts:{songs:{week:{items:[]},month:{items:[]},year:{items:[]},allTime:{items:[]}},artists:{week:{items:[]},month:{items:[]},year:{items:[]},allTime:{items:[]}},albums:{week:{items:[]},month:{items:[]},year:{items:[]},allTime:{items:[]}}}};

const accents=['#caff4b','#708cff','#bb73ff','#ffd16f','#ff7189'];
const playlists=[
  {name:'On Repeat',id:'37i9dQZF1EpnTClO2dDlBN',url:'https://open.spotify.com/playlist/37i9dQZF1EpnTClO2dDlBN?si=7b2193162a804969'},
  {name:'P1',id:'44rjeQwL3zcZJY4h1RWxGv',url:'https://open.spotify.com/playlist/44rjeQwL3zcZJY4h1RWxGv?si=73e2dad69e124960&pt=139c8cb31efc0ec19d7ebda26e39d79f'},
  {name:'720S',id:'7u6vXVHXiZXY64MGiWPLgd',url:'https://open.spotify.com/playlist/7u6vXVHXiZXY64MGiWPLgd?si=d64caeeb69d64ef0&pt=77d60c2d1e4974100cb1d76ed9c6face'},
  {name:'Repeat Rewind',id:'37i9dQZF1EpPWup4plZPDb',url:'https://open.spotify.com/playlist/37i9dQZF1EpPWup4plZPDb?si=2b328c1d3d1c4283'}
];

let data=null;
let state={category:'songs',period:'week',playlist:0};
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
function labelPeriod(p){return p==='week'?'THIS WEEK':p==='month'?'THIS MONTH':p==='year'?'THIS YEAR':'ALL TIME'}

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
  $('title').textContent='TOP 5 '+labelCategory(state.category)+' '+labelPeriod(state.period);
  const chart=data?.charts?.[state.category]?.[state.period];
  $('range').textContent=chart?.rangeLabel||'NO PUBLISHED RANGE';

  if(!chart?.items?.length){
    $('board').innerHTML='<div class="empty">This chart has no supported public data in the current edition.</div>';
    renderAnalysis(chart);
    return
  }

  $('board').innerHTML=chart.items.map((x,i)=>{
    const accent=accents[i%accents.length];
    const sub=state.category==='songs'?x.artist:state.category==='albums'?x.artist:(x.genres?.slice(0,2).join(' · ')||'ARTIST');
    const sparkPoints=points(x.trajectory);
    const active=state.period==='week'||state.period==='month'?(x.activeDays??'—'):'CUMULATIVE';
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
          <div class="metric"><small>${state.period==='week'||state.period==='month'?'ACTIVE DAYS':'SCOPE'}</small><strong>${active}</strong></div>
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
  $('writeup').textContent=a.writeup||'The source returned no usable entries for this view.';
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
  $('playlistStage').addEventListener('touchstart',e=>{
    const t=e.changedTouches[0];startX=t.clientX;startY=t.clientY
  },{passive:true});
  $('playlistStage').addEventListener('touchend',e=>{
    if(startX==null)return;
    const t=e.changedTouches[0],dx=t.clientX-startX,dy=t.clientY-startY;
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)setPlaylist(state.playlist+(dx<0?1:-1));
    startX=startY=null
  },{passive:true});
  setPlaylist(0)
}

async function boot(){
  let live=false;
  try{
    const r=await fetch('./data/latest.json',{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    data=await r.json();
    live=true
  }catch(e){
    data=PREVIEW_DATA
  }
  $('source').textContent=(data.sourceStatus||'STATS.FM').toUpperCase();
  $('edition').textContent=(data.editionLabel||'LATEST EDITION').toUpperCase();
  $('cutoff').textContent=data.cutoffLabel||'—';
  $('updated').textContent=data.updatedLabel||'—';
  $('previewFlag').style.display=(data.isPreview||!live)?'inline-flex':'none';
  $('modeNote').textContent=(data.isPreview||!live)?'PREVIEW FALLBACK ACTIVE':'PUBLISHED DATA ACTIVE';
  render()
}

document.querySelectorAll('.category').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;render()});
document.querySelectorAll('.period').forEach(b=>b.onclick=()=>{state.period=b.dataset.period;render()});
initCarousel();
boot();
