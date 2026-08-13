// stocks.js — curated Indian equity universe for search.
// Each entry: NSE symbol, company name, sector bucket (drives sector-specific analysis),
// industry label, and Yahoo Finance ticker suffix (.NS = NSE).
// This is a *search index only*. No prices/fundamentals are stored here — those are
// always fetched live from data providers so nothing is ever fabricated.

export const SECTORS = {
  BANK: 'Banking / NBFC',
  IT: 'Information Technology',
  FMCG: 'FMCG / Consumer',
  AUTO: 'Automobile',
  PHARMA: 'Pharma / Healthcare',
  ENERGY: 'Energy / Oil & Gas',
  METAL: 'Metals & Mining',
  INFRA: 'Infra / Cement / Realty',
  TELECOM: 'Telecom',
  DIVERSIFIED: 'Diversified / Conglomerate',
  OTHER: 'Other',
};

// A representative multi-sector, multi-cap universe (large/mid/small, profitable &
// loss-making, banks/NBFCs included) so the tool can be exercised across the board.
export const STOCK_UNIVERSE = [
  // --- Banking / NBFC ---
  { s: 'HDFCBANK',   n: 'HDFC Bank',                        sector: 'BANK',    industry: 'Private Bank' },
  { s: 'ICICIBANK',  n: 'ICICI Bank',                       sector: 'BANK',    industry: 'Private Bank' },
  { s: 'SBIN',       n: 'State Bank of India',              sector: 'BANK',    industry: 'Public Bank' },
  { s: 'KOTAKBANK',  n: 'Kotak Mahindra Bank',              sector: 'BANK',    industry: 'Private Bank' },
  { s: 'AXISBANK',   n: 'Axis Bank',                        sector: 'BANK',    industry: 'Private Bank' },
  { s: 'BAJFINANCE', n: 'Bajaj Finance',                    sector: 'BANK',    industry: 'NBFC' },
  { s: 'BANKBARODA', n: 'Bank of Baroda',                   sector: 'BANK',    industry: 'Public Bank' },
  { s: 'IDFCFIRSTB', n: 'IDFC First Bank',                  sector: 'BANK',    industry: 'Private Bank' },

  // --- IT ---
  { s: 'TCS',        n: 'Tata Consultancy Services',        sector: 'IT',      industry: 'IT Services' },
  { s: 'INFY',       n: 'Infosys',                          sector: 'IT',      industry: 'IT Services' },
  { s: 'WIPRO',      n: 'Wipro',                            sector: 'IT',      industry: 'IT Services' },
  { s: 'HCLTECH',    n: 'HCL Technologies',                 sector: 'IT',      industry: 'IT Services' },
  { s: 'TECHM',      n: 'Tech Mahindra',                    sector: 'IT',      industry: 'IT Services' },
  { s: 'LTIM',       n: 'LTIMindtree',                      sector: 'IT',      industry: 'IT Services' },
  { s: 'PERSISTENT', n: 'Persistent Systems',               sector: 'IT',      industry: 'IT Services' },

  // --- FMCG / Consumer ---
  { s: 'HINDUNILVR', n: 'Hindustan Unilever',               sector: 'FMCG',    industry: 'FMCG' },
  { s: 'ITC',        n: 'ITC',                              sector: 'FMCG',    industry: 'Diversified FMCG' },
  { s: 'NESTLEIND',  n: 'Nestle India',                     sector: 'FMCG',    industry: 'Packaged Foods' },
  { s: 'BRITANNIA',  n: 'Britannia Industries',             sector: 'FMCG',    industry: 'Packaged Foods' },
  { s: 'DABUR',      n: 'Dabur India',                      sector: 'FMCG',    industry: 'FMCG' },
  { s: 'TITAN',      n: 'Titan Company',                    sector: 'FMCG',    industry: 'Consumer Durables' },

  // --- Auto ---
  { s: 'MARUTI',     n: 'Maruti Suzuki India',              sector: 'AUTO',    industry: 'Passenger Vehicles' },
  { s: 'TATAMOTORS', n: 'Tata Motors',                      sector: 'AUTO',    industry: 'Auto - 4W & CV' },
  { s: 'M&M',        n: 'Mahindra & Mahindra',              sector: 'AUTO',    industry: 'Auto - UV & Tractors' },
  { s: 'BAJAJ-AUTO', n: 'Bajaj Auto',                       sector: 'AUTO',    industry: 'Two Wheelers' },
  { s: 'EICHERMOT',  n: 'Eicher Motors',                    sector: 'AUTO',    industry: 'Two Wheelers / CV' },
  { s: 'HEROMOTOCO', n: 'Hero MotoCorp',                    sector: 'AUTO',    industry: 'Two Wheelers' },

  // --- Pharma / Healthcare ---
  { s: 'SUNPHARMA',  n: 'Sun Pharmaceutical',               sector: 'PHARMA',  industry: 'Pharma' },
  { s: 'DRREDDY',    n: "Dr. Reddy's Laboratories",         sector: 'PHARMA',  industry: 'Pharma' },
  { s: 'CIPLA',      n: 'Cipla',                            sector: 'PHARMA',  industry: 'Pharma' },
  { s: 'DIVISLAB',   n: "Divi's Laboratories",              sector: 'PHARMA',  industry: 'Pharma - API' },
  { s: 'APOLLOHOSP', n: 'Apollo Hospitals',                 sector: 'PHARMA',  industry: 'Healthcare Services' },

  // --- Energy / Oil & Gas ---
  { s: 'RELIANCE',   n: 'Reliance Industries',              sector: 'ENERGY',  industry: 'Oil to Chemicals / Telecom / Retail' },
  { s: 'ONGC',       n: 'Oil & Natural Gas Corporation',    sector: 'ENERGY',  industry: 'Oil Exploration' },
  { s: 'NTPC',       n: 'NTPC',                             sector: 'ENERGY',  industry: 'Power Generation' },
  { s: 'POWERGRID',  n: 'Power Grid Corporation',           sector: 'ENERGY',  industry: 'Power Transmission' },
  { s: 'IOC',        n: 'Indian Oil Corporation',           sector: 'ENERGY',  industry: 'Oil Marketing' },
  { s: 'ADANIGREEN', n: 'Adani Green Energy',               sector: 'ENERGY',  industry: 'Renewables' },

  // --- Metals & Mining ---
  { s: 'TATASTEEL',  n: 'Tata Steel',                       sector: 'METAL',   industry: 'Steel' },
  { s: 'JSWSTEEL',   n: 'JSW Steel',                        sector: 'METAL',   industry: 'Steel' },
  { s: 'HINDALCO',   n: 'Hindalco Industries',              sector: 'METAL',   industry: 'Aluminium' },
  { s: 'COALINDIA',  n: 'Coal India',                       sector: 'METAL',   industry: 'Mining' },
  { s: 'VEDL',       n: 'Vedanta',                          sector: 'METAL',   industry: 'Diversified Metals' },

  // --- Infra / Cement / Realty ---
  { s: 'LT',         n: 'Larsen & Toubro',                  sector: 'INFRA',   industry: 'Engineering & Construction' },
  { s: 'ULTRACEMCO', n: 'UltraTech Cement',                 sector: 'INFRA',   industry: 'Cement' },
  { s: 'GRASIM',     n: 'Grasim Industries',                sector: 'INFRA',   industry: 'Cement / VSF' },
  { s: 'DLF',        n: 'DLF',                              sector: 'INFRA',   industry: 'Real Estate' },
  { s: 'ADANIPORTS', n: 'Adani Ports & SEZ',                sector: 'INFRA',   industry: 'Ports' },

  // --- Telecom ---
  { s: 'BHARTIARTL', n: 'Bharti Airtel',                    sector: 'TELECOM', industry: 'Telecom Services' },
  { s: 'IDEA',       n: 'Vodafone Idea',                    sector: 'TELECOM', industry: 'Telecom Services' },

  // --- Diversified / Conglomerate ---
  { s: 'ADANIENT',   n: 'Adani Enterprises',                sector: 'DIVERSIFIED', industry: 'Incubator / Diversified' },

  // --- Other / Diversified caps for testing missing data & volatility ---
  { s: 'ASIANPAINT', n: 'Asian Paints',                     sector: 'OTHER',   industry: 'Paints' },
  { s: 'PIDILITIND', n: 'Pidilite Industries',              sector: 'OTHER',   industry: 'Adhesives / Chemicals' },
  { s: 'ZOMATO',     n: 'Zomato (Eternal)',                 sector: 'OTHER',   industry: 'Online Food Delivery' },
  { s: 'PAYTM',      n: 'One 97 (Paytm)',                   sector: 'OTHER',   industry: 'Fintech' },
  { s: 'NYKAA',      n: 'FSN E-Commerce (Nykaa)',           sector: 'OTHER',   industry: 'Online Retail' },
  { s: 'IRCTC',      n: 'IRCTC',                            sector: 'OTHER',   industry: 'Railway Services' },
  { s: 'DMART',      n: 'Avenue Supermarts (DMart)',        sector: 'OTHER',   industry: 'Retail' },
  { s: 'TRENT',      n: 'Trent',                            sector: 'OTHER',   industry: 'Retail' },
];

// Benchmark index (NIFTY 50) — used for relative strength & beta.
export const BENCHMARK = { s: '^NSEI', n: 'NIFTY 50', yahoo: '%5ENSEI' };

// Sector proxy indices for relative-strength comparison (Yahoo tickers).
export const SECTOR_INDEX = {
  BANK:    { n: 'NIFTY Bank',    yahoo: '%5ENSEBANK' },
  IT:      { n: 'NIFTY IT',      yahoo: 'NIFTYIT.NS' },
  AUTO:    { n: 'NIFTY Auto',    yahoo: 'NIFTYAUTO.NS' },
  PHARMA:  { n: 'NIFTY Pharma',  yahoo: 'NIFTYPHARMA.NS' },
  FMCG:    { n: 'NIFTY FMCG',    yahoo: 'NIFTYFMCG.NS' },
  METAL:   { n: 'NIFTY Metal',   yahoo: 'NIFTYMETAL.NS' },
};

// Convert an NSE symbol to a Yahoo Finance ticker. Yahoo uses ".NS" for NSE and
// URL-encodes special characters (e.g. M&M -> M%26M.NS).
export function toYahoo(nseSymbol) {
  return encodeURIComponent(nseSymbol) + '.NS';
}

// Fuzzy search over symbol + name + industry.
export function searchStocks(query, limit = 8) {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const scored = [];
  for (const st of STOCK_UNIVERSE) {
    const sym = st.s.toUpperCase();
    const name = st.n.toUpperCase();
    let score = 0;
    if (sym === q) score = 100;
    else if (sym.startsWith(q)) score = 80;
    else if (name.startsWith(q)) score = 70;
    else if (sym.includes(q)) score = 50;
    else if (name.includes(q)) score = 40;
    else if (st.industry.toUpperCase().includes(q)) score = 20;
    if (score > 0) scored.push({ st, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.st);
}
