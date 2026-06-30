# GitHub Actions Setup for Phase 3

This document explains how to set up automated updates for your news aggregator using GitHub Actions.

## Prerequisites

1. Your project pushed to GitHub
2. A Groq API key (from https://console.groq.com/keys)

## Setup Instructions

### Step 1: Add Your Groq API Key as a GitHub Secret

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. **Name:** `GROQ_API_KEY`
5. **Value:** Your Groq API key (e.g., `gsk_...`)
6. Click **Add secret**

### Step 2: Verify the Workflow File

The workflow is already in place at `.github/workflows/update.yml`. It will:

- Run **every hour at the top of the hour** (configurable)
- Fetch latest RSS feeds
- Deduplicate and rank stories
- Build the HTML page
- Commit changes back to the repo

### Step 3: Test the Workflow

1. Go to **Actions** tab in your GitHub repository
2. Click **Update News Aggregator** workflow
3. Click **Run workflow** → **Run workflow** (green button)
4. Watch the job complete (should take 2-3 minutes)
5. Verify the update in your repo — you should see new commits with timestamp

## Schedule Options

The workflow runs on a cron schedule. To change it:

**Every hour:**
```yaml
- cron: '0 * * * *'  # Current setting
```

**Every 6 hours:**
```yaml
- cron: '0 0,6,12,18 * * *'
```

**Daily at 9am UTC:**
```yaml
- cron: '0 9 * * *'
```

Edit `.github/workflows/update.yml` and update the `cron` line to your preferred schedule.

## What Gets Committed

Each workflow run commits:
- `data/latest.json` — The ranked, categorized stories
- `public/index.html` — The generated webpage

These are the build outputs that power your live aggregator. Raw feed data (`data/raw-stories.json`) is not committed.

## Troubleshooting

### Workflow fails with "GROQ_API_KEY not found"

→ Make sure you added the secret in Settings. Check the name is exactly `GROQ_API_KEY`.

### Workflow succeeds but no commit appears

→ Check if there were no changes (i.e., stories haven't updated significantly). The workflow only commits if the content actually changed.

### Rate limit errors from RSS feeds

→ Some feeds rate-limit aggressive fetching. Space out workflow runs by increasing the cron interval (e.g., every 6 hours instead of hourly).

## Next: Phase 4 (Hosting)

Once workflows are running smoothly, deploy the `public/` folder to **Cloudflare Pages** for free hosting:

1. Create a Cloudflare account (free tier)
2. Connect your GitHub repo to Cloudflare Pages
3. Set build command: (leave blank — it's static HTML)
4. Set publish directory: `public`

Your aggregator will be live and auto-updating!

## Workflow File Details

- **Trigger:** Cron schedule + manual dispatch from GitHub UI
- **Node version:** 20 (latest LTS)
- **Skips CI:** Commits include `[skip ci]` to avoid triggering another workflow run
- **Git config:** Uses GitHub Actions bot account for commits
- **Logging:** Final output shows story count and timestamp
