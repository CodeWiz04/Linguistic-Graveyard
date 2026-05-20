# ANSWERS.md

---

## 1. How to Run

```bash
git clone <repo-url>
cd linguistic-graveyard
npm install
npm start
# → open http://localhost:3000
```

Requires Node.js v16+. No API key. No environment variables. Full steps in README.md.

---

## 2. Stack Choice

**Why this stack (Node/Express + vanilla JS frontend):**

- **No build step.** The frontend is a single `public/index.html` — no Webpack, no Vite, no TypeScript compilation. On a fresh machine: `npm install` (3 packages), `npm start`, done. Zero friction for a reviewer.
- **Express is the right weight.** The backend does three things: timeout-wrap API calls, normalise inconsistent API responses, and serve static files. Express handles all three in ~150 lines. Fastify or Hapi would be over-engineered; plain `http` would mean writing routing by hand.
- **`node-fetch` v2** (CommonJS) was chosen over the native `fetch` in Node 18+ to stay compatible with Node 16, which is still widely installed.
- **Vanilla JS frontend.** React would require a build toolchain and add complexity for what is essentially a search → render → detail flow. Vanilla JS here is a feature, not laziness.

**What would have been a worse choice:**

A Python/Django backend would work but introduces a heavier dependency tree and a slower cold-start on a fresh machine (virtual environment setup, `pip install`, `collectstatic` for Django). For a project that needs to run in one command on a fresh machine, that friction is a real cost. A full Next.js or Remix app would be even worse — it solves problems (SSR, routing, hydration) that don't exist here, and adds 200MB of `node_modules` for a project with one page.

---

## 3. One Real Edge Case

**The ELP API returns speaker counts as inconsistent types — sometimes a number, sometimes a formatted string like `"1,200–2,000"`, sometimes null.**

**File:** `server.js`  
**Function:** `extractSpeakers()` (line ~115–128)

```js
function extractSpeakers(raw) {
  const val = raw.number_of_speakers || raw.speakers || raw.speaker_count;
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const match = val.replace(/,/g, '').match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }
  return null;
}
```

**What would happen without this:** The frontend would receive `"1,200–2,000"` as a string, and `Number("1,200–2,000").toLocaleString()` returns `NaN`. The card would display `"NaN speakers"`. Worse, the `estimateExpiry()` function compares speaker count numerically — passing a string would cause all comparisons to evaluate to `false`, and every language would silently get a wrong or missing expiry estimate. The comma-stripping + regex extraction ensures we always get either a clean integer or `null`, never a corrupt value downstream.

---

## 4. AI Usage

**Tool used: Claude**

### Where AI was used:

1. **Initial concept brainstorm** — Asked for an unusual public API project idea. AI suggested "Linguistic Graveyard" (endangered languages + Wikipedia + extinction timeline). *What I changed:* The AI initially proposed using the Glottolog API, which has no public REST endpoint. I switched to the Endangered Languages Project API, which is genuinely free and public with no auth.

2. **`estimateExpiry()` function** — Asked AI to write a rough extinction-window estimator based on speaker count and endangerment level. The AI wrote a version with more buckets (10 levels). *What I changed:* I collapsed it to 6 meaningful buckets — the original was false precision. A language with 150 speakers doesn't need a different estimate from one with 120. I also added the `"Being revived"` case for "awakening" languages, which the AI missed entirely; without it, languages undergoing revitalisation (like Māori or Cornish) would show a bleak extinction estimate that's actively misleading.

3. **CSS tombstone SVG** — Asked AI to sketch a tombstone SVG for the detail panel. The AI output had hardcoded pixel fonts that don't exist in browser environments. *What I changed:* Replaced with web-safe fallbacks that are already loaded by the page, and adjusted the `text-anchor="middle"` values since the AI used left-alignment which clipped on narrow viewports.

4. **Error taxonomy** — Asked AI to list all the ways an API proxy can fail. Used this to structure the `error` field values (`TIMEOUT`, `API_ERROR`, `BAD_INPUT`, `NOT_FOUND`, `API_MALFORMED`) consistently across routes. The AI's original list included `RATE_LIMITED` — I removed it because the ELP API has no documented rate limit and adding speculative error codes makes the client harder to reason about.

---

## 5. Honest Gap

**The `estimateExpiry()` function is educated guessing dressed up as data.**

It uses speaker count and endangerment level to produce a year range like `~2035–2055`. But this is a heuristic, not a model. It doesn't account for:
- Age distribution of speakers (50 elderly speakers is very different from 50 children)
- Whether there's an active revitalisation programme
- Geographic concentration (50 speakers in one village vs 50 scattered globally)
- Language policy in the host country

**What I'd do with another day:** The ELP API returns a `speaker_number_trends` field on some language records. I'd parse this field (it's a free-text narrative like "declining rapidly" or "stable among older speakers") and run it through a lightweight NLP classifier — or pass it to a small LLM call — to assign a trend multiplier to the estimate. That would make the extinction window a function of *trajectory*, not just snapshot size, which is far more meaningful. I'd also add a disclaimer UI on any expiry estimate making clear it's a heuristic.
