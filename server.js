const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const http = require("http");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT = 8000; // 8 seconds before we give up on slow API
const fallbackLanguages = require("./data/fallback-languages.json");

// Helper: fetch with timeout so a slow API doesn't hang the user forever
async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error("API_TIMEOUT");
    }
    throw err;
  }
}

function searchFallbackLanguages(query) {
  const normalized = query.trim().toLowerCase();
  return fallbackLanguages.filter((lang) => {
    if (lang.name.toLowerCase().includes(normalized)) return true;
    if (lang.family?.toLowerCase().includes(normalized)) return true;
    if (lang.iso639?.toLowerCase().includes(normalized)) return true;
    if (lang.altNames?.some((name) => name.toLowerCase().includes(normalized))) return true;
    if (lang.countries?.some((country) => country.toLowerCase().includes(normalized))) return true;
    if (lang.description?.toLowerCase().includes(normalized)) return true;
    return false;
  });
}

function getFallbackLanguageById(id) {
  return fallbackLanguages.find((lang) => String(lang.id) === String(id)) || null;
}

function getRandomFallbackLanguage() {
  return fallbackLanguages[Math.floor(Math.random() * fallbackLanguages.length)];
}

// --- Route: Search languages by country or name ---
// Uses the Endangered Languages Project API (no key required)
app.get("/api/languages", async (req, res) => {
  const { query } = req.query;

  // Validate user input — reject empty or suspiciously long strings
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ error: "BAD_INPUT", message: "Please provide a search query." });
  }
  const sanitized = query.trim().slice(0, 100); // hard cap at 100 chars

  try {
    const url = `https://endangeredlanguages.com/api/1/language/?q=${encodeURIComponent(sanitized)}&format=json&limit=20`;
    const apiRes = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT);

    if (apiRes.status === 403) {
      const languages = searchFallbackLanguages(sanitized);
      return res.json({ languages, total: languages.length, fallback: true });
    }

    if (!apiRes.ok) {
      // API returned an error status — surface it cleanly
      return res.status(502).json({
        error: "API_ERROR",
        message: `Endangered Languages API responded with ${apiRes.status}.`,
      });
    }

    const data = await apiRes.json();

    // The ELP API returns { results: [...] }
    if (!data || !Array.isArray(data.results)) {
      return res.status(502).json({ error: "API_MALFORMED", message: "Unexpected response from API." });
    }

    if (data.results.length === 0) {
      return res.json({ languages: [], total: 0 });
    }

    // Normalise & enrich each language record
    const languages = data.results.map((lang) => normaliseLanguage(lang));
    return res.json({ languages, total: data.count || languages.length });
  } catch (err) {
    if (err.message === "API_TIMEOUT" || err.code === "ENOTFOUND" || err.code === "ECONNREFUSED" || err.code === "EAI_AGAIN") {
      const languages = searchFallbackLanguages(sanitized);
      return res.json({ languages, total: languages.length, fallback: true });
    }
    console.error("Language search error:", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong on our end." });
  }
});

// --- Route: Get Wikipedia extract for a language ---
app.get("/api/wiki/:name", async (req, res) => {
  const name = req.params.name;
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: "BAD_INPUT", message: "Language name required." });
  }

  try {
    const searchTerm = encodeURIComponent(`${name.trim()} language`);
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${searchTerm}`;
    const wikiRes = await fetchWithTimeout(url, {}, 6000);

    if (wikiRes.status === 404) {
      // Wikipedia doesn't always have a page — return gracefully
      return res.json({ extract: null, thumbnail: null });
    }
    if (!wikiRes.ok) {
      return res.json({ extract: null, thumbnail: null });
    }

    const wikiData = await wikiRes.json();
    return res.json({
      extract: wikiData.extract || null,
      thumbnail: wikiData.thumbnail?.source || null,
      wikiUrl: wikiData.content_urls?.desktop?.page || null,
    });
  } catch (err) {
    if (err.message === "API_TIMEOUT") {
      return res.json({ extract: null, thumbnail: null, timedOut: true });
    }
    return res.json({ extract: null, thumbnail: null });
  }
});

// --- Route: Get a single language detail by ELP ID ---
app.get("/api/language/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: "BAD_INPUT", message: "Invalid language ID." });
  }

  try {
    const url = `https://endangeredlanguages.com/api/1/language/${id}/?format=json`;
    const apiRes = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT);

    if (apiRes.status === 404) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Language not found." });
    }
    if (apiRes.status === 403) {
      const fallback = getFallbackLanguageById(id);
      if (fallback) return res.json(fallback);
      return res.status(502).json({ error: "API_UNAVAILABLE", message: "Endangered Languages API is unavailable or blocked." });
    }
    if (!apiRes.ok) {
      return res.status(502).json({ error: "API_ERROR", message: `API returned ${apiRes.status}.` });
    }

    const data = await apiRes.json();
    return res.json(normaliseLanguage(data));
  } catch (err) {
    if (err.message === "API_TIMEOUT" || err.code === "ENOTFOUND" || err.code === "ECONNREFUSED" || err.code === "EAI_AGAIN") {
      const fallback = getFallbackLanguageById(id);
      if (fallback) return res.json(fallback);
    }
    if (err.message === "API_TIMEOUT") {
      return res.status(504).json({ error: "TIMEOUT", message: "API timed out fetching language details." });
    }
    console.error("Language detail error:", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong." });
  }
});

// --- Route: Random endangered language (for discovery) ---
app.get("/api/random", async (req, res) => {
  // Pick a random offset in a broad search
  const offset = Math.floor(Math.random() * 200);
  try {
    const url = `https://endangeredlanguages.com/api/1/language/?format=json&limit=1&offset=${offset}`;
    const apiRes = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT);
    if (apiRes.status === 403) {
      return res.json(getRandomFallbackLanguage());
    }
    if (!apiRes.ok) {
      return res.status(502).json({ error: "API_ERROR", message: "Could not fetch random language." });
    }
    const data = await apiRes.json();
    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ error: "NOT_FOUND", message: "No language found at this offset." });
    }
    return res.json(normaliseLanguage(data.results[0]));
  } catch (err) {
    if (err.message === "API_TIMEOUT" || err.code === "ENOTFOUND" || err.code === "ECONNREFUSED" || err.code === "EAI_AGAIN") {
      return res.json(getRandomFallbackLanguage());
    }
    if (err.message === "API_TIMEOUT") {
      return res.status(504).json({ error: "TIMEOUT", message: "API timed out." });
    }
    return res.status(500).json({ error: "SERVER_ERROR", message: "Something went wrong." });
  }
});

// ---- Normalise a raw ELP language object ----
function normaliseLanguage(raw) {
  // ELP API is inconsistent — fields may be arrays, strings, or missing
  const speakers = extractSpeakers(raw);
  return {
    id: raw.id || raw.language_code || null,
    name: raw.name || raw.language_name || "Unknown Language",
    altNames: raw.altnames || raw.alternate_names || [],
    countries: extractCountries(raw),
    endangermentLevel: raw.endangerment_level || raw.level || null,
    speakerCount: speakers,
    speakerTrend: raw.speaker_number_trends || null,
    iso639: raw.iso639_3 || raw.iso || null,
    family: raw.language_family || raw.family || null,
    description: raw.description || null,
    location: {
      lat: raw.latitude || raw.lat || null,
      lng: raw.longitude || raw.lon || null,
    },
    expiryEstimate: estimateExpiry(speakers, raw.endangerment_level),
    lastUpdated: raw.last_updated || null,
  };
}

function extractCountries(raw) {
  if (Array.isArray(raw.countries)) return raw.countries;
  if (typeof raw.countries === "string") return [raw.countries];
  if (Array.isArray(raw.country)) return raw.country;
  return [];
}

function extractSpeakers(raw) {
  // Speaker count may be a range string like "100-200" or a number
  const val = raw.number_of_speakers || raw.speakers || raw.speaker_count;
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    // Handle ranges: take lower bound
    const match = val.replace(/,/g, "").match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }
  return null;
}

// Rough "last-speaker" year estimate based on speaker count & endangerment
function estimateExpiry(speakers, level) {
  if (!speakers && !level) return null;
  const now = new Date().getFullYear();

  // Critically endangered with < 10 speakers: could be gone this decade
  if (level && level.toLowerCase().includes("dormant")) return "Already dormant";
  if (level && level.toLowerCase().includes("awakening")) return "Being revived";

  if (speakers !== null) {
    if (speakers === 0) return "Possibly extinct";
    if (speakers < 10) return `~${now + 5}–${now + 15}`;
    if (speakers < 50) return `~${now + 10}–${now + 30}`;
    if (speakers < 200) return `~${now + 20}–${now + 50}`;
    if (speakers < 1000) return `~${now + 30}–${now + 80}`;
    return "Unclear — depends on intergenerational transmission";
  }

  if (level) {
    const l = level.toLowerCase();
    if (l.includes("critically")) return `~${now + 5}–${now + 20}`;
    if (l.includes("severely")) return `~${now + 15}–${now + 40}`;
    if (l.includes("definitely")) return `~${now + 30}–${now + 70}`;
  }
  return null;
}

const START_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT = START_PORT + 10;

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n🪦  Linguistic Graveyard running at http://localhost:${port}\n`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && port < MAX_PORT) {
      console.warn(`Port ${port} is in use. Trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is in use. Please free the port or set PORT to a different value.`);
      process.exit(1);
    }

    console.error("Server error:", err);
    process.exit(1);
  });
}

startServer(START_PORT);
