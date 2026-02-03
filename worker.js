// Zagu Ordering Portal — Kintone API Proxy (Cloudflare Worker)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(message, status = 500, details) {
  return new Response(JSON.stringify({ error: message, details }), {
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

// Returns { ok, data, status } — never throws
async function kintone(env, appKey, endpoint, method = "GET", body = null, query = {}, overrideToken = null) {
  const apps = getApps(env);
  const appConfig = apps[appKey];
  if (!appConfig) return { ok: false, status: 400, data: { message: `Unknown app: ${appKey}` } };

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
  return { ok: res.ok, status: res.status, data };
}

// ─── Route handlers ─────────────────────────────────────────

async function handleHealth(env) {
  return jsonResponse({ status: "ok", kintone: env.KINTONE_BASE_URL, timestamp: new Date().toISOString() });
}

async function handleGetRecords(env, appKey, url) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  const query = url.searchParams.get("query") || "";
  const fields = url.searchParams.get("fields") || undefined;
  const totalCount = url.searchParams.get("totalCount") || "true";
  const r = await kintone(env, appKey, "/k/v1/records.json", "GET", null, {
    app: apps[appKey].id, query, fields, totalCount,
  });
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}

async function handleGetRecord(env, appKey, id) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  const r = await kintone(env, appKey, "/k/v1/record.json", "GET", null, {
    app: apps[appKey].id, id,
  });
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}

async function handleCreateRecord(env, appKey, body) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  const token = appKey === "orders" ? getCombinedToken(apps) : null;
  const r = await kintone(env, appKey, "/k/v1/record.json", "POST", {
    app: apps[appKey].id, record: body.record,
  }, {}, token);
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}

async function handleUpdateRecord(env, appKey, body) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  const r = await kintone(env, appKey, "/k/v1/record.json", "PUT", {
    app: apps[appKey].id, id: body.id, record: body.record,
  });
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}

async function handleLogin(env, body) {
  const { code, password } = body;
  if (!code || !password) return errorResponse("Code and password required", 400);

  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id, query: `dealer_code = "${code}" limit 1`,
  });
  if (!r.ok) return errorResponse(r.data.message, r.status, r.data);
  if (r.data.records.length === 0) return errorResponse("Dealer not found", 401);

  const d = r.data.records[0];
  const pmStatus = d.Status?.value || d.dealer_status?.value || "";

  if (pmStatus !== "Active") {
    if (pmStatus === "Pending Review" || pmStatus === "Pending Approval")
      return errorResponse("Your account is pending approval. Please wait for activation.", 401);
    if (pmStatus === "Inactive")
      return errorResponse("Your account has been deactivated. Please contact Zagu back office.", 401);
    return errorResponse("Dealer not found or inactive", 401);
  }

  if (d.login_password.value !== password) return errorResponse("Invalid password", 401);

  const expiry = d.password_expiry?.value;
  if (expiry && new Date(expiry) < new Date())
    return errorResponse("Password expired. Please contact your administrator.", 401);

  const stores = (d.dealer_stores?.value || []).map((row) => ({
    code: row.value.ds_store_code?.value || "",
    name: row.value.ds_store_name?.value || "",
    address: row.value.ds_store_address?.value || "",
  }));

  return jsonResponse({
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
  const r = await kintone(env, "orders", "/k/v1/record/status.json", "PUT", payload);
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}

async function handleSubmitOrder(env, body) {
  const { record, isDraft } = body;
  const apps = getApps(env);

  const cr = await kintone(env, "orders", "/k/v1/record.json", "POST", {
    app: apps.orders.id, record,
  }, {}, getCombinedToken(apps));
  if (!cr.ok) return errorResponse(cr.data.message, cr.status, cr.data);

  const recordId = cr.data.id;

  if (!isDraft) {
    const s1 = await kintone(env, "orders", "/k/v1/record/status.json", "PUT", {
      app: apps.orders.id, id: recordId, action: "Submit Order",
    });
    if (!s1.ok) {
      return jsonResponse({ id: recordId, revision: cr.data.revision, status: "created_but_status_pending", statusError: s1.data.message });
    }

    const s2 = await kintone(env, "orders", "/k/v1/record/status.json", "PUT", {
      app: apps.orders.id, id: recordId, action: "Send for Approval", assignee: "Administrator",
    });
    if (!s2.ok) {
      return jsonResponse({ id: recordId, revision: cr.data.revision, status: "created_but_status_pending", statusError: s2.data.message });
    }
  }

  return jsonResponse({ id: recordId, revision: cr.data.revision, status: isDraft ? "draft" : "pending_approval" });
}

async function handleRegister(env, body) {
  const { email, dealerCode, password, dealerName, contactPerson, phone, region } = body;
  if (!email || !dealerCode || !password || !dealerName || !contactPerson)
    return errorResponse("Email, dealer code, password, dealer name, and contact person are required", 400);
  if (password.length < 6) return errorResponse("Password must be at least 6 characters", 400);

  const apps = getApps(env);
  const existing = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id, query: `dealer_code = "${dealerCode}" or email = "${email}" limit 1`,
  });
  if (!existing.ok) return errorResponse(existing.data.message, existing.status, existing.data);
  if (existing.data.records.length > 0) {
    const match = existing.data.records[0];
    if (match.dealer_code.value === dealerCode) return errorResponse("Dealer code already registered", 409);
    if (match.email.value === email) return errorResponse("Email already registered", 409);
  }

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 90);

  const cr = await kintone(env, "dealers", "/k/v1/record.json", "POST", {
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
  if (!cr.ok) return errorResponse(cr.data.message, cr.status, cr.data);

  const recordId = cr.data.id;

  // Advance PM: New → Pending Review (notifies Administrator)
  const pm = await kintone(env, "dealers", "/k/v1/record/status.json", "PUT", {
    app: apps.dealers.id, id: recordId, action: "Submit for Review", assignee: "Administrator",
  });

  return jsonResponse({
    success: true, id: recordId,
    message: "Registration submitted. Your account will be reviewed by Zagu back office.",
    ...(pm.ok ? {} : { pmWarning: pm.data.message }),
  });
}

async function handleChangePassword(env, body) {
  const { code, currentPassword, newPassword } = body;
  if (!code || !currentPassword || !newPassword) return errorResponse("All fields required", 400);
  if (newPassword.length < 6) return errorResponse("New password must be at least 6 characters", 400);

  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id, query: `dealer_code = "${code}" limit 1`,
  });
  if (!r.ok) return errorResponse(r.data.message, r.status, r.data);
  if (r.data.records.length === 0) return errorResponse("Dealer not found", 401);

  const d = r.data.records[0];
  const pmStatus = d.Status?.value || d.dealer_status?.value || "";
  if (pmStatus !== "Active") return errorResponse("Dealer not active", 401);
  if (d.login_password.value !== currentPassword) return errorResponse("Current password incorrect", 401);

  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + 90);
  const u = await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id, id: d.$id.value,
    record: {
      login_password: { value: newPassword },
      password_expiry: { value: newExpiry.toISOString().split("T")[0] },
    },
  });
  if (!u.ok) return errorResponse(u.data.message, u.status, u.data);

  return jsonResponse({ success: true, newExpiry: newExpiry.toISOString().split("T")[0] });
}

async function handleDealerStatus(env, body) {
  const { id, action, assignee } = body;
  const apps = getApps(env);
  const payload = { app: apps.dealers.id, id, action };
  if (assignee) payload.assignee = assignee;
  const r = await kintone(env, "dealers", "/k/v1/record/status.json", "PUT", payload);
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}

// ─── Router ─────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (path === "/api/health" && method === "GET") return handleHealth(env);
      if (path === "/api/auth/login" && method === "POST") return handleLogin(env, await request.json());
      if (path === "/api/auth/register" && method === "POST") return handleRegister(env, await request.json());
      if (path === "/api/auth/change-password" && method === "PUT") return handleChangePassword(env, await request.json());
      if (path === "/api/orders/status" && method === "POST") return handleOrderStatus(env, await request.json());
      if (path === "/api/orders/submit-order" && method === "POST") return handleSubmitOrder(env, await request.json());
      if (path === "/api/dealers/status" && method === "POST") return handleDealerStatus(env, await request.json());

      const recordsMatch = path.match(/^\/api\/(\w+)\/records$/);
      if (recordsMatch && method === "GET") return handleGetRecords(env, recordsMatch[1], url);

      const recordIdMatch = path.match(/^\/api\/(\w+)\/record\/(\d+)$/);
      if (recordIdMatch && method === "GET") return handleGetRecord(env, recordIdMatch[1], recordIdMatch[2]);

      const recordMatch = path.match(/^\/api\/(\w+)\/record$/);
      if (recordMatch && method === "POST") return handleCreateRecord(env, recordMatch[1], await request.json());
      if (recordMatch && method === "PUT") return handleUpdateRecord(env, recordMatch[1], await request.json());

      return errorResponse("Not found", 404);
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  },
};
