// Zagu Ordering Portal — Kintone API Proxy (Cloudflare Worker)
// v2: + Firebase Cloud Messaging push notifications

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

// ─── FCM Push Notifications ──────────────────────────────────

function base64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createJWT(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const unsigned = `${headerB64}.${payloadB64}`;

  const keyData = pemToArrayBuffer(serviceAccount.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64urlEncode(signature)}`;
}

async function getAccessToken(env) {
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
  const jwt = await createJWT(sa);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OAuth2 error: ${data.error_description || data.error}`);
  return data.access_token;
}

async function sendFcmNotification(env, token, title, body, data = {}) {
  const accessToken = await getAccessToken(env);
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush: {
            notification: {
              icon: "https://tomarai-369.github.io/zagu-ordering-portal/icon-192x192.png",
              badge: "https://tomarai-369.github.io/zagu-ordering-portal/icon-72x72.png",
              tag: data.orderId || "zagu-general",
              data,
            },
            fcm_options: {
              link: "https://tomarai-369.github.io/zagu-ordering-portal/",
            },
          },
        },
      }),
    }
  );

  const result = await res.json();
  return { ok: res.ok, result };
}

async function notifyDealer(env, dealerCode, title, body, data = {}) {
  if (!env.FCM_SERVICE_ACCOUNT) return { sent: 0, note: "FCM not configured" };

  const apps = getApps(env);
  
  // Fetch dealer's FCM tokens
  const url = new URL(`${env.KINTONE_BASE_URL}/k/v1/records.json`);
  url.searchParams.set("app", apps.dealers.id);
  url.searchParams.set("query", `dealer_code = "${dealerCode}" limit 1`);
  url.searchParams.set("fields[0]", "fcm_tokens");
  
  const res = await fetch(url.toString(), {
    headers: { "X-Cybozu-API-Token": apps.dealers.token },
  });
  const fetchData = await res.json();
  if (!res.ok || !fetchData.records || fetchData.records.length === 0) return { sent: 0, note: "Dealer not found" };

  const tokensRaw = fetchData.records[0].fcm_tokens?.value;
  if (!tokensRaw) return { sent: 0, note: "No FCM tokens registered" };

  let tokens;
  try { tokens = JSON.parse(tokensRaw); } catch { return { sent: 0, note: "Invalid token data" }; }
  if (!Array.isArray(tokens) || tokens.length === 0) return { sent: 0, note: "No tokens" };

  const results = [];
  const validTokens = [];
  for (const token of tokens) {
    try {
      const r = await sendFcmNotification(env, token, title, body, data);
      results.push(r);
      if (r.ok) validTokens.push(token);
    } catch (e) {
      results.push({ ok: false, error: e.message });
    }
  }

  // Clean up expired/invalid tokens
  if (validTokens.length < tokens.length) {
    await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
      app: apps.dealers.id,
      updateKey: { field: "dealer_code", value: dealerCode },
      record: { fcm_tokens: { value: JSON.stringify(validTokens) } },
    });
  }

  return { sent: validTokens.length, total: tokens.length, results };
}

async function handleRegisterFcmToken(env, body) {
  const { dealerCode, token } = body;
  if (!dealerCode || !token) return errorResponse("dealerCode and token required", 400);

  const apps = getApps(env);
  
  // Fetch dealer record directly
  const url = new URL(`${env.KINTONE_BASE_URL}/k/v1/records.json`);
  url.searchParams.set("app", apps.dealers.id);
  url.searchParams.set("query", `dealer_code = "${dealerCode}" limit 1`);
  url.searchParams.set("fields[0]", "$id");
  url.searchParams.set("fields[1]", "fcm_tokens");
  
  const res = await fetch(url.toString(), {
    headers: { "X-Cybozu-API-Token": apps.dealers.token },
  });
  const data = await res.json();
  if (!res.ok || !data.records || data.records.length === 0) return errorResponse("Dealer not found", 404);

  const record = data.records[0];
  const existing = record.fcm_tokens?.value;
  let tokens = [];
  try { tokens = existing ? JSON.parse(existing) : []; } catch { tokens = []; }

  if (tokens.includes(token)) return jsonResponse({ success: true, registered: true, tokenCount: tokens.length });
  tokens.push(token);
  if (tokens.length > 10) tokens = tokens.slice(-10);

  const u = await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: record.$id.value,
    record: { fcm_tokens: { value: JSON.stringify(tokens) } },
  });

  return u.ok
    ? jsonResponse({ success: true, registered: true, tokenCount: tokens.length })
    : errorResponse(u.data.message, u.status);
}

async function handleSendNotification(env, body) {
  const { dealerCode, title, message, data } = body;
  if (!dealerCode || !title) return errorResponse("dealerCode and title required", 400);
  const result = await notifyDealer(env, dealerCode, title, message || "", data || {});
  return jsonResponse(result);
}

// ─── Route handlers ─────────────────────────────────────────

async function handleHealth(env) {
  return jsonResponse({
    status: "ok",
    kintone: env.KINTONE_BASE_URL,
    fcm: !!env.FCM_SERVICE_ACCOUNT,
    timestamp: new Date().toISOString(),
  });
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
  const pmStatus = d.Status?.value || "";

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

  // Send push notification on status change (fire-and-forget)
  if (r.ok) {
    try {
      const orderRec = await kintone(env, "orders", "/k/v1/record.json", "GET", null, {
        app: apps.orders.id, id,
      });
      if (orderRec.ok) {
        const rec = orderRec.data.record;
        const dealerCode = rec.dealer_lookup?.value;
        const orderNum = rec.order_number?.value || `#${id}`;
        const statusMessages = {
          "Approve": { title: "✅ Order Approved!", body: `Your order ${orderNum} has been approved.` },
          "Reject": { title: "❌ Order Rejected", body: `Your order ${orderNum} was rejected. ${rec.rejection_reason?.value || "See details in app."}` },
          "Post to SAP": { title: "📋 Order Processing", body: `Your order ${orderNum} has been posted to SAP.` },
          "Begin Picking": { title: "📦 Order Being Prepared", body: `Your order ${orderNum} is being picked and packed.` },
          "Ready": { title: "🎉 Ready for Pickup!", body: `Your order ${orderNum} is ready for pickup!` },
          "Complete": { title: "🏆 Order Completed", body: `Your order ${orderNum} is complete. Thank you!` },
        };
        const msg = statusMessages[action];
        if (msg && dealerCode) {
          notifyDealer(env, dealerCode, msg.title, msg.body, { orderId: id, orderNumber: orderNum, action }).catch(() => {});
        }
      }
    } catch {}
  }

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
  const { dealerCode, dealerName, email, contactPerson, phone, password, region } = body;
  if (!dealerCode || !dealerName || !email || !contactPerson || !password) return errorResponse("All required fields must be provided", 400);
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
  if (d.Status?.value !== "Active") return errorResponse("Dealer not active", 401);
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

async function handleFileProxy(env, fileKey) {
  const url = `${env.KINTONE_BASE_URL}/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`;
  const res = await fetch(url, {
    headers: { "X-Cybozu-API-Token": env.KINTONE_PRODUCTS_TOKEN },
  });
  if (!res.ok) return errorResponse("File not found", 404);
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      ...CORS_HEADERS,
    },
  });
}

async function handleGetNews(env) {
  const today = new Date().toISOString().split("T")[0];
  const query = `is_active in ("Yes") and publish_date <= "${today}" order by is_pinned desc, priority asc, publish_date desc limit 20`;
  const url = new URL(`${env.KINTONE_BASE_URL}/k/v1/records.json`);
  url.searchParams.set("app", env.KINTONE_NEWS_APP_ID);
  url.searchParams.set("query", query);
  const res = await fetch(url.toString(), {
    headers: { "X-Cybozu-Authorization": env.KINTONE_AUTH },
  });
  const data = await res.json();
  if (!res.ok) return errorResponse(data.message || "Failed to fetch news", res.status);
  const records = (data.records || []).filter((r) => {
    const expiry = r.expiry_date?.value;
    return !expiry || expiry >= today;
  });
  return jsonResponse({ records });
}

async function handleDeleteRecord(env, appKey, ids) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  const r = await kintone(env, appKey, "/k/v1/records.json", "DELETE", {
    app: apps[appKey].id, ids: Array.isArray(ids) ? ids : [ids],
  });
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
      if (path === "/api/news" && method === "GET") return handleGetNews(env);

      // FCM endpoints
      if (path === "/api/fcm/register" && method === "POST") return handleRegisterFcmToken(env, await request.json());
      if (path === "/api/fcm/send" && method === "POST") return handleSendNotification(env, await request.json());

      if (path === "/api/file" && method === "GET") {
        const fileKey = url.searchParams.get("fileKey");
        if (!fileKey) return errorResponse("fileKey required", 400);
        return handleFileProxy(env, fileKey);
      }

      const recordsMatch = path.match(/^\/api\/(\w+)\/records$/);
      if (recordsMatch && method === "GET") return handleGetRecords(env, recordsMatch[1], url);
      if (recordsMatch && method === "DELETE") {
        const body = await request.json();
        return handleDeleteRecord(env, recordsMatch[1], body.ids);
      }

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
