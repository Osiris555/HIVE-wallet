// apps/mobile/honey-dev/pyth-price-feed.js
// Pyth Network Price Feed Integration
// More reliable and decentralized than CoinGecko!

const fetch = require('node-fetch');

// Pyth Network Price Service API
// This is the HTTP endpoint - for production you'd use on-chain Pyth contracts
const PYTH_API = "https://hermes.pyth.network/v2/updates/price/latest";

// Pyth Price Feed IDs for each token
// These are the official Pyth feed IDs for mainnet prices
const PYTH_PRICE_IDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", // BTC/USD
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // ETH/USD
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", // SOL/USD
  USDT: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b", // USDT/USD
  USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", // USDC/USD
  XRP: "0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8", // XRP/USD
};

const PRICE_CACHE_TTL_MS = 60 * 1000; // Cache for 1 minute

let priceCache = {
  prices: {},
  lastUpdate: 0,
};

/**
 * Fetch real-time prices from Pyth Network
 * @returns {Promise<Object>} Token prices in USD
 */
async function fetchPythPrices() {
  const now = Date.now();

  // Return cached prices if still fresh
  if (now - priceCache.lastUpdate < PRICE_CACHE_TTL_MS) {
    return priceCache.prices;
  }

  try {
    // Construct Pyth v2 API URL with all price feed IDs
    const ids = Object.values(PYTH_PRICE_IDS);
    const params = ids.map(id => `ids[]=${id}`).join('&');
    const url = `${PYTH_API}?${params}`;

    const response = await fetch(url, { timeout: 8000 });
    if (!response.ok) {
      console.warn("Pyth API error:", response.status);
      return priceCache.prices;
    }
    
    const data = await response.json();

    const prices = {
      HNY: 1.00,
      stHNY: 1.05,
    };

    // v2 API returns { parsed: [{ id, price: { price, expo, conf, publish_time } }] }
    const parsed = data.parsed || data;
    const feedArray = Array.isArray(parsed) ? parsed : [];

    for (const [symbol, feedId] of Object.entries(PYTH_PRICE_IDS)) {
      const cleanId = feedId.replace(/^0x/, '');
      const feed = feedArray.find(f => {
        const fid = (f.id || '').replace(/^0x/, '');
        return fid === cleanId;
      });
      if (feed && feed.price) {
        const price = Number(feed.price.price);
        const expo = Number(feed.price.expo);
        const actualPrice = price * Math.pow(10, expo);
        if (actualPrice > 0) prices[symbol] = actualPrice;
      }
    }

    priceCache = { prices, lastUpdate: now };
    console.log("📈 Pyth prices updated:", Object.entries(prices).map(([k,v]) => `${k}: $${Number(v).toFixed(2)}`).join(', '));
    return prices;
  } catch (e) {
    console.warn("Failed to fetch Pyth prices:", e.message);
    return priceCache.prices;
  }
}

/**
 * Alternative: Fetch prices using Pyth's simpler endpoint
 * This is easier but less detailed
 */
async function fetchPythPricesSimple() {
  const now = Date.now();

  if (now - priceCache.lastUpdate < PRICE_CACHE_TTL_MS) {
    return priceCache.prices;
  }

  try {
    const prices = {
      HNY: 1.00,
      stHNY: 1.05,
    };

    for (const [symbol, feedId] of Object.entries(PYTH_PRICE_IDS)) {
      try {
        const url = `${PYTH_API}?ids[]=${feedId}`;
        const response = await fetch(url, { timeout: 5000 });
        
        if (response.ok) {
          const data = await response.json();
          const parsed = data.parsed || data;
          const feedArray = Array.isArray(parsed) ? parsed : [];
          if (feedArray[0] && feedArray[0].price) {
            const price = Number(feedArray[0].price.price);
            const expo = Number(feedArray[0].price.expo);
            const actualPrice = price * Math.pow(10, expo);
            if (actualPrice > 0) prices[symbol] = actualPrice;
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch ${symbol} price:`, e.message);
      }
    }

    priceCache = { prices, lastUpdate: now };
    console.log("📈 Pyth prices updated:", Object.entries(prices).map(([k,v]) => `${k}: $${Number(v).toFixed(2)}`).join(', '));
    return prices;
  } catch (e) {
    console.warn("Failed to fetch Pyth prices:", e.message);
    return priceCache.prices;
  }
}

/**
 * Get latest cached prices without fetching
 */
function getCachedPrices() {
  return priceCache.prices;
}

/**
 * Check if prices are stale
 */
function arePricesStale() {
  return Date.now() - priceCache.lastUpdate > PRICE_CACHE_TTL_MS;
}

module.exports = {
  fetchPythPrices,
  fetchPythPricesSimple,
  getCachedPrices,
  arePricesStale,
  PYTH_PRICE_IDS,
};
