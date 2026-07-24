#!/usr/bin/env python3
"""Build one closed Sunday Spotify Power Rankings edition from public stats.fm data."""

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://api.stats.fm/api/v1"
USER = os.getenv("STATSFM_USER", "31c4puiblaxm3wzzwg3hfc7t75yq")
TZ = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "latest.json"
HIST = ROOT / "data" / "history"
HIST.mkdir(parents=True, exist_ok=True)
CATS = {
    "songs": ("tracks", "track"),
    "artists": ("artists", "artist"),
    "albums": ("albums", "album"),
}


def get(path, params=None, timeout=45):
    query = "?" + urllib.parse.urlencode(params) if params else ""
    request = urllib.request.Request(
        API + path + query,
        headers={"Accept": "application/json", "User-Agent": "DantePowerRankings/2.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def sunday_cutoff(now=None):
    now = (now or datetime.now(TZ)).astimezone(TZ)
    days_since_sunday = (now.weekday() + 1) % 7
    cutoff = (now - timedelta(days=days_since_sunday)).replace(
        hour=9, minute=0, second=0, microsecond=0
    )
    return cutoff if now >= cutoff else cutoff - timedelta(days=7)


def ms(value):
    return int(value.timestamp() * 1000)


def fmt(value):
    return value.strftime("%b %-d, %Y · %-I:%M %p ET")


def range_label(start, end):
    return f"{start.strftime('%b %-d, %-I:%M %p')} — {end.strftime('%b %-d, %-I:%M %p ET')}"


def normalize(item, kind):
    obj = item.get(kind) or {}
    artists = obj.get("artists") or []
    albums = obj.get("albums") or []
    image = obj.get("image") or ""
    if not image:
        image = next((album.get("image") for album in albums if album.get("image")), "")
    if not image:
        image = next((artist.get("image") for artist in artists if artist.get("image")), "")
    return {
        "id": str(obj.get("id", "")),
        "name": obj.get("name", "Unknown"),
        "artist": ", ".join(a.get("name", "") for a in artists if a.get("name")),
        "genres": obj.get("genres") or [],
        "image": image,
        "plays": int(item.get("streams") or item.get("count") or 0),
        "playedMs": int(item.get("playedMs") or item.get("durationMs") or 0),
        "sourceRank": item.get("position"),
    }


def top(category, start=None, end=None, limit=30):
    endpoint, kind = CATS[category]
    params = {"limit": limit, "offset": 0}
    if start is not None:
        params["after"] = ms(start)
    if end is not None:
        params["before"] = ms(end)
    response = get(f"/users/{urllib.parse.quote(USER)}/top/{endpoint}", params)
    result = []
    for raw in response.get("items", []):
        item = normalize(raw, kind)
        if item["id"]:
            result.append(item)
    return result


def day_map(category, item_id, start, end):
    endpoint, _ = CATS[category]
    path = (
        f"/users/{urllib.parse.quote(USER)}/streams/{endpoint}/"
        f"{urllib.parse.quote(item_id)}/stats/per-day"
    )
    response = get(
        path,
        {
            "after": ms(start),
            "before": ms(end),
            "timeZone": "America/New_York",
        },
    )
    payload = response.get("items", {})
    if isinstance(payload, dict):
        payload = payload.get("days", payload)
    return payload if isinstance(payload, dict) else {}


def daily_series(category, item_id, start, end):
    rows = day_map(category, item_id, start, end)
    series = []
    cursor = start
    while cursor < end:
        key = cursor.strftime("%Y-%m-%d")
        row = rows.get(key, {}) if isinstance(rows, dict) else {}
        series.append(
            {
                "count": int(row.get("count") or row.get("streams") or 0),
                "durationMs": int(row.get("durationMs") or row.get("playedMs") or 0),
            }
        )
        cursor += timedelta(days=1)
    return series


def bucket(values, count):
    if not values:
        return [0.0] * count
    size = len(values) / count
    output = []
    for index in range(count):
        start = int(math.floor(index * size))
        end = int(math.floor((index + 1) * size))
        if index == count - 1:
            end = len(values)
        chunk = values[start:max(start + 1, end)]
        output.append(float(sum(chunk)))
    return output


def calculate_short(items, category, start, end, days, recent_days):
    max_plays = max([x["plays"] for x in items] or [1])
    max_ms = max([x["playedMs"] for x in items] or [1])
    enriched = []
    for item in items[:15]:
        series = daily_series(category, item["id"], start, end)
        active = sum(1 for day in series if day["count"] > 0)
        recent = series[-recent_days:]
        earlier = series[:-recent_days]
        recent_rate = sum(day["count"] for day in recent) / max(1, len(recent))
        earlier_rate = sum(day["count"] for day in earlier) / max(1, len(earlier))
        momentum = 0.5 if recent_rate + earlier_rate == 0 else recent_rate / (recent_rate + earlier_rate)
        score = 100 * (
            0.60 * item["plays"] / max(1, max_plays)
            + 0.20 * item["playedMs"] / max(1, max_ms)
            + 0.15 * active / days
            + 0.05 * momentum
        )
        raw = [day["count"] for day in series]
        trajectory = raw if days == 7 else bucket(raw, 4)
        first = trajectory[0] if trajectory else 0
        last = trajectory[-1] if trajectory else 0
        delta = round((last - first) / max(1, first) * 100, 1)
        enriched.append(
            dict(
                item,
                powerScore=round(score, 3),
                activeDays=active,
                trajectory=trajectory,
                trajectoryDelta=delta,
                trajectoryCaption=(
                    "DAILY LISTENING · CLOSED WEEK"
                    if days == 7
                    else "FOUR COMPLETED CHART WEEKS"
                ),
            )
        )
    enriched.sort(key=lambda x: (-x["powerScore"], -x["plays"], -x["playedMs"]))
    for rank, item in enumerate(enriched, 1):
        item["rank"] = rank
    return enriched


def calculate_long(items):
    max_plays = max([x["plays"] for x in items] or [1])
    max_ms = max([x["playedMs"] for x in items] or [1])
    enriched = []
    for item in items[:20]:
        score = 100 * (
            0.75 * item["plays"] / max(1, max_plays)
            + 0.25 * item["playedMs"] / max(1, max_ms)
        )
        enriched.append(dict(item, powerScore=round(score, 3), activeDays=None))
    enriched.sort(key=lambda x: (-x["powerScore"], -x["plays"], -x["playedMs"]))
    for rank, item in enumerate(enriched, 1):
        item["rank"] = rank
    return enriched


def cumulative_trajectory(category, item_id, start, end, points=10):
    try:
        series = daily_series(category, item_id, start, end)
    except Exception:
        # A very large lifetime response may be restricted. Fall back to two recent years,
        # while retaining the true lifetime score and rank.
        fallback_start = max(start, end - timedelta(days=730))
        series = daily_series(category, item_id, fallback_start, end)
    plays = [day["count"] for day in series]
    minutes = [day["durationMs"] for day in series]
    play_buckets = bucket(plays, points)
    minute_buckets = bucket(minutes, points)
    cumulative_plays = []
    cumulative_minutes = []
    running_plays = running_minutes = 0.0
    for play_value, minute_value in zip(play_buckets, minute_buckets):
        running_plays += play_value
        running_minutes += minute_value
        cumulative_plays.append(running_plays)
        cumulative_minutes.append(running_minutes)
    max_plays = max(cumulative_plays or [1])
    max_minutes = max(cumulative_minutes or [1])
    trajectory = [
        round(100 * (0.75 * p / max(1, max_plays) + 0.25 * m / max(1, max_minutes)), 3)
        for p, m in zip(cumulative_plays, cumulative_minutes)
    ]
    delta = round(trajectory[-1] - trajectory[-2], 2) if len(trajectory) > 1 else 0
    return trajectory, delta


def history_metadata(category, period, item_id, current_rank, previous_rank):
    historical_ranks = []
    appearances = 0
    for file in sorted(HIST.glob("*.json")):
        try:
            payload = json.loads(file.read_text())
            items = payload.get("charts", {}).get(category, {}).get(period, {}).get("items", [])
            match = next((x for x in items if str(x.get("id")) == str(item_id)), None)
            if match:
                appearances += 1
                if match.get("rank"):
                    historical_ranks.append(int(match["rank"]))
        except Exception:
            continue
    candidates = [current_rank]
    if previous_rank:
        candidates.append(previous_rank)
    candidates.extend(historical_ranks)
    peak = min(candidates) if candidates else current_rank
    if period in ("week", "month"):
        tenure = f"{appearances + 1} WKS" if appearances else "BASELINE"
    else:
        tenure = f"{appearances + 1} EDITIONS" if appearances else "BASELINE"
    return peak, tenure


def attach_movement(current, previous, category, period):
    previous_positions = {x["id"]: x["rank"] for x in previous}
    output = []
    for item in current[:5]:
        previous_rank = previous_positions.get(item["id"])
        peak, tenure = history_metadata(category, period, item["id"], item["rank"], previous_rank)
        output.append(
            dict(
                item,
                previousRank=previous_rank,
                peakRank=peak,
                chartTenure=tenure,
            )
        )
    return output


def analysis(items, category, period):
    if not items:
        return {}
    leader = items[0]
    changes = [
        (x["previousRank"] - x["rank"], x)
        for x in items
        if x.get("previousRank") is not None
    ]
    biggest_up = max(changes, key=lambda pair: pair[0], default=None)
    biggest_down = min(changes, key=lambda pair: pair[0], default=None)
    gap = abs(items[0]["powerScore"] - items[1]["powerScore"]) if len(items) > 1 else None
    kind = {"songs": "song", "artists": "artist", "albums": "album"}[category]
    movement_text = "Stable board"
    if biggest_up and biggest_up[0] > 0:
        movement_text = f"{biggest_up[1]['name']} +{biggest_up[0]}"
    writeup = (
        f"{leader['name']} leads the {kind} rankings using the complete {period} scoring scope "
        f"with {leader['plays']} plays. "
    )
    if biggest_up and biggest_up[0] > 0:
        writeup += f"{biggest_up[1]['name']} makes the strongest rise, gaining {biggest_up[0]} positions. "
    if biggest_down and biggest_down[0] < 0:
        writeup += f"{biggest_down[1]['name']} records the largest decline at {abs(biggest_down[0])} positions. "
    if period in ("year", "allTime"):
        writeup += "The rank remains cumulative; the trajectory line reports pace without allowing recent listening to replace the historical totals. "
    if gap is not None:
        writeup += (
            f"The lead is narrow at {gap:.1f} Power Score points."
            if gap < 5
            else f"The leader holds a {gap:.1f}-point margin."
        )
    return {
        "headline": f"{leader['name']} controls the No. 1 position.",
        "writeup": writeup,
        "leader": leader["name"],
        "biggestMove": movement_text,
        "closestRace": "—" if gap is None else f"{gap:.1f} PTS",
    }


def short_chart(category, start, end, previous_start, previous_end, days, recent_days):
    current = calculate_short(top(category, start, end), category, start, end, days, recent_days)
    previous = calculate_short(
        top(category, previous_start, previous_end),
        category,
        previous_start,
        previous_end,
        days,
        recent_days,
    )
    items = attach_movement(current, previous, category, "week" if days == 7 else "month")
    return {
        "rangeLabel": range_label(start, end),
        "trajectoryMethod": items[0]["trajectoryCaption"] if items else "",
        "items": items,
        "analysis": analysis(items, category, "completed week" if days == 7 else "completed four-week period"),
    }


def long_chart(category, start, end, previous_end, period):
    current = calculate_long(top(category, start, end))
    previous = calculate_long(top(category, start, previous_end))
    previous_positions = {x["id"]: x["rank"] for x in previous}
    for item in current[:5]:
        trajectory, delta = cumulative_trajectory(category, item["id"], start, end)
        item["trajectory"] = trajectory
        item["trajectoryDelta"] = delta
        item["trajectoryCaption"] = (
            "CUMULATIVE CALENDAR-YEAR TRAJECTORY"
            if period == "year"
            else "CUMULATIVE LIFETIME TRAJECTORY"
        )
    items = attach_movement(current, previous, category, period)
    label = (
        f"{range_label(start, end)} · COMPARED WITH PRIOR SUNDAY CUMULATIVE"
        if period == "year"
        else "FULL IMPORTED HISTORY · COMPARED WITH PRIOR SUNDAY LIFETIME"
    )
    return {
        "rangeLabel": label,
        "trajectoryMethod": items[0]["trajectoryCaption"] if items else "",
        "items": items,
        "analysis": analysis(items, category, "calendar-year" if period == "year" else "lifetime"),
    }


def main():
    cutoff = sunday_cutoff()
    previous_cutoff = cutoff - timedelta(days=7)
    week_start = cutoff - timedelta(days=7)
    month_start = cutoff - timedelta(days=28)
    year_start = cutoff.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    # Imported histories can predate Spotify. 2000 is an inexpensive safe lower bound.
    lifetime_start = datetime(2000, 1, 1, tzinfo=TZ)

    charts = {}
    for category in CATS:
        charts[category] = {
            "week": short_chart(
                category,
                week_start,
                cutoff,
                week_start - timedelta(days=7),
                week_start,
                7,
                2,
            ),
            "month": short_chart(
                category,
                month_start,
                cutoff,
                month_start - timedelta(days=28),
                month_start,
                28,
                7,
            ),
            "year": long_chart(category, year_start, cutoff, previous_cutoff, "year"),
            "allTime": long_chart(category, lifetime_start, cutoff, previous_cutoff, "allTime"),
        }
        time.sleep(0.35)

    payload = {
        "editionLabel": f"Week ending {cutoff.strftime('%b %-d, %Y')}",
        "cutoffLabel": fmt(cutoff),
        "updatedLabel": fmt(datetime.now(TZ)),
        "sourceStatus": "stats.fm verified",
        "cutoffIso": cutoff.isoformat(),
        "isPreview": False,
        "charts": charts,
    }

    if not any(
        payload["charts"][category]["week"]["items"]
        for category in CATS
    ):
        raise RuntimeError("stats.fm returned no supported weekly rankings")

    encoded = json.dumps(payload, indent=2, ensure_ascii=False)
    temporary = OUT.with_suffix(".tmp")
    temporary.write_text(encoded)
    temporary.replace(OUT)
    (HIST / f"{cutoff.strftime('%Y-%m-%d')}.json").write_text(encoded)
    print("Published", payload["editionLabel"])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Update failed; existing edition preserved: {error}", file=sys.stderr)
        sys.exit(1)
