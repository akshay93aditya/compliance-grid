# Local launchd cron for the content-hash patrol

GitHub Actions runners run from US-based IPs that Indian government portals
(e.g. `karmikaspandana.karnataka.gov.in`) IP-block or geo-restrict. The
`cg patrol` half of the daily sync therefore can't run reliably from CI.
This directory provides a launchd job that runs patrol nightly from the
operator's laptop, where the originating IP is Indian.

## What stays in CI vs. here

| Component | Runs in CI? | Runs locally? | Why |
|---|---|---|---|
| `cg pull` (federation sync) | ✅ daily at 00:30 UTC via `.github/workflows/sync.yml` | optional | Reaches GitHub-hosted git remote; works from any IP. |
| `cg patrol` (content-hash diff + re-extract on change) | ❌ | ✅ daily at 02:00 local via launchd | Needs to fetch Indian government portals directly; CI IPs are blocked. |

## Install (one-time)

```bash
# 1. Render the plist with your absolute repo path. Do NOT use a path
#    under ~/Documents/, ~/Desktop/, or ~/Downloads/ — macOS TCC blocks
#    launchd-spawned processes from reading those locations without
#    Full Disk Access permission. ~/code/ or ~/dev/ work without any UI
#    permission step.
REPO_PATH="$HOME/code/compliance-grid"
sed "s|__REPO_PATH__|$REPO_PATH|g" \
  "$REPO_PATH/scripts/launchd/com.compliance-grid.patrol.plist" \
  > "$HOME/Library/LaunchAgents/com.compliance-grid.patrol.plist"

# 2. Load the job. launchd starts honoring the StartCalendarInterval
#    immediately and persists across reboots.
launchctl bootstrap gui/$(id -u) \
  "$HOME/Library/LaunchAgents/com.compliance-grid.patrol.plist"

# 3. (optional) Trigger one run now to verify wiring.
launchctl kickstart -k gui/$(id -u)/com.compliance-grid.patrol
```

## Inspect

```bash
# Is the job loaded?
launchctl list | grep compliance-grid

# Most recent log (the wrapper writes one per run, plus launchd's own out/err)
ls -t logs/patrol/ | head -3
tail -50 logs/patrol/$(ls -t logs/patrol/ | head -1)
```

## Stop / uninstall

```bash
launchctl bootout gui/$(id -u)/com.compliance-grid.patrol
rm "$HOME/Library/LaunchAgents/com.compliance-grid.patrol.plist"
```

## Why launchd, not crontab

macOS effectively deprecated `cron` years ago; launchd is the supported
scheduler and it's better at handling sleep/wake correctly (a missed
run while the laptop was off is honored on next wake by default — and
explicitly skipped here via `RunAtLoad: false` to avoid double-runs at
boot).
