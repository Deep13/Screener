const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const { SmartAPI } = require("smartapi-javascript");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Set up SmartAPI client
const smartApi = new SmartAPI({
  apiKey: process.env.ANGEL_API_KEY, // Your API key
  clientCode: process.env.ANGEL_CLIENT_CODE, // Your client code
  password: process.env.ANGEL_PASSWORD, // Your password
  twoFA: process.env.ANGEL_TOTP_SECRET, // Your 2FA code if needed
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Route to serve the home page
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/src/index.html");
});

// Route to fetch market data for selected stocks
app.post("/getStockData", async (req, res) => {
  const { timeframe, indicator, stocks } = req.body;

  const stockData = [];
  try {
    for (let stock of stocks) {
      // Fetch market data for each stock using SmartAPI
      const response = await smartApi.getMarketData({
        symbol: stock, // Stock symbol (e.g., AAPL, GOOG)
        interval: timeframe, // Time frame (e.g., 1h, 1d)
        indicator: indicator, // Indicator type (e.g., MA, EMA, etc.)
      });

      console.log(`Response for ${stock}:`, response); // Log the response for debugging
      stockData.push(response.data); // Assuming 'data' contains the required stock data
    }

    // Process and filter the data based on your criteria
    const filteredData = filterStocksBasedOnCriteria(stockData);

    // Return the filtered stock data to the frontend
    res.json(filteredData);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Error fetching data" });
  }
});

// Function to filter stocks based on custom criteria
const filterStocksBasedOnCriteria = (stocks) => {
  return stocks.filter((stock) => {
    // Implement your screening logic here, for example:
    // Check if the close price is higher than the open price
    return stock.close > stock.open; // Example condition for demonstration
  });
};

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
