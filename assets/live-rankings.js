export const API = 'https://api.stats.fm/api/v1';
export const STATS_USER = '31c4puiblaxm3wzzwg3hfc7t75yq';
export const ALL_TIME_START = '2020-11-01';
export const CACHE_TTL_MS = 15 * 60 * 1000;

export const categoryMap = {
  songs: { endpoint: 'tracks', key: 'track', singular: 'song' },
  artists: { endpoint: 'artists', key: 'artist', singular: 'artist' },
  albums: { endpoint: 'albums', key: 'album', singular: 'album' },
};

export const numberFormat = value => value == null ? '—' : new Intl.NumberFormat('en-US').format(Math.round(value));
export const durationFormat = ms => {
  if (ms == null) return '—';
  const minutes = Math.round(ms / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
};

function easternParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const out = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function easternMs(parts) {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  for (let i = 0; i < 3; i += 1) {
    const rendered = easternParts(guess);
    const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    const renderedUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
    guess += desiredUtc - renderedUtc;
  }
  return guess;
}

export function easternDateMs(dateString, endInclusive = false) {
  const [year, month, day] = dateString.split('-').map(Number);
  const base = easternMs({ year, month, day, hour: 0, minute: 0, second: 0 });
  return endInclusive ? shiftEasternDays(base, 1) : base;
}

export function easternDateKey(ms = Date.now()) {
  const p = easternParts(ms);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function shiftEasternDays(ms, amount) {
  const p = easternParts(ms);
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day + amount, p.hour, p.minute, p.second));
  return easternMs({
    year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate(),
    hour: utc.getUTCHours(), minute: utc.getUTCMinutes(), second: utc.getUTCSeconds(),
  });
}

export function subtractEasternMonth(ms) {
  const p = easternParts(ms);
  let year = p.year;
  let month = p.month - 1;
  if (month === 0) { month = 12; year -= 1; }
  const day = Math.min(p.day, daysInMonth(year, month));
  return easternMs({ year, month, day, hour: p.hour, minute: p.minute, second: p.second });
}

export function addIsoDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isoToday() { return easternDateKey(Date.now()); }

function formatInstant(ms, includeTime = false) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(ms));
}

function periodLabel(period) {
  return { week: 'ROLLING 7 DAYS', month: 'ROLLING MONTH', year: 'YEAR TO DATE', allTime: 'NOV 1, 2020 TO NOW', custom: 'CUSTOM RANGE' }[period] || period;
}

export function getWindow(period, custom = {}, nowMs = Date.now()) {
  let startMs;
  let endMs = nowMs;
  if (period === 'week') startMs = shiftEasternDays(nowMs, -7);
  else if (period === 'month') startMs = subtractEasternMonth(nowMs);
  else if (period === 'year') {
    const p = easternParts(nowMs);
    startMs = easternMs({ year: p.year, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
  } else if (period === 'allTime') startMs = easternDateMs(ALL_TIME_START);
  else if (period === 'custom') {
    startMs = easternDateMs(custom.start);
    endMs = easternDateMs(custom.end, true);
  } else throw new Error(`Unsupported period: ${period}`);

  const duration = endMs - startMs;
  let previousStartMs;
  let previousEndMs;
  if (period === 'year' || period === 'allTime') {
    previousStartMs = startMs;
    previousEndMs = Math.max(startMs, shiftEasternDays(endMs, -7));
  } else {
    previousEndMs = startMs;
    previousStartMs = startMs - duration;
  }

  const label = period === 'custom'
    ? `${formatInstant(startMs)} — ${formatInstant(endMs - 1)} · CUSTOM RANGE`
    : `${formatInstant(startMs, period === 'week' || period === 'month')} — NOW · ${periodLabel(period)}`;

  return { period, startMs, endMs, previousStartMs, previousEndMs, duration, label };
}

async function apiGet(path, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${API}${path}?${query}`, { headers: { Accept: 'application/json' }, mode: 'cors' });
  if (!response.ok) throw new Error(`stats.fm returned ${response.status}`);
  return response.json();
}

function normalizeTop(raw, category) {
  const config = categoryMap[category];
  const obj = raw?.[config.key] || {};
  const artists = obj.artists || [];
  const albums = obj.albums || [];
  let image = obj.image || '';
  if (!image) image = albums.find(x => x.image)?.image || '';
  if (!image) image = artists.find(x => x.image)?.image || '';
  return {
    id: String(obj.id || ''),
    name: obj.name || 'Unknown',
    artist: artists.map(a => a.name).filter(Boolean).join(', '),
    genres: obj.genres || [],
    image,
    plays: Number(raw.streams ?? raw.count ?? 0),
    playedMs: Number(raw.playedMs ?? raw.durationMs ?? 0),
    sourceRank: Number(raw.position ?? 0) || null,
  };
}

async function topItems(category, startMs, endMs, limit) {
  const config = categoryMap[category];
  const payload = await apiGet(`/users/${encodeURIComponent(STATS_USER)}/top/${config.endpoint}`, {
    after: String(Math.round(startMs)), before: String(Math.round(endMs)), limit: String(limit), offset: '0',
  });
  return (payload.items || []).map(x => normalizeTop(x, category)).filter(x => x.id);
}

async function dailyRows(category, itemId, startMs, endMs) {
  const endpoint = categoryMap[category].endpoint;
  const payload = await apiGet(`/users/${encodeURIComponent(STATS_USER)}/streams/${endpoint}/${encodeURIComponent(itemId)}/stats/per-day`, {
    after: String(Math.round(startMs)), before: String(Math.round(endMs)), timeZone: 'America/New_York',
  });
  let rows = payload?.items?.days || payload?.items || {};
  if (rows?.days) rows = rows.days;
  const normalized = {};
  for (const [key, row] of Object.entries(rows || {})) {
    const local = easternDateKey(new Date(key).getTime());
    const current = normalized[local] || { count: 0, durationMs: 0 };
    normalized[local] = {
      count: current.count + Number(row.count ?? row.streams ?? 0),
      durationMs: current.durationMs + Number(row.durationMs ?? row.playedMs ?? 0),
    };
  }
  const result = [];
  const startKey = easternDateKey(startMs);
  const endKey = easternDateKey(endMs - 1);
  let cursor = startKey;
  let guard = 0;
  while (cursor <= endKey && guard < 2500) {
    result.push(normalized[cursor] || { count: 0, durationMs: 0 });
    cursor = addIsoDays(cursor, 1);
    guard += 1;
  }
  return result;
}

async function mapLimit(items, concurrency, mapper) {
  const result = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      result[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return result;
}

function bucket(values, count) {
  if (!values.length) return Array(count).fill(0);
  if (values.length <= count) return values.slice();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * values.length / count);
    const end = Math.max(start + 1, Math.floor((i + 1) * values.length / count));
    out.push(values.slice(start, end).reduce((a, b) => a + b, 0));
  }
  return out;
}

function trajectoryFor(daily, period) {
  const values = daily.map(x => x.count);
  const target = period === 'week' ? 7 : period === 'month' ? 8 : period === 'custom' ? Math.min(12, Math.max(4, Math.ceil(values.length / 7))) : 10;
  if (period === 'year' || period === 'allTime') {
    let running = 0;
    const cumulative = values.map(value => (running += value));
    if (cumulative.length <= target) return cumulative;
    return Array.from({ length: target }, (_, index) => {
      const point = Math.min(cumulative.length - 1, Math.round(index * (cumulative.length - 1) / (target - 1)));
      return cumulative[point];
    });
  }
  return bucket(values, target);
}

function scoreLong(items) {
  const maxPlays = Math.max(1, ...items.map(x => x.plays));
  const maxMs = Math.max(1, ...items.map(x => x.playedMs));
  return items.map(item => ({
    ...item,
    powerScore: 100 * (0.75 * item.plays / maxPlays + 0.25 * item.playedMs / maxMs),
  })).sort((a, b) => b.powerScore - a.powerScore || b.plays - a.plays || b.playedMs - a.playedMs)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function scoreShort(items) {
  const maxPlays = Math.max(1, ...items.map(x => x.plays));
  const maxMs = Math.max(1, ...items.map(x => x.playedMs));
  return items.map(item => {
    const daily = item.daily || [];
    const activeDays = daily.filter(x => x.count > 0).length;
    const consistency = daily.length ? activeDays / daily.length : 0;
    const recentLength = Math.max(1, Math.floor(daily.length / 4));
    const recent = daily.slice(-recentLength).reduce((sum, x) => sum + x.count, 0) / recentLength;
    const priorRows = daily.slice(0, -recentLength);
    const prior = priorRows.length ? priorRows.reduce((sum, x) => sum + x.count, 0) / priorRows.length : 0;
    const momentum = Math.max(recent, prior) > 0 ? recent / Math.max(recent, prior) : 0;
    return {
      ...item,
      activeDays,
      powerScore: 60 * item.plays / maxPlays + 20 * item.playedMs / maxMs + 15 * consistency + 5 * momentum,
    };
  }).sort((a, b) => b.powerScore - a.powerScore || b.plays - a.plays || b.playedMs - a.playedMs)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function trajectoryDelta(values) {
  if (!values?.length) return 0;
  const first = values.find(v => v > 0) ?? 0;
  const last = values.at(-1) ?? 0;
  return Math.round(((last - first) / Math.max(1, first)) * 1000) / 10;
}

function analysis(items, category, period) {
  if (!items.length) return {};
  const leader = items[0];
  const gap = items[1] ? Math.abs(leader.powerScore - items[1].powerScore) : null;
  const risers = items.filter(x => x.previousRank != null).map(x => ({ item: x, move: x.previousRank - x.rank })).sort((a, b) => b.move - a.move);
  const best = risers.find(x => x.move > 0);
  const scope = { week: 'rolling seven-day', month: 'rolling one-month', year: 'year-to-date', allTime: 'November 2020-to-now', custom: 'custom-range' }[period];
  return {
    headline: `${leader.name} controls the No. 1 position.`,
    writeup: `${leader.name} leads the ${categoryMap[category].singular} rankings across the live ${scope} window with ${numberFormat(leader.plays)} plays.${best ? ` ${best.item.name} makes the strongest rise, gaining ${best.move} positions.` : ''}${gap == null ? '' : ` The lead is ${gap < 5 ? 'tight' : 'clear'} at ${gap.toFixed(1)} Power Score points.`}`,
    leader: leader.name,
    biggestMove: best ? `${best.item.name} +${best.move}` : 'Stable board',
    closestRace: gap == null ? '—' : `${gap.toFixed(1)} PTS`,
  };
}

function cacheKey(category, period, limit, custom) {
  const rounded = Math.floor(Date.now() / CACHE_TTL_MS);
  return `spr-live-v3:${STATS_USER}:${category}:${period}:${limit}:${custom?.start || ''}:${custom?.end || ''}:${rounded}`;
}

function getCached(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Date.now() - parsed.savedAt < CACHE_TTL_MS ? parsed.value : null;
  } catch { return null; }
}

function setCached(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch { }
}

export async function buildLiveChart(category, period, { limit = 5, custom = null, force = false, trajectories = true } = {}) {
  const key = cacheKey(category, period, limit, custom);
  if (!force) {
    const cached = getCached(key);
    if (cached) return cached;
  }

  const window = getWindow(period, custom || {});
  const candidateLimit = Math.min(40, Math.max(limit + 7, limit === 25 ? 30 : 12));
  const [currentRaw, previousRaw] = await Promise.all([
    topItems(category, window.startMs, window.endMs, candidateLimit),
    topItems(category, window.previousStartMs, window.previousEndMs, candidateLimit),
  ]);

  let ranked;
  if (period === 'week' || period === 'month' || period === 'custom') {
    const enriched = await mapLimit(currentRaw, 5, async item => {
      let daily = [];
      try { daily = await dailyRows(category, item.id, window.startMs, window.endMs); } catch { daily = []; }
      return { ...item, daily };
    });
    ranked = scoreShort(enriched);
  } else {
    ranked = scoreLong(currentRaw);
  }

  const previousRanked = (period === 'year' || period === 'allTime') ? scoreLong(previousRaw) : previousRaw.map((item, index) => ({ ...item, rank: item.sourceRank || index + 1 }));
  const previousPositions = new Map(previousRanked.map(x => [x.id, x.rank]));
  let items = ranked.slice(0, limit).map(item => ({
    ...item,
    previousRank: previousPositions.get(item.id) ?? null,
    peakRank: Math.min(item.rank, previousPositions.get(item.id) ?? item.rank),
    chartTenure: 'LIVE',
  }));

  if (trajectories) {
    items = await mapLimit(items, 5, async item => {
      let daily = item.daily || [];
      if (!daily.length) {
        try { daily = await dailyRows(category, item.id, window.startMs, window.endMs); } catch { daily = []; }
      }
      const trajectory = trajectoryFor(daily, period);
      return {
        ...item,
        activeDays: daily.filter(x => x.count > 0).length,
        trajectory,
        trajectoryDelta: trajectoryDelta(trajectory),
        trajectoryCaption: period === 'week' ? 'ROLLING 7 DAYS · DAILY' : period === 'month' ? 'ROLLING MONTH · CHECKPOINTS' : period === 'year' ? 'YEAR TO DATE · CHECKPOINTS' : period === 'allTime' ? 'NOV 2020 TO NOW · CHECKPOINTS' : 'CUSTOM RANGE · CHECKPOINTS',
      };
    });
  }

  const chart = {
    rangeLabel: `${window.label} · LIVE FROM STATS.FM`,
    items,
    analysis: analysis(items, category, period),
    refreshedAt: Date.now(),
    period,
    category,
  };
  setCached(key, chart);
  return chart;
}

export function top25Url(category, period, custom = null) {
  const params = new URLSearchParams({ category, period });
  if (custom?.start && custom?.end) {
    params.set('start', custom.start);
    params.set('end', custom.end);
  }
  return `./top25.html?${params}`;
}
