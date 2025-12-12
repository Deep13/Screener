const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

/**
 * Generate dummy 1-minute OHLCV data
 * Returns array of candles:
 * { time: ISO string, open, high, low, close, volume }
 */
function generateDummyData(nMinutes = 600) {
    const now = new Date();
    now.setSeconds(0, 0);

    // create timestamps ending at now
    const candles = [];
    let price = 100;

    for (let i = nMinutes - 1; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 60 * 1000);

        // random walk
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

        price = close; // next candle starts from previous close
    }

    return candles;
}

// normal-ish random using Box-Muller
function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function timeframeToMs(tf) {
    const map = {
        "1m": 60 * 1000,
        "5m": 5 * 60 * 1000,
        "15m": 15 * 60 * 1000,
        "30m": 30 * 60 * 1000,
        "1h": 60 * 60 * 1000,
        "1d": 24 * 60 * 60 * 1000,
    };
    return map[tf] || map["30m"];
}

/**
 * Resample 1m candles into timeframe candles (OHLC + sum volume)
 */
function resampleOHLC(candles, timeframe) {
    const bucketMs = timeframeToMs(timeframe);

    // group by bucket start time
    const buckets = new Map();

    for (const c of candles) {
        const t = new Date(c.time).getTime();
        const bucketStart = Math.floor(t / bucketMs) * bucketMs;

        if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
        buckets.get(bucketStart).push(c);
    }

    const resampled = [];
    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);

    for (const key of sortedKeys) {
        const arr = buckets.get(key);
        if (!arr || arr.length === 0) continue;

        const open = arr[0].open;
        const close = arr[arr.length - 1].close;
        let high = -Infinity;
        let low = Infinity;
        let volume = 0;

        for (const c of arr) {
            if (c.high > high) high = c.high;
            if (c.low < low) low = c.low;
            volume += c.volume;
        }

        resampled.push({
            time: new Date(key).toISOString(),
            open,
            high,
            low,
            close,
            volume,
        });
    }

    return resampled;
}

/**
 * Indicator calculation (adds `indicator` array aligned with candles)
 */
function addIndicator(candles, indicator, window = 20) {
    const ind = String(indicator || "VWAP").toUpperCase();

    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);

    let indicatorArr = new Array(candles.length).fill(null);

    if (ind === "VWAP") {
        let cumPV = 0;
        let cumVol = 0;
        for (let i = 0; i < candles.length; i++) {
            cumPV += closes[i] * volumes[i];
            cumVol += volumes[i];
            indicatorArr[i] = cumVol === 0 ? null : cumPV / cumVol;
        }
    } else if (ind === "SMA") {
        for (let i = 0; i < candles.length; i++) {
            if (i + 1 < window) {
                indicatorArr[i] = null;
                continue;
            }
            let sum = 0;
            for (let j = i - window + 1; j <= i; j++) sum += closes[j];
            indicatorArr[i] = sum / window;
        }
    } else if (ind === "EMA") {
        const span = window;
        const alpha = 2 / (span + 1);
        let ema = null;

        for (let i = 0; i < candles.length; i++) {
            if (ema === null) {
                ema = closes[i];
            } else {
                ema = alpha * closes[i] + (1 - alpha) * ema;
            }
            indicatorArr[i] = ema;
        }
    } else if (ind === "CLOSE") {
        indicatorArr = closes.slice();
    } else {
        throw new Error(`Unsupported indicator: ${indicator}`);
    }

    // attach indicator values
    return candles.map((c, i) => ({ ...c, indicator: indicatorArr[i] }));
}

/**
 * API:
 * /api/candles?timeframe=30m&indicator=VWAP&window=20&n=600
 */
app.get("/api/candles", (req, res) => {
    try {
        const timeframe = req.query.timeframe || "30m";
        const indicator = req.query.indicator || "VWAP";
        const window = Math.max(2, Math.min(200, parseInt(req.query.window || "20", 10)));
        const n = Math.max(200, Math.min(5000, parseInt(req.query.n || "600", 10)));

        // 1m base data
        const oneMin = generateDummyData(n);

        // resample
        const tfCandles = resampleOHLC(oneMin, timeframe);

        // add indicator
        const withInd = addIndicator(tfCandles, indicator, window);

        res.json({
            ok: true,
            params: { timeframe, indicator, window, n },
            candles: withInd,
        });
    } catch (e) {
        res.status(400).json({ ok: false, error: String(e.message || e) });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running: http://localhost:${PORT}`);
});
