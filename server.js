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
// DATA_DIR lets you point persistent files at a location *outside* the deploy
// directory — important on hosts like Hostinger/Vercel where each deploy
// wipes the app dir. Falls back to __dirname for local dev.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
// Only attempt to create the directory when DATA_DIR is explicitly set;
// __dirname is guaranteed to exist. Never let this crash the process at boot.
if (process.env.DATA_DIR) {
  try {
    require("fs").mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn(`⚠️ Could not create DATA_DIR (${DATA_DIR}): ${e.message}`);
  }
}
const RESULTS_FILE = path.join(DATA_DIR, "results_history_new.json");
const WATCHLIST_FILE = path.join(DATA_DIR, "watchlist.json");
const MAX_HISTORY = 200;
// ------------------------------------------------------------
// Default watchlist — 500 stocks from public/DOC-20260326-WA0013.xlsx (Nifty 500 list).
const DEFAULT_STOCKS = [
  { exchange: "NSE", tradingsymbol: "360ONE-EQ" },
  { exchange: "NSE", tradingsymbol: "3MINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "ABB-EQ" },
  { exchange: "NSE", tradingsymbol: "ACC-EQ" },
  { exchange: "NSE", tradingsymbol: "ACMESOLAR-EQ" },
  { exchange: "NSE", tradingsymbol: "AIAENG-EQ" },
  { exchange: "NSE", tradingsymbol: "APLAPOLLO-EQ" },
  { exchange: "NSE", tradingsymbol: "AUBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "AWL-EQ" },
  { exchange: "NSE", tradingsymbol: "AADHARHFC-EQ" },
  { exchange: "NSE", tradingsymbol: "AARTIIND-EQ" },
  { exchange: "NSE", tradingsymbol: "AAVAS-EQ" },
  { exchange: "NSE", tradingsymbol: "ABBOTINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "ACE-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIENSOL-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIENT-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIGREEN-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIPORTS-EQ" },
  { exchange: "NSE", tradingsymbol: "ADANIPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "ATGL-EQ" },
  { exchange: "NSE", tradingsymbol: "ABCAPITAL-EQ" },
  { exchange: "NSE", tradingsymbol: "ABFRL-EQ" },
  { exchange: "NSE", tradingsymbol: "ABLBL-EQ" },
  { exchange: "NSE", tradingsymbol: "ABREL-EQ" },
  { exchange: "NSE", tradingsymbol: "ABSLAMC-EQ" },
  { exchange: "NSE", tradingsymbol: "AEGISLOG-EQ" },
  { exchange: "NSE", tradingsymbol: "AEGISVOPAK-EQ" },
  { exchange: "NSE", tradingsymbol: "AFCONS-EQ" },
  { exchange: "NSE", tradingsymbol: "AFFLE-EQ" },
  { exchange: "NSE", tradingsymbol: "AJANTPHARM-EQ" },
  { exchange: "NSE", tradingsymbol: "AKUMS-EQ" },
  { exchange: "NSE", tradingsymbol: "AKZOINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "APLLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "ALKEM-EQ" },
  { exchange: "NSE", tradingsymbol: "ALKYLAMINE-EQ" },
  { exchange: "NSE", tradingsymbol: "ALOKINDS-EQ" },
  { exchange: "NSE", tradingsymbol: "ARE&M-EQ" },
  { exchange: "NSE", tradingsymbol: "AMBER-EQ" },
  { exchange: "NSE", tradingsymbol: "AMBUJACEM-EQ" },
  { exchange: "NSE", tradingsymbol: "ANANDRATHI-EQ" },
  { exchange: "NSE", tradingsymbol: "ANANTRAJ-EQ" },
  { exchange: "NSE", tradingsymbol: "ANGELONE-EQ" },
  { exchange: "NSE", tradingsymbol: "APARINDS-EQ" },
  { exchange: "NSE", tradingsymbol: "APOLLOHOSP-EQ" },
  { exchange: "NSE", tradingsymbol: "APOLLOTYRE-EQ" },
  { exchange: "NSE", tradingsymbol: "APTUS-EQ" },
  { exchange: "NSE", tradingsymbol: "ASAHIINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "ASHOKLEY-EQ" },
  { exchange: "NSE", tradingsymbol: "ASIANPAINT-EQ" },
  { exchange: "NSE", tradingsymbol: "ASTERDM-EQ" },
  { exchange: "NSE", tradingsymbol: "ASTRAZEN-EQ" },
  { exchange: "NSE", tradingsymbol: "ASTRAL-EQ" },
  { exchange: "NSE", tradingsymbol: "ATHERENERG-EQ" },
  { exchange: "NSE", tradingsymbol: "ATUL-EQ" },
  { exchange: "NSE", tradingsymbol: "AUROPHARMA-EQ" },
  { exchange: "NSE", tradingsymbol: "AIIL-EQ" },
  { exchange: "NSE", tradingsymbol: "DMART-EQ" },
  { exchange: "NSE", tradingsymbol: "AXISBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "BASF-EQ" },
  { exchange: "NSE", tradingsymbol: "BEML-EQ" },
  { exchange: "NSE", tradingsymbol: "BLS-EQ" },
  { exchange: "NSE", tradingsymbol: "BSE-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJ-AUTO-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJFINANCE-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJFINSV-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJHLDNG-EQ" },
  { exchange: "NSE", tradingsymbol: "BAJAJHFL-EQ" },
  { exchange: "NSE", tradingsymbol: "BALKRISIND-EQ" },
  { exchange: "NSE", tradingsymbol: "BALRAMCHIN-EQ" },
  { exchange: "NSE", tradingsymbol: "BANDHANBNK-EQ" },
  { exchange: "NSE", tradingsymbol: "BANKBARODA-EQ" },
  { exchange: "NSE", tradingsymbol: "BANKINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "MAHABANK-EQ" },
  { exchange: "NSE", tradingsymbol: "BATAINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "BAYERCROP-EQ" },
  { exchange: "NSE", tradingsymbol: "BERGEPAINT-EQ" },
  { exchange: "NSE", tradingsymbol: "BDL-EQ" },
  { exchange: "NSE", tradingsymbol: "BEL-EQ" },
  { exchange: "NSE", tradingsymbol: "BHARATFORG-EQ" },
  { exchange: "NSE", tradingsymbol: "BHEL-EQ" },
  { exchange: "NSE", tradingsymbol: "BPCL-EQ" },
  { exchange: "NSE", tradingsymbol: "BHARTIARTL-EQ" },
  { exchange: "NSE", tradingsymbol: "BHARTIHEXA-EQ" },
  { exchange: "NSE", tradingsymbol: "BIKAJI-EQ" },
  { exchange: "NSE", tradingsymbol: "BIOCON-EQ" },
  { exchange: "NSE", tradingsymbol: "BSOFT-EQ" },
  { exchange: "NSE", tradingsymbol: "BLUEDART-EQ" },
  { exchange: "NSE", tradingsymbol: "BLUEJET-EQ" },
  { exchange: "NSE", tradingsymbol: "BLUESTARCO-EQ" },
  { exchange: "NSE", tradingsymbol: "BBTC-EQ" },
  { exchange: "NSE", tradingsymbol: "BOSCHLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "FIRSTCRY-EQ" },
  { exchange: "NSE", tradingsymbol: "BRIGADE-EQ" },
  { exchange: "NSE", tradingsymbol: "BRITANNIA-EQ" },
  { exchange: "NSE", tradingsymbol: "MAPMYINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "CCL-EQ" },
  { exchange: "NSE", tradingsymbol: "CESC-EQ" },
  { exchange: "NSE", tradingsymbol: "CGPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "CRISIL-EQ" },
  { exchange: "NSE", tradingsymbol: "CAMPUS-EQ" },
  { exchange: "NSE", tradingsymbol: "CANFINHOME-EQ" },
  { exchange: "NSE", tradingsymbol: "CANBK-EQ" },
  { exchange: "NSE", tradingsymbol: "CAPLIPOINT-EQ" },
  { exchange: "NSE", tradingsymbol: "CGCL-EQ" },
  { exchange: "NSE", tradingsymbol: "CARBORUNIV-EQ" },
  { exchange: "NSE", tradingsymbol: "CASTROLIND-EQ" },
  { exchange: "NSE", tradingsymbol: "CEATLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "CENTRALBK-EQ" },
  { exchange: "NSE", tradingsymbol: "CDSL-EQ" },
  { exchange: "NSE", tradingsymbol: "CENTURYPLY-EQ" },
  { exchange: "NSE", tradingsymbol: "CERA-EQ" },
  { exchange: "NSE", tradingsymbol: "CHALET-EQ" },
  { exchange: "NSE", tradingsymbol: "CHAMBLFERT-EQ" },
  { exchange: "NSE", tradingsymbol: "CHENNPETRO-EQ" },
  { exchange: "NSE", tradingsymbol: "CHOICEIN-EQ" },
  { exchange: "NSE", tradingsymbol: "CHOLAHLDNG-EQ" },
  { exchange: "NSE", tradingsymbol: "CHOLAFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "CIPLA-EQ" },
  { exchange: "NSE", tradingsymbol: "CUB-EQ" },
  { exchange: "NSE", tradingsymbol: "CLEAN-EQ" },
  { exchange: "NSE", tradingsymbol: "COALINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "COCHINSHIP-EQ" },
  { exchange: "NSE", tradingsymbol: "COFORGE-EQ" },
  { exchange: "NSE", tradingsymbol: "COHANCE-EQ" },
  { exchange: "NSE", tradingsymbol: "COLPAL-EQ" },
  { exchange: "NSE", tradingsymbol: "CAMS-EQ" },
  { exchange: "NSE", tradingsymbol: "CONCORDBIO-EQ" },
  { exchange: "NSE", tradingsymbol: "CONCOR-EQ" },
  { exchange: "NSE", tradingsymbol: "COROMANDEL-EQ" },
  { exchange: "NSE", tradingsymbol: "CRAFTSMAN-EQ" },
  { exchange: "NSE", tradingsymbol: "CREDITACC-EQ" },
  { exchange: "NSE", tradingsymbol: "CROMPTON-EQ" },
  { exchange: "NSE", tradingsymbol: "CUMMINSIND-EQ" },
  { exchange: "NSE", tradingsymbol: "CYIENT-EQ" },
  { exchange: "NSE", tradingsymbol: "DCMSHRIRAM-EQ" },
  { exchange: "NSE", tradingsymbol: "DLF-EQ" },
  { exchange: "NSE", tradingsymbol: "DOMS-EQ" },
  { exchange: "NSE", tradingsymbol: "DABUR-EQ" },
  { exchange: "NSE", tradingsymbol: "DALBHARAT-EQ" },
  { exchange: "NSE", tradingsymbol: "DATAPATTNS-EQ" },
  { exchange: "NSE", tradingsymbol: "DEEPAKFERT-EQ" },
  { exchange: "NSE", tradingsymbol: "DEEPAKNTR-EQ" },
  { exchange: "NSE", tradingsymbol: "DELHIVERY-EQ" },
  { exchange: "NSE", tradingsymbol: "DEVYANI-EQ" },
  { exchange: "NSE", tradingsymbol: "DIVISLAB-EQ" },
  { exchange: "NSE", tradingsymbol: "DIXON-EQ" },
  { exchange: "NSE", tradingsymbol: "AGARWALEYE-EQ" },
  { exchange: "NSE", tradingsymbol: "LALPATHLAB-EQ" },
  { exchange: "NSE", tradingsymbol: "DRREDDY-EQ" },
  { exchange: "NSE", tradingsymbol: "EIDPARRY-EQ" },
  { exchange: "NSE", tradingsymbol: "EIHOTEL-EQ" },
  { exchange: "NSE", tradingsymbol: "EICHERMOT-EQ" },
  { exchange: "NSE", tradingsymbol: "ELECON-EQ" },
  { exchange: "NSE", tradingsymbol: "ELGIEQUIP-EQ" },
  { exchange: "NSE", tradingsymbol: "EMAMILTD-EQ" },
  { exchange: "NSE", tradingsymbol: "EMCURE-EQ" },
  { exchange: "NSE", tradingsymbol: "ENDURANCE-EQ" },
  { exchange: "NSE", tradingsymbol: "ENGINERSIN-EQ" },
  { exchange: "NSE", tradingsymbol: "ERIS-EQ" },
  { exchange: "NSE", tradingsymbol: "ESCORTS-EQ" },
  { exchange: "NSE", tradingsymbol: "ETERNAL-EQ" },
  { exchange: "NSE", tradingsymbol: "EXIDEIND-EQ" },
  { exchange: "NSE", tradingsymbol: "NYKAA-EQ" },
  { exchange: "NSE", tradingsymbol: "FEDERALBNK-EQ" },
  { exchange: "NSE", tradingsymbol: "FACT-EQ" },
  { exchange: "NSE", tradingsymbol: "FINCABLES-EQ" },
  { exchange: "NSE", tradingsymbol: "FINPIPE-EQ" },
  { exchange: "NSE", tradingsymbol: "FSL-EQ" },
  { exchange: "NSE", tradingsymbol: "FIVESTAR-EQ" },
  { exchange: "NSE", tradingsymbol: "FORCEMOT-EQ" },
  { exchange: "NSE", tradingsymbol: "FORTIS-EQ" },
  { exchange: "NSE", tradingsymbol: "GAIL-EQ" },
  { exchange: "NSE", tradingsymbol: "GVT&D-EQ" },
  { exchange: "NSE", tradingsymbol: "GMRAIRPORT-EQ" },
  { exchange: "NSE", tradingsymbol: "GRSE-EQ" },
  { exchange: "NSE", tradingsymbol: "GICRE-EQ" },
  { exchange: "NSE", tradingsymbol: "GILLETTE-EQ" },
  { exchange: "NSE", tradingsymbol: "GLAND-EQ" },
  { exchange: "NSE", tradingsymbol: "GLAXO-EQ" },
  { exchange: "NSE", tradingsymbol: "GLENMARK-EQ" },
  { exchange: "NSE", tradingsymbol: "MEDANTA-EQ" },
  { exchange: "NSE", tradingsymbol: "GODIGIT-EQ" },
  { exchange: "NSE", tradingsymbol: "GPIL-EQ" },
  { exchange: "NSE", tradingsymbol: "GODFRYPHLP-EQ" },
  { exchange: "NSE", tradingsymbol: "GODREJAGRO-EQ" },
  { exchange: "NSE", tradingsymbol: "GODREJCP-EQ" },
  { exchange: "NSE", tradingsymbol: "GODREJIND-EQ" },
  { exchange: "NSE", tradingsymbol: "GODREJPROP-EQ" },
  { exchange: "NSE", tradingsymbol: "GRANULES-EQ" },
  { exchange: "NSE", tradingsymbol: "GRAPHITE-EQ" },
  { exchange: "NSE", tradingsymbol: "GRASIM-EQ" },
  { exchange: "NSE", tradingsymbol: "GRAVITA-EQ" },
  { exchange: "NSE", tradingsymbol: "GESHIP-EQ" },
  { exchange: "NSE", tradingsymbol: "FLUOROCHEM-EQ" },
  { exchange: "NSE", tradingsymbol: "GUJGASLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "GMDCLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "GSPL-EQ" },
  { exchange: "NSE", tradingsymbol: "HEG-EQ" },
  { exchange: "NSE", tradingsymbol: "HBLENGINE-EQ" },
  { exchange: "NSE", tradingsymbol: "HCLTECH-EQ" },
  { exchange: "NSE", tradingsymbol: "HDFCAMC-EQ" },
  { exchange: "NSE", tradingsymbol: "HDFCBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "HDFCLIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "HFCL-EQ" },
  { exchange: "NSE", tradingsymbol: "HAPPSTMNDS-EQ" },
  { exchange: "NSE", tradingsymbol: "HAVELLS-EQ" },
  { exchange: "NSE", tradingsymbol: "HEROMOTOCO-EQ" },
  { exchange: "NSE", tradingsymbol: "HEXT-EQ" },
  { exchange: "NSE", tradingsymbol: "HSCL-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDALCO-EQ" },
  { exchange: "NSE", tradingsymbol: "HAL-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDCOPPER-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDPETRO-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDUNILVR-EQ" },
  { exchange: "NSE", tradingsymbol: "HINDZINC-EQ" },
  { exchange: "NSE", tradingsymbol: "POWERINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "HOMEFIRST-EQ" },
  { exchange: "NSE", tradingsymbol: "HONASA-EQ" },
  { exchange: "NSE", tradingsymbol: "HONAUT-EQ" },
  { exchange: "NSE", tradingsymbol: "HUDCO-EQ" },
  { exchange: "NSE", tradingsymbol: "HYUNDAI-EQ" },
  { exchange: "NSE", tradingsymbol: "ICICIBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "ICICIGI-EQ" },
  { exchange: "NSE", tradingsymbol: "ICICIPRULI-EQ" },
  { exchange: "NSE", tradingsymbol: "IDBI-EQ" },
  { exchange: "NSE", tradingsymbol: "IDFCFIRSTB-EQ" },
  { exchange: "NSE", tradingsymbol: "IFCI-EQ" },
  { exchange: "NSE", tradingsymbol: "IIFL-EQ" },
  { exchange: "NSE", tradingsymbol: "INOXINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "IRB-EQ" },
  { exchange: "NSE", tradingsymbol: "IRCON-EQ" },
  { exchange: "NSE", tradingsymbol: "ITCHOTELS-EQ" },
  { exchange: "NSE", tradingsymbol: "ITC-EQ" },
  { exchange: "NSE", tradingsymbol: "ITI-EQ" },
  { exchange: "NSE", tradingsymbol: "INDGN-EQ" },
  { exchange: "NSE", tradingsymbol: "INDIACEM-EQ" },
  { exchange: "NSE", tradingsymbol: "INDIAMART-EQ" },
  { exchange: "NSE", tradingsymbol: "INDIANB-EQ" },
  { exchange: "NSE", tradingsymbol: "IEX-EQ" },
  { exchange: "NSE", tradingsymbol: "INDHOTEL-EQ" },
  { exchange: "NSE", tradingsymbol: "IOC-EQ" },
  { exchange: "NSE", tradingsymbol: "IOB-EQ" },
  { exchange: "NSE", tradingsymbol: "IRCTC-EQ" },
  { exchange: "NSE", tradingsymbol: "IRFC-EQ" },
  { exchange: "NSE", tradingsymbol: "IREDA-EQ" },
  { exchange: "NSE", tradingsymbol: "IGL-EQ" },
  { exchange: "NSE", tradingsymbol: "INDUSTOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "INDUSINDBK-EQ" },
  { exchange: "NSE", tradingsymbol: "NAUKRI-EQ" },
  { exchange: "NSE", tradingsymbol: "INFY-EQ" },
  { exchange: "NSE", tradingsymbol: "INOXWIND-EQ" },
  { exchange: "NSE", tradingsymbol: "INTELLECT-EQ" },
  { exchange: "NSE", tradingsymbol: "INDIGO-EQ" },
  { exchange: "NSE", tradingsymbol: "IGIL-EQ" },
  { exchange: "NSE", tradingsymbol: "IKS-EQ" },
  { exchange: "NSE", tradingsymbol: "IPCALAB-EQ" },
  { exchange: "NSE", tradingsymbol: "JBCHEPHARM-EQ" },
  { exchange: "NSE", tradingsymbol: "JKCEMENT-EQ" },
  { exchange: "NSE", tradingsymbol: "JBMA-EQ" },
  { exchange: "NSE", tradingsymbol: "JKTYRE-EQ" },
  { exchange: "NSE", tradingsymbol: "JMFINANCIL-EQ" },
  { exchange: "NSE", tradingsymbol: "JSWCEMENT-EQ" },
  { exchange: "NSE", tradingsymbol: "JSWENERGY-EQ" },
  { exchange: "NSE", tradingsymbol: "JSWINFRA-EQ" },
  { exchange: "NSE", tradingsymbol: "JSWSTEEL-EQ" },
  { exchange: "NSE", tradingsymbol: "JPPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "J&KBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "JINDALSAW-EQ" },
  { exchange: "NSE", tradingsymbol: "JSL-EQ" },
  { exchange: "NSE", tradingsymbol: "JINDALSTEL-EQ" },
  { exchange: "NSE", tradingsymbol: "JIOFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "JUBLFOOD-EQ" },
  { exchange: "NSE", tradingsymbol: "JUBLINGREA-EQ" },
  { exchange: "NSE", tradingsymbol: "JUBLPHARMA-EQ" },
  { exchange: "NSE", tradingsymbol: "JWL-EQ" },
  { exchange: "NSE", tradingsymbol: "JYOTHYLAB-EQ" },
  { exchange: "NSE", tradingsymbol: "JYOTICNC-EQ" },
  { exchange: "NSE", tradingsymbol: "KPRMILL-EQ" },
  { exchange: "NSE", tradingsymbol: "KEI-EQ" },
  { exchange: "NSE", tradingsymbol: "KPITTECH-EQ" },
  { exchange: "NSE", tradingsymbol: "KSB-EQ" },
  { exchange: "NSE", tradingsymbol: "KAJARIACER-EQ" },
  { exchange: "NSE", tradingsymbol: "KPIL-EQ" },
  { exchange: "NSE", tradingsymbol: "KALYANKJIL-EQ" },
  { exchange: "NSE", tradingsymbol: "KARURVYSYA-EQ" },
  { exchange: "NSE", tradingsymbol: "KAYNES-EQ" },
  { exchange: "NSE", tradingsymbol: "KEC-EQ" },
  { exchange: "NSE", tradingsymbol: "KFINTECH-EQ" },
  { exchange: "NSE", tradingsymbol: "KIRLOSBROS-EQ" },
  { exchange: "NSE", tradingsymbol: "KIRLOSENG-EQ" },
  { exchange: "NSE", tradingsymbol: "KOTAKBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "KIMS-EQ" },
  { exchange: "NSE", tradingsymbol: "LTF-EQ" },
  { exchange: "NSE", tradingsymbol: "LTTS-EQ" },
  { exchange: "NSE", tradingsymbol: "LICHSGFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "LTFOODS-EQ" },
  { exchange: "NSE", tradingsymbol: "LTM-EQ" },
  { exchange: "NSE", tradingsymbol: "LT-EQ" },
  { exchange: "NSE", tradingsymbol: "LATENTVIEW-EQ" },
  { exchange: "NSE", tradingsymbol: "LAURUSLABS-EQ" },
  { exchange: "NSE", tradingsymbol: "THELEELA-EQ" },
  { exchange: "NSE", tradingsymbol: "LEMONTREE-EQ" },
  { exchange: "NSE", tradingsymbol: "LICI-EQ" },
  { exchange: "NSE", tradingsymbol: "LINDEINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "LLOYDSME-EQ" },
  { exchange: "NSE", tradingsymbol: "LODHA-EQ" },
  { exchange: "NSE", tradingsymbol: "LUPIN-EQ" },
  { exchange: "NSE", tradingsymbol: "MMTC-EQ" },
  { exchange: "NSE", tradingsymbol: "MRF-EQ" },
  { exchange: "NSE", tradingsymbol: "MGL-EQ" },
  { exchange: "NSE", tradingsymbol: "MAHSCOOTER-EQ" },
  { exchange: "NSE", tradingsymbol: "MAHSEAMLES-EQ" },
  { exchange: "NSE", tradingsymbol: "M&MFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "M&M-EQ" },
  { exchange: "NSE", tradingsymbol: "MANAPPURAM-EQ" },
  { exchange: "NSE", tradingsymbol: "MRPL-EQ" },
  { exchange: "NSE", tradingsymbol: "MANKIND-EQ" },
  { exchange: "NSE", tradingsymbol: "MARICO-EQ" },
  { exchange: "NSE", tradingsymbol: "MARUTI-EQ" },
  { exchange: "NSE", tradingsymbol: "MFSL-EQ" },
  { exchange: "NSE", tradingsymbol: "MAXHEALTH-EQ" },
  { exchange: "NSE", tradingsymbol: "MAZDOCK-EQ" },
  { exchange: "NSE", tradingsymbol: "METROPOLIS-EQ" },
  { exchange: "NSE", tradingsymbol: "MINDACORP-EQ" },
  { exchange: "NSE", tradingsymbol: "MSUMI-EQ" },
  { exchange: "NSE", tradingsymbol: "MOTILALOFS-EQ" },
  { exchange: "NSE", tradingsymbol: "MPHASIS-EQ" },
  { exchange: "NSE", tradingsymbol: "MCX-EQ" },
  { exchange: "NSE", tradingsymbol: "MUTHOOTFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "NATCOPHARM-EQ" },
  { exchange: "NSE", tradingsymbol: "NBCC-EQ" },
  { exchange: "NSE", tradingsymbol: "NCC-EQ" },
  { exchange: "NSE", tradingsymbol: "NHPC-EQ" },
  { exchange: "NSE", tradingsymbol: "NLCINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "NMDC-EQ" },
  { exchange: "NSE", tradingsymbol: "NSLNISP-EQ" },
  { exchange: "NSE", tradingsymbol: "NTPCGREEN-EQ" },
  { exchange: "NSE", tradingsymbol: "NTPC-EQ" },
  { exchange: "NSE", tradingsymbol: "NH-EQ" },
  { exchange: "NSE", tradingsymbol: "NATIONALUM-EQ" },
  { exchange: "NSE", tradingsymbol: "NAVA-EQ" },
  { exchange: "NSE", tradingsymbol: "NAVINFLUOR-EQ" },
  { exchange: "NSE", tradingsymbol: "NESTLEIND-EQ" },
  { exchange: "NSE", tradingsymbol: "NETWEB-EQ" },
  { exchange: "NSE", tradingsymbol: "NEULANDLAB-EQ" },
  { exchange: "NSE", tradingsymbol: "NEWGEN-EQ" },
  { exchange: "NSE", tradingsymbol: "NAM-INDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "NIVABUPA-EQ" },
  { exchange: "NSE", tradingsymbol: "NUVAMA-EQ" },
  { exchange: "NSE", tradingsymbol: "NUVOCO-EQ" },
  { exchange: "NSE", tradingsymbol: "OBEROIRLTY-EQ" },
  { exchange: "NSE", tradingsymbol: "ONGC-EQ" },
  { exchange: "NSE", tradingsymbol: "OIL-EQ" },
  { exchange: "NSE", tradingsymbol: "OLAELEC-EQ" },
  { exchange: "NSE", tradingsymbol: "OLECTRA-EQ" },
  { exchange: "NSE", tradingsymbol: "PAYTM-EQ" },
  { exchange: "NSE", tradingsymbol: "ONESOURCE-EQ" },
  { exchange: "NSE", tradingsymbol: "OFSS-EQ" },
  { exchange: "NSE", tradingsymbol: "POLICYBZR-EQ" },
  { exchange: "NSE", tradingsymbol: "PCBL-EQ" },
  { exchange: "NSE", tradingsymbol: "PGEL-EQ" },
  { exchange: "NSE", tradingsymbol: "PIIND-EQ" },
  { exchange: "NSE", tradingsymbol: "PNBHOUSING-EQ" },
  { exchange: "NSE", tradingsymbol: "PTCIL-EQ" },
  { exchange: "NSE", tradingsymbol: "PVRINOX-EQ" },
  { exchange: "NSE", tradingsymbol: "PAGEIND-EQ" },
  { exchange: "NSE", tradingsymbol: "PATANJALI-EQ" },
  { exchange: "NSE", tradingsymbol: "PERSISTENT-EQ" },
  { exchange: "NSE", tradingsymbol: "PETRONET-EQ" },
  { exchange: "NSE", tradingsymbol: "PFIZER-EQ" },
  { exchange: "NSE", tradingsymbol: "PHOENIXLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "PIDILITIND-EQ" },
  { exchange: "NSE", tradingsymbol: "PPLPHARMA-EQ" },
  { exchange: "NSE", tradingsymbol: "POLYMED-EQ" },
  { exchange: "NSE", tradingsymbol: "POLYCAB-EQ" },
  { exchange: "NSE", tradingsymbol: "POONAWALLA-EQ" },
  { exchange: "NSE", tradingsymbol: "PFC-EQ" },
  { exchange: "NSE", tradingsymbol: "POWERGRID-EQ" },
  { exchange: "NSE", tradingsymbol: "PRAJIND-EQ" },
  { exchange: "NSE", tradingsymbol: "PREMIERENE-EQ" },
  { exchange: "NSE", tradingsymbol: "PRESTIGE-EQ" },
  { exchange: "NSE", tradingsymbol: "PGHH-EQ" },
  { exchange: "NSE", tradingsymbol: "PNB-EQ" },
  { exchange: "NSE", tradingsymbol: "RRKABEL-EQ" },
  { exchange: "NSE", tradingsymbol: "RBLBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "RECLTD-EQ" },
  { exchange: "NSE", tradingsymbol: "RHIM-EQ" },
  { exchange: "NSE", tradingsymbol: "RITES-EQ" },
  { exchange: "NSE", tradingsymbol: "RADICO-EQ" },
  { exchange: "NSE", tradingsymbol: "RVNL-EQ" },
  { exchange: "NSE", tradingsymbol: "RAILTEL-EQ" },
  { exchange: "NSE", tradingsymbol: "RAINBOW-EQ" },
  { exchange: "NSE", tradingsymbol: "RKFORGE-EQ" },
  { exchange: "NSE", tradingsymbol: "RCF-EQ" },
  { exchange: "NSE", tradingsymbol: "REDINGTON-EQ" },
  { exchange: "NSE", tradingsymbol: "RELIANCE-EQ" },
  { exchange: "NSE", tradingsymbol: "RELINFRA-EQ" },
  { exchange: "NSE", tradingsymbol: "RPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "SBFC-EQ" },
  { exchange: "NSE", tradingsymbol: "SBICARD-EQ" },
  { exchange: "NSE", tradingsymbol: "SBILIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "SJVN-EQ" },
  { exchange: "NSE", tradingsymbol: "SRF-EQ" },
  { exchange: "NSE", tradingsymbol: "SAGILITY-EQ" },
  { exchange: "NSE", tradingsymbol: "SAILIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "SAMMAANCAP-EQ" },
  { exchange: "NSE", tradingsymbol: "MOTHERSON-EQ" },
  { exchange: "NSE", tradingsymbol: "SAPPHIRE-EQ" },
  { exchange: "NSE", tradingsymbol: "SARDAEN-EQ" },
  { exchange: "NSE", tradingsymbol: "SAREGAMA-EQ" },
  { exchange: "NSE", tradingsymbol: "SCHAEFFLER-EQ" },
  { exchange: "NSE", tradingsymbol: "SCHNEIDER-EQ" },
  { exchange: "NSE", tradingsymbol: "SCI-EQ" },
  { exchange: "NSE", tradingsymbol: "SHREECEM-EQ" },
  { exchange: "NSE", tradingsymbol: "SHRIRAMFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "SHYAMMETL-EQ" },
  { exchange: "NSE", tradingsymbol: "ENRIN-EQ" },
  { exchange: "NSE", tradingsymbol: "SIEMENS-EQ" },
  { exchange: "NSE", tradingsymbol: "SIGNATURE-EQ" },
  { exchange: "NSE", tradingsymbol: "SOBHA-EQ" },
  { exchange: "NSE", tradingsymbol: "SOLARINDS-EQ" },
  { exchange: "NSE", tradingsymbol: "SONACOMS-EQ" },
  { exchange: "NSE", tradingsymbol: "SONATSOFTW-EQ" },
  { exchange: "NSE", tradingsymbol: "STARHEALTH-EQ" },
  { exchange: "NSE", tradingsymbol: "SBIN-EQ" },
  { exchange: "NSE", tradingsymbol: "SAIL-EQ" },
  { exchange: "NSE", tradingsymbol: "SUMICHEM-EQ" },
  { exchange: "NSE", tradingsymbol: "SUNPHARMA-EQ" },
  { exchange: "NSE", tradingsymbol: "SUNTV-EQ" },
  { exchange: "NSE", tradingsymbol: "SUNDARMFIN-EQ" },
  { exchange: "NSE", tradingsymbol: "SUNDRMFAST-EQ" },
  { exchange: "NSE", tradingsymbol: "SUPREMEIND-EQ" },
  { exchange: "NSE", tradingsymbol: "SUZLON-EQ" },
  { exchange: "NSE", tradingsymbol: "SWANCORP-EQ" },
  { exchange: "NSE", tradingsymbol: "SWIGGY-EQ" },
  { exchange: "NSE", tradingsymbol: "SYNGENE-EQ" },
  { exchange: "NSE", tradingsymbol: "SYRMA-EQ" },
  { exchange: "NSE", tradingsymbol: "TBOTEK-EQ" },
  { exchange: "NSE", tradingsymbol: "TVSMOTOR-EQ" },
  { exchange: "NSE", tradingsymbol: "TATACHEM-EQ" },
  { exchange: "NSE", tradingsymbol: "TATACOMM-EQ" },
  { exchange: "NSE", tradingsymbol: "TCS-EQ" },
  { exchange: "NSE", tradingsymbol: "TATACONSUM-EQ" },
  { exchange: "NSE", tradingsymbol: "TATAELXSI-EQ" },
  { exchange: "NSE", tradingsymbol: "TATAINVEST-EQ" },
  { exchange: "NSE", tradingsymbol: "TMPV-EQ" },
  { exchange: "NSE", tradingsymbol: "TATAPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "TATASTEEL-EQ" },
  { exchange: "NSE", tradingsymbol: "TATATECH-EQ" },
  { exchange: "NSE", tradingsymbol: "TTML-EQ" },
  { exchange: "NSE", tradingsymbol: "TECHM-EQ" },
  { exchange: "NSE", tradingsymbol: "TECHNOE-EQ" },
  { exchange: "NSE", tradingsymbol: "TEJASNET-EQ" },
  { exchange: "NSE", tradingsymbol: "NIACL-EQ" },
  { exchange: "NSE", tradingsymbol: "RAMCOCEM-EQ" },
  { exchange: "NSE", tradingsymbol: "THERMAX-EQ" },
  { exchange: "NSE", tradingsymbol: "TIMKEN-EQ" },
  { exchange: "NSE", tradingsymbol: "TITAGARH-EQ" },
  { exchange: "NSE", tradingsymbol: "TITAN-EQ" },
  { exchange: "NSE", tradingsymbol: "TORNTPHARM-EQ" },
  { exchange: "NSE", tradingsymbol: "TORNTPOWER-EQ" },
  { exchange: "NSE", tradingsymbol: "TARIL-EQ" },
  { exchange: "NSE", tradingsymbol: "TRENT-EQ" },
  { exchange: "NSE", tradingsymbol: "TRIDENT-EQ" },
  { exchange: "NSE", tradingsymbol: "TRIVENI-EQ" },
  { exchange: "NSE", tradingsymbol: "TRITURBINE-EQ" },
  { exchange: "NSE", tradingsymbol: "TIINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "UCOBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "UNOMINDA-EQ" },
  { exchange: "NSE", tradingsymbol: "UPL-EQ" },
  { exchange: "NSE", tradingsymbol: "UTIAMC-EQ" },
  { exchange: "NSE", tradingsymbol: "ULTRACEMCO-EQ" },
  { exchange: "NSE", tradingsymbol: "UNIONBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "UBL-EQ" },
  { exchange: "NSE", tradingsymbol: "UNITDSPR-EQ" },
  { exchange: "NSE", tradingsymbol: "USHAMART-EQ" },
  { exchange: "NSE", tradingsymbol: "VGUARD-EQ" },
  { exchange: "NSE", tradingsymbol: "DBREALTY-EQ" },
  { exchange: "NSE", tradingsymbol: "VTL-EQ" },
  { exchange: "NSE", tradingsymbol: "VBL-EQ" },
  { exchange: "NSE", tradingsymbol: "MANYAVAR-EQ" },
  { exchange: "NSE", tradingsymbol: "VEDL-EQ" },
  { exchange: "NSE", tradingsymbol: "VENTIVE-EQ" },
  { exchange: "NSE", tradingsymbol: "VIJAYA-EQ" },
  { exchange: "NSE", tradingsymbol: "VMM-EQ" },
  { exchange: "NSE", tradingsymbol: "IDEA-EQ" },
  { exchange: "NSE", tradingsymbol: "VOLTAS-EQ" },
  { exchange: "NSE", tradingsymbol: "WAAREEENER-EQ" },
  { exchange: "NSE", tradingsymbol: "WELCORP-EQ" },
  { exchange: "NSE", tradingsymbol: "WELSPUNLIV-EQ" },
  { exchange: "NSE", tradingsymbol: "WHIRLPOOL-EQ" },
  { exchange: "NSE", tradingsymbol: "WIPRO-EQ" },
  { exchange: "NSE", tradingsymbol: "WOCKPHARMA-EQ" },
  { exchange: "NSE", tradingsymbol: "YESBANK-EQ" },
  { exchange: "NSE", tradingsymbol: "ZFCVINDIA-EQ" },
  { exchange: "NSE", tradingsymbol: "ZEEL-EQ" },
  { exchange: "NSE", tradingsymbol: "ZENTEC-EQ" },
  { exchange: "NSE", tradingsymbol: "ZENSARTECH-EQ" },
  { exchange: "NSE", tradingsymbol: "ZYDUSLIFE-EQ" },
  { exchange: "NSE", tradingsymbol: "ECLERX-EQ" },
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
    // Weekly/monthly are built by aggregating ONE_DAY candles in-process.
    "1w": "ONE_DAY",
    "1mo": "ONE_DAY",
  };
  return m[String(timeframe || "").toLowerCase()] || "FIVE_MINUTE";
}

function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function aggregateCandles(candles, kind /* 'week' | 'month' */) {
  const keyFn = kind === "week" ? isoWeekKey : monthKey;
  const groups = new Map();
  for (const c of candles) {
    const d = new Date(c.time);
    const k = keyFn(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const out = [];
  const sortedKeys = Array.from(groups.keys()).sort();
  for (const k of sortedKeys) {
    const arr = groups.get(k).sort((a, b) => new Date(a.time) - new Date(b.time));
    out.push({
      time: arr[0].time,
      open: arr[0].open,
      high: Math.max(...arr.map((x) => x.high)),
      low: Math.min(...arr.map((x) => x.low)),
      close: arr[arr.length - 1].close,
      volume: arr.reduce((s, x) => s + (Number(x.volume) || 0), 0),
    });
  }
  return out;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// Angel's getCandleData expects "YYYY-MM-DD HH:mm" in IST.
// Format in IST regardless of server timezone (Vercel runs UTC, local dev usually IST).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function fmtDateTime(d) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

// timeframe preset: today / 1h / 2h / 4h / 2d / 1w / 1mo / 3mo / 6mo / 1y
function getRangeFromPreset(preset) {
  const now = new Date();
  const end = now;

  const p = String(preset || "today").toLowerCase();

  const DAY = 24 * 60 * 60 * 1000;
  if (p === "1h") return { from: new Date(now.getTime() - 1 * 60 * 60 * 1000), to: end };
  if (p === "2h") return { from: new Date(now.getTime() - 2 * 60 * 60 * 1000), to: end };
  if (p === "4h") return { from: new Date(now.getTime() - 4 * 60 * 60 * 1000), to: end };
  if (p === "2d") return { from: new Date(now.getTime() - 2 * DAY), to: end };
  if (p === "1w") return { from: new Date(now.getTime() - 7 * DAY), to: end };
  if (p === "1mo") return { from: new Date(now.getTime() - 30 * DAY), to: end };
  if (p === "3mo") return { from: new Date(now.getTime() - 90 * DAY), to: end };
  if (p === "6mo") return { from: new Date(now.getTime() - 180 * DAY), to: end };
  if (p === "1y") return { from: new Date(now.getTime() - 365 * DAY), to: end };

  // today: 09:15 IST of the current IST trading day (TZ-independent).
  const istShifted = new Date(now.getTime() + IST_OFFSET_MS);
  const startMs = Date.UTC(
    istShifted.getUTCFullYear(),
    istShifted.getUTCMonth(),
    istShifted.getUTCDate(),
    3,
    45,
    0,
    0, // 09:15 IST = 03:45 UTC
  );
  return { from: new Date(startMs), to: end };
}

// ------------------------------------------------------------
// Resolve symboltoken (scrip master)
// NOTE: This is large JSON. For production, cache it for 1 day.
let scripMasterCache = null; // raw array (kept for callers that need rows)
let scripMasterIndex = null; // Map<"EXCH:SYM", row> for O(1) lookup
let scripMasterFetchedAt = 0;
const tokenCache = new Map(); // Map<"EXCH:SYM", tokenString> — survives across scans

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
    // Build the lookup index once per refresh — O(1) reads forever after.
    const idx = new Map();
    for (const row of data) {
      const key = `${String(row.exch_seg).toUpperCase()}:${String(row.symbol).toUpperCase()}`;
      // First entry wins on duplicate symbols (rare; matches old `.find()` behavior).
      if (!idx.has(key)) idx.set(key, row);
    }
    scripMasterCache = data;
    scripMasterIndex = idx;
    scripMasterFetchedAt = Date.now();
    tokenCache.clear(); // master refreshed → previous token snapshots may be stale
    return data;
  } catch (e) {
    console.error("Failed to load scrip master:", e);
    throw new Error("Unable to load scrip master. Please try again later.");
  }
}

async function resolveSymbolTokenFromMaster(exchange, tradingsymbol) {
  const ex = String(exchange).toUpperCase();
  const ts = String(tradingsymbol).toUpperCase();
  const key = `${ex}:${ts}`;

  const cached = tokenCache.get(key);
  if (cached) return cached;

  await loadScripMasterCached();
  const row = scripMasterIndex.get(key);
  if (!row) throw new Error(`Symbol not found in master: ${ex}:${ts}`);
  const token = String(row.token);
  tokenCache.set(key, token);
  return token;
}

// ------------------------------------------------------------
// Angel One session (SmartAPI SDK)
let smart = null;
let sessionReady = false;
let lastSessionAt = 0;

let angelJwtToken = null;
let angelFeedToken = null;

function invalidateAngelSession() {
  sessionReady = false;
  lastSessionAt = 0;
  angelJwtToken = null;
  angelFeedToken = null;
}

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
// Angel's /market/v1/quote caps each call at 50 tokens (AB4029). Chunk per-exchange.
async function getLTPBulk(exchangeTokens) {
  await ensureAngelSession();

  const apiKey = process.env.ANGEL_API_KEY;
  if (!angelJwtToken) throw new Error("Missing angelJwtToken (session not ready)");

  const MAX_TOKENS_PER_CALL = 50;
  const batches = [];
  for (const [exchange, tokens] of Object.entries(exchangeTokens || {})) {
    if (!Array.isArray(tokens) || !tokens.length) continue;
    for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_CALL) {
      batches.push({ [exchange]: tokens.slice(i, i + MAX_TOKENS_PER_CALL) });
    }
  }
  if (!batches.length) return [];

  const allFetched = [];
  for (const batch of batches) {
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
      body: JSON.stringify({ mode: "LTP", exchangeTokens: batch }),
    });
    const json = await resp.json();
    if (!json?.status) throw new Error(`Market quote failed: ${JSON.stringify(json)}`);
    // json.data.fetched: [{exchange, symbolToken, ltp, ...}]
    allFetched.push(...(json.data?.fetched || []));
  }
  return allFetched;
}

// ------------------------------------------------------------
// Candle fetch
async function fetchCandles(exchange, tradingsymbol, interval, preset, timeframe) {
  await ensureAngelSession();
  const tf = String(timeframe || "").toLowerCase();
  const isWeekly = tf === "1w";
  const isMonthly = tf === "1mo";

  console.log(`Fetching candles for ${exchange}:${tradingsymbol} | Interval: ${interval} | Preset: ${preset} | TF: ${tf}`);
  const symboltoken = await resolveSymbolTokenFromMaster(exchange, tradingsymbol);
  console.log(`Resolved ${exchange}:${tradingsymbol} → token ${symboltoken}`);

  let { from, to } = getRangeFromPreset(preset);
  // Weekly/monthly override the preset range — presets like "today"/"1h" can't produce enough bars.
  if (isWeekly || isMonthly) {
    to = new Date();
    from = new Date();
    from.setFullYear(from.getFullYear() - (isMonthly ? 5 : 2));
  }

  const candleParams = {
    exchange,
    symboltoken,
    interval,
    fromdate: fmtDateTime(from),
    todate: fmtDateTime(to),
  };
  console.log("Candle params:", candleParams);
  const candleResp = await smart.getCandleData(candleParams);
  // Angel uses both `status` (legacy) and `success` (newer) on this endpoint.
  if (!candleResp || candleResp.status === false || candleResp.success === false) {
    throw new Error(`getCandleData failed: ${JSON.stringify(candleResp)}`);
  }

  const rows = Array.isArray(candleResp.data) ? candleResp.data : [];
  let candles = rows.map((r) => ({
    time: new Date(r[0]).toISOString(),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5] ?? 0),
  }));

  if (isWeekly) candles = aggregateCandles(candles, "week");
  else if (isMonthly) candles = aggregateCandles(candles, "month");

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
    // Use a partial window for the first w-1 candles so the line spans the chart.
    for (let i = 0; i < candles.length; i++) {
      const start = Math.max(0, i - w + 1);
      const n = i - start + 1;
      let sum = 0;
      for (let j = start; j <= i; j++) sum += closes[j];
      out[i] = sum / n;
    }
  } else if (ind === "BOLLINGER_UPPER" || ind === "BOLLINGER_LOWER") {
    for (let i = 0; i < candles.length; i++) {
      const start = Math.max(0, i - w + 1);
      const slice = closes.slice(start, i + 1);
      const sma = slice.reduce((s, v) => s + v, 0) / slice.length;
      const variance = slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / slice.length;
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
  const stdDev = Math.max(0.1, Number(req.query.stdDev || 2));
  const requestedPreset = req.query.preset || "today";

  const exchange = (req.query.exchange || "NSE").toUpperCase();
  const tradingsymbol = (req.query.tradingsymbol || "RELIANCE-EQ").toUpperCase();

  // Cascade: try the requested preset; if it returns zero candles (weekend,
  // holiday, intraday range outside market hours), widen until data appears.
  const presetCascade = [requestedPreset];
  for (const p of ["1w", "1mo", "3mo"]) {
    if (!presetCascade.includes(p)) presetCascade.push(p);
  }

  const interval = mapInterval(timeframe);
  let candles = [];
  let usedPreset = requestedPreset;
  let lastError = null;

  for (const preset of presetCascade) {
    try {
      const result = await fetchCandles(exchange, tradingsymbol, interval, preset, timeframe);
      if (result.candles && result.candles.length) {
        candles = result.candles;
        usedPreset = preset;
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (candles.length) {
    const withIndicator = addIndicator(candles, indicator, window, stdDev);
    return res.json({
      ok: true,
      source: "angelone",
      params: { exchange, tradingsymbol, preset: usedPreset, requestedPreset, timeframe, interval, indicator, window, stdDev },
      candles: withIndicator,
    });
  }

  const dummy = generateDummyData(600);
  const withIndicator = addIndicator(dummy, indicator, window, stdDev);
  res.json({
    ok: true,
    source: "dummy_fallback",
    error: lastError ? String(lastError.message || lastError) : "No candles returned for any preset",
    params: { preset: requestedPreset, requestedPreset, timeframe, indicator, window, stdDev },
    candles: withIndicator,
  });
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
    preset,
    timeframe,
    interval,
    indicator,
    window,
    candle1Side,
    breakoutMode,
    confirmWithLTP,
    stocks: totalStocks,
  });

  sendEvent("progress", { step: "init", message: `Starting scan for ${totalStocks} stocks...`, current: 0, total: totalStocks });

  function parseAngelError(e) {
    const msg = String(e?.message || e || "");
    const idx = msg.indexOf("{");
    if (idx >= 0) {
      try {
        const obj = JSON.parse(msg.slice(idx));
        // Angel mixes errorcode/errorCode and message/errorMessage across endpoints.
        return {
          code: obj?.errorcode ?? obj?.errorCode,
          apiMessage: obj?.message ?? obj?.errorMessage,
          raw: obj,
          msg,
        };
      } catch (_) {}
    }
    const resp = e?.response?.data;
    return {
      code: resp?.errorcode ?? resp?.errorCode,
      apiMessage: resp?.message ?? resp?.errorMessage,
      raw: resp,
      msg,
    };
  }

  const fetchCandlesWithRetry = async (exchange, tradingsymbol, interval, preset, timeframe, maxTry = 3) => {
    let lastError;
    for (let i = 1; i <= maxTry; i++) {
      try {
        return await fetchCandles(exchange, tradingsymbol, interval, preset, timeframe);
      } catch (e) {
        lastError = e;
        const info = parseAngelError(e);
        console.warn(`⚠️ Candle fetch failed [${i}/${maxTry}]`, {
          symbol: tradingsymbol,
          exchange,
          code: info.code,
          message: info.apiMessage || info.msg,
        });
        // AG8003 = "Token missing" — session is stale even though we think it's valid.
        // Invalidate it so the next attempt re-logs in. Worth one retry.
        if (info.code === "AG8003") {
          console.warn("🔄 Token missing — forcing session refresh");
          invalidateAngelSession();
          continue;
        }
        if (info.code !== "AB1004") break;
        const wait = 600 * Math.pow(2, i - 1);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastError;
  };

  // Detect actual client disconnect on the *response* stream.
  // Note: req.on("close") also fires when express.json() finishes consuming the
  // request body, which would falsely mark every scan as disconnected.
  let clientDisconnected = false;
  let scanFinished = false;
  res.on("close", () => {
    if (!scanFinished) {
      clientDisconnected = true;
      console.log("Client disconnected, aborting scan");
    }
  });

  try {
    const results = [];
    const ltpReq = { NSE: [], BSE: [], NFO: [], MCX: [] };
    let matchesSoFar = 0;

    // Bounded parallelism + token-bucket pacing for Angel's 3/sec getCandleData cap.
    // SLOT_MS slightly above 1000/3 to stay safe under any sliding-window measurement.
    const CONCURRENCY = 3;
    const SLOT_MS = 340;
    let pacerNextStartAt = 0;
    const paceCandleStart = async () => {
      const now = Date.now();
      if (pacerNextStartAt <= now) {
        pacerNextStartAt = now + SLOT_MS;
        return;
      }
      const wait = pacerNextStartAt - now;
      pacerNextStartAt += SLOT_MS;
      await new Promise((r) => setTimeout(r, wait));
    };

    const resultsByIdx = new Array(stocks.length);
    let nextIdx = 0;
    let completed = 0;

    const worker = async () => {
      while (!clientDisconnected) {
        const myIdx = nextIdx++;
        if (myIdx >= stocks.length) return;

        const s = stocks[myIdx];
        const exchange = String(s.exchange || "NSE").toUpperCase();
        const tradingsymbol = String(s.tradingsymbol || "").toUpperCase();
        if (!tradingsymbol) {
          completed++;
          continue;
        }

        sendEvent("progress", {
          step: "fetch",
          message: `Fetching ${tradingsymbol}`,
          current: completed,
          total: totalStocks,
          matches: matchesSoFar,
        });

        await paceCandleStart();
        if (clientDisconnected) return;

        try {
          const { candles, symboltoken } = await fetchCandlesWithRetry(exchange, tradingsymbol, interval, preset, timeframe);
          console.log(`🕯️ ${tradingsymbol} candles: ${candles?.length ?? 0}`);

          if (!candles || candles.length < 10) {
            resultsByIdx[myIdx] = { exchange, tradingsymbol, symboltoken, match: false, reason: "Not enough candles" };
            continue;
          }

          sendEvent("progress", {
            step: "calculate",
            message: `Analyzing ${tradingsymbol}`,
            current: completed,
            total: totalStocks,
            matches: matchesSoFar,
          });

          const withInd = addIndicator(candles, indicator, window, stdDev);
          const hits = scanThreeCandlePattern(withInd, { candle1Side, breakoutMode });

          if (hits.length) {
            matchesSoFar++;
            console.log(`✅ Pattern HIT → ${tradingsymbol}`);
            if (confirmWithLTP && ltpReq[exchange]) ltpReq[exchange].push(String(symboltoken));
            resultsByIdx[myIdx] = { exchange, tradingsymbol, symboltoken, match: true, hits, lastCandle: withInd[withInd.length - 1], candles: withInd };

            sendEvent("match", {
              message: `Pattern found in ${tradingsymbol}`,
              symbol: tradingsymbol,
              current: completed,
              total: totalStocks,
              matches: matchesSoFar,
            });
          } else {
            resultsByIdx[myIdx] = { exchange, tradingsymbol, symboltoken, match: false };
          }
        } catch (e) {
          const info = parseAngelError(e);
          console.error(`🔥 ${tradingsymbol} failed`, { exchange, code: info.code, message: info.apiMessage || info.msg });
          resultsByIdx[myIdx] = { exchange, tradingsymbol, match: false, error: info.code ? `${info.code}: ${info.apiMessage || info.msg}` : info.msg };
        } finally {
          completed++;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stocks.length) }, () => worker()));

    // Flatten sparse → dense, preserving input order.
    for (const r of resultsByIdx) if (r) results.push(r);

    // Round summary — quickly tells if no matches is a data issue vs a pattern issue.
    let nErr = 0,
      nFewCandles = 0,
      nScannedNoHit = 0,
      nHit = 0;
    for (const r of results) {
      if (r.error) nErr++;
      else if (r.reason === "Not enough candles") nFewCandles++;
      else if (r.match) nHit++;
      else nScannedNoHit++;
    }
    console.log(
      `📊 Round summary: ${totalStocks} stocks | ${nErr} errors | ${nFewCandles} too-few-candles | ${nScannedNoHit + nHit} scanned | ${nHit} hits` +
        ` (preset=${preset} tf=${timeframe} ind=${indicator} side=${candle1Side} mode=${breakoutMode})`,
    );

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
          exchange: r.exchange,
          tradingsymbol: r.tradingsymbol,
          symboltoken: r.symboltoken,
          ltp: r.ltp ?? null,
          liveBreakAboveCandle2High: r.liveBreakAboveCandle2High ?? null,
          hits: r.hits ?? [],
          candles: r.candles?.slice(-300) ?? [],
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

// ------------------------------------------------------------
// Watchlist persistence
async function readWatchlist() {
  try {
    const raw = await fs.readFile(WATCHLIST_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function writeWatchlist(list) {
  await fs.writeFile(WATCHLIST_FILE, JSON.stringify(list, null, 2), "utf-8");
}

function watchlistKey(exchange, tradingsymbol) {
  return `${String(exchange).toUpperCase()}:${String(tradingsymbol).toUpperCase()}`;
}

// ------------------------------------------------------------
// Search: fuzzy match scrip master by symbol or name (equities only)
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "")
    .trim()
    .toUpperCase();
  if (!q) return res.json({ ok: true, results: [] });
  try {
    const data = await loadScripMasterCached();
    const results = [];
    for (const row of data) {
      const exch = String(row.exch_seg || "").toUpperCase();
      if (exch !== "NSE" && exch !== "BSE") continue;
      // skip derivatives (they have an expiry)
      if (row.expiry && String(row.expiry).trim() !== "") continue;
      const sym = String(row.symbol || "").toUpperCase();
      const name = String(row.name || "").toUpperCase();
      if (sym.includes(q) || name.includes(q)) {
        results.push({
          exchange: exch,
          tradingsymbol: row.symbol,
          name: row.name || row.symbol,
          token: String(row.token),
        });
        if (results.length >= 30) break;
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ------------------------------------------------------------
// Watchlist CRUD
app.get("/api/watchlist", async (req, res) => {
  const list = await readWatchlist();
  res.json({ ok: true, watchlist: list });
});

app.post("/api/watchlist", async (req, res) => {
  const { exchange, tradingsymbol, name, upperLimit, lowerLimit } = req.body || {};
  if (!exchange || !tradingsymbol) {
    return res.status(400).json({ ok: false, error: "exchange and tradingsymbol required" });
  }
  const list = await readWatchlist();
  const key = watchlistKey(exchange, tradingsymbol);
  const existing = list.find((x) => watchlistKey(x.exchange, x.tradingsymbol) === key);
  const parseLimit = (v) => (v === null || v === "" || v === undefined ? null : Number(v));
  if (existing) {
    if (name !== undefined) existing.name = name;
    if (upperLimit !== undefined) existing.upperLimit = parseLimit(upperLimit);
    if (lowerLimit !== undefined) existing.lowerLimit = parseLimit(lowerLimit);
  } else {
    list.push({
      exchange: String(exchange).toUpperCase(),
      tradingsymbol: String(tradingsymbol).toUpperCase(),
      name: name || tradingsymbol,
      upperLimit: parseLimit(upperLimit),
      lowerLimit: parseLimit(lowerLimit),
      addedAt: new Date().toISOString(),
    });
  }
  await writeWatchlist(list);
  res.json({ ok: true, watchlist: list });
});

app.delete("/api/watchlist/:exchange/:tradingsymbol", async (req, res) => {
  const key = watchlistKey(req.params.exchange, req.params.tradingsymbol);
  const list = await readWatchlist();
  const filtered = list.filter((x) => watchlistKey(x.exchange, x.tradingsymbol) !== key);
  await writeWatchlist(filtered);
  res.json({ ok: true, watchlist: filtered });
});

// ------------------------------------------------------------
// Bulk LTP for the whole watchlist — polled by the watchlist UI for alerts
app.get("/api/watchlist/ltp", async (req, res) => {
  try {
    const list = await readWatchlist();
    if (!list.length) return res.json({ ok: true, prices: {} });

    await ensureAngelSession();

    const byExchange = {};
    const symbolByExchToken = {};
    for (const item of list) {
      try {
        const token = await resolveSymbolTokenFromMaster(item.exchange, item.tradingsymbol);
        if (!byExchange[item.exchange]) byExchange[item.exchange] = [];
        byExchange[item.exchange].push(String(token));
        symbolByExchToken[`${item.exchange}:${token}`] = item.tradingsymbol;
      } catch (e) {
        console.warn(`watchlist ltp: unresolved ${item.exchange}:${item.tradingsymbol} — ${e.message}`);
      }
    }

    if (!Object.keys(byExchange).length) return res.json({ ok: true, prices: {} });

    const fetched = await getLTPBulk(byExchange);
    const prices = {};
    for (const row of fetched) {
      const sym = symbolByExchToken[`${row.exchange}:${row.symbolToken}`];
      if (sym) prices[watchlistKey(row.exchange, sym)] = Number(row.ltp);
    }
    res.json({ ok: true, prices });
  } catch (e) {
    console.error("watchlist ltp failed:", e);
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
