async function fetchCandles() {
    const tf = document.getElementById("timeframe").value;
    const ind = document.getElementById("indicator").value;
    const windowVal = document.getElementById("window").value;
    const n = document.getElementById("n").value;

    const url = `/api/candles?timeframe=${encodeURIComponent(tf)}&indicator=${encodeURIComponent(
        ind
    )}&window=${encodeURIComponent(windowVal)}&n=${encodeURIComponent(n)}`;

    setStatus(`Loading: timeframe=${tf}, indicator=${ind}, window=${windowVal}...`);
    const res = await fetch(url);
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || "API error");
    return data.candles;
}

function setStatus(msg) {
    document.getElementById("status").textContent = msg;
}

function drawChart(candles, indicatorName) {
    const x = candles.map((c) => c.time);
    const open = candles.map((c) => c.open);
    const high = candles.map((c) => c.high);
    const low = candles.map((c) => c.low);
    const close = candles.map((c) => c.close);
    const indicator = candles.map((c) => c.indicator);

    const candleTrace = {
        type: "candlestick",
        x,
        open,
        high,
        low,
        close,
        name: "Price",
    };

    const indTrace = {
        type: "scatter",
        mode: "lines",
        x,
        y: indicator,
        name: indicatorName,
    };

    const layout = {
        title: "",
        xaxis: { title: "Time", rangeslider: { visible: false } },
        yaxis: { title: "Price" },
        hovermode: "x unified",
        height: 640,
        margin: { l: 50, r: 20, t: 10, b: 50 },
    };

    Plotly.newPlot("chart", [candleTrace, indTrace], layout, { responsive: true });
}

async function load() {
    try {
        const indicatorSelect = document.getElementById("indicator");
        const indicatorName = indicatorSelect.options[indicatorSelect.selectedIndex].text;

        const candles = await fetchCandles();
        drawChart(candles, indicatorName);
        setStatus(`Loaded ${candles.length} candles.`);
    } catch (e) {
        setStatus(`Error: ${e.message}`);
        console.error(e);
    }
}

document.getElementById("loadBtn").addEventListener("click", load);

// auto load on open + reload on dropdown change (optional)
document.getElementById("timeframe").addEventListener("change", load);
document.getElementById("indicator").addEventListener("change", load);
document.getElementById("window").addEventListener("change", load);

load();
