require("dotenv").config({ path: "../.env" });
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Config ─────────────────────────────────────────────────
const KINTONE_BASE = process.env.KINTONE_BASE_URL;
const APPS = {
  products: { id: process.env.KINTONE_PRODUCTS_APP_ID, token: process.env.KINTONE_PRODUCTS_TOKEN },
  dealers:  { id: process.env.KINTONE_DEALERS_APP_ID,  token: process.env.KINTONE_DEALERS_TOKEN },
  orders:   { id: process.env.KINTONE_ORDERS_APP_ID,   token: process.env.KINTONE_ORDERS_TOKEN },
};

// ─── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: ["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"] }));
app.use(express.json());

// Serve static React build in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/dist")));
}

// ─── Kintone Proxy Helper ───────────────────────────────────
async function kintoneRequest(appKey, endpoint, method = "GET", body = null, query = {}) {
  const appConfig = APPS[appKey];
  if (!appConfig) throw new Error(`Unknown app: ${appKey}`);

  const url = new URL(`${KINTONE_BASE}${endpoint}`);
  if (method === "GET") {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
  }

  const headers = {
    "X-Cybozu-API-Token": appConfig.token,
    "Content-Type": "application/json",
  };

  const options = { method, headers };
  if (body && method !== "GET") options.body = JSON.stringify(body);

  const res = await fetch(url.toString(), options);
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.message || `Kintone error ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// ─── API Routes ─────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", kintone: KINTONE_BASE, timestamp: new Date().toISOString() });
});

// GET records from any app
app.get("/api/:appKey/records", async (req, res) => {
  try {
    const { appKey } = req.params;
    const { query, fields, totalCount } = req.query;
    const data = await kintoneRequest(appKey, "/k/v1/records.json", "GET", null, {
      app: APPS[appKey].id,
      query: query || "",
      fields: fields || undefined,
      totalCount: totalCount || "true",
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// GET single record
app.get("/api/:appKey/record/:id", async (req, res) => {
  try {
    const { appKey, id } = req.params;
    const data = await kintoneRequest(appKey, "/k/v1/record.json", "GET", null, {
      app: APPS[appKey].id,
      id,
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// POST new record
app.post("/api/:appKey/record", async (req, res) => {
  try {
    const { appKey } = req.params;
    const data = await kintoneRequest(appKey, "/k/v1/record.json", "POST", {
      app: APPS[appKey].id,
      record: req.body.record,
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// PUT update record
app.put("/api/:appKey/record", async (req, res) => {
  try {
    const { appKey } = req.params;
    const data = await kintoneRequest(appKey, "/k/v1/record.json", "PUT", {
      app: APPS[appKey].id,
      id: req.body.id,
      record: req.body.record,
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// POST multiple records
app.post("/api/:appKey/records", async (req, res) => {
  try {
    const { appKey } = req.params;
    const data = await kintoneRequest(appKey, "/k/v1/records.json", "POST", {
      app: APPS[appKey].id,
      records: req.body.records,
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─── Auth Route (dealer login) ──────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { code, password } = req.body;
    if (!code || !password) return res.status(400).json({ error: "Code and password required" });

    const data = await kintoneRequest("dealers", "/k/v1/records.json", "GET", null, {
      app: APPS.dealers.id,
      query: `dealer_code = "${code}" and dealer_status = "Active" limit 1`,
    });

    if (data.records.length === 0) return res.status(401).json({ error: "Dealer not found" });

    const dealer = data.records[0];
    if (dealer.login_password.value !== password) return res.status(401).json({ error: "Invalid password" });

    res.json({
      dealer: {
        code: dealer.dealer_code.value,
        name: dealer.dealer_name.value,
        contact: dealer.contact_person.value,
        email: dealer.email.value,
        region: dealer.region.value,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Catch-all for React SPA (production) ───────────────────
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/dist/index.html"));
  });
}

// ─── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🟡 Zagu Ordering API running on http://localhost:${PORT}`);
  console.log(`  📦 Kintone: ${KINTONE_BASE}`);
  console.log(`  🔗 Apps: Products(#${APPS.products.id}) Dealers(#${APPS.dealers.id}) Orders(#${APPS.orders.id})\n`);
});
