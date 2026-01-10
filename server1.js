const express = require("express");
const path = require("path");
require("dotenv").config();

const { SmartAPI } = require("smartapi-javascript"); // :contentReference[oaicite:5]{index=5}
const { authenticator } = require("otplib");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ------------------ Dummy fallback ------------------
function randn() {
    let u = 0, v = 0;
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
        candles.push({ time: t.toISOString(), open, high, low, close, volume });
        price = close;
    }
    return candles;
}

// ------------------ Helpers ------------------
function mapInterval(timeframe) {
    // SmartAPI intervals commonly: ONE_MINUTE, FIVE_MINUTE, FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, ONE_DAY :contentReference[oaicite:6]{index=6}
    const m = {
        "1m": "ONE_MINUTE",
        "5m": "FIVE_MINUTE",
        "15m": "FIFTEEN_MINUTE",
        "30m": "THIRTY_MINUTE",
        "1h": "ONE_HOUR",
        "1d": "ONE_DAY",
    };
    return m[timeframe] || "THIRTY_MINUTE";
}

// optional: you can later cache instrument master instead of re-loading repeatedly
async function resolveSymbolTokenFromMaster(exchange, tradingsymbol) {
    // AngelOne scrip master JSON :contentReference[oaicite:7]{index=7}
    const url = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load scrip master: ${res.status}`);
    const data = await res.json();

    const row = data.find(
        (x) =>
            String(x.exch_seg).toUpperCase() === String(exchange).toUpperCase() &&
            String(x.symbol).toUpperCase() === String(tradingsymbol).toUpperCase()
    );

    if (!row) throw new Error(`Symbol not found in master: ${exchange}:${tradingsymbol}`);
    return String(row.token);
}

// ------------------ Angel One session ------------------
let smart = null;
let sessionReady = false;
let lastSessionAt = 0;

async function ensureAngelSession() {
    if (sessionReady && Date.now() - lastSessionAt < 10 * 60 * 1000) return;

    const apiKey = process.env.ANGEL_API_KEY;
    const clientCode = process.env.ANGEL_CLIENT_CODE;

    // ✅ Use MPIN (4 digits) instead of password
    const mpin = process.env.ANGEL_MPIN;

    const totpSecret = process.env.ANGEL_TOTP_SECRET;

    if (!apiKey || !clientCode || !mpin || !totpSecret) {
        throw new Error(
            "Missing Angel env vars. Set ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_MPIN, ANGEL_TOTP_SECRET"
        );
    }

    // Safety: MPIN must be exactly 4 digits
    if (!/^\d{4}$/.test(mpin)) {
        throw new Error("ANGEL_MPIN must be exactly 4 digits.");
    }

    smart = new SmartAPI({ api_key: apiKey });

    const totp = authenticator.generate(totpSecret);

    // ✅ Pass MPIN in place of password
    const data = await smart.generateSession(clientCode, mpin, totp);

    if (!data || data.status === false) {
        throw new Error(`Angel generateSession failed: ${JSON.stringify(data)}`);
    }

    sessionReady = true;
    lastSessionAt = Date.now();
}


// ------------------ API: candles ------------------
/**
 * /api/candles?timeframe=5m&indicator=VWAP&window=20&exchange=NSE&tradingsymbol=RELIANCE-EQ
 *
 * Returns candles aligned for Plotly:
 * { time, open, high, low, close, volume, indicator }
 */
app.get("/api/candles", async (req, res) => {
    const timeframe = req.query.timeframe || "30m";
    const indicator = (req.query.indicator || "VWAP").toUpperCase();
    const window = Math.max(2, Math.min(200, parseInt(req.query.window || "20", 10)));

    const exchange = (req.query.exchange || process.env.ANGEL_EXCHANGE || "NSE").toUpperCase();
    const tradingsymbol = (req.query.tradingsymbol || process.env.ANGEL_TRADINGSYMBOL || "RELIANCE-EQ").toUpperCase();

    try {
        await ensureAngelSession();

        const symboltoken = await resolveSymbolTokenFromMaster(exchange, tradingsymbol);

        // build date range (last N candles * timeframe-ish)
        const now = new Date();
        const todate = fmtDateTime(now);
        const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // last 2 days default
        const fromdate = fmtDateTime(from);

        const candleParams = {
            exchange,
            symboltoken,
            interval: mapInterval(timeframe),
            fromdate,
            todate,
        };

        // SmartAPI candle data call :contentReference[oaicite:10]{index=10}
        const candleResp = await smart.getCandleData(candleParams);

        if (!candleResp || candleResp.status === false) {
            throw new Error(`getCandleData failed: ${JSON.stringify(candleResp)}`);
        }

        // Candle response format is usually: data: [[time, open, high, low, close, volume], ...]
        const rows = candleResp.data || [];
        const candles = rows.map((r) => ({
            time: new Date(r[0]).toISOString(),
            open: Number(r[1]),
            high: Number(r[2]),
            low: Number(r[3]),
            close: Number(r[4]),
            volume: Number(r[5] ?? 0),
        }));

        const withIndicator = addIndicator(candles, indicator, window);

        res.json({
            ok: true,
            source: "angelone",
            params: { exchange, tradingsymbol, timeframe, indicator, window },
            candles: withIndicator,
        });
    } catch (e) {
        // fallback to dummy so UI still works
        const dummy = generateDummyData(600);
        const withIndicator = addIndicator(dummy, indicator, window);

        res.json({
            ok: true,
            source: "dummy_fallback",
            error: String(e.message || e),
            params: { timeframe, indicator, window },
            candles: withIndicator,
        });
    }
});

// ------------------ Indicator (same as before) ------------------
function addIndicator(candles, indicator, window = 20) {
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    let out = new Array(candles.length).fill(null);

    if (indicator === "VWAP") {
        let cumPV = 0, cumVol = 0;
        for (let i = 0; i < candles.length; i++) {
            cumPV += closes[i] * volumes[i];
            cumVol += volumes[i];
            out[i] = cumVol === 0 ? null : cumPV / cumVol;
        }
    } else if (indicator === "SMA") {
        for (let i = 0; i < candles.length; i++) {
            if (i + 1 < window) continue;
            let sum = 0;
            for (let j = i - window + 1; j <= i; j++) sum += closes[j];
            out[i] = sum / window;
        }
    } else if (indicator === "EMA") {
        const alpha = 2 / (window + 1);
        let ema = null;
        for (let i = 0; i < candles.length; i++) {
            ema = ema === null ? closes[i] : alpha * closes[i] + (1 - alpha) * ema;
            out[i] = ema;
        }
    } else if (indicator === "CLOSE") {
        out = closes.slice();
    } else {
        throw new Error(`Unsupported indicator: ${indicator}`);
    }

    return candles.map((c, i) => ({ ...c, indicator: out[i] }));
}

// SmartAPI expects "YYYY-MM-DD HH:mm" in many examples :contentReference[oaicite:11]{index=11}
function pad(n) { return String(n).padStart(2, "0"); }
function fmtDateTime(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
