import {
  ALL_TIME_START,
  addIsoDays,
  buildLiveChart,
  durationFormat,
  easternDateKey,
  isoToday,
  numberFormat,
  subtractEasternMonth,
  top25Url,
} from './live-rankings.js';

const accents = ['#caff4b', '#708cff', '#bb73ff', '#ffd16f', '#ff7189'];
const playlists = [
  { name: 'On Repeat', id: '37i9dQZF1EpnTClO2dDlBN', url: 'https://open.spotify.com/playlist/37i9dQZF1EpnTClO2dDlBN?si=7b2193162a804969' },
  { name: 'P1', id: '44rjeQwL3zcZJY4h1RWxGv', url: 'https://open.spotify.com/playlist/44rjeQwL3zcZJY4h1RWxGv?si=73e2dad69e124960&pt=139c8cb31efc0ec19d7ebda26e39d79f' },
  { name: '720S', id: '7u6vXVHXiZXY64MGiWPLgd', url: 'https://open.spotify.com/playlist/7u6vXVHXiZXY64MGiWPLgd?si=d64caeeb69d64ef0&pt=77d60c2d1e4974100cb1d76ed9c6face' },
  { name: 'Repeat Rewind', id: '37i9dQZF1EpPWup4plZPDb', url: 'https://open.spotify.com/playlist/37i9dQZF1EpPWup4plZPDb?si=2b328c1d3d1c4283' },
];

const state = {
  category: 'songs', period: 'week', playlist: 0,
  chart: null, loading: false, fallback: null,
  custom: { start: '', end: '' },
  calendar: { start: '', end: '', month: null },
};

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const initials = value => String(value || '?').split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase();
const categoryLabel = category => ({ songs: 'SONGS', artists: 'ARTISTS', albums: 'ALBUMS' }[category]);
const periodLabel = period => ({ week: '7 DAYS', month: '1 MONTH', year: 'THIS YEAR', allTime: 'ALL TIME', custom: 'CUSTOM RANGE' }[period]);

function movement(item) {
  if (item.previousRank == null) return '<span class="move new">NEW</span>';
  const change = item.previousRank - item.rank;
  if (change > 0) return `<span class="move up">▲ ${change}</span>`;
  if (change < 0) return `<span class="move down">▼ ${Math.abs(change)}</span>`;
  return '<span class="move">— EVEN</span>';
}

function trendText(item) {
  const delta = Number(item.trajectoryDelta || 0);
  return `${delta > 0 ? '+' : ''}${delta}${state.period === 'year' || state.period === 'allTime' ? ' INDEX' : '% PACE'}`;
}

function sparkPoints(values) {
  const array = Array.isArray(values) && values.length ? values : [0, 0, 0, 0, 0];
  const width = 205, height = 52, padding = 4;
  const min = Math.min(...array), max = Math.max(...array), span = Math.max(0.001, max - min);
  return array.map((value, index) => {
    const x = padding + (index / Math.max(1, array.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function art(item, accent) {
  const cls = state.category === 'artists' ? 'art artist-art' : 'art';
  if (item.image) return `<img class="${cls}" src="${esc(item.image)}" alt="${esc(item.name)} artwork" loading="lazy" onerror="this.outerHTML='<div class=&quot;${cls} art-fallback&quot; style=&quot;--accent:${accent}&quot;>${esc(initials(item.name))}</div>'">`;
  return `<div class="${cls} art-fallback" style="--accent:${accent}">${esc(initials(item.name))}</div>`;
}

function renderAnalysis(chart) {
  const analysis = chart?.analysis || {};
  $('headline').textContent = analysis.headline || 'No supported chart to analyze.';
  $('writeup').textContent = analysis.writeup || 'The source returned no usable entries for this live window.';
  $('leader').textContent = analysis.leader || chart?.items?.[0]?.name || '—';
  $('bigMove').textContent = analysis.biggestMove || '—';
  $('closeRace').textContent = analysis.closestRace || '—';
}

function render() {
  document.querySelectorAll('.category').forEach(button => button.classList.toggle('active', button.dataset.category === state.category));
  document.querySelectorAll('.period').forEach(button => button.classList.toggle('active', button.dataset.period === state.period));
  $('customBar').hidden = state.period !== 'custom';
  $('title').textContent = `TOP 5 ${categoryLabel(state.category)} · ${periodLabel(state.period)}`;
  $('viewTop25').href = top25Url(state.category, state.period, state.period === 'custom' ? state.custom : null);
  $('viewTop25').classList.toggle('disabled', state.period === 'custom' && (!state.custom.start || !state.custom.end));

  if (state.loading) {
    $('board').innerHTML = '<div class="empty"><span class="loader"></span>Building the live rankings from stats.fm…</div>';
    $('range').textContent = 'LIVE REQUEST IN PROGRESS';
    return;
  }

  const chart = state.chart;
  $('range').textContent = chart?.rangeLabel || (state.period === 'custom' ? 'CHOOSE A CUSTOM RANGE' : 'NO LIVE RANGE AVAILABLE');
  $('windowStatus').textContent = chart?.rangeLabel?.split('·')[0]?.trim() || periodLabel(state.period);

  if (!chart?.items?.length) {
    $('board').innerHTML = `<div class="empty">${state.period === 'custom' ? 'Open the calendar, choose two dates, and run the custom range.' : 'No supported public data was returned for this live window.'}</div>`;
    renderAnalysis(chart);
    return;
  }

  $('board').innerHTML = chart.items.map((item, index) => {
    const accent = accents[index % accents.length];
    const subtitle = state.category === 'songs' || state.category === 'albums' ? item.artist : (item.genres?.slice(0, 2).join(' · ') || 'ARTIST');
    const points = sparkPoints(item.trajectory);
    const scope = state.period === 'week' || state.period === 'month' || state.period === 'custom' ? (item.activeDays ?? '—') : 'CUMULATIVE';
    return `<article class="card" style="--accent:${accent};animation-delay:${index * 70}ms">
      <div class="rank">${item.rank}</div>
      ${art(item, accent)}
      <div class="main">
        <div class="rowtop">
          <div><h3 class="name">${esc(item.name)}</h3><p class="sub">${esc(subtitle || '')}</p></div>
          <div class="badges">${movement(item)}<span class="trend-badge">${esc(trendText(item))}</span></div>
        </div>
        <div class="metrics">
          <div class="metric"><small>PLAYS</small><strong>${numberFormat(item.plays)}</strong></div>
          <div class="metric"><small>LISTENING</small><strong>${durationFormat(item.playedMs)}</strong></div>
          <div class="metric"><small>${state.period === 'week' || state.period === 'month' || state.period === 'custom' ? 'ACTIVE DAYS' : 'SCOPE'}</small><strong>${scope}</strong></div>
          <div class="metric"><small>PEAK · MODE</small><strong>${item.peakRank ? `#${item.peakRank}` : '—'} · ${esc(item.chartTenure || 'LIVE')}</strong></div>
        </div>
        <div class="meter"><i style="width:${Math.max(5, Math.min(100, item.powerScore ?? 10))}%"></i></div>
      </div>
      <div class="score-pane">
        <div class="score-line"><strong>${item.powerScore == null ? '—' : Math.round(item.powerScore)}</strong><small>POWER</small></div>
        <svg class="spark" viewBox="0 0 205 52" preserveAspectRatio="none" aria-label="${esc(item.trajectoryCaption || 'Trajectory')}">
          <line class="sparkline-base" x1="4" x2="201" y1="47" y2="47"></line>
          <polygon points="4,52 ${points} 201,52"></polygon><polyline points="${points}"></polyline>
        </svg>
        <div class="spark-caption">${esc(item.trajectoryCaption || 'LIVE TRAJECTORY')}</div>
      </div>
    </article>`;
  }).join('');
  renderAnalysis(chart);
}

async function loadChart(force = false) {
  if (state.period === 'custom' && (!state.custom.start || !state.custom.end)) {
    state.chart = null;
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    state.chart = await buildLiveChart(state.category, state.period, {
      limit: 5,
      custom: state.period === 'custom' ? state.custom : null,
      force,
      trajectories: true,
    });
    $('source').textContent = 'STATS.FM LIVE';
    $('updated').textContent = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }).format(new Date(state.chart.refreshedAt));
  } catch (error) {
    const fallback = state.fallback?.charts?.[state.category]?.[state.period];
    state.chart = fallback?.items?.length ? { ...fallback, rangeLabel: `${fallback.rangeLabel} · SAVED FALLBACK` } : null;
    $('source').textContent = state.chart ? 'SAVED FALLBACK' : 'SOURCE ERROR';
    $('updated').textContent = state.chart ? state.fallback.updatedLabel || 'Saved edition' : 'Unavailable';
    if (!state.chart) $('range').textContent = `Could not load stats.fm: ${error.message}`;
  } finally {
    state.loading = false;
    render();
  }
}

function setPlaylist(index) {
  state.playlist = (index + playlists.length) % playlists.length;
  const playlist = playlists[state.playlist];
  $('playlistName').textContent = playlist.name;
  $('playlistOpen').href = playlist.url;
  $('playlistFrame').src = `https://open.spotify.com/embed/playlist/${encodeURIComponent(playlist.id)}?utm_source=generator&theme=0`;
  $('playlistFrame').title = `${playlist.name} Spotify playlist`;
  $('playlistCount').textContent = `${String(state.playlist + 1).padStart(2, '0')} / ${String(playlists.length).padStart(2, '0')}`;
  document.querySelectorAll('.dot-btn').forEach((dot, i) => dot.classList.toggle('active', i === state.playlist));
}

function initPlaylist() {
  $('playlistDots').innerHTML = playlists.map((playlist, i) => `<button class="dot-btn${i === 0 ? ' active' : ''}" aria-label="Show ${esc(playlist.name)}" data-index="${i}"></button>`).join('');
  document.querySelectorAll('.dot-btn').forEach(dot => { dot.onclick = () => setPlaylist(Number(dot.dataset.index)); });
  $('playlistPrev').onclick = () => setPlaylist(state.playlist - 1);
  $('playlistNext').onclick = () => setPlaylist(state.playlist + 1);
  $('playlistPanel').addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setPlaylist(state.playlist - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setPlaylist(state.playlist + 1); }
  });
  let touchX = null, touchY = null;
  $('playlistStage').addEventListener('touchstart', event => { const touch = event.changedTouches[0]; touchX = touch.clientX; touchY = touch.clientY; }, { passive: true });
  $('playlistStage').addEventListener('touchend', event => {
    if (touchX == null) return;
    const touch = event.changedTouches[0], dx = touch.clientX - touchX, dy = touch.clientY - touchY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.25) setPlaylist(state.playlist + (dx < 0 ? 1 : -1));
    touchX = touchY = null;
  }, { passive: true });
  setPlaylist(0);
}

function readableDate(dateString) {
  if (!dateString) return 'Not selected';
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function monthKey(dateString) { return dateString.slice(0, 7); }
function firstOfMonth(dateString) { return `${monthKey(dateString)}-01`; }
function shiftMonth(dateString, offset) {
  const [year, month] = dateString.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1 + offset, 1));
  return dt.toISOString().slice(0, 10);
}

function renderMonth(monthString) {
  const [year, month] = monthString.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = first.getUTCDay();
  const heading = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(first);
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push('<span class="calendar-blank"></span>');
  const today = isoToday();
  for (let day = 1; day <= days; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const disabled = date < ALL_TIME_START || date > today;
    const selected = date === state.calendar.start || date === state.calendar.end;
    const inRange = state.calendar.start && state.calendar.end && date > state.calendar.start && date < state.calendar.end;
    cells.push(`<button class="calendar-day${selected ? ' selected' : ''}${inRange ? ' in-range' : ''}" data-date="${date}" ${disabled ? 'disabled' : ''}>${day}</button>`);
  }
  return `<section class="calendar-month"><h3>${heading}</h3><div class="weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="days-grid">${cells.join('')}</div></section>`;
}

function renderCalendar() {
  const first = state.calendar.month || firstOfMonth(state.calendar.start || isoToday());
  const count = window.matchMedia('(max-width: 700px)').matches ? 1 : 2;
  $('calendarMonths').innerHTML = Array.from({ length: count }, (_, i) => renderMonth(shiftMonth(first, i))).join('');
  $('calendarHeading').textContent = count === 1 ? readableDate(first).replace(/ 1,/, ',') : `${readableDate(first).replace(/ 1,/, ',')} — ${readableDate(shiftMonth(first, 1)).replace(/ 1,/, ',')}`;
  $('calendarStartLabel').textContent = readableDate(state.calendar.start);
  $('calendarEndLabel').textContent = readableDate(state.calendar.end);
  $('calendarApply').disabled = !(state.calendar.start && state.calendar.end);
  document.querySelectorAll('.calendar-day[data-date]').forEach(button => {
    button.onclick = () => {
      const date = button.dataset.date;
      if (!state.calendar.start || state.calendar.end) {
        state.calendar.start = date;
        state.calendar.end = '';
      } else if (date < state.calendar.start) {
        state.calendar.start = date;
        state.calendar.end = '';
      } else {
        state.calendar.end = date;
      }
      renderCalendar();
    };
  });
}

function openCalendar() {
  state.calendar.start = state.custom.start;
  state.calendar.end = state.custom.end;
  state.calendar.month = firstOfMonth(state.custom.start || isoToday());
  $('calendarOverlay').hidden = false;
  requestAnimationFrame(() => $('calendarOverlay').classList.add('open'));
  document.body.classList.add('modal-open');
  renderCalendar();
}

function closeCalendar() {
  $('calendarOverlay').classList.remove('open');
  setTimeout(() => { $('calendarOverlay').hidden = true; }, 180);
  document.body.classList.remove('modal-open');
}

function updateCustomText() {
  $('customRangeText').textContent = state.custom.start && state.custom.end ? `${readableDate(state.custom.start)} → ${readableDate(state.custom.end)}` : 'Choose a start and end date';
  $('runCustom').disabled = !(state.custom.start && state.custom.end);
}

function initCalendar() {
  $('openCalendar').onclick = openCalendar;
  $('closeCalendar').onclick = closeCalendar;
  $('calendarCancel').onclick = closeCalendar;
  $('calendarOverlay').onclick = event => { if (event.target === $('calendarOverlay')) closeCalendar(); };
  $('calendarPrev').onclick = () => { state.calendar.month = shiftMonth(state.calendar.month, -1); renderCalendar(); };
  $('calendarNext').onclick = () => { state.calendar.month = shiftMonth(state.calendar.month, 1); renderCalendar(); };
  $('calendarApply').onclick = () => {
    state.custom.start = state.calendar.start;
    state.custom.end = state.calendar.end;
    updateCustomText();
    closeCalendar();
    $('customStatus').textContent = 'Dates selected. Press Run Range to build the live custom chart.';
  };
  document.querySelectorAll('[data-quick]').forEach(button => {
    button.onclick = () => {
      const today = isoToday();
      const type = button.dataset.quick;
      if (type === '7') state.calendar.start = addIsoDays(today, -6);
      if (type === 'month') state.calendar.start = easternDateKey(subtractEasternMonth(Date.now()));
      if (type === 'ytd') state.calendar.start = `${today.slice(0, 4)}-01-01`;
      if (type === 'all') state.calendar.start = ALL_TIME_START;
      state.calendar.end = today;
      state.calendar.month = firstOfMonth(state.calendar.start);
      renderCalendar();
    };
  });
  window.addEventListener('resize', () => { if (!$('calendarOverlay').hidden) renderCalendar(); });
  updateCustomText();
}

async function boot() {
  try {
    const response = await fetch('./data/latest.json', { cache: 'no-store' });
    if (response.ok) state.fallback = await response.json();
  } catch { state.fallback = null; }
  initPlaylist();
  initCalendar();
  await loadChart(false);
}

document.querySelectorAll('.category').forEach(button => {
  button.onclick = async () => {
    state.category = button.dataset.category;
    await loadChart(false);
  };
});

document.querySelectorAll('.period').forEach(button => {
  button.onclick = async () => {
    state.period = button.dataset.period;
    await loadChart(false);
  };
});

$('refreshLive').onclick = () => loadChart(true);
$('runCustom').onclick = async () => {
  $('customStatus').textContent = `Building ${categoryLabel(state.category).toLowerCase()} rankings for the selected dates…`;
  await loadChart(true);
  $('customStatus').textContent = state.chart?.items?.length ? 'Custom range loaded. The official saved edition was not changed.' : 'No data was returned for this range.';
};

document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('calendarOverlay').hidden) closeCalendar(); });
boot();
