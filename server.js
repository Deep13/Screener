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
const fs = require("fs/promises");
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
const RESULTS_FILE = path.join(__dirname, "results_history_new.json");
const MAX_HISTORY = 200;
// ------------------------------------------------------------
// Default watchlist (~130 large / midcap stocks).
const DEFAULT_STOCKS = [
  // A
  { exchange: "NSE", tradingsymbol: "ABB-EQ" },
  { exchange: "NSE", tradingsymbol: "ABBOTINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIENT-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIGREEN-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIPORTS-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "ATGL-EQ" },
  { exchange: "NSE", tradingsymbol: "ABCAPITAL-EQ" },
  { exchange: "NSE", tradingsymbol: "ABFRL-EQ" },
  { exchange: "NSE", tradingsymbol: "APLAPOLLO-EQ" },
  { exchange: "NSE", tradingsymbol: "APOLLOHOSP-EQ" },
  { exchange: "NSE", tradingsymbol: "APOLLOTYRE-EQ" },
  { exchange: "NSE", tradingsymbol: "ASHOKLEY-EQ" },
  { exchange: "NSE", tradingsymbol: "ASIANPAINT-EQ" },
  { exchange: "NSE", tradingsymbol: "ASTRAL-EQ" },
  { exchange: "NSE", tradingsymbol: "AUBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "AUROPHARMA-EQ" },
  // B
  { exchange: "NSE", tradingsymbol: "BAJAJ-AUTO-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJFINANCE-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJFINSV-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJHLDNG-EQ" },
  { exchange: "NSE", tradingsymbol: "BALKRISIND-EQ" },
  { exchange: "NSE", tradingsymbol: "BANDHANBNK-EQ" },
  { exchange: "NSE", tradingsymbol: "BANKBARODA-EQ" },
  { exchange: "NSE", tradingsymbol: "BERGEPAINT-EQ" },
  { exchange: "NSE", tradingsymbol: "BEL-EQ" },
  { exchange: "NSE", tradingsymbol: "BHARATFORG-EQ" },
  { exchange: "NSE", tradingsymbol: "BHEL-EQ" },
  { exchange: "NSE", tradingsymbol: "BPCL-EQ" },
  { exchange: "NSE", tradingsymbol: "BHARTIARTL-EQ" },
  { exchange: "NSE", tradingsymbol: "BIOCON-EQ" },
  { exchange: "NSE", tradingsymbol: "BOSCHLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "BRITANNIA-EQ" },
  // C
  { exchange: "NSE", tradingsymbol: "CANBK-EQ" },
  { exchange: "NSE", tradingsymbol: "CGPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "CHOLAFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "CIPLA-EQ" },
  { exchange: "NSE", tradingsymbol: "COALINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "COLPAL-EQ" },
  { exchange: "NSE", tradingsymbol: "CONCOR-EQ" },
  { exchange: "NSE", tradingsymbol: "COROMANDEL-EQ" },
  // D
  { exchange: "NSE", tradingsymbol: "DABUR-EQ" },
  { exchange: "NSE", tradingsymbol: "DALBHARAT-EQ" },
  { exchange: "NSE", tradingsymbol: "DEEPAKNTR-EQ" },
  { exchange: "NSE", tradingsymbol: "DIVISLAB-EQ" },
  { exchange: "NSE", tradingsymbol: "DIXON-EQ" },
  { exchange: "NSE", tradingsymbol: "DRREDDY-EQ" },
  // E
  { exchange: "NSE", tradingsymbol: "EICHERMOT-EQ" },
  { exchange: "NSE", tradingsymbol: "ESCORTS-EQ" },
  { exchange: "NSE", tradingsymbol: "EXIDEIND-EQ" },
  // F
  { exchange: "NSE", tradingsymbol: "FEDERALBNK-EQ" },
  // G
  { exchange: "NSE", tradingsymbol: "GAIL-EQ" },
  { exchange: "NSE", tradingsymbol: "GLENMARK-EQ" },
  { exchange: "NSE", tradingsymbol: "GODREJCP-EQ" },
  { exchange: "NSE", tradingsymbol: "GODREJPROP-EQ" },
  { exchange: "NSE", tradingsymbol: "GRASIM-EQ" },
  // H
  { exchange: "NSE", tradingsymbol: "HCLTECH-EQ" },
  { exchange: "NSE", tradingsymbol: "HDFCBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "HDFCLIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "HEROMOTOCO-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDALCO-EQ" },
  { exchange: "NSE", tradingsymbol: "HAL-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDPETRO-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDUNILVR-EQ" },
  // I
  { exchange: "NSE", tradingsymbol: "ICICIBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "ICICIGI-EQ" },
  { exchange: "NSE", tradingsymbol: "ICICIPRULI-EQ" },
  { exchange: "NSE", tradingsymbol: "INDIANB-EQ" },
  { exchange: "NSE", tradingsymbol: "IOC-EQ" },
  { exchange: "NSE", tradingsymbol: "IGL-EQ" },
  { exchange: "NSE", tradingsymbol: "INDUSINDBK-EQ" },
  { exchange: "NSE", tradingsymbol: "NAUKRI-EQ" },
  { exchange: "NSE", tradingsymbol: "INFY-EQ" },
  { exchange: "NSE", tradingsymbol: "INDIGO-EQ" },
  // J
  { exchange: "NSE", tradingsymbol: "JSWSTEEL-EQ" },
  { exchange: "NSE", tradingsymbol: "JSWENERGY-EQ" },
  // K
  { exchange: "NSE", tradingsymbol: "KOTAKBANK-EQ" },
  // L
  { exchange: "NSE", tradingsymbol: "LT-EQ" },
  { exchange: "NSE", tradingsymbol: "LICHSGFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "LTIM-EQ" },
  { exchange: "NSE", tradingsymbol: "LUPIN-EQ" },
  // M
  { exchange: "NSE", tradingsymbol: "M&M-EQ" },
  { exchange: "NSE", tradingsymbol: "M&MFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "MARICO-EQ" },
  { exchange: "NSE", tradingsymbol: "MARUTI-EQ" },
  { exchange: "NSE", tradingsymbol: "MAXHEALTH-EQ" },
  // N
  { exchange: "NSE", tradingsymbol: "NESTLEIND-EQ" },
  { exchange: "NSE", tradingsymbol: "NMDC-EQ" },
  { exchange: "NSE", tradingsymbol: "NTPC-EQ" },
  // O
  { exchange: "NSE", tradingsymbol: "ONGC-EQ" },
  // P
  { exchange: "NSE", tradingsymbol: "PAGEIND-EQ" },
  { exchange: "NSE", tradingsymbol: "PETRONET-EQ" },
  { exchange: "NSE", tradingsymbol: "PIDILITIND-EQ" },
  { exchange: "NSE", tradingsymbol: "PIIND-EQ" },
  { exchange: "NSE", tradingsymbol: "PFC-EQ" },
  { exchange: "NSE", tradingsymbol: "POWERGRID-EQ" },
  // R
  { exchange: "NSE", tradingsymbol: "RECLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "RELIANCE-EQ" },
  // S
  { exchange: "NSE", tradingsymbol: "SBILIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "SHREECEM-EQ" },
  { exchange: "NSE", tradingsymbol: "SIEMENS-EQ" },
  { exchange: "NSE", tradingsymbol: "SBIN-EQ" },
  { exchange: "NSE", tradingsymbol: "SUNPHARMA-EQ" },
  // T
  { exchange: "NSE", tradingsymbol: "TATACHEM-EQ" },
  { exchange: "NSE", tradingsymbol: "TATACONSUM-EQ" },
  { exchange: "NSE", tradingsymbol: "TATAELXSI-EQ" },
  { exchange: "NSE", tradingsymbol: "TATAMOTORS-EQ" },
  { exchange: "NSE", tradingsymbol: "TATAPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "TATASTEEL-EQ" },
  { exchange: "NSE", tradingsymbol: "TCS-EQ" },
  { exchange: "NSE", tradingsymbol: "TECHM-EQ" },
  { exchange: "NSE", tradingsymbol: "TITAN-EQ" },
  { exchange: "NSE", tradingsymbol: "TORNTPHARM-EQ" },
  // U
  { exchange: "NSE", tradingsymbol: "UPL-EQ" },
  // V
  { exchange: "NSE", tradingsymbol: "VEDL-EQ" },
  { exchange: "NSE", tradingsymbol: "VOLTAS-EQ" },
  // W-Z
  { exchange: "NSE", tradingsymbol: "WIPRO-EQ" },
  { exchange: "NSE", tradingsymbol: "ZOMATO-EQ" },
  { exchange: "NSE", tradingsymbol: "ZEEL-EQ" },
];
async function writeHistory(list) {
  await fs.writeFile(RESULTS_FILE, JSON.stringify(list, null, 2), "utf-8");
}

async function readHistory() {
  try {
    const raw = await fs.readFile(RESULTS_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}
async function appendHistory(entry) {
  const list = await readHistory();
  list.push(entry);
  // keep last N
  const trimmed = list.slice(Math.max(0, list.length - MAX_HISTORY));
  await writeHistory(trimmed);
  return trimmed;
}
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
  try {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (scripMasterCache && Date.now() - scripMasterFetchedAt < ONE_DAY) return scripMasterCache;
    console.log("📥 Fetching scrip master from Angel One…");
    const url = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
    const res = await fetch(url);
    console.log(`Scrip master response: ${res.status} ${res.statusText}`);
    if (!res.ok) throw new Error(`Failed to load scrip master: ${res.status}`);
    const data = await res.json();
    console.log(`Scrip master loaded: ${data.length} entries`);
    scripMasterCache = data;
    scripMasterFetchedAt = Date.now();
    return data;
  } catch (e) {
    console.error("Failed to load scrip master:", e);
    throw new Error("Unable to load scrip master. Please try again later.");
  }
}

async function resolveSymbolTokenFromMaster(exchange, tradingsymbol) {
  const ex = String(exchange).toUpperCase();
  const ts = String(tradingsymbol).toUpperCase();

  const data = await loadScripMasterCached();
  console.log(`Resolving token for ${ex}:${ts} from scrip master with ${data.length} entries`);
  const row = data.find((x) => String(x.exch_seg).toUpperCase() === ex && String(x.symbol).toUpperCase() === ts);
  console.log(`Scrip master lookup: ${ex}:${ts} →`, row ? `token ${row.token}` : "NOT FOUND");
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
  console.log("🔐 Establishing Angel One session…");
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
  console.log("Session response:", data);
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
  console.log(`Fetching candles for ${exchange}:${tradingsymbol} | Interval: ${interval} | Preset: ${preset}`);
  const symboltoken = await resolveSymbolTokenFromMaster(exchange, tradingsymbol);
  console.log(`Resolved ${exchange}:${tradingsymbol} → token ${symboltoken}`);
  const { from, to } = getRangeFromPreset(preset);

  const candleParams = {
    exchange,
    symboltoken,
    interval,
    fromdate: fmtDateTime(from),
    todate: fmtDateTime(to),
  };
  console.log("Candle params:", candleParams);
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
function addIndicator(candles, indicator, window = 20, stdDev = 2) {
  const ind = String(indicator || "VWAP").toUpperCase();
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  let out = new Array(candles.length).fill(null);

  const w = Math.max(2, Math.min(200, Number(window || 20)));
  const numDev = Math.max(0.1, Number(stdDev || 2));

  if (ind === "VWAP") {
    let cumPV = 0,
      cumVol = 0;
    for (let i = 0; i < candles.length; i++) {
      const tp = closes[i]; // simplified: close as price; for truer VWAP use typical price: (h+l+c)/3
      cumPV += tp * volumes[i];
      cumVol += volumes[i];
      out[i] = cumVol === 0 ? null : cumPV / cumVol;
    }
  } else if (ind === "SMA" || ind === "BOLLINGER_BAND") {
    for (let i = 0; i < candles.length; i++) {
      if (i + 1 < w) continue;
      let sum = 0;
      for (let j = i - w + 1; j <= i; j++) sum += closes[j];
      out[i] = sum / w;
    }
  } else if (ind === "BOLLINGER_UPPER" || ind === "BOLLINGER_LOWER") {
    for (let i = 0; i < candles.length; i++) {
      if (i + 1 < w) continue;
      const slice = closes.slice(i - w + 1, i + 1);
      const sma = slice.reduce((s, v) => s + v, 0) / w;
      const variance = slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / w;
      const sd = Math.sqrt(variance);
      out[i] = ind === "BOLLINGER_UPPER" ? sma + numDev * sd : sma - numDev * sd;
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
  console.log("🟢 [/api/screener] SSE Request started");

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const body = req.body || {};

  const preset = String(body.preset || "today");
  const timeframe = String(body.timeframe || "5m");
  const indicator = String(body.indicator || "VWAP").toUpperCase();
  const window = Math.max(2, Math.min(200, Number(body.window || 20)));

  const candle1Side = String(body.candle1Side || "BELOW").toUpperCase();
  const breakoutMode = String(body.breakoutMode || "CLOSE").toUpperCase();
  const stdDev = Math.max(0.1, Number(body.stdDev || 2));

  const confirmWithLTP = body.confirmWithLTP !== false;
  const stocks = Array.isArray(body.stocks) && body.stocks.length ? body.stocks : DEFAULT_STOCKS;

  const interval = mapInterval(timeframe);
  const totalStocks = stocks.length;

  console.log("⚙️ Params:", {
    preset, timeframe, interval, indicator, window,
    candle1Side, breakoutMode, confirmWithLTP, stocks: totalStocks,
  });

  sendEvent("progress", { step: "init", message: `Starting scan for ${totalStocks} stocks...`, current: 0, total: totalStocks });

  function parseAngelError(e) {
    const msg = String(e?.message || e || "");
    const idx = msg.indexOf("{");
    if (idx >= 0) {
      try {
        const obj = JSON.parse(msg.slice(idx));
        return { code: obj?.errorcode, apiMessage: obj?.message, raw: obj, msg };
      } catch (_) {}
    }
    const resp = e?.response?.data;
    return { code: resp?.errorcode, apiMessage: resp?.message, raw: resp, msg };
  }

  const fetchCandlesWithRetry = async (exchange, tradingsymbol, interval, preset, maxTry = 3) => {
    let lastError;
    for (let i = 1; i <= maxTry; i++) {
      try {
        return await fetchCandles(exchange, tradingsymbol, interval, preset);
      } catch (e) {
        lastError = e;
        const info = parseAngelError(e);
        console.warn(`⚠️ Candle fetch failed [${i}/${maxTry}]`, {
          symbol: tradingsymbol, exchange, code: info.code, message: info.apiMessage || info.msg,
        });
        if (info.code !== "AB1004") break;
        const wait = 600 * Math.pow(2, i - 1);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastError;
  };

  // Check if client disconnected
  let clientDisconnected = false;
  let scanFinished = false;
  req.on("close", () => {
    if (!scanFinished) {
      clientDisconnected = true;
      console.log("Client disconnected, aborting scan");
    }
  });

  try {
    const results = [];
    const ltpReq = { NSE: [], BSE: [], NFO: [], MCX: [] };
    let matchesSoFar = 0;

    for (let idx = 0; idx < stocks.length; idx++) {
      if (clientDisconnected) return;

      const s = stocks[idx];
      const exchange = String(s.exchange || "NSE").toUpperCase();
      const tradingsymbol = String(s.tradingsymbol || "").toUpperCase();
      if (!tradingsymbol) continue;

      // Send progress: fetching candles
      sendEvent("progress", {
        step: "fetch",
        message: `Fetching ${tradingsymbol}`,
        current: idx + 1,
        total: totalStocks,
        matches: matchesSoFar,
      });

      try {
        const { candles, symboltoken } = await fetchCandlesWithRetry(exchange, tradingsymbol, interval, preset);

        console.log(`🕯️ ${tradingsymbol} candles: ${candles?.length ?? 0}`);

        if (!candles || candles.length < 10) {
          results.push({ exchange, tradingsymbol, symboltoken, match: false, reason: "Not enough candles" });
          continue;
        }

        // Send progress: calculating pattern
        sendEvent("progress", {
          step: "calculate",
          message: `Analyzing ${tradingsymbol}`,
          current: idx + 1,
          total: totalStocks,
          matches: matchesSoFar,
        });

        const withInd = addIndicator(candles, indicator, window, stdDev);
        const hits = scanThreeCandlePattern(withInd, { candle1Side, breakoutMode });

        if (hits.length) {
          matchesSoFar++;
          console.log(`✅ Pattern HIT → ${tradingsymbol}`);
          if (confirmWithLTP && ltpReq[exchange]) ltpReq[exchange].push(String(symboltoken));
          results.push({ exchange, tradingsymbol, symboltoken, match: true, hits, lastCandle: withInd[withInd.length - 1], candles: withInd });

          sendEvent("match", {
            message: `Pattern found in ${tradingsymbol}`,
            symbol: tradingsymbol,
            current: idx + 1,
            total: totalStocks,
            matches: matchesSoFar,
          });
        } else {
          results.push({ exchange, tradingsymbol, symboltoken, match: false });
        }
      } catch (e) {
        const info = parseAngelError(e);
        console.error(`🔥 ${tradingsymbol} failed`, { exchange, code: info.code, message: info.apiMessage || info.msg });
        results.push({ exchange, tradingsymbol, match: false, error: info.code ? `${info.code}: ${info.apiMessage || info.msg}` : info.msg });
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    if (clientDisconnected) return;

    // ---------- LTP BULK ----------
    let ltpMap = {};
    if (confirmWithLTP) {
      const exchangeTokens = Object.fromEntries(Object.entries(ltpReq).filter(([, arr]) => arr.length));

      if (Object.keys(exchangeTokens).length) {
        sendEvent("progress", { step: "ltp", message: "Fetching live prices...", current: totalStocks, total: totalStocks, matches: matchesSoFar });

        const fetched = await getLTPBulk(exchangeTokens);
        for (const row of fetched) {
          ltpMap[`${row.exchange}:${row.symbolToken}`] = Number(row.ltp);
        }
      }
    }

    // ---------- Attach LTP ----------
    for (const r of results) {
      if (!r.match || !confirmWithLTP) continue;
      const key = `${r.exchange}:${r.symboltoken}`;
      const ltp = ltpMap[key];
      r.ltp = Number.isFinite(ltp) ? ltp : null;
      const candle2High = r.hits?.[0]?.candle2High;
      r.liveBreakAboveCandle2High = Number.isFinite(candle2High) && Number.isFinite(ltp) ? ltp > candle2High : null;
    }

    // ---------- Save history ----------
    const matched = results.filter((r) => r.match);
    const scanParams = { preset, timeframe, interval, indicator, window, candle1Side, breakoutMode, confirmWithLTP };

    // Only persist to file if there are matches
    if (matched.length > 0) {
      sendEvent("progress", { step: "saving", message: `Saving ${matched.length} matches to history...`, current: totalStocks, total: totalStocks, matches: matched.length });

      await appendHistory({
        id: `${Date.now()}`,
        ts: new Date().toISOString(),
        params: scanParams,
        results: matched.map((r) => ({
          exchange: r.exchange, tradingsymbol: r.tradingsymbol, symboltoken: r.symboltoken,
          ltp: r.ltp ?? null, liveBreakAboveCandle2High: r.liveBreakAboveCandle2High ?? null,
          hits: r.hits ?? [], candles: r.candles?.slice(-300) ?? [],
        })),
      });
    }

    console.log("✅ [/api/screener] Completed");

    // Send final result
    sendEvent("done", {
      ok: true,
      params: scanParams,
      results: matched,
    });

    scanFinished = true;
    res.end();
  } catch (e) {
    console.error("🔥 [/api/screener] Fatal:", e);
    sendEvent("error", { message: String(e.message || e) });
    scanFinished = true;
    res.end();
  }
});

// ------------------------------------------------------------
// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get("/api/history", async (req, res) => {
  const list = await readHistory();
  // latest first
  res.json({ ok: true, history: list.slice().reverse() });
});

// API: history item by id
app.get("/api/history/:id", async (req, res) => {
  const list = await readHistory();
  const item = list.find((x) => String(x.id) === String(req.params.id));
  if (!item) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, item });
});

// API: delete history item by id
app.delete("/api/history/:id", async (req, res) => {
  const list = await readHistory();
  const filtered = list.filter((x) => String(x.id) !== String(req.params.id));
  if (filtered.length === list.length) return res.status(404).json({ ok: false, error: "Not found" });
  await writeHistory(filtered);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
