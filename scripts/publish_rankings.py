#!/usr/bin/env python3
"""Production entry point for the weekly Spotify Power Rankings publisher.

Normalizes stats.fm per-day UTC keys into America/New_York calendar dates and
publishes the official All Time chart from November 1, 2020 onward.
"""

import json
import sys
from datetime import datetime, timedelta

import update_rankings as rankings


ALL_TIME_START = datetime(2020, 11, 1, 0, 0, 0, tzinfo=rankings.TZ)
_raw_day_map = rankings.day_map


def normalized_day_map(category, item_id, start, end):
    rows = _raw_day_map(category, item_id, start, end)
    normalized = {}
    for raw_key, row in rows.items():
        key = str(raw_key)
        try:
            instant = datetime.fromisoformat(key.replace("Z", "+00:00"))
            local_day = instant.astimezone(rankings.TZ).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            local_day = key[:10]
        existing = normalized.get(local_day)
        if existing:
            normalized[local_day] = {
                "count": int(existing.get("count") or 0)
                + int(row.get("count") or row.get("streams") or 0),
                "durationMs": int(existing.get("durationMs") or existing.get("playedMs") or 0)
                + int(row.get("durationMs") or row.get("playedMs") or 0),
            }
        else:
            normalized[local_day] = row
    return normalized


rankings.day_map = normalized_day_map


def main():
    cutoff = rankings.sunday_cutoff()
    previous_cutoff = cutoff - timedelta(days=7)
    week_start = cutoff - timedelta(days=7)
    month_start = cutoff - timedelta(days=28)
    year_start = cutoff.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    charts = {}
    for category in rankings.CATS:
        all_time = rankings.long_chart(
            category,
            ALL_TIME_START,
            cutoff,
            previous_cutoff,
            "allTime",
        )
        all_time["rangeLabel"] = (
            f"{rankings.range_label(ALL_TIME_START, cutoff)} "
            "· COMPARED WITH PRIOR SUNDAY CUMULATIVE"
        )
        charts[category] = {
            "week": rankings.short_chart(
                category,
                week_start,
                cutoff,
                week_start - timedelta(days=7),
                week_start,
                7,
                2,
            ),
            "month": rankings.short_chart(
                category,
                month_start,
                cutoff,
                month_start - timedelta(days=28),
                month_start,
                28,
                7,
            ),
            "year": rankings.long_chart(
                category,
                year_start,
                cutoff,
                previous_cutoff,
                "year",
            ),
            "allTime": all_time,
        }
        rankings.time.sleep(0.35)

    payload = {
        "editionLabel": f"Week ending {cutoff.strftime('%b %-d, %Y')}",
        "cutoffLabel": rankings.fmt(cutoff),
        "updatedLabel": rankings.fmt(datetime.now(rankings.TZ)),
        "sourceStatus": "stats.fm verified",
        "cutoffIso": cutoff.isoformat(),
        "allTimeStartIso": ALL_TIME_START.isoformat(),
        "isPreview": False,
        "charts": charts,
    }

    if not any(payload["charts"][category]["week"]["items"] for category in rankings.CATS):
        raise RuntimeError("stats.fm returned no supported weekly rankings")

    encoded = json.dumps(payload, indent=2, ensure_ascii=False)
    temporary = rankings.OUT.with_suffix(".tmp")
    temporary.write_text(encoded)
    temporary.replace(rankings.OUT)
    (rankings.HIST / f"{cutoff.strftime('%Y-%m-%d')}.json").write_text(encoded)
    print("Published", payload["editionLabel"], "with All Time from 2020-11-01")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Update failed; existing edition preserved: {error}", file=sys.stderr)
        raise SystemExit(1)
