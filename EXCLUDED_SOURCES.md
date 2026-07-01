# Excluded Sources

This is the master exclusion list for the news aggregator. Any story whose
publisher (or link domain) matches an entry below is dropped during fetching,
before ranking or display.

**How it works:** `src/fetch-feeds.js` parses this file at build time. It reads
every markdown list item (`- entry`) in the sections below. An entry that looks
like a bare domain (e.g. `tmz.com`) is matched against the article's link
domain; every other entry is matched against the publisher name as a whole word
(case-insensitive, a leading "The" is ignored). Add or remove entries by simply
editing the lists — no code changes required.

> Note: Google News links are redirects that hide the real domain, so publisher
> **names** are the primary matching mechanism. When adding a domain, also add
> the outlet's display name (e.g. add both `tmz.com` and `TMZ`).

---

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

- TMZ
- Page Six
- Medium

## Excluded domains

Matched against the article's link domain (for direct, non-redirected feeds).

- medium.com
- tmz.com
- pagesix.com
