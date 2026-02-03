require("dotenv").config({ path: "../.env" });
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

const KINTONE_BASE = process.env.KINTONE_BASE_URL;
const APPS = {
  products: { id: process.env.KINTONE_PRODUCTS_APP_ID, token: process.env.KINTONE_PRODUCTS_TOKEN },
  dealers:  { id: process.env.KINTONE_DEALERS_APP_ID,  token: process.env.KINTONE_DEALERS_TOKEN },
  orders:   { id: process.env.KINTONE_ORDERS_APP_ID,   token: process.env.KINTONE_ORDERS_TOKEN },
};

// Combined token for orders (needs products + dealers for lookup resolution)
const ORDERS_COMBINED_TOKEN = [APPS.orders.token, APPS.products.token, APPS.dealers.token].join(",");

const ALLOWED_ORIGINS = [
  "http://localhost:5173", "http://localhost:3000", "http://localhost:3001",
  "https://tomarai-369.github.io",
  process.env.FRONTEND_URL,
].filter(Boolean);
app.use(cors({ origin: (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return cb(null, true);
  cb(null, false);
}, credentials: true }));
app.use(express.json());

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/dist")));
}

// ─── Kintone Proxy ──────────────────────────────────────────
async function kintoneRequest(appKey, endpoint, method = "GET", body = null, query = {}, overrideToken = null) {
  const appConfig = APPS[appKey];
  if (!appConfig) throw new Error(`Unknown app: ${appKey}`);

  const url = new URL(`${KINTONE_BASE}${endpoint}`);
  if (method === "GET") {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
  }

  const options = {
    method,
    headers: {
      "X-Cybozu-API-Token": overrideToken || appConfig.token,
      "Content-Type": "application/json",
    },
  };
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

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", kintone: KINTONE_BASE, timestamp: new Date().toISOString() });
});

// Generic CRUD
app.get("/api/:appKey/records", async (req, res) => {
  try {
    const { appKey } = req.params;
    const { query, fields, totalCount } = req.query;
    const data = await kintoneRequest(appKey, "/k/v1/records.json", "GET", null, {
      app: APPS[appKey].id, query: query || "", fields: fields || undefined, totalCount: totalCount || "true",
    });
    res.json(data);
  } catch (err) { res.status(err.status || 500).json({ error: err.message, details: err.details }); }
});

app.get("/api/:appKey/record/:id", async (req, res) => {
  try {
    const { appKey, id } = req.params;
    const data = await kintoneRequest(appKey, "/k/v1/record.json", "GET", null, { app: APPS[appKey].id, id });
    res.json(data);
  } catch (err) { res.status(err.status || 500).json({ error: err.message, details: err.details }); }
});

app.post("/api/:appKey/record", async (req, res) => {
  try {
    const { appKey } = req.params;
    // Use combined tokens for orders (lookups need access to products + dealers apps)
    const token = appKey === "orders" ? ORDERS_COMBINED_TOKEN : null;
    const data = await kintoneRequest(appKey, "/k/v1/record.json", "POST", {
      app: APPS[appKey].id, record: req.body.record,
    }, {}, token);
    res.json(data);
  } catch (err) { res.status(err.status || 500).json({ error: err.message, details: err.details }); }
});

app.put("/api/:appKey/record", async (req, res) => {
  try {
    const { appKey } = req.params;
    const data = await kintoneRequest(appKey, "/k/v1/record.json", "PUT", {
      app: APPS[appKey].id, id: req.body.id, record: req.body.record,
    });
    res.json(data);
  } catch (err) { res.status(err.status || 500).json({ error: err.message, details: err.details }); }
});

// ─── Auth (dealer login with stores + balance) ──────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { code, password } = req.body;
    if (!code || !password) return res.status(400).json({ error: "Code and password required" });

    const data = await kintoneRequest("dealers", "/k/v1/records.json", "GET", null, {
      app: APPS.dealers.id, query: `dealer_code = "${code}" and dealer_status in ("Active") limit 1`,
    });

    if (data.records.length === 0) return res.status(401).json({ error: "Dealer not found or inactive" });

    const d = data.records[0];
    if (d.login_password.value !== password) return res.status(401).json({ error: "Invalid password" });

    // Check password expiry
    const expiry = d.password_expiry?.value;
    if (expiry && new Date(expiry) < new Date()) {
      return res.status(401).json({ error: "Password expired. Please contact your administrator." });
    }

    // Extract stores from subtable
    const stores = (d.dealer_stores?.value || []).map((row) => ({
      code: row.value.ds_store_code?.value || "",
      name: row.value.ds_store_name?.value || "",
      address: row.value.ds_store_address?.value || "",
    }));

    res.json({
      dealer: {
        code: d.dealer_code.value,
        name: d.dealer_name.value,
        sapBpCode: d.sap_bp_code?.value || "",
        contact: d.contact_person.value,
        email: d.email.value,
        region: d.region.value,
        outstandingBalance: Number(d.outstanding_balance?.value || 0),
        creditLimit: Number(d.credit_limit?.value || 0),
        creditTerms: d.credit_terms?.value || "None",
        mfaEnabled: d.mfa_enabled?.value || "No",
        passwordExpiry: d.password_expiry?.value || "",
        stores,
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Process Management: Update order status ────────────────
app.post("/api/orders/status", async (req, res) => {
  try {
    const { id, action, assignee } = req.body;
    const body = { app: APPS.orders.id, id, action };
    if (assignee) body.assignee = assignee;

    const data = await kintoneRequest("orders", "/k/v1/record/status.json", "PUT", body);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─── Composite: Create order + advance status ───────────────
// Creates the order and immediately advances through process management
// New → Submit Order → Send for Approval (Pending ONB Approval)
app.post("/api/orders/submit-order", async (req, res) => {
  try {
    const { record, isDraft } = req.body;

    // Step 1: Create the record (with combined tokens for lookup resolution)
    const createResult = await kintoneRequest("orders", "/k/v1/record.json", "POST", {
      app: APPS.orders.id, record,
    }, {}, ORDERS_COMBINED_TOKEN);

    const recordId = createResult.id;

    // Step 2: If not a draft, advance the process management status
    if (!isDraft) {
      try {
        // New → Submitted
        await kintoneRequest("orders", "/k/v1/record/status.json", "PUT", {
          app: APPS.orders.id, id: recordId, action: "Submit Order",
        });

        // Submitted → Pending ONB Approval (requires assignee)
        await kintoneRequest("orders", "/k/v1/record/status.json", "PUT", {
          app: APPS.orders.id, id: recordId, action: "Send for Approval", assignee: "Administrator",
        });
      } catch (statusErr) {
        // Order was created but status advancement failed — log but don't fail the whole request
        console.error(`[Zagu] Status advancement failed for record ${recordId}:`, statusErr.message);
        return res.json({
          id: recordId,
          revision: createResult.revision,
          status: "created_but_status_pending",
          statusError: statusErr.message,
        });
      }
    }

    res.json({
      id: recordId,
      revision: createResult.revision,
      status: isDraft ? "draft" : "pending_approval",
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─── Dealer Registration ────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, dealerCode, password, dealerName, contactPerson, phone, region } = req.body;
    if (!email || !dealerCode || !password || !dealerName || !contactPerson) {
      return res.status(400).json({ error: "Email, dealer code, password, dealer name, and contact person are required" });
    }
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    // Check if dealer code or email already exists
    const existing = await kintoneRequest("dealers", "/k/v1/records.json", "GET", null, {
      app: APPS.dealers.id, query: `dealer_code = "${dealerCode}" or email = "${email}" limit 1`,
    });
    if (existing.records.length > 0) {
      const match = existing.records[0];
      if (match.dealer_code.value === dealerCode) return res.status(409).json({ error: "Dealer code already registered" });
      if (match.email.value === email) return res.status(409).json({ error: "Email already registered" });
    }

    // Set password expiry 90 days from now
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 90);

    // Create dealer record with Pending Approval status
    const record = {
      dealer_code: { value: dealerCode },
      dealer_name: { value: dealerName },
      email: { value: email },
      contact_person: { value: contactPerson },
      phone: { value: phone || "" },
      region: { value: region || "NCR" },
      login_password: { value: password },
      password_expiry: { value: expiry.toISOString().split("T")[0] },
      dealer_status: { value: "Pending Approval" },
      credit_terms: { value: "None" },
      mfa_enabled: { value: "No" },
    };

    const result = await kintoneRequest("dealers", "/k/v1/record.json", "POST", {
      app: APPS.dealers.id, record,
    });

    res.json({ success: true, id: result.id, message: "Registration submitted. Your account will be reviewed by Zagu back office." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details });
  }
});

// ─── Change Password ────────────────────────────────────────
app.put("/api/auth/change-password", async (req, res) => {
  try {
    const { code, currentPassword, newPassword } = req.body;
    if (!code || !currentPassword || !newPassword) return res.status(400).json({ error: "All fields required" });
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });

    // Verify current credentials
    const data = await kintoneRequest("dealers", "/k/v1/records.json", "GET", null, {
      app: APPS.dealers.id, query: `dealer_code = "${code}" and dealer_status in ("Active") limit 1`,
    });
    if (data.records.length === 0) return res.status(401).json({ error: "Dealer not found" });
    const d = data.records[0];
    if (d.login_password.value !== currentPassword) return res.status(401).json({ error: "Current password incorrect" });

    // Update password + set new expiry (90 days)
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 90);
    await kintoneRequest("dealers", "/k/v1/record.json", "PUT", {
      app: APPS.dealers.id, id: d.$id.value,
      record: {
        login_password: { value: newPassword },
        password_expiry: { value: newExpiry.toISOString().split("T")[0] },
      },
    });

    res.json({ success: true, newExpiry: newExpiry.toISOString().split("T")[0] });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV === "production") {
    res.sendFile(path.join(__dirname, "../client/dist/index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  🟡 Zagu Ordering API running on http://localhost:${PORT}`);
  console.log(`  📦 Kintone: ${KINTONE_BASE}`);
  console.log(`  🔗 Apps: Products(#${APPS.products.id}) Dealers(#${APPS.dealers.id}) Orders(#${APPS.orders.id})\n`);
});
