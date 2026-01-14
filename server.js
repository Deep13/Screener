/**
 * server.js
 *
 * Angel One Screener (3-candle pattern) + optional LTP confirmation
 * - User selects: preset (today/1h/2h/2d), timeframe (1m/5m/15m...), indicator (VWAP/SMA/EMA/CLOSE), window
 * - Server scans up to 10 stocks and returns matched list for home table
 *
 * ENV required:
 *   ANGEL_API_KEY
 *   ANGEL_CLIENT_CODE
 *   ANGEL_MPIN           (4 digits)
 *   ANGEL_TOTP_SECRET
 *
 * Optional:
 *   PORT
 *
 * Run:
 *   npm i express dotenv smartapi-javascript otplib
 *   node server.js
 */

const express = require("express");
const path = require("path");
require("dotenv").config();

const { SmartAPI } = require("smartapi-javascript");
const { authenticator } = require("otplib");

// ------------------------------------------------------------
// Node fetch compatibility
// Node 18+ has global fetch. If not, install node-fetch and uncomment below.
// const fetch = global.fetch || ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));
if (typeof fetch === "undefined") {
  throw new Error("Global fetch not found. Use Node 18+ OR install node-fetch and enable the fallback import in server.js.");
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ------------------------------------------------------------
// Default watchlist (10 stocks). Adjust anytime.
const DEFAULT_STOCKS = [
  { exchange: "NSE", tradingsymbol: "ADANIENT-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIPORTS-EQ" },
  { exchange: "NSE", tradingsymbol: "APOLLOHOSP-EQ" },
  { exchange: "NSE", tradingsymbol: "ASIANPAINT-EQ" },
  { exchange: "NSE", tradingsymbol: "AXISBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJ-AUTO-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJFINANCE-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJFINSV-EQ" },
  { exchange: "NSE", tradingsymbol: "BPCL-EQ" },
  { exchange: "NSE", tradingsymbol: "BHARTIARTL-EQ" },
  { exchange: "NSE", tradingsymbol: "BRITANNIA-EQ" },
  { exchange: "NSE", tradingsymbol: "CIPLA-EQ" },
  { exchange: "NSE", tradingsymbol: "COALINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "DIVISLAB-EQ" },
  { exchange: "NSE", tradingsymbol: "DRREDDY-EQ" },
  { exchange: "NSE", tradingsymbol: "EICHERMOT-EQ" },
  { exchange: "NSE", tradingsymbol: "GRASIM-EQ" },
  { exchange: "NSE", tradingsymbol: "HCLTECH-EQ" },
  { exchange: "NSE", tradingsymbol: "HDFCBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "HDFCLIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "HEROMOTOCO-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDALCO-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDUNILVR-EQ" },
  { exchange: "NSE", tradingsymbol: "ICICIBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "ITC-EQ" },
  { exchange: "NSE", tradingsymbol: "INDUSINDBK-EQ" },
  { exchange: "NSE", tradingsymbol: "INFY-EQ" },
  { exchange: "NSE", tradingsymbol: "JSWSTEEL-EQ" },
  { exchange: "NSE", tradingsymbol: "KOTAKBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "LT-EQ" },
  { exchange: "NSE", tradingsymbol: "M&M-EQ" },
  { exchange: "NSE", tradingsymbol: "MARUTI-EQ" },
  { exchange: "NSE", tradingsymbol: "NESTLEIND-EQ" },
  { exchange: "NSE", tradingsymbol: "NTPC-EQ" },
  { exchange: "NSE", tradingsymbol: "ONGC-EQ" },
  { exchange: "NSE", tradingsymbol: "POWERGRID-EQ" },
  { exchange: "NSE", tradingsymbol: "RELIANCE-EQ" },
  { exchange: "NSE", tradingsymbol: "SBILIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "SBIN-EQ" },
  { exchange: "NSE", tradingsymbol: "SUNPHARMA-EQ" },
  { exchange: "NSE", tradingsymbol: "TCS-EQ" },
  { exchange: "NSE", tradingsymbol: "TATACONSUM-EQ" },
  { exchange: "NSE", tradingsymbol: "TATAMOTORS-EQ" },
  { exchange: "NSE", tradingsymbol: "TATASTEEL-EQ" },
  { exchange: "NSE", tradingsymbol: "TECHM-EQ" },
  { exchange: "NSE", tradingsymbol: "TITAN-EQ" },
  { exchange: "NSE", tradingsymbol: "ULTRACEMCO-EQ" },
  { exchange: "NSE", tradingsymbol: "UPL-EQ" },
  { exchange: "NSE", tradingsymbol: "WIPRO-EQ" },
];

// ------------------------------------------------------------
// Dummy fallback (so UI still works if session fails)
function randn() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function generateDummyData(nMinutes = 600) {
  const now = new Date();
  now.setSeconds(0, 0);

  const candles = [];
  let price = 100;

  for (let i = nMinutes - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60 * 1000);
    const open = price;
    const close = open + randn() * 0.2;
    const high = Math.max(open, close) + Math.abs(randn() * 0.3);
    const low = Math.min(open, close) - Math.abs(randn() * 0.3);
    const volume = randInt(100, 1000);
    candles.push({
      time: t.toISOString(),
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return candles;
}

// ------------------------------------------------------------
// Helpers
function mapInterval(timeframe) {
  const m = {
    "1m": "ONE_MINUTE",
    "3m": "THREE_MINUTE",
    "5m": "FIVE_MINUTE",
    "10m": "TEN_MINUTE",
    "15m": "FIFTEEN_MINUTE",
    "30m": "THIRTY_MINUTE",
    "1h": "ONE_HOUR",
    "1d": "ONE_DAY",
  };
  return m[String(timeframe || "").toLowerCase()] || "FIVE_MINUTE";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// SmartAPI commonly expects "YYYY-MM-DD HH:mm"
function fmtDateTime(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// timeframe preset: today / 1h / 2h / 4h / 2d
function getRangeFromPreset(preset) {
  const now = new Date();
  const end = now;

  const p = String(preset || "today").toLowerCase();

  if (p === "1h") return { from: new Date(now.getTime() - 1 * 60 * 60 * 1000), to: end };
  if (p === "2h") return { from: new Date(now.getTime() - 2 * 60 * 60 * 1000), to: end };
  if (p === "4h") return { from: new Date(now.getTime() - 4 * 60 * 60 * 1000), to: end };
  if (p === "2d") return { from: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), to: end };

  // today (approx NSE cash hours start at 09:15 IST; you can tune this)
  const start = new Date(now);
  start.setHours(9, 15, 0, 0);
  return { from: start, to: end };
}

// ------------------------------------------------------------
// Resolve symboltoken (scrip master)
// NOTE: This is large JSON. For production, cache it for 1 day.
let scripMasterCache = null;
let scripMasterFetchedAt = 0;

async function loadScripMasterCached() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (scripMasterCache && Date.now() - scripMasterFetchedAt < ONE_DAY) return scripMasterCache;

  const url = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load scrip master: ${res.status}`);
  const data = await res.json();
  scripMasterCache = data;
  scripMasterFetchedAt = Date.now();
  return data;
}

async function resolveSymbolTokenFromMaster(exchange, tradingsymbol) {
  const ex = String(exchange).toUpperCase();
  const ts = String(tradingsymbol).toUpperCase();

  const data = await loadScripMasterCached();

  const row = data.find((x) => String(x.exch_seg).toUpperCase() === ex && String(x.symbol).toUpperCase() === ts);

  if (!row) throw new Error(`Symbol not found in master: ${ex}:${ts}`);
  return String(row.token);
}

// ------------------------------------------------------------
// Angel One session (SmartAPI SDK)
let smart = null;
let sessionReady = false;
let lastSessionAt = 0;

let angelJwtToken = null;
let angelFeedToken = null;

async function ensureAngelSession() {
  if (sessionReady && Date.now() - lastSessionAt < 10 * 60 * 1000) return;

  const apiKey = process.env.ANGEL_API_KEY;
  const clientCode = process.env.ANGEL_CLIENT_CODE;
  const mpin = process.env.ANGEL_MPIN;
  const totpSecret = process.env.ANGEL_TOTP_SECRET;

  if (!apiKey || !clientCode || !mpin || !totpSecret) {
    throw new Error("Missing Angel env vars. Set ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_MPIN, ANGEL_TOTP_SECRET");
  }
  if (!/^\d{4}$/.test(mpin)) throw new Error("ANGEL_MPIN must be exactly 4 digits.");

  smart = new SmartAPI({ api_key: apiKey });
  const totp = authenticator.generate(totpSecret);

  // MPIN in place of password
  const data = await smart.generateSession(clientCode, mpin, totp);

  if (!data || data.status === false) throw new Error(`Angel generateSession failed: ${JSON.stringify(data)}`);

  // SDK response usually puts tokens in data.data
  angelJwtToken = data.data?.jwtToken || data.data?.jwt || null;
  angelFeedToken = data.data?.feedToken || null;

  sessionReady = true;
  lastSessionAt = Date.now();
}

// ------------------------------------------------------------
// Market Quote (bulk LTP) - Optional confirmation for latest price breakout
async function getLTPBulk(exchangeTokens) {
  await ensureAngelSession();

  const apiKey = process.env.ANGEL_API_KEY;
  if (!angelJwtToken) throw new Error("Missing angelJwtToken (session not ready)");

  const resp = await fetch("https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${angelJwtToken}`,
      "X-PrivateKey": apiKey,
      "X-UserType": "USER",
      "X-SourceID": "WEB",
    },
    body: JSON.stringify({
      mode: "LTP",
      exchangeTokens,
    }),
  });

  const json = await resp.json();
  if (!json?.status) throw new Error(`Market quote failed: ${JSON.stringify(json)}`);

  // json.data.fetched: [{exchange, symbolToken, ltp, ...}]
  return json.data?.fetched || [];
}

// ------------------------------------------------------------
// Candle fetch
async function fetchCandles(exchange, tradingsymbol, interval, preset) {
  await ensureAngelSession();

  const symboltoken = await resolveSymbolTokenFromMaster(exchange, tradingsymbol);

  const { from, to } = getRangeFromPreset(preset);

  const candleParams = {
    exchange,
    symboltoken,
    interval,
    fromdate: fmtDateTime(from),
    todate: fmtDateTime(to),
  };

  const candleResp = await smart.getCandleData(candleParams);
  if (!candleResp || candleResp.status === false) {
    throw new Error(`getCandleData failed: ${JSON.stringify(candleResp)}`);
  }

  const rows = candleResp.data || [];
  const candles = rows.map((r) => ({
    time: new Date(r[0]).toISOString(),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5] ?? 0),
  }));

  return { candles, symboltoken };
}

// ------------------------------------------------------------
// Indicator
function addIndicator(candles, indicator, window = 20) {
  const ind = String(indicator || "VWAP").toUpperCase();
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  let out = new Array(candles.length).fill(null);

  const w = Math.max(2, Math.min(200, Number(window || 20)));

  if (ind === "VWAP") {
    let cumPV = 0,
      cumVol = 0;
    for (let i = 0; i < candles.length; i++) {
      const tp = closes[i]; // simplified: close as price; for truer VWAP use typical price: (h+l+c)/3
      cumPV += tp * volumes[i];
      cumVol += volumes[i];
      out[i] = cumVol === 0 ? null : cumPV / cumVol;
    }
  } else if (ind === "SMA") {
    for (let i = 0; i < candles.length; i++) {
      if (i + 1 < w) continue;
      let sum = 0;
      for (let j = i - w + 1; j <= i; j++) sum += closes[j];
      out[i] = sum / w;
    }
  } else if (ind === "EMA") {
    const alpha = 2 / (w + 1);
    let ema = null;
    for (let i = 0; i < candles.length; i++) {
      ema = ema === null ? closes[i] : alpha * closes[i] + (1 - alpha) * ema;
      out[i] = ema;
    }
  } else if (ind === "CLOSE") {
    out = closes.slice();
  } else {
    throw new Error(`Unsupported indicator: ${ind}`);
  }

  return candles.map((c, i) => ({ ...c, indicator: out[i] }));
}

// ------------------------------------------------------------
// Screener Logic
function isAllOneSide(candle, level, side /* "ABOVE" | "BELOW" */) {
  const vals = [candle.open, candle.high, candle.low, candle.close];
  return side === "ABOVE" ? vals.every((v) => v > level) : vals.every((v) => v < level);
}

function touchedIndicator(candle, level) {
  if (level == null) return false;

  // touch: indicator within candle range
  if (candle.low <= level && level <= candle.high) return true;

  // cross
  const crossDown = candle.open > level && candle.close < level;
  const crossUp = candle.open < level && candle.close > level;
  return crossDown || crossUp;
}

/**
 * STEP-2: Candle-2 touched indicator -> mark Candle-2 high
 * STEP-1: Candle-1 all above/below indicator (configurable)
 * STEP-3: any future candle crosses above / closes above Candle-2 high
 */
function scanThreeCandlePattern(candlesWithInd, opts = {}) {
  const candle1Side = String(opts.candle1Side || "BELOW").toUpperCase(); // "BELOW" | "ABOVE"
  const breakoutMode = String(opts.breakoutMode || "CLOSE").toUpperCase(); // "CLOSE" | "HIGH"

  const n = candlesWithInd.length;
  const hits = [];

  for (let i = 1; i < n - 1; i++) {
    const candle2 = candlesWithInd[i - 1];
    const candle1 = candlesWithInd[i];

    const ind2 = candle2.indicator;
    const ind1 = candle1.indicator;

    if (ind2 == null || ind1 == null) continue;

    // Step-2
    if (!touchedIndicator(candle2, ind2)) continue;
    const refHigh = candle2.high;

    // Step-1
    if (!isAllOneSide(candle1, ind1, candle1Side)) continue;

    // Step-3: first future candle break
    let found = null;
    for (let j = i + 1; j < n; j++) {
      const candle3 = candlesWithInd[j];

      const breaks = breakoutMode === "HIGH" ? candle3.high > refHigh : candle3.close > refHigh;

      if (breaks) {
        found = { candle3Index: j, candle3 };
        break;
      }
    }

    if (found) {
      hits.push({
        candle2Index: i - 1,
        candle1Index: i,
        ...found,
        candle2High: refHigh,
      });
      break; // stop after first match per symbol
    }
  }

  return hits;
}

// ------------------------------------------------------------
// API: get candles for one symbol (kept from your earlier logic)
app.get("/api/candles", async (req, res) => {
  const timeframe = req.query.timeframe || "5m";
  const indicator = (req.query.indicator || "VWAP").toUpperCase();
  const window = Math.max(2, Math.min(200, parseInt(req.query.window || "20", 10)));
  const preset = req.query.preset || "today";

  const exchange = (req.query.exchange || "NSE").toUpperCase();
  const tradingsymbol = (req.query.tradingsymbol || "RELIANCE-EQ").toUpperCase();

  try {
    const interval = mapInterval(timeframe);
    const { candles } = await fetchCandles(exchange, tradingsymbol, interval, preset);
    const withIndicator = addIndicator(candles, indicator, window);

    res.json({
      ok: true,
      source: "angelone",
      params: { exchange, tradingsymbol, preset, timeframe, interval, indicator, window },
      candles: withIndicator,
    });
  } catch (e) {
    const dummy = generateDummyData(600);
    const withIndicator = addIndicator(dummy, indicator, window);

    res.json({
      ok: true,
      source: "dummy_fallback",
      error: String(e.message || e),
      params: { preset, timeframe, indicator, window },
      candles: withIndicator,
    });
  }
});

// ------------------------------------------------------------
// API: screener (bulk scan up to 10)
// API: screener (with Plotly chart integration)
app.post("/api/screener", async (req, res) => {
  const body = req.body || {};

  const preset = String(body.preset || "today");
  const timeframe = String(body.timeframe || "5m");
  const indicator = String(body.indicator || "VWAP").toUpperCase();
  const window = Math.max(2, Math.min(200, Number(body.window || 20)));

  const candle1Side = String(body.candle1Side || "BELOW").toUpperCase();
  const breakoutMode = String(body.breakoutMode || "CLOSE").toUpperCase();

  const confirmWithLTP = body.confirmWithLTP !== false;
  const stocks = Array.isArray(body.stocks) && body.stocks.length ? body.stocks : DEFAULT_STOCKS;

  const interval = mapInterval(timeframe);

  try {
    const results = [];
    const ltpReq = { NSE: [], BSE: [], NFO: [], MCX: [] };

    // sequential calls to avoid rate-limit issues (safe)
    for (const s of stocks.slice(0, 10)) {
      const exchange = String(s.exchange || "NSE").toUpperCase();
      const tradingsymbol = String(s.tradingsymbol || "").toUpperCase();
      if (!tradingsymbol) continue;

      try {
        const { candles, symboltoken } = await fetchCandles(exchange, tradingsymbol, interval, preset);

        if (!candles || candles.length < 10) {
          results.push({ exchange, tradingsymbol, symboltoken, match: false, reason: "Not enough candles" });
          continue;
        }

        const withInd = addIndicator(candles, indicator, window);
        const hits = scanThreeCandlePattern(withInd, { candle1Side, breakoutMode });

        if (hits.length) {
          if (confirmWithLTP && ltpReq[exchange]) ltpReq[exchange].push(String(symboltoken));
          results.push({
            exchange,
            tradingsymbol,
            symboltoken,
            match: true,
            hit: hits[0],
            lastCandle: withInd[withInd.length - 1],
            candles: withInd, // Include candles in response
          });
        } else {
          results.push({ exchange, tradingsymbol, symboltoken, match: false });
        }
      } catch (e) {
        results.push({ exchange, tradingsymbol, match: false, error: String(e.message || e) });
      }
    }

    // LTP confirmation (bulk)
    let ltpMap = {};
    if (confirmWithLTP) {
      const exchangeTokens = Object.fromEntries(Object.entries(ltpReq).filter(([_, arr]) => Array.isArray(arr) && arr.length > 0));

      if (Object.keys(exchangeTokens).length) {
        const fetched = await getLTPBulk(exchangeTokens);
        for (const row of fetched) {
          ltpMap[`${row.exchange}:${row.symbolToken}`] = Number(row.ltp);
        }
      }
    }

    // Attach LTP & liveBreak flag
    for (const r of results) {
      if (!r.match || !confirmWithLTP) continue;
      const key = `${r.exchange}:${r.symboltoken}`;
      const ltp = ltpMap[key];
      if (Number.isFinite(ltp)) {
        r.ltp = ltp;
        const candle2High = r.hit?.candle2High;
        r.liveBreakAboveCandle2High = Number.isFinite(candle2High) ? ltp > candle2High : null;
      } else {
        r.ltp = null;
        r.liveBreakAboveCandle2High = null;
      }
    }

    // Only matched for home table
    const matched = results.filter((x) => x.match);

    res.json({
      ok: true,
      params: { preset, timeframe, interval, indicator, window, candle1Side, breakoutMode, confirmWithLTP },
      results: matched,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ------------------------------------------------------------
// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
