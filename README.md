# Dante's Spotify Power Rankings

A static Netlify dashboard for Dante Ivery's weekly Spotify listening charts.

## Published charts

- Songs: This Week, This Month, This Year, All Time
- Artists: This Week, This Month, This Year, All Time
- Albums: This Week, This Month, This Year, All Time

The weekly scoring window is closed and fixed: Sunday at 9:00 AM Eastern through the following Sunday at 8:59:59 AM Eastern. The monthly chart contains the four completed chart weeks ending at the same cutoff.

## Automation

GitHub Actions retrieves public stats.fm data once each Sunday, calculates Power Scores, saves a dated historical snapshot, and updates `data/latest.json`. Netlify then publishes that one repository commit. Opening the website never recalculates rankings.

The updater also performs a best-effort public Spotify On Repeat check. Matches are shown only when the song title and artist can both be verified; On Repeat never changes a Power Score.

## Netlify

Import this repository as an existing project. There is no build command. The publish directory is the repository root (`.`), as configured in `netlify.toml`.
