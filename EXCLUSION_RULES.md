# Exclusion Rules

The master exclusion policy for the news aggregator. It has two parts:

1. **Blocked publishers & domains** — outlet lists that `src/fetch-feeds.js`
   parses at build time.
2. **Content rules** — quality filters (long titles, non-article links,
   paywalls) that are enforced in code and documented here for reference.

A story is dropped during fetching — before ranking or display — if it matches
any rule below.

**How Part 1 parsing works:** `src/fetch-feeds.js` reads every markdown list
item (`- entry`) under the Part 1 sections. An entry that looks like a bare
domain (e.g. `tmz.com`) is matched against the article's link domain; every
other entry is matched against the publisher name as a whole word
(case-insensitive, a leading "The" is ignored). Add or remove entries by simply
editing the lists — no code changes required. Bullet points under **Part 2**
are documentation only and are **not** parsed as outlet names.

> Note: Google News links are redirects that hide the real domain, so publisher
> **names** are the primary matching mechanism. When adding a domain, also add
> the outlet's display name (e.g. add both `tmz.com` and `TMZ`).

---

# Part 1 — Blocked publishers & domains

## Russian state / news agencies

Outlets controlled by or aligned with the Russian state.

- RT
- RT News
- Russia Today
- TASS
- Sputnik
- Sputnik International
- RIA Novosti
- Interfax
- Izvestia
- Pravda
- Kommersant
- Gazeta.ru
- Vzglyad
- Rossiyskaya Gazeta
- Channel One Russia
- Regnum
- Lenta.ru
- Tsargrad
- NTV

## Far-right / extremist sources

Outlets commonly classified as far-right, hyperpartisan, or extremist by media
bias and fact-checking organizations. Edit as needed.

- Breitbart
- Breitbart News
- InfoWars
- The Gateway Pundit
- Gateway Pundit
- OANN
- One America News
- One America News Network
- Newsmax
- The Daily Stormer
- VDARE
- The Post Millennial
- WorldNetDaily
- WND
- American Thinker
- The Federalist
- The Epoch Times
- Epoch Times
- Rebel News
- Human Events
- National File
- Big League Politics
- Taki's Magazine

## Tabloids / gossip / low-quality

Tabloids and outlets focused on celebrity gossip, entertainment rumors, and
sensationalist coverage.

- TMZ
- Page Six
- Medium
- Daily Mail
- MailOnline
- The Sun
- Daily Star
- Daily Mirror
- The Mirror
- National Enquirer
- Radar Online
- New York Post
- E! News
- Perez Hilton
- Hollywood Life
- Just Jared
- The Blast
- OK! Magazine
- Us Weekly
- In Touch Weekly
- Life & Style
- Star Magazine
- Closer
- HELLO! Magazine
- Heat
- The Tab
- Bossip
- MediaTakeOut
- The Shade Room

---

# Part 2 — Content rules

These are enforced in code (`src/fetch-feeds.js`). The thresholds are noted
here for reference; bullet points in this part are **documentation, not outlet
names**, and are ignored by the Part 1 parser.

## Extremely long titles

Reject headlines longer than **200 characters**. These are almost never real
headlines — they're summaries, abstracts, or malformed feed entries. Example of
a title that is excluded:

> In January 2026, scientists reported that the human brain processes spoken
> language in a sequence that closely mirrors the layered architecture of
> advanced AI language models — suggesting that biological brains and artificial
> networks may build meaning through surprisingly similar step-by-step
> computations.

## Non-article links (video, audio, galleries, etc.)

Reject items that link to something other than a readable article — video,
audio/podcasts, photo galleries, live streams, and slideshows. Detection uses:

- **Link domain**: youtube.com, youtu.be, vimeo.com, dailymotion.com,
  twitch.tv, soundcloud.com, spotify.com, open.spotify.com,
  podcasts.apple.com, podcasts.google.com, iheart.com, megaphone.fm
- **Link path / extension**: `/video/`, `/videos/`, `/watch`, `/live/`,
  `/podcast`, `/audio/`, `/gallery`, `/photos/`, `/slideshow`, and media file
  extensions (`.mp4`, `.mp3`, `.m4a`, `.m3u8`)
- **Title markers** (for Google News, whose links are redirects): leading
  `Video:` / `Watch:` / `Listen:` / `Photos:` / `Gallery:` or bracketed
  `[Video]` / `(Podcast)` markers

## Paywalled articles

Reject items behind a paywall so readers never hit a subscription wall. Paywall
detection is configured in `src/paywall-domains.json`:

- **Domains** (`paywalled_domains`) matched against the article link.
- **Publisher names** (`paywalled_publishers`) matched against the outlet name —
  required because Google News redirect links hide the real domain.

To exclude another paywalled outlet, add its domain and display name there.
