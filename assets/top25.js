import { buildLiveChart, durationFormat, numberFormat } from './live-rankings.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const initials = value => String(value || '?').split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase();
const accents = ['#caff4b', '#708cff', '#bb73ff', '#ffd16f', '#ff7189'];
const validCategories = ['songs', 'artists', 'albums'];
const validPeriods = ['week', 'month', 'year', 'allTime', 'custom'];
const labels = {
  category: { songs: 'SONGS', artists: 'ARTISTS', albums: 'ALBUMS' },
  period: { week: '7 DAYS', month: '1 MONTH', year: 'THIS YEAR', allTime: 'ALL TIME', custom: 'CUSTOM RANGE' },
};

const params = new URLSearchParams(location.search);
const state = {
  category: validCategories.includes(params.get('category')) ? params.get('category') : 'songs',
  period: validPeriods.includes(params.get('period')) ? params.get('period') : 'week',
  custom: { start: params.get('start') || '', end: params.get('end') || '' },
};

function movement(item) {
  if (item.previousRank == null) return '<span class="move new">NEW</span>';
  const change = item.previousRank - item.rank;
  if (change > 0) return `<span class="move up">▲ ${change}</span>`;
  if (change < 0) return `<span class="move down">▼ ${Math.abs(change)}</span>`;
  return '<span class="move">— EVEN</span>';
}

function updateUrl() {
  const next = new URLSearchParams({ category: state.category, period: state.period });
  if (state.period === 'custom' && state.custom.start && state.custom.end) {
    next.set('start', state.custom.start);
    next.set('end', state.custom.end);
  }
  history.replaceState(null, '', `?${next}`);
}

function renderControls() {
  document.querySelectorAll('.category').forEach(button => button.classList.toggle('active', button.dataset.category === state.category));
  document.querySelectorAll('.period').forEach(button => button.classList.toggle('active', button.dataset.period === state.period));
  $('top25Heading').textContent = `TOP 25 ${labels.category[state.category]} · ${labels.period[state.period]}`;
}

function art(item, accent) {
  const cls = state.category === 'artists' ? 'top25-art artist-art' : 'top25-art';
  if (item.image) return `<img class="${cls}" src="${esc(item.image)}" alt="${esc(item.name)} artwork" loading="lazy">`;
  return `<div class="${cls} art-fallback" style="--accent:${accent}">${esc(initials(item.name))}</div>`;
}

function renderRows(chart) {
  if (!chart?.items?.length) {
    const customMessage = state.period === 'custom' && !(state.custom.start && state.custom.end)
      ? 'Choose the custom range on the main dashboard first, then select View Full Top 25.'
      : 'No supported data was returned for this live chart.';
    $('top25List').innerHTML = `<div class="top25-loading">${customMessage}</div>`;
    return;
  }
  $('top25List').innerHTML = chart.items.map((item, index) => {
    const accent = accents[index % accents.length];
    const subtitle = state.category === 'songs' || state.category === 'albums' ? item.artist : (item.genres?.slice(0, 2).join(' · ') || 'ARTIST');
    return `<article class="top25-row${index < 5 ? ' featured' : ''}" style="--accent:${accent};animation-delay:${Math.min(index * 25, 350)}ms">
      <div class="top25-rank">${item.rank}</div>
      ${art(item, accent)}
      <div class="top25-name"><strong>${esc(item.name)}</strong><small>${esc(subtitle || '')}</small></div>
      <div class="top25-stat"><small>PLAYS</small><strong>${numberFormat(item.plays)}</strong></div>
      <div class="top25-stat"><small>LISTENING</small><strong>${durationFormat(item.playedMs)}</strong></div>
      <div class="top25-power">${movement(item)}<strong>${Math.round(item.powerScore || 0)}</strong><small>POWER</small></div>
    </article>`;
  }).join('');
}

async function load(force = false) {
  renderControls();
  updateUrl();
  if (state.period === 'custom' && !(state.custom.start && state.custom.end)) {
    $('top25Range').textContent = 'NO CUSTOM DATES WERE PASSED FROM THE MAIN DASHBOARD';
    renderRows(null);
    return;
  }
  $('top25List').innerHTML = '<div class="top25-loading"><span class="loader"></span>Building the selected Top 25 from stats.fm…</div>';
  try {
    const chart = await buildLiveChart(state.category, state.period, {
      limit: 25,
      custom: state.period === 'custom' ? state.custom : null,
      force,
      trajectories: false,
    });
    $('top25Range').textContent = chart.rangeLabel;
    $('top25Updated').textContent = `REFRESHED ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(chart.refreshedAt))}`;
    renderRows(chart);
  } catch (error) {
    $('top25Range').textContent = `COULD NOT LOAD STATS.FM: ${error.message}`;
    $('top25List').innerHTML = '<div class="top25-loading">The live request failed. Return to the Top 5 dashboard or try Refresh Live.</div>';
    $('top25Updated').textContent = 'SOURCE UNAVAILABLE';
  }
}

document.querySelectorAll('.category').forEach(button => {
  button.onclick = () => { state.category = button.dataset.category; load(false); };
});
document.querySelectorAll('.period').forEach(button => {
  button.onclick = () => { state.period = button.dataset.period; load(false); };
});
$('refreshTop25').onclick = () => load(true);
load(false);
