// Zagu Ordering Portal — Kintone API Proxy (Cloudflare Worker)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getApps(env) {
  return {
    products: { id: env.KINTONE_PRODUCTS_APP_ID, token: env.KINTONE_PRODUCTS_TOKEN },
    dealers:  { id: env.KINTONE_DEALERS_APP_ID,  token: env.KINTONE_DEALERS_TOKEN },
    orders:   { id: env.KINTONE_ORDERS_APP_ID,   token: env.KINTONE_ORDERS_TOKEN },
  };
}

function getCombinedToken(apps) {
  return [apps.orders.token, apps.products.token, apps.dealers.token].join(",");
}

async function kintoneRequest(env, appKey, endpoint, method = "GET", body = null, query = {}, overrideToken = null) {
  const apps = getApps(env);
  const appConfig = apps[appKey];
  if (!appConfig) throw Object.assign(new Error(`Unknown app: ${appKey}`), { status: 400 });

  const url = new URL(`${env.KINTONE_BASE_URL}${endpoint}`);
  if (method === "GET") {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }

  const headers = { "X-Cybozu-API-Token": overrideToken || appConfig.token };
  if (method !== "GET") headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method,
    headers,
    ...(body && method !== "GET" ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || `Kintone error ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// ─── Route handlers ─────────────────────────────────────────

async function handleHealth(env) {
  return json({ status: "ok", kintone: env.KINTONE_BASE_URL, timestamp: new Date().toISOString() });
}

async function handleGetRecords(env, appKey, url) {
  const apps = getApps(env);
  if (!apps[appKey]) return json({ error: `Unknown app: ${appKey}` }, 400);
  const query = url.searchParams.get("query") || "";
  const fields = url.searchParams.get("fields") || undefined;
  const totalCount = url.searchParams.get("totalCount") || "true";
  const data = await kintoneRequest(env, appKey, "/k/v1/records.json", "GET", null, {
    app: apps[appKey].id, query, fields, totalCount,
  });
  return json(data);
}

async function handleGetRecord(env, appKey, id) {
  const apps = getApps(env);
  if (!apps[appKey]) return json({ error: `Unknown app: ${appKey}` }, 400);
  const data = await kintoneRequest(env, appKey, "/k/v1/record.json", "GET", null, {
    app: apps[appKey].id, id,
  });
  return json(data);
}

async function handleCreateRecord(env, appKey, body) {
  const apps = getApps(env);
  if (!apps[appKey]) return json({ error: `Unknown app: ${appKey}` }, 400);
  const token = appKey === "orders" ? getCombinedToken(apps) : null;
  const data = await kintoneRequest(env, appKey, "/k/v1/record.json", "POST", {
    app: apps[appKey].id, record: body.record,
  }, {}, token);
  return json(data);
}

async function handleUpdateRecord(env, appKey, body) {
  const apps = getApps(env);
  if (!apps[appKey]) return json({ error: `Unknown app: ${appKey}` }, 400);
  const data = await kintoneRequest(env, appKey, "/k/v1/record.json", "PUT", {
    app: apps[appKey].id, id: body.id, record: body.record,
  });
  return json(data);
}

async function handleLogin(env, body) {
  const { code, password } = body;
  if (!code || !password) return json({ error: "Code and password required" }, 400);

  const apps = getApps(env);
  const data = await kintoneRequest(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id, query: `dealer_code = "${code}" limit 1`,
  });
  if (data.records.length === 0) return json({ error: "Dealer not found" }, 401);

  const d = data.records[0];
  const pmStatus = d.Status?.value || d.dealer_status?.value || "";

  // Only Active dealers can log in
  if (pmStatus !== "Active") {
    if (pmStatus === "Pending Review" || pmStatus === "Pending Approval") {
      return json({ error: "Your account is pending approval. Please wait for activation." }, 401);
    }
    if (pmStatus === "Inactive") {
      return json({ error: "Your account has been deactivated. Please contact Zagu back office." }, 401);
    }
    return json({ error: "Dealer not found or inactive" }, 401);
  }

  if (d.login_password.value !== password) return json({ error: "Invalid password" }, 401);

  const expiry = d.password_expiry?.value;
  if (expiry && new Date(expiry) < new Date()) {
    return json({ error: "Password expired. Please contact your administrator." }, 401);
  }

  const stores = (d.dealer_stores?.value || []).map((row) => ({
    code: row.value.ds_store_code?.value || "",
    name: row.value.ds_store_name?.value || "",
    address: row.value.ds_store_address?.value || "",
  }));

  return json({
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
}

async function handleOrderStatus(env, body) {
  const { id, action, assignee } = body;
  const apps = getApps(env);
  const payload = { app: apps.orders.id, id, action };
  if (assignee) payload.assignee = assignee;
  const data = await kintoneRequest(env, "orders", "/k/v1/record/status.json", "PUT", payload);
  return json(data);
}

async function handleSubmitOrder(env, body) {
  const { record, isDraft } = body;
  const apps = getApps(env);

  const createResult = await kintoneRequest(env, "orders", "/k/v1/record.json", "POST", {
    app: apps.orders.id, record,
  }, {}, getCombinedToken(apps));

  const recordId = createResult.id;

  if (!isDraft) {
    try {
      await kintoneRequest(env, "orders", "/k/v1/record/status.json", "PUT", {
        app: apps.orders.id, id: recordId, action: "Submit Order",
      });
      await kintoneRequest(env, "orders", "/k/v1/record/status.json", "PUT", {
        app: apps.orders.id, id: recordId, action: "Send for Approval", assignee: "Administrator",
      });
    } catch (statusErr) {
      return json({
        id: recordId, revision: createResult.revision,
        status: "created_but_status_pending", statusError: statusErr.message,
      });
    }
  }

  return json({
    id: recordId, revision: createResult.revision,
    status: isDraft ? "draft" : "pending_approval",
  });
}

async function handleRegister(env, body) {
  const { email, dealerCode, password, dealerName, contactPerson, phone, region } = body;
  if (!email || !dealerCode || !password || !dealerName || !contactPerson) {
    return json({ error: "Email, dealer code, password, dealer name, and contact person are required" }, 400);
  }
  if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

  const apps = getApps(env);
  const existing = await kintoneRequest(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id, query: `dealer_code = "${dealerCode}" or email = "${email}" limit 1`,
  });
  if (existing.records.length > 0) {
    const match = existing.records[0];
    if (match.dealer_code.value === dealerCode) return json({ error: "Dealer code already registered" }, 409);
    if (match.email.value === email) return json({ error: "Email already registered" }, 409);
  }

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 90);

  const result = await kintoneRequest(env, "dealers", "/k/v1/record.json", "POST", {
    app: apps.dealers.id,
    record: {
      dealer_code: { value: dealerCode },
      dealer_name: { value: dealerName },
      email: { value: email },
      contact_person: { value: contactPerson },
      phone: { value: phone || "" },
      region: { value: region || "NCR" },
      login_password: { value: password },
      password_expiry: { value: expiry.toISOString().split("T")[0] },
      credit_terms: { value: "None" },
      mfa_enabled: { value: "No" },
    },
  });

  const recordId = result.id;

  // Advance PM: New → Pending Review (notifies Administrator)
  try {
    await kintoneRequest(env, "dealers", "/k/v1/record/status.json", "PUT", {
      app: apps.dealers.id, id: recordId, action: "Submit for Review", assignee: "Administrator",
    });
  } catch (pmErr) {
    // Record created but PM advancement failed — still report success
    return json({ success: true, id: recordId, message: "Registration submitted. Your account will be reviewed by Zagu back office.", pmWarning: pmErr.message });
  }

  return json({ success: true, id: result.id, message: "Registration submitted. Your account will be reviewed by Zagu back office." });
}

async function handleChangePassword(env, body) {
  const { code, currentPassword, newPassword } = body;
  if (!code || !currentPassword || !newPassword) return json({ error: "All fields required" }, 400);
  if (newPassword.length < 6) return json({ error: "New password must be at least 6 characters" }, 400);

  const apps = getApps(env);
  const data = await kintoneRequest(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id, query: `dealer_code = "${code}" limit 1`,
  });
  if (data.records.length === 0) return json({ error: "Dealer not found" }, 401);

  const d = data.records[0];
  const pmStatus = d.Status?.value || d.dealer_status?.value || "";
  if (pmStatus !== "Active") return json({ error: "Dealer not active" }, 401);
  if (d.login_password.value !== currentPassword) return json({ error: "Current password incorrect" }, 401);

  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + 90);
  await kintoneRequest(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id, id: d.$id.value,
    record: {
      login_password: { value: newPassword },
      password_expiry: { value: newExpiry.toISOString().split("T")[0] },
    },
  });

  return json({ success: true, newExpiry: newExpiry.toISOString().split("T")[0] });
}

async function handleDealerStatus(env, body) {
  const { id, action, assignee } = body;
  const apps = getApps(env);
  const payload = { app: apps.dealers.id, id, action };
  if (assignee) payload.assignee = assignee;
  const data = await kintoneRequest(env, "dealers", "/k/v1/record/status.json", "PUT", payload);
  return json(data);
}

// ─── Router ─────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // Health check
      if (path === "/api/health" && method === "GET") {
        return handleHealth(env);
      }

      // Auth routes
      if (path === "/api/auth/login" && method === "POST") {
        return handleLogin(env, await request.json());
      }
      if (path === "/api/auth/register" && method === "POST") {
        return handleRegister(env, await request.json());
      }
      if (path === "/api/auth/change-password" && method === "PUT") {
        return handleChangePassword(env, await request.json());
      }

      // Order-specific routes
      if (path === "/api/orders/status" && method === "POST") {
        return handleOrderStatus(env, await request.json());
      }
      if (path === "/api/orders/submit-order" && method === "POST") {
        return handleSubmitOrder(env, await request.json());
      }

      // Dealer PM status advancement
      if (path === "/api/dealers/status" && method === "POST") {
        return handleDealerStatus(env, await request.json());
      }

      // Generic CRUD: /api/{appKey}/records
      const recordsMatch = path.match(/^\/api\/(\w+)\/records$/);
      if (recordsMatch && method === "GET") {
        return handleGetRecords(env, recordsMatch[1], url);
      }

      // Generic CRUD: /api/{appKey}/record/{id}
      const recordIdMatch = path.match(/^\/api\/(\w+)\/record\/(\d+)$/);
      if (recordIdMatch && method === "GET") {
        return handleGetRecord(env, recordIdMatch[1], recordIdMatch[2]);
      }

      // Generic CRUD: /api/{appKey}/record (POST/PUT)
      const recordMatch = path.match(/^\/api\/(\w+)\/record$/);
      if (recordMatch && method === "POST") {
        return handleCreateRecord(env, recordMatch[1], await request.json());
      }
      if (recordMatch && method === "PUT") {
        return handleUpdateRecord(env, recordMatch[1], await request.json());
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message, details: err.details }, err.status || 500);
    }
  },
};
