# Quick Start Guide

## ✅ What's Already Done

The news aggregator pipeline has been fully set up:

- **Fetched 639 stories** from RSS feeds (Phase 1a) ✓
- **Project structure** created with all scripts and configs ✓
- **Data files** ready for processing (`data/latest.json`)
- **Dependencies** installed (`npm install`)

## ⏭️ What You Need to Do (5 minutes)

### Step 1: Get a Groq API Key

1. Go to **https://console.groq.com/keys**
2. Sign up for free (takes ~2 minutes)
3. Click "Create API Key"
4. Copy the key

### Step 2: Add the Key to `.env`

Edit `.env` in the project root and replace the placeholder:

```
GROQ_API_KEY=gsk_your_actual_key_here
```

(Don't commit `.env` — it's in `.gitignore`)

### Step 3: Run the Pipeline

```bash
# Complete all phases at once:
npm run build

# Or run individually:
node src/dedupe-and-rank.js    # Phase 1b: Dedupe + rank with LLM
node src/build-site.js          # Phase 2: Generate HTML
```

## 🎯 Final Output

After running `npm run build`:

- **`data/latest.json`** — Ranked, categorized list of up to 100 stories
- **`public/index.html`** — Webpage ready to view

Open `public/index.html` in your browser to see the final result!

## 📊 What Each Script Does

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `fetch-feeds.js` | Fetch RSS feeds from 27 sources | — | `data/latest.json` (639 stories) |
| `dedupe-and-rank.js` | Cluster similar stories, call LLM to rank | `data/latest.json` | `data/latest.json` (100 ranked stories) |
| `build-site.js` | Generate HTML from ranked stories | `data/latest.json` | `public/index.html` |

## 🚀 Next Steps After Getting API Key

```bash
# 1. Add GROQ_API_KEY to .env

# 2. Run everything:
npm run build

# 3. Open in browser:
open public/index.html
```

## ❓ Troubleshooting

**"Error: GROQ_API_KEY environment variable not set"**
→ Add your key to `.env` and make sure the file is saved

**"Error: Feed not recognized"**
→ Some feed URLs may need updating. Run `node src/test-feeds.js` to check which feeds are working

**LLM categorization fails**
→ The system falls back to ranking by source count (still works, just less sophisticated)

## 📝 Notes

- All dependencies are on **free tiers** (NPR, BBC, Groq, etc.)
- **639 stories** were fetched; the LLM will rank and select the top 100
- Paywalled sources (NYT, WSJ, FT, etc.) are **automatically filtered out**
- Results refresh every time you run the pipeline
- HTML is plain, no CSS frameworks (as per requirements)

---

**Ready?** Get your Groq key and run `npm run build`!
