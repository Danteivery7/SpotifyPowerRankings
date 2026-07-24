#!/usr/bin/env python3
"""Production entry point for the weekly Spotify Power Rankings publisher.

stats.fm returns per-day dictionary keys as UTC ISO timestamps even when an IANA
reporting timezone is requested. The core ranking module works with local
calendar dates, so this entry point normalizes those keys before publishing.
"""

import sys
from datetime import datetime

import update_rankings as rankings


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
                "count": int(existing.get("count") or 0) + int(row.get("count") or row.get("streams") or 0),
                "durationMs": int(existing.get("durationMs") or existing.get("playedMs") or 0)
                + int(row.get("durationMs") or row.get("playedMs") or 0),
            }
        else:
            normalized[local_day] = row
    return normalized


rankings.day_map = normalized_day_map


if __name__ == "__main__":
    try:
        rankings.main()
    except Exception as error:
        print(f"Update failed; existing edition preserved: {error}", file=sys.stderr)
        raise SystemExit(1)
