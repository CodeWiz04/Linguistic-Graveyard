#  Linguistic Graveyard

> *Every two weeks, a language dies forever. Here are the ones still breathing.*

A web app that lets you explore the world's dying languages using the **Endangered Languages Project API** and **Wikipedia API** — both free, no key required.

**What makes it different from just visiting the ELP website:** You get a unified search across name, country, and family; estimated extinction timelines; automatic Wikipedia context loaded per language; and a haunting interface that makes the stakes feel real. The ELP website has no combined search, no expiry estimates, and no Wikipedia integration.

---

## How to Run

### Prerequisites
- [Node.js](https://nodejs.org/) v16 or higher (`node --version` to check)
- `npm` (comes with Node)

### Steps (fresh machine)

```bash
# 1. Clone or download this repo
git clone <repo-url>
cd linguistic-graveyard

# 2. Install dependencies (just express + node-fetch + cors)
npm install

# 3. Start the server
npm start

# 4. Open your browser
open http://localhost:3000
```

That's it. **No API key needed.** Both APIs (Endangered Languages Project + Wikipedia) are fully public and free.

### Optional: change the port

```bash
PORT=8080 npm start
```

---

## What You Can Do

- **Search** by language name (`Cornish`), country (`Papua New Guinea`), or family (`Turkic`)
- **Click any result** to open a full detail view with speaker counts, endangerment level, estimated extinction window, and a Wikipedia extract
- **Random** — hit the Random button to discover a language you've never heard of
- **Quick chips** — one-click region buttons along the top

---

## No API Key Required

The two APIs used:

| API | Endpoint | Auth |
|-----|----------|------|
| Endangered Languages Project | `endangeredlanguages.com/api/1/language/` | None |
| Wikipedia REST API | `en.wikipedia.org/api/rest_v1/page/summary/` | None |

---

## Error Handling

The app handles all three test scenarios:

| Scenario | Behavior |
|----------|----------|
| **API is slow** | 8-second server-side timeout + 10-second client-side timeout; user sees a clear timeout message |
| **API returns an error** | HTTP status surfaced as a user-readable message; no crash |
| **Bad user input** | Empty query rejected client-side + server-side; input capped at 100 chars; IDs validated with regex |

---

## Stack

See `ANSWERS.md` for the full rationale.

---

## Project Structure

```
linguistic-graveyard/
├── server.js        ← Express backend + API proxy + data normalisation
├── public/
│   └── index.html   ← Single-page frontend (vanilla JS, no build step)
├── package.json
├── README.md
└── ANSWERS.md
```
