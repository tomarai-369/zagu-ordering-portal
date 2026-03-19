// Zagu Ordering Portal — Cloudflare Worker API Proxy
// Version: 2.4
// Endpoints: /api/auth/*, /api/orders/*, /api/dealers/*, /api/news,
//            /api/fcm/*, /api/file, /api/holidays, /portal.js
// Backend: Kintone REST API (zagushakes.kintone.com)
// Features: Login, Registration, MFA (TOTP), Password Reset (Resend email),
//           Order management, FCM push notifications, Holiday calendar,
//           Kintone Portal customization JS

// worker_v3.js
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
function errorResponse(message, status = 500, details) {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
function getApps(env) {
  return {
    products: { id: env.KINTONE_PRODUCTS_APP_ID, token: env.KINTONE_PRODUCTS_TOKEN },
    dealers: { id: env.KINTONE_DEALERS_APP_ID, token: env.KINTONE_DEALERS_TOKEN },
    orders: { id: env.KINTONE_ORDERS_APP_ID, token: env.KINTONE_ORDERS_TOKEN }
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
      if (v !== void 0 && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }
  const headers = { "X-Cybozu-API-Token": overrideToken || appConfig.token };
  if (method !== "GET") headers["Content-Type"] = "application/json";
  const res = await fetch(url.toString(), {
    method,
    headers,
    ...body && method !== "GET" ? { body: JSON.stringify(body) } : {}
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}
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
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function createJWT(serviceAccount) {
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const unsigned = `${headerB64}.${payloadB64}`;
  const keyData = pemToArrayBuffer(serviceAccount.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
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
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
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
        "Content-Type": "application/json"
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
              data
            },
            fcm_options: {
              link: "https://tomarai-369.github.io/zagu-ordering-portal/"
            }
          }
        }
      })
    }
  );
  const result = await res.json();
  return { ok: res.ok, result };
}
async function notifyDealer(env, dealerCode, title, body, data = {}) {
  if (!env.FCM_SERVICE_ACCOUNT) return { sent: 0, note: "FCM not configured" };
  const apps = getApps(env);
  const url = new URL(`${env.KINTONE_BASE_URL}/k/v1/records.json`);
  url.searchParams.set("app", apps.dealers.id);
  url.searchParams.set("query", `dealer_code = "${dealerCode}" limit 1`);
  url.searchParams.set("fields[0]", "fcm_tokens");
  const res = await fetch(url.toString(), {
    headers: { "X-Cybozu-API-Token": apps.dealers.token }
  });
  const fetchData = await res.json();
  if (!res.ok || !fetchData.records || fetchData.records.length === 0) return { sent: 0, note: "Dealer not found" };
  const tokensRaw = fetchData.records[0].fcm_tokens?.value;
  if (!tokensRaw) return { sent: 0, note: "No FCM tokens registered" };
  let tokens;
  try {
    tokens = JSON.parse(tokensRaw);
  } catch {
    return { sent: 0, note: "Invalid token data" };
  }
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
  if (validTokens.length < tokens.length) {
    await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
      app: apps.dealers.id,
      updateKey: { field: "dealer_code", value: dealerCode },
      record: { fcm_tokens: { value: JSON.stringify(validTokens) } }
    });
  }
  return { sent: validTokens.length, total: tokens.length, results };
}
async function handleRegisterFcmToken(env, body) {
  const { dealerCode, token } = body;
  if (!dealerCode || !token) return errorResponse("dealerCode and token required", 400);
  const apps = getApps(env);
  const url = new URL(`${env.KINTONE_BASE_URL}/k/v1/records.json`);
  url.searchParams.set("app", apps.dealers.id);
  url.searchParams.set("query", `dealer_code = "${dealerCode}" limit 1`);
  url.searchParams.set("fields[0]", "$id");
  url.searchParams.set("fields[1]", "fcm_tokens");
  const res = await fetch(url.toString(), {
    headers: { "X-Cybozu-API-Token": apps.dealers.token }
  });
  const data = await res.json();
  if (!res.ok || !data.records || data.records.length === 0) return errorResponse("Dealer not found", 404);
  const record = data.records[0];
  const existing = record.fcm_tokens?.value;
  let tokens = [];
  try {
    tokens = existing ? JSON.parse(existing) : [];
  } catch {
    tokens = [];
  }
  if (tokens.includes(token)) return jsonResponse({ success: true, registered: true, tokenCount: tokens.length });
  tokens.push(token);
  if (tokens.length > 10) tokens = tokens.slice(-10);
  const u = await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: record.$id.value,
    record: { fcm_tokens: { value: JSON.stringify(tokens) } }
  });
  return u.ok ? jsonResponse({ success: true, registered: true, tokenCount: tokens.length }) : errorResponse(u.data.message, u.status);
}
async function handleSendNotification(env, body) {
  const { dealerCode, title, message, data } = body;
  if (!dealerCode || !title) return errorResponse("dealerCode and title required", 400);
  const result = await notifyDealer(env, dealerCode, title, message || "", data || {});
  return jsonResponse(result);
}
async function handleHealth(env) {
  return jsonResponse({
    status: "ok",
    kintone: env.KINTONE_BASE_URL,
    fcm: !!env.FCM_SERVICE_ACCOUNT,
    timestamp: (new Date()).toISOString()
  });
}
async function handleGetRecords(env, appKey, url) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  if (appKey === "dealers") return errorResponse("Direct dealer data access is not permitted. Use /api/auth/login.", 403);
  const query = url.searchParams.get("query") || "";
  const fields = url.searchParams.get("fields") || void 0;
  const totalCount = url.searchParams.get("totalCount") || "true";
  const r = await kintone(env, appKey, "/k/v1/records.json", "GET", null, {
    app: apps[appKey].id,
    query,
    fields,
    totalCount
  });
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}
async function handleGetRecord(env, appKey, id) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  if (appKey === "dealers") return errorResponse("Direct dealer data access is not permitted.", 403);
  const r = await kintone(env, appKey, "/k/v1/record.json", "GET", null, {
    app: apps[appKey].id,
    id
  });
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}
async function handleCreateRecord(env, appKey, body) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  if (appKey === "dealers") return errorResponse("Use /api/auth/register to create dealer accounts.", 403);
  const token = appKey === "orders" ? getCombinedToken(apps) : null;
  const r = await kintone(env, appKey, "/k/v1/record.json", "POST", {
    app: apps[appKey].id,
    record: body.record
  }, {}, token);
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}
async function handleUpdateRecord(env, appKey, body) {
  const apps = getApps(env);
  if (!apps[appKey]) return errorResponse(`Unknown app: ${appKey}`, 400);
  if (appKey === "dealers") return errorResponse("Use /api/auth endpoints to modify dealer accounts.", 403);
  const r = await kintone(env, appKey, "/k/v1/record.json", "PUT", {
    app: apps[appKey].id,
    id: body.id,
    record: body.record
  });
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}
async function handleLogin(env, body) {
  const { code, password } = body;
  if (!code || !password) return errorResponse("Code and password required", 400);
  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query: `dealer_code = "${code}" limit 1`
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
  const mfaEnabled = d.mfa_enabled?.value === "Yes";
  const mfaSecret = d.mfa_secret?.value;
  if (mfaEnabled && mfaSecret) {
    return jsonResponse({ mfaRequired: true, dealerCode: d.dealer_code.value });
  }
  const expiry = d.password_expiry?.value;
  if (expiry && new Date(expiry) < new Date())
    return errorResponse("Password expired. Please contact your administrator.", 401);
  const stores = (d.dealer_stores?.value || []).map((row) => ({
    code: row.value.ds_store_code?.value || "",
    name: row.value.ds_store_name?.value || "",
    address: row.value.ds_store_address?.value || ""
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
      stores
    }
  });
}
async function handleOrderStatus(env, body) {
  const { id, action, assignee } = body;
  const apps = getApps(env);
  const payload = { app: apps.orders.id, id, action };
  if (assignee) payload.assignee = assignee;
  const r = await kintone(env, "orders", "/k/v1/record/status.json", "PUT", payload);
  if (r.ok) {
    try {
      const orderRec = await kintone(env, "orders", "/k/v1/record.json", "GET", null, {
        app: apps.orders.id,
        id
      });
      if (orderRec.ok) {
        const rec = orderRec.data.record;
        const dealerCode = rec.dealer_lookup?.value;
        const orderNum = rec.order_number?.value || `#${id}`;
        const statusMessages = {
          "Approve": { title: "\u2705 Order Approved!", body: `Your order ${orderNum} has been approved.` },
          "Reject": { title: "\u274C Order Rejected", body: `Your order ${orderNum} was rejected. ${rec.rejection_reason?.value || "See details in app."}` },
          "Post to SAP": { title: "\u{1F4CB} Order Processing", body: `Your order ${orderNum} has been posted to SAP.` },
          "Start Picking": { title: "\u{1F4E6} Order Being Prepared", body: `Your order ${orderNum} is being picked and packed.` },
          "Mark Ready": { title: "\u{1F389} Ready for Pickup!", body: `Your order ${orderNum} is ready for pickup!` },
          "Complete": { title: "\u{1F3C6} Order Completed", body: `Your order ${orderNum} is complete. Thank you!` }
        };
        const msg = statusMessages[action];
        if (msg && dealerCode) {
          notifyDealer(env, dealerCode, msg.title, msg.body, { orderId: id, orderNumber: orderNum, action }).catch(() => {
          });
          try {
            const dlrRec = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
              app: apps.dealers.id,
              query: `dealer_code = "${dealerCode}" limit 1`,
              "fields[0]": "email",
              "fields[1]": "dealer_name"
            });
            if (dlrRec.ok && dlrRec.data.records.length > 0) {
              const dlr = dlrRec.data.records[0];
              const dlrEmail = dlr.email?.value;
              const dlrName = dlr.dealer_name?.value || "Dealer";
              if (dlrEmail) {
                const details = action === "Reject" ? rec.rejection_reason?.value || "" : "";
                const emailBody = orderStatusEmailBody(dlrName, orderNum, action === "Approve" ? "Approved" : action === "Reject" ? "Rejected" : action === "Post to SAP" ? "Posted to SAP" : action === "Start Picking" ? "Picking" : action === "Mark Ready" ? "Ready for Pickup" : "Completed", details);
                const portalUrl = env.PORTAL_BASE_URL || "https://tomarai-369.github.io/zagu-ordering-portal";
                const html = zaguEmailTemplate(msg.title, emailBody, portalUrl, "View Order");
                sendEmail(env, dlrEmail, `${msg.title} \u2014 ${orderNum}`, html).catch(() => {
                });
              }
            }
          } catch {
          }
        }
      }
    } catch {
    }
  }
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}
async function handleSubmitOrder(env, body) {
  const { record, isDraft } = body;
  if (!record) return errorResponse("Order record is required", 400);
  const items = record.order_items?.value;
  if (!isDraft && (!items || items.length === 0)) {
    return errorResponse("Order must contain at least one item", 400);
  }
  const apps = getApps(env);
  const cr = await kintone(env, "orders", "/k/v1/record.json", "POST", {
    app: apps.orders.id,
    record
  }, {}, getCombinedToken(apps));
  if (!cr.ok) return errorResponse(cr.data.message, cr.status, cr.data);
  const recordId = cr.data.id;
  if (!isDraft) {
    const s1 = await kintone(env, "orders", "/k/v1/record/status.json", "PUT", {
      app: apps.orders.id,
      id: recordId,
      action: "Submit Order"
    });
    if (!s1.ok) {
      return jsonResponse({ id: recordId, revision: cr.data.revision, status: "created_but_status_pending", statusError: s1.data.message });
    }
    const s2 = await kintone(env, "orders", "/k/v1/record/status.json", "PUT", {
      app: apps.orders.id,
      id: recordId,
      action: "Send for Approval",
      assignee: "Administrator"
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
    app: apps.dealers.id,
    query: `dealer_code = "${dealerCode}" or email = "${email}" limit 1`
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
      mfa_enabled: { value: "No" }
    }
  });
  if (!cr.ok) return errorResponse(cr.data.message, cr.status, cr.data);
  const recordId = cr.data.id;
  const pm = await kintone(env, "dealers", "/k/v1/record/status.json", "PUT", {
    app: apps.dealers.id,
    id: recordId,
    action: "Submit for Review",
    assignee: "Administrator"
  });
  return jsonResponse({
    success: true,
    id: recordId,
    message: "Registration submitted. Your account will be reviewed by Zagu back office.",
    ...pm.ok ? {} : { pmWarning: pm.data.message }
  });
}
var BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function generateSecret(len = 20) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let secret = "";
  for (const b of bytes) secret += BASE32_CHARS[b % 32];
  return secret;
}
function base32Decode(encoded) {
  let bits = "";
  for (const c of encoded.toUpperCase()) {
    const val = BASE32_CHARS.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes.buffer;
}
async function generateTOTP(secret, time = null) {
  const counter = Math.floor((time || Date.now() / 1e3) / 30);
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(4, counter, false);
  const keyData = base32Decode(secret);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, counterBuf);
  const hmac = new Uint8Array(sig);
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac[offset] & 127) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1e6;
  return code.toString().padStart(6, "0");
}
async function verifyTOTP(secret, token) {
  const now = Math.floor(Date.now() / 1e3);
  for (const offset of [-30, 0, 30]) {
    const expected = await generateTOTP(secret, now + offset);
    if (expected === token) return true;
  }
  return false;
}
async function handleMfaSetup(env, body) {
  const { code, password } = body;
  if (!code || !password) return errorResponse("Code and password required", 400);
  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query: `dealer_code = "${code}" limit 1`
  });
  if (!r.ok || r.data.records.length === 0) return errorResponse("Dealer not found", 404);
  const d = r.data.records[0];
  if (d.login_password.value !== password) return errorResponse("Invalid password", 401);
  const secret = generateSecret(20);
  const issuer = "Zagu%20Dealer%20Portal";
  const otpauthUrl = `otpauth://totp/${issuer}:${encodeURIComponent(code)}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;
  await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: d.$id.value,
    record: { mfa_secret: { value: secret } }
  });
  return jsonResponse({ secret, otpauthUrl, qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}` });
}
async function handleMfaVerifySetup(env, body) {
  const { code, token } = body;
  if (!code || !token) return errorResponse("Code and OTP token required", 400);
  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query: `dealer_code = "${code}" limit 1`
  });
  if (!r.ok || r.data.records.length === 0) return errorResponse("Dealer not found", 404);
  const d = r.data.records[0];
  const secret = d.mfa_secret?.value;
  if (!secret) return errorResponse("MFA not set up. Please set up MFA first.", 400);
  const valid = await verifyTOTP(secret, token);
  if (!valid) return errorResponse("Invalid OTP code. Please try again.", 401);
  await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: d.$id.value,
    record: { mfa_enabled: { value: "Yes" } }
  });
  return jsonResponse({ success: true, message: "MFA enabled successfully" });
}
async function handleMfaDisable(env, body) {
  const { code, password } = body;
  if (!code || !password) return errorResponse("Code and password required", 400);
  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query: `dealer_code = "${code}" limit 1`
  });
  if (!r.ok || r.data.records.length === 0) return errorResponse("Dealer not found", 404);
  const d = r.data.records[0];
  if (d.login_password.value !== password) return errorResponse("Invalid password", 401);
  await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: d.$id.value,
    record: { mfa_enabled: { value: "No" }, mfa_secret: { value: "" } }
  });
  return jsonResponse({ success: true, message: "MFA disabled" });
}
async function handleMfaVerifyLogin(env, body) {
  const { code, token } = body;
  if (!code || !token) return errorResponse("Code and OTP required", 400);
  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query: `dealer_code = "${code}" limit 1`
  });
  if (!r.ok || r.data.records.length === 0) return errorResponse("Dealer not found", 404);
  const d = r.data.records[0];
  const secret = d.mfa_secret?.value;
  if (!secret) return errorResponse("MFA not configured", 400);
  const valid = await verifyTOTP(secret, token);
  if (!valid) return errorResponse("Invalid OTP code", 401);
  const stores = (d.dealer_stores?.value || []).map((row) => ({
    code: row.value.ds_store_code?.value || "",
    name: row.value.ds_store_name?.value || "",
    address: row.value.ds_store_address?.value || ""
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
      mfaEnabled: "Yes",
      passwordExpiry: d.password_expiry?.value || "",
      stores
    }
  });
}
function zaguEmailTemplate(title, bodyContent, ctaUrl, ctaText) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

<!-- Header with Zagu branding -->
<tr><td style="background:linear-gradient(135deg,#D4A017 0%,#B8860B 100%);padding:28px 32px;text-align:center;">
<img src="https://zagushakes.com/wp-content/uploads/2024/08/zagu-logo-2-black-1024x276.png" alt="Zagu" width="140" style="max-width:140px;height:auto;margin-bottom:8px;" />
<h1 style="color:#ffffff;font-size:20px;margin:8px 0 0;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.15);">${title}</h1>
</td></tr>

<!-- Body content -->
<tr><td style="padding:32px;">
${bodyContent}
${ctaUrl ? `
<table cellpadding="0" cellspacing="0" style="margin:24px auto;">
<tr><td style="background:#D4A017;border-radius:8px;text-align:center;">
<a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">${ctaText || "Open Portal"}</a>
</td></tr></table>` : ""}
</td></tr>

<!-- Footer -->
<tr><td style="background:#FFF8E7;padding:20px 32px;border-top:1px solid #f0e6d0;">
<p style="color:#8B7355;font-size:11px;margin:0;text-align:center;line-height:1.6;">
This is an automated notification from the Zagu Online Ordering System.<br/>
\xA9 2026 Zagu Foods Corporation / Spencer Foods Corp.<br/>
52 West Capitol Drive, Bo. Kapitolyo, Pasig City, Philippines
</p>
</td></tr>

</table>
</td></tr></table></body></html>`;
}
function orderStatusEmailBody(dealerName, orderNumber, status, details) {
  const statusColors = {
    "Approved": { bg: "#E8F5E9", fg: "#2E7D32", icon: "\u2705" },
    "Rejected": { bg: "#FFEBEE", fg: "#C62828", icon: "\u274C" },
    "Posted to SAP": { bg: "#E3F2FD", fg: "#1565C0", icon: "\u{1F4CB}" },
    "Picking": { bg: "#FFF3E0", fg: "#E65100", icon: "\u{1F4E6}" },
    "Ready for Pickup": { bg: "#E8F5E9", fg: "#2E7D32", icon: "\u{1F389}" },
    "Completed": { bg: "#F3E5F5", fg: "#6A1B9A", icon: "\u{1F3C6}" }
  };
  const s = statusColors[status] || { bg: "#F5F5F5", fg: "#333", icon: "\u{1F4CC}" };
  return `
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${dealerName}</strong>,</p>
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">Your order <strong>${orderNumber}</strong> has been updated:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;">
<tr><td style="padding:12px 16px;background:#f9f6f0;border:1px solid #e8e0d0;font-weight:bold;color:#5C4A1E;width:140px;">Order</td>
<td style="padding:12px 16px;border:1px solid #e8e0d0;">${orderNumber}</td></tr>
<tr><td style="padding:12px 16px;background:#f9f6f0;border:1px solid #e8e0d0;font-weight:bold;color:#5C4A1E;">Status</td>
<td style="padding:12px 16px;border:1px solid #e8e0d0;"><span style="background:${s.bg};color:${s.fg};padding:4px 14px;border-radius:12px;font-weight:bold;font-size:13px;">${s.icon} ${status}</span></td></tr>
${details ? `<tr><td style="padding:12px 16px;background:#f9f6f0;border:1px solid #e8e0d0;font-weight:bold;color:#5C4A1E;">Details</td>
<td style="padding:12px 16px;border:1px solid #e8e0d0;">${details}</td></tr>` : ""}
</table>`;
}
async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not configured" };
  const fromDomain = env.EMAIL_FROM_DOMAIN || "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `Zagu Orders <${fromDomain}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    })
  });
  const data = await res.json();
  return { ok: res.ok, data };
}
async function handleForgotPassword(env, body) {
  const { dealerCode, email } = body;
  if (!dealerCode && !email) return errorResponse("Dealer code or email required", 400);
  const apps = getApps(env);
  const query = dealerCode ? `dealer_code = "${dealerCode}" limit 1` : `email = "${email}" limit 1`;
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query
  });
  if (!r.ok) return errorResponse(r.data.message, r.status, r.data);
  if (r.data.records.length === 0) {
    return jsonResponse({ success: true, message: "If an account exists with that information, a reset email has been sent." });
  }
  const d = r.data.records[0];
  const dealerEmail = d.email?.value;
  const dealerName = d.dealer_name?.value || "Dealer";
  const code = d.dealer_code?.value;
  if (!dealerEmail) {
    return jsonResponse({ success: true, message: "If an account exists with that information, a reset email has been sent." });
  }
  const tokenBytes = new Uint8Array(24);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const expiry = new Date(Date.now() + 30 * 60 * 1e3);
  const u = await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: d.$id.value,
    record: {
      reset_token: { value: token },
      reset_token_expiry: { value: expiry.toISOString() }
    }
  });
  if (!u.ok) return errorResponse("Failed to generate reset token", 500);
  const portalBase = env.PORTAL_BASE_URL || "https://tomarai-369.github.io/zagu-ordering-portal";
  const resetUrl = `${portalBase}/?reset=${token}&code=${encodeURIComponent(code)}`;
  const emailBody = `
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${dealerName}</strong>,</p>
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 8px;">We received a request to reset your password for the Zagu Ordering Portal.</p>
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 8px;">Click the button below to set a new password. This link will expire in <strong>30 minutes</strong>.</p>`;
  const html = zaguEmailTemplate(
    "Password Reset Request",
    emailBody,
    resetUrl,
    "Reset My Password"
  );
  const emailResult = await sendEmail(env, dealerEmail, "\u{1F510} Zagu Portal \u2014 Password Reset", html);
  if (!emailResult.ok) {
    console.error("Email send failed:", JSON.stringify(emailResult.data));
  }
  return jsonResponse({
    success: true,
    message: "If an account exists with that information, a reset email has been sent."
  });
}
async function handleResetPassword(env, body) {
  const { token, dealerCode, newPassword } = body;
  if (!token || !dealerCode || !newPassword) return errorResponse("Token, dealer code, and new password required", 400);
  if (newPassword.length < 6) return errorResponse("Password must be at least 6 characters", 400);
  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query: `dealer_code = "${dealerCode}" and reset_token = "${token}" limit 1`
  });
  if (!r.ok) return errorResponse(r.data.message, r.status, r.data);
  if (r.data.records.length === 0) return errorResponse("Invalid or expired reset link", 400);
  const d = r.data.records[0];
  const expiry = d.reset_token_expiry?.value;
  if (!expiry || new Date(expiry) < new Date()) {
    await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
      app: apps.dealers.id,
      id: d.$id.value,
      record: { reset_token: { value: "" }, reset_token_expiry: { value: "" } }
    });
    return errorResponse("Reset link has expired. Please request a new one.", 400);
  }
  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + 90);
  const u = await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: d.$id.value,
    record: {
      login_password: { value: newPassword },
      password_expiry: { value: newExpiry.toISOString().split("T")[0] },
      password_changed_at: { value: (new Date()).toISOString() },
      reset_token: { value: "" },
      reset_token_expiry: { value: "" }
    }
  });
  if (!u.ok) return errorResponse(u.data.message, u.status, u.data);
  const dealerEmail = d.email?.value;
  const dealerName = d.dealer_name?.value || "Dealer";
  if (dealerEmail) {
    const confirmBody = `
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 16px;">Hi <strong>${dealerName}</strong>,</p>
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 8px;">Your password has been successfully reset.</p>
<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 8px;">You can now log in with your new password. If you did not make this change, please contact Zagu support immediately.</p>`;
    const html = zaguEmailTemplate(
      "Password Changed Successfully",
      confirmBody,
      env.PORTAL_BASE_URL || "https://tomarai-369.github.io/zagu-ordering-portal",
      "Log In Now"
    );
    sendEmail(env, dealerEmail, "\u2705 Zagu Portal \u2014 Password Changed", html).catch(() => {
    });
  }
  return jsonResponse({ success: true, message: "Password reset successfully. You can now log in." });
}
async function handleChangePassword(env, body) {
  const { code, currentPassword, newPassword } = body;
  if (!code || !currentPassword || !newPassword) return errorResponse("All fields required", 400);
  if (newPassword.length < 6) return errorResponse("New password must be at least 6 characters", 400);
  const apps = getApps(env);
  const r = await kintone(env, "dealers", "/k/v1/records.json", "GET", null, {
    app: apps.dealers.id,
    query: `dealer_code = "${code}" limit 1`
  });
  if (!r.ok) return errorResponse(r.data.message, r.status, r.data);
  if (r.data.records.length === 0) return errorResponse("Dealer not found", 401);
  const d = r.data.records[0];
  if (d.Status?.value !== "Active") return errorResponse("Dealer not active", 401);
  if (d.login_password.value !== currentPassword) return errorResponse("Current password incorrect", 401);
  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + 90);
  const u = await kintone(env, "dealers", "/k/v1/record.json", "PUT", {
    app: apps.dealers.id,
    id: d.$id.value,
    record: {
      login_password: { value: newPassword },
      password_expiry: { value: newExpiry.toISOString().split("T")[0] },
      password_changed_at: { value: (new Date()).toISOString() }
    }
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
    headers: { "X-Cybozu-API-Token": env.KINTONE_PRODUCTS_TOKEN }
  });
  if (!res.ok) return errorResponse("File not found", 404);
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      ...CORS_HEADERS
    }
  });
}
async function handleGetNews(env) {
  const today = (new Date()).toISOString().split("T")[0];
  const query = `is_active in ("Yes") and publish_date <= "${today}" order by is_pinned desc, priority asc, publish_date desc limit 20`;
  const url = new URL(`${env.KINTONE_BASE_URL}/k/v1/records.json`);
  url.searchParams.set("app", env.KINTONE_NEWS_APP_ID);
  url.searchParams.set("query", query);
  const res = await fetch(url.toString(), {
    headers: { "X-Cybozu-Authorization": env.KINTONE_AUTH }
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
  if (appKey === "dealers") return errorResponse("Dealer records cannot be deleted via API.", 403);
  const r = await kintone(env, appKey, "/k/v1/records.json", "DELETE", {
    app: apps[appKey].id,
    ids: Array.isArray(ids) ? ids : [ids]
  });
  return r.ok ? jsonResponse(r.data) : errorResponse(r.data.message, r.status, r.data);
}
async function handleGetHolidays(env, url) {
  const year = url.searchParams.get("year") || (new Date()).getFullYear().toString();
  const query = `year = "${year}" and is_active in ("Yes") order by holiday_date asc`;
  const apiUrl = `${env.KINTONE_BASE_URL}/k/v1/records.json?app=5&query=${encodeURIComponent(query)}&fields[0]=holiday_date&fields[1]=holiday_name&fields[2]=holiday_type`;
  const res = await fetch(apiUrl, { headers: { "X-Cybozu-Authorization": env.KINTONE_AUTH } });
  const data = await res.json();
  if (!res.ok) return errorResponse("Failed to fetch holidays", res.status, data);
  const holidays = (data.records || []).map((r) => ({
    date: r.holiday_date.value,
    name: r.holiday_name.value,
    type: r.holiday_type.value
  }));
  return jsonResponse({ year, holidays, count: holidays.length });
}
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
      if (path === "/api/auth/forgot-password" && method === "POST") return handleForgotPassword(env, await request.json());
      if (path === "/api/auth/reset-password" && method === "POST") return handleResetPassword(env, await request.json());
      if (path === "/api/auth/mfa/setup" && method === "POST") return handleMfaSetup(env, await request.json());
      if (path === "/api/auth/mfa/verify-setup" && method === "POST") return handleMfaVerifySetup(env, await request.json());
      if (path === "/api/auth/mfa/verify-login" && method === "POST") return handleMfaVerifyLogin(env, await request.json());
      if (path === "/api/auth/mfa/disable" && method === "POST") return handleMfaDisable(env, await request.json());
      if (path === "/api/orders/status" && method === "POST") return handleOrderStatus(env, await request.json());
      if (path === "/api/orders/submit-order" && method === "POST") return handleSubmitOrder(env, await request.json());
      if (path === "/api/dealers/status" && method === "POST") return handleDealerStatus(env, await request.json());
      if (path === "/api/news" && method === "GET") return handleGetNews(env);
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
      if (path === "/api/holidays") return handleGetHolidays(env, url);
      if (path === "/portal.js") {
        const decoded = atob("KGZ1bmN0aW9uICgpIHsKICAidXNlIHN0cmljdCI7CgogIC8vIOKUgOKUgCBDb25maWcg4pSA4pSACiAgdmFyIERPTUFJTiA9IGxvY2F0aW9uLm9yaWdpbjsKICB2YXIgQVBQUyA9IHsKICAgIHByb2R1Y3RzOiB7IGlkOiAxLCBsYWJlbDogIlByb2R1Y3RzIE1hc3RlciIsIGljb246ICLwn5OmIiwgY29sb3I6ICIjRTg3NDBDIiwgZGVzYzogIkNhdGFsb2csIHByaWNpbmcgJiBzdG9jayIgfSwKICAgIGRlYWxlcnM6IHsgaWQ6IDIsIGxhYmVsOiAiRGVhbGVycyBNYXN0ZXIiLCBpY29uOiAi8J+PqiIsIGNvbG9yOiAiIzFhN2ZhOCIsIGRlc2M6ICJBY2NvdW50cywgcmVnaW9ucyAmIGNyZWRpdCIgfSwKICAgIG9yZGVyczogeyBpZDogMywgbGFiZWw6ICJPcmRlcnMiLCBpY29uOiAi8J+bkiIsIGNvbG9yOiAiIzhiNWNmNiIsIGRlc2M6ICJQcm9jZXNzaW5nICYgZnVsZmlsbG1lbnQiIH0sCiAgICBuZXdzOiB7IGlkOiA0LCBsYWJlbDogIkFubm91bmNlbWVudHMiLCBpY29uOiAi8J+ToyIsIGNvbG9yOiAiI2Q5NzcwNiIsIGRlc2M6ICJOZXdzLCBwcm9tb3MgJiB1cGRhdGVzIiB9LAogICAgaG9saWRheXM6IHsgaWQ6IDUsIGxhYmVsOiAiSG9saWRheSBDYWxlbmRhciIsIGljb246ICLwn5OFIiwgY29sb3I6ICIjMDU5NjY5IiwgZGVzYzogIlBIIGhvbGlkYXlzICYgYnVzaW5lc3MgZGF5cyIgfQogIH07CgogIHZhciBXT1JLRkxPV19NQUlOID0gWwogICAgeyBpZDogIm5ldyIsIGxhYmVsOiAiTmV3Iiwgc3RhdHVzOiAiTmV3IiwgY29sb3I6ICIjOTRhM2I4IiB9LAogICAgeyBpZDogInN1Ym1pdHRlZCIsIGxhYmVsOiAiU3VibWl0dGVkIiwgc3RhdHVzOiAiU3VibWl0dGVkIiwgY29sb3I6ICIjM2I4MmY2IiB9LAogICAgeyBpZDogInBlbmRpbmciLCBsYWJlbDogIlBlbmRpbmciLCBzdGF0dXM6ICJQZW5kaW5nIE9OQiBBcHByb3ZhbCIsIGNvbG9yOiAiI2Y1OWUwYiIsIHN1YjogIk9OQiBBcHByb3ZhbCIgfSwKICAgIHsgaWQ6ICJhcHByb3ZlZCIsIGxhYmVsOiAiQXBwcm92ZWQiLCBzdGF0dXM6ICJBcHByb3ZlZCIsIGNvbG9yOiAiIzEwYjk4MSIgfSwKICAgIHsgaWQ6ICJzYXAiLCBsYWJlbDogIlBvc3RlZCIsIHN0YXR1czogIlBvc3RlZCB0byBTQVAiLCBjb2xvcjogIiM4YjVjZjYiLCBzdWI6ICJ0byBTQVAiIH0sCiAgICB7IGlkOiAicGlja2luZyIsIGxhYmVsOiAiUGlja2luZyIsIHN0YXR1czogIlBpY2tpbmciLCBjb2xvcjogIiNmOTczMTYiIH0sCiAgICB7IGlkOiAicmVhZHkiLCBsYWJlbDogIlJlYWR5Iiwgc3RhdHVzOiAiUmVhZHkgZm9yIFBpY2t1cCIsIGNvbG9yOiAiIzA2YjZkNCIsIHN1YjogImZvciBQaWNrdXAiIH0sCiAgICB7IGlkOiAiY29tcGxldGVkIiwgbGFiZWw6ICJDb21wbGV0ZWQiLCBzdGF0dXM6ICJDb21wbGV0ZWQiLCBjb2xvcjogIiMwNTk2NjkiIH0KICBdOwogIHZhciBXT1JLRkxPV19SRUpFQ1RFRCA9IHsgaWQ6ICJyZWplY3RlZCIsIGxhYmVsOiAiUmVqZWN0ZWQiLCBzdGF0dXM6ICJSZWplY3RlZCIsIGNvbG9yOiAiI2VmNDQ0NCIgfTsKICB2YXIgQUxMX1dPUktGTE9XID0gV09SS0ZMT1dfTUFJTi5jb25jYXQoW1dPUktGTE9XX1JFSkVDVEVEXSk7CgogIC8vIOKUgOKUgCBDU1Mg4pSA4pSACiAgdmFyIENTUyA9IGAKICAgIEBpbXBvcnQgdXJsKCdodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tL2NzczI/ZmFtaWx5PURNK1NhbnM6aXRhbCxvcHN6LHdnaHRAMCw5Li40MCwzMDA7MCw5Li40MCw0MDA7MCw5Li40MCw1MDA7MCw5Li40MCw2MDA7MCw5Li40MCw3MDAmZGlzcGxheT1zd2FwJyk7CgogICAgI3phZ3UtcG9ydGFsICosICN6YWd1LXBvcnRhbCAqOjpiZWZvcmUsICN6YWd1LXBvcnRhbCAqOjphZnRlciB7IGJveC1zaXppbmc6IGJvcmRlci1ib3g7IG1hcmdpbjogMDsgcGFkZGluZzogMDsgfQogICAgI3phZ3UtcG9ydGFsIHsKICAgICAgLS16cC1vcmFuZ2U6ICNFODc0MEM7CiAgICAgIC0tenAtc3VyZmFjZTogI2ZmZmZmZjsKICAgICAgLS16cC1ib3JkZXI6ICNlOGU1ZTA7CiAgICAgIC0tenAtdGV4dDogIzFjMTkxNzsKICAgICAgLS16cC10ZXh0LXNlY29uZGFyeTogIzc4NzE2YzsKICAgICAgLS16cC10ZXh0LW11dGVkOiAjYThhMjllOwogICAgICAtLXpwLXJhZGl1czogMTJweDsKICAgICAgLS16cC1zaGFkb3ctc206IDAgMXB4IDJweCByZ2JhKDI4LDI1LDIzLDAuMDQpLCAwIDFweCAzcHggcmdiYSgyOCwyNSwyMywwLjA2KTsKICAgICAgLS16cC1zaGFkb3ctbWQ6IDAgMnB4IDRweCByZ2JhKDI4LDI1LDIzLDAuMDQpLCAwIDRweCAxMnB4IHJnYmEoMjgsMjUsMjMsMC4wOCk7CiAgICAgIGZvbnQtZmFtaWx5OiAnRE0gU2FucycsIC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgc2Fucy1zZXJpZjsKICAgICAgbWF4LXdpZHRoOiAxMDgwcHg7IG1hcmdpbjogMCBhdXRvOyBwYWRkaW5nOiAyMHB4IDIwcHggNDBweDsKICAgICAgY29sb3I6IHZhcigtLXpwLXRleHQpOyAtd2Via2l0LWZvbnQtc21vb3RoaW5nOiBhbnRpYWxpYXNlZDsKICAgIH0KCiAgICAvKiBIZWFkZXIgKi8KICAgIC56cC1oZWFkZXIgewogICAgICBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDIwcHg7CiAgICAgIG1hcmdpbi1ib3R0b206IDI4cHg7IHBhZGRpbmc6IDI4cHggMzJweDsKICAgICAgYmFja2dyb3VuZDogbGluZWFyLWdyYWRpZW50KDEzNWRlZywgI0U4NzQwQyAwJSwgI2Q0NjUwYSA1MCUsICNiZjU4MDggMTAwJSk7CiAgICAgIGJvcmRlci1yYWRpdXM6IDE2cHg7IGNvbG9yOiAjZmZmOwogICAgICBib3gtc2hhZG93OiAwIDhweCAzMnB4IHJnYmEoMjMyLDExNiwxMiwwLjI1KTsKICAgICAgcG9zaXRpb246IHJlbGF0aXZlOyBvdmVyZmxvdzogaGlkZGVuOwogICAgfQogICAgLnpwLWhlYWRlcjo6YmVmb3JlIHsKICAgICAgY29udGVudDogJyc7IHBvc2l0aW9uOiBhYnNvbHV0ZTsgaW5zZXQ6IDA7CiAgICAgIGJhY2tncm91bmQ6IHVybCgiZGF0YTppbWFnZS9zdmcreG1sLCUzQ3N2ZyB3aWR0aD0nNjAnIGhlaWdodD0nNjAnIHZpZXdCb3g9JzAgMCA2MCA2MCcgeG1sbnM9J2h0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnJyUzRSUzQ2cgZmlsbD0nbm9uZScgZmlsbC1ydWxlPSdldmVub2RkJyUzRSUzQ2cgZmlsbD0nJTIzZmZmZmZmJyBmaWxsLW9wYWNpdHk9JzAuMDQnJTNFJTNDcGF0aCBkPSdNMzYgMzR2LTRoLTJ2NGgtNHYyaDR2NGgydi00aDR2LTJoLTR6bTAtMzBWMGgtMnY0aC00djJoNHY0aDJWNmg0VjRoLTR6TTYgMzR2LTRINHY0SDB2Mmg0djRoMnYtNGg0di0ySDZ6TTYgNFYwSDR2NEgwdjJoNHY0aDJWNmg0VjRINnonLyUzRSUzQy9nJTNFJTNDL2clM0UlM0Mvc3ZnJTNFIik7CiAgICAgIHBvaW50ZXItZXZlbnRzOiBub25lOwogICAgfQogICAgLnpwLWhlYWRlcjo6YWZ0ZXIgewogICAgICBjb250ZW50OiAnJzsgcG9zaXRpb246IGFic29sdXRlOyByaWdodDogLTQwcHg7IGJvdHRvbTogLTQwcHg7CiAgICAgIHdpZHRoOiAyMDBweDsgaGVpZ2h0OiAyMDBweDsgYm9yZGVyLXJhZGl1czogNTAlOwogICAgICBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwyNTUsMjU1LDAuMDcpOyBwb2ludGVyLWV2ZW50czogbm9uZTsKICAgIH0KICAgIC56cC1sb2dvIHsKICAgICAgd2lkdGg6IDU2cHg7IGhlaWdodDogNTZweDsgYm9yZGVyLXJhZGl1czogMTRweDsKICAgICAgYmFja2dyb3VuZDogcmdiYSgyNTUsMjU1LDI1NSwwLjIpOyBiYWNrZHJvcC1maWx0ZXI6IGJsdXIoOHB4KTsKICAgICAgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7CiAgICAgIGZvbnQtc2l6ZTogMjhweDsgZm9udC13ZWlnaHQ6IDcwMDsgZmxleC1zaHJpbms6IDA7CiAgICAgIGJvcmRlcjogMXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsMC4xNSk7CiAgICB9CiAgICAuenAtaGVhZGVyLXRleHQgeyBmbGV4OiAxOyBwb3NpdGlvbjogcmVsYXRpdmU7IHotaW5kZXg6IDE7IH0KICAgIC56cC1oZWFkZXItdGV4dCBoMSB7IGZvbnQtc2l6ZTogMjFweDsgZm9udC13ZWlnaHQ6IDcwMDsgbGV0dGVyLXNwYWNpbmc6IC0wLjNweDsgfQogICAgLnpwLWhlYWRlci10ZXh0IHAgeyBmb250LXNpemU6IDEzcHg7IG9wYWNpdHk6IDAuNzU7IG1hcmdpbi10b3A6IDNweDsgfQogICAgLnpwLWdyZWV0aW5nIHsgcG9zaXRpb246IGFic29sdXRlOyB0b3A6IDIwcHg7IHJpZ2h0OiAyOHB4OyB6LWluZGV4OiAxOyBmb250LXNpemU6IDEycHg7IG9wYWNpdHk6IDAuODU7IH0KICAgIC56cC1ncmVldGluZyBzdHJvbmcgeyBmb250LXdlaWdodDogNjAwOyB9CgogICAgLyogS1BJcyAqLwogICAgLnpwLWtwaXMgeyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdCg0LCAxZnIpOyBnYXA6IDEycHg7IG1hcmdpbi1ib3R0b206IDI4cHg7IH0KICAgIC56cC1rcGkgewogICAgICBiYWNrZ3JvdW5kOiB2YXIoLS16cC1zdXJmYWNlKTsgYm9yZGVyLXJhZGl1czogdmFyKC0tenAtcmFkaXVzKTsKICAgICAgcGFkZGluZzogMjBweDsgYm94LXNoYWRvdzogdmFyKC0tenAtc2hhZG93LXNtKTsKICAgICAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tenAtYm9yZGVyKTsKICAgICAgdGV4dC1kZWNvcmF0aW9uOiBub25lOyBjb2xvcjogaW5oZXJpdDsgZGlzcGxheTogYmxvY2s7CiAgICAgIHRyYW5zaXRpb246IHRyYW5zZm9ybSAwLjJzLCBib3gtc2hhZG93IDAuMnM7CiAgICB9CiAgICAuenAta3BpOmhvdmVyIHsgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKC0ycHgpOyBib3gtc2hhZG93OiB2YXIoLS16cC1zaGFkb3ctbWQpOyB9CiAgICAuenAta3BpLWRvdCB7IHdpZHRoOiA4cHg7IGhlaWdodDogOHB4OyBib3JkZXItcmFkaXVzOiA1MCU7IGRpc3BsYXk6IGlubGluZS1ibG9jazsgbWFyZ2luLXJpZ2h0OiAycHg7IHZlcnRpY2FsLWFsaWduOiBtaWRkbGU7IH0KICAgIC56cC1rcGktdmFsIHsgZm9udC1zaXplOiAzMnB4OyBmb250LXdlaWdodDogNzAwOyBsaW5lLWhlaWdodDogMTsgbGV0dGVyLXNwYWNpbmc6IC0xcHg7IG1hcmdpbi10b3A6IDhweDsgfQogICAgLnpwLWtwaS1sYmwgeyBmb250LXNpemU6IDExcHg7IGNvbG9yOiB2YXIoLS16cC10ZXh0LXNlY29uZGFyeSk7IHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7IGxldHRlci1zcGFjaW5nOiAwLjhweDsgZm9udC13ZWlnaHQ6IDUwMDsgfQogICAgLnpwLWtwaS1hbGVydCB7IGRpc3BsYXk6IGlubGluZS1ibG9jazsgZm9udC1zaXplOiAxMHB4OyBmb250LXdlaWdodDogNjAwOyBwYWRkaW5nOiAycHggOHB4OyBib3JkZXItcmFkaXVzOiA5OXB4OyBtYXJnaW4tbGVmdDogOHB4OyB2ZXJ0aWNhbC1hbGlnbjogbWlkZGxlOyB9CiAgICAuenAta3BpIC56cC1sb2FkaW5nIHsgY29sb3I6IHZhcigtLXpwLXRleHQtbXV0ZWQpOyBhbmltYXRpb246IHpwLXB1bHNlIDEuNXMgZWFzZSBpbmZpbml0ZTsgfQogICAgQGtleWZyYW1lcyB6cC1wdWxzZSB7IDAlLDEwMCV7b3BhY2l0eToxfSA1MCV7b3BhY2l0eTowLjN9IH0KCiAgICAvKiBTZWN0aW9uICovCiAgICAuenAtc2ggeyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47IG1hcmdpbi1ib3R0b206IDE0cHg7IH0KICAgIC56cC1zaC10aXRsZSB7IGZvbnQtc2l6ZTogMTNweDsgZm9udC13ZWlnaHQ6IDYwMDsgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsgbGV0dGVyLXNwYWNpbmc6IDAuOHB4OyB9CiAgICAuenAtc2gtbWV0YSB7IGZvbnQtc2l6ZTogMTFweDsgY29sb3I6IHZhcigtLXpwLXRleHQtbXV0ZWQpOyB9CgogICAgLyogQXBwcyAqLwogICAgLnpwLWFwcHMgeyBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdCg0LCAxZnIpOyBnYXA6IDEycHg7IG1hcmdpbi1ib3R0b206IDI4cHg7IH0KICAgIC56cC1hcHAgewogICAgICBiYWNrZ3JvdW5kOiB2YXIoLS16cC1zdXJmYWNlKTsgYm9yZGVyLXJhZGl1czogdmFyKC0tenAtcmFkaXVzKTsKICAgICAgcGFkZGluZzogMjBweCAxOHB4OyBib3gtc2hhZG93OiB2YXIoLS16cC1zaGFkb3ctc20pOwogICAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS16cC1ib3JkZXIpOwogICAgICB0ZXh0LWRlY29yYXRpb246IG5vbmU7IGNvbG9yOiBpbmhlcml0OwogICAgICB0cmFuc2l0aW9uOiB0cmFuc2Zvcm0gMC4ycywgYm94LXNoYWRvdyAwLjJzOwogICAgICBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBnYXA6IDEwcHg7CiAgICB9CiAgICAuenAtYXBwOmhvdmVyIHsgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKC0ycHgpOyBib3gtc2hhZG93OiB2YXIoLS16cC1zaGFkb3ctbWQpOyB9CiAgICAuenAtYXBwLWljb24geyB3aWR0aDogNDBweDsgaGVpZ2h0OiA0MHB4OyBib3JkZXItcmFkaXVzOiAxMHB4OyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgZm9udC1zaXplOiAxOXB4OyB9CiAgICAuenAtYXBwLW5hbWUgeyBmb250LXNpemU6IDE0cHg7IGZvbnQtd2VpZ2h0OiA2MDA7IH0KICAgIC56cC1hcHAtZGVzYyB7IGZvbnQtc2l6ZTogMTJweDsgY29sb3I6IHZhcigtLXpwLXRleHQtc2Vjb25kYXJ5KTsgbGluZS1oZWlnaHQ6IDEuNDsgfQogICAgLnpwLWFwcC1tZXRhIHsgZm9udC1zaXplOiAxMXB4OyBjb2xvcjogdmFyKC0tenAtdGV4dC1tdXRlZCk7IG1hcmdpbi10b3A6IGF1dG87IH0KCiAgICAvKiBXb3JrZmxvdyAqLwogICAgLnpwLXdmLXdyYXAgewogICAgICBiYWNrZ3JvdW5kOiB2YXIoLS16cC1zdXJmYWNlKTsgYm9yZGVyLXJhZGl1czogdmFyKC0tenAtcmFkaXVzKTsKICAgICAgcGFkZGluZzogMjRweCAyMHB4IDIwcHg7IGJveC1zaGFkb3c6IHZhcigtLXpwLXNoYWRvdy1zbSk7CiAgICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXpwLWJvcmRlcik7IG1hcmdpbi1ib3R0b206IDI4cHg7CiAgICAgIG92ZXJmbG93LXg6IGF1dG87CiAgICB9CiAgICAuenAtd2Ytc3ZnIHsgd2lkdGg6IDEwMCU7IG1pbi13aWR0aDogNzYwcHg7IGRpc3BsYXk6IGJsb2NrOyB9CiAgICAuenAtd2Ytbm9kZSB7IGN1cnNvcjogcG9pbnRlcjsgfQogICAgLnpwLXdmLW5vZGU6aG92ZXIgLndmLWJnIHsgZmlsdGVyOiBicmlnaHRuZXNzKDEuMTIpOyB9CiAgICAuenAtd2YtZWRnZSB7IGZpbGw6IG5vbmU7IHN0cm9rZTogI2Q2ZDNkMTsgc3Ryb2tlLXdpZHRoOiAxLjU7IH0KICAgIC56cC13Zi1lZGdlLWhlYWQgeyBmaWxsOiAjZDZkM2QxOyB9CiAgICAuenAtd2YtcmVqLWVkZ2UgeyBzdHJva2U6ICNmY2E1YTU7IHN0cm9rZS1kYXNoYXJyYXk6IDUsNDsgc3Ryb2tlLXdpZHRoOiAxLjU7IH0KCiAgICAvKiDilIDilIAgRHJpbGxkb3duIE1vZGFsIOKUgOKUgCAqLwogICAgLnpwLW1vZGFsLW92ZXJsYXkgewogICAgICBwb3NpdGlvbjogZml4ZWQ7IGluc2V0OiAwOyB6LWluZGV4OiAxMDAwMDsKICAgICAgYmFja2dyb3VuZDogcmdiYSgyOCwyNSwyMywwLjQ1KTsgYmFja2Ryb3AtZmlsdGVyOiBibHVyKDRweCk7CiAgICAgIGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogY2VudGVyOwogICAgICBvcGFjaXR5OiAwOyB0cmFuc2l0aW9uOiBvcGFjaXR5IDAuMnMgZWFzZTsKICAgICAgcG9pbnRlci1ldmVudHM6IG5vbmU7CiAgICB9CiAgICAuenAtbW9kYWwtb3ZlcmxheS56cC1tb2RhbC1vcGVuIHsgb3BhY2l0eTogMTsgcG9pbnRlci1ldmVudHM6IGFsbDsgfQogICAgLnpwLW1vZGFsIHsKICAgICAgYmFja2dyb3VuZDogI2ZmZjsgYm9yZGVyLXJhZGl1czogMTZweDsKICAgICAgd2lkdGg6IDkwJTsgbWF4LXdpZHRoOiA4MjBweDsgbWF4LWhlaWdodDogODB2aDsKICAgICAgYm94LXNoYWRvdzogMCAyNHB4IDY0cHggcmdiYSgyOCwyNSwyMywwLjIpLCAwIDRweCAxNnB4IHJnYmEoMjgsMjUsMjMsMC4xKTsKICAgICAgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsKICAgICAgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKDEycHgpIHNjYWxlKDAuOTgpOwogICAgICB0cmFuc2l0aW9uOiB0cmFuc2Zvcm0gMC4ycyBlYXNlOwogICAgfQogICAgLnpwLW1vZGFsLW9wZW4gLnpwLW1vZGFsIHsgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKDApIHNjYWxlKDEpOyB9CiAgICAuenAtbW9kYWwtaGVhZGVyIHsKICAgICAgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOwogICAgICBwYWRkaW5nOiAyMHB4IDI0cHg7IGJvcmRlci1ib3R0b206IDFweCBzb2xpZCAjZThlNWUwOyBmbGV4LXNocmluazogMDsKICAgIH0KICAgIC56cC1tb2RhbC1oZWFkZXItbGVmdCB7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogMTJweDsgfQogICAgLnpwLW1vZGFsLWJhZGdlIHsKICAgICAgZGlzcGxheTogaW5saW5lLWJsb2NrOyBwYWRkaW5nOiA1cHggMTRweDsgYm9yZGVyLXJhZGl1czogOHB4OwogICAgICBmb250LXNpemU6IDEzcHg7IGZvbnQtd2VpZ2h0OiA2MDA7IGNvbG9yOiAjZmZmOwogICAgfQogICAgLnpwLW1vZGFsLWNvdW50IHsgZm9udC1zaXplOiAxM3B4OyBjb2xvcjogIzc4NzE2YzsgZm9udC13ZWlnaHQ6IDUwMDsgfQogICAgLnpwLW1vZGFsLWNsb3NlIHsKICAgICAgd2lkdGg6IDMycHg7IGhlaWdodDogMzJweDsgYm9yZGVyLXJhZGl1czogOHB4OyBib3JkZXI6IDFweCBzb2xpZCAjZThlNWUwOwogICAgICBiYWNrZ3JvdW5kOiAjZmZmOyBjdXJzb3I6IHBvaW50ZXI7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICAgIGp1c3RpZnktY29udGVudDogY2VudGVyOyBmb250LXNpemU6IDE2cHg7IGNvbG9yOiAjNzg3MTZjOwogICAgICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kIDAuMTVzOwogICAgfQogICAgLnpwLW1vZGFsLWNsb3NlOmhvdmVyIHsgYmFja2dyb3VuZDogI2Y1ZjVmNDsgfQogICAgLnpwLW1vZGFsLWJvZHkgewogICAgICBvdmVyZmxvdy15OiBhdXRvOyBmbGV4OiAxOyBwYWRkaW5nOiAwOwogICAgfQogICAgLnpwLW1vZGFsLWxvYWRpbmcgewogICAgICBwYWRkaW5nOiA0OHB4OyB0ZXh0LWFsaWduOiBjZW50ZXI7IGNvbG9yOiAjYThhMjllOyBmb250LXNpemU6IDEzcHg7CiAgICB9CiAgICAuenAtbW9kYWwtZW1wdHkgewogICAgICBwYWRkaW5nOiA0OHB4OyB0ZXh0LWFsaWduOiBjZW50ZXI7IGNvbG9yOiAjYThhMjllOyBmb250LXNpemU6IDE0cHg7CiAgICB9CgogICAgLyogTW9kYWwgVGFibGUgKi8KICAgIC56cC1kdCB7IHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyBmb250LXNpemU6IDEzcHg7IH0KICAgIC56cC1kdCB0aGVhZCB7IHBvc2l0aW9uOiBzdGlja3k7IHRvcDogMDsgei1pbmRleDogMTsgfQogICAgLnpwLWR0IHRoIHsKICAgICAgYmFja2dyb3VuZDogI2ZhZmFmOTsgcGFkZGluZzogMTBweCAxNnB4OyB0ZXh0LWFsaWduOiBsZWZ0OwogICAgICBmb250LXNpemU6IDExcHg7IGZvbnQtd2VpZ2h0OiA2MDA7IHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7CiAgICAgIGxldHRlci1zcGFjaW5nOiAwLjVweDsgY29sb3I6ICM3ODcxNmM7IGJvcmRlci1ib3R0b206IDFweCBzb2xpZCAjZThlNWUwOwogICAgICB3aGl0ZS1zcGFjZTogbm93cmFwOwogICAgfQogICAgLnpwLWR0IHRkIHsKICAgICAgcGFkZGluZzogMTJweCAxNnB4OyBib3JkZXItYm90dG9tOiAxcHggc29saWQgI2Y1ZjVmNDsKICAgICAgY29sb3I6ICMxYzE5MTc7IHZlcnRpY2FsLWFsaWduOiBtaWRkbGU7CiAgICB9CiAgICAuenAtZHQgdGJvZHkgdHIgeyB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kIDAuMXM7IGN1cnNvcjogcG9pbnRlcjsgfQogICAgLnpwLWR0IHRib2R5IHRyOmhvdmVyIHsgYmFja2dyb3VuZDogI2ZhZmFmOTsgfQogICAgLnpwLWR0IHRib2R5IHRyOmxhc3QtY2hpbGQgdGQgeyBib3JkZXItYm90dG9tOiBub25lOyB9CiAgICAuenAtZHQgLnpwLWR0LW9yZGVyIHsgZm9udC13ZWlnaHQ6IDYwMDsgY29sb3I6IHZhcigtLXpwLW9yYW5nZSk7IHRleHQtZGVjb3JhdGlvbjogbm9uZTsgfQogICAgLnpwLWR0IC56cC1kdC1vcmRlcjpob3ZlciB7IHRleHQtZGVjb3JhdGlvbjogdW5kZXJsaW5lOyB9CiAgICAuenAtZHQgLnpwLWR0LWFtb3VudCB7IGZvbnQtd2VpZ2h0OiA2MDA7IGZvbnQtdmFyaWFudC1udW1lcmljOiB0YWJ1bGFyLW51bXM7IH0KICAgIC56cC1kdCAuenAtZHQtcGlsbCB7CiAgICAgIGRpc3BsYXk6IGlubGluZS1ibG9jazsgcGFkZGluZzogMnB4IDhweDsgYm9yZGVyLXJhZGl1czogNnB4OwogICAgICBmb250LXNpemU6IDExcHg7IGZvbnQtd2VpZ2h0OiA1MDA7CiAgICB9CgogICAgLyogTW9kYWwgZm9vdGVyICovCiAgICAuenAtbW9kYWwtZm9vdGVyIHsKICAgICAgcGFkZGluZzogMTRweCAyNHB4OyBib3JkZXItdG9wOiAxcHggc29saWQgI2U4ZTVlMDsKICAgICAgZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOyBhbGlnbi1pdGVtczogY2VudGVyOwogICAgICBmbGV4LXNocmluazogMDsKICAgIH0KICAgIC56cC1tb2RhbC1mb290ZXIgYSB7CiAgICAgIGZvbnQtc2l6ZTogMTJweDsgZm9udC13ZWlnaHQ6IDUwMDsgY29sb3I6IHZhcigtLXpwLW9yYW5nZSk7CiAgICAgIHRleHQtZGVjb3JhdGlvbjogbm9uZTsKICAgIH0KICAgIC56cC1tb2RhbC1mb290ZXIgYTpob3ZlciB7IHRleHQtZGVjb3JhdGlvbjogdW5kZXJsaW5lOyB9CiAgICAuenAtbW9kYWwtZm9vdGVyIHNwYW4geyBmb250LXNpemU6IDExcHg7IGNvbG9yOiAjYThhMjllOyB9CgogICAgLyogQW5ub3VuY2VtZW50cyAqLwogICAgLnpwLWFubiB7IG1hcmdpbi1ib3R0b206IDI4cHg7IH0KICAgIC56cC1hbm4taXRlbSB7CiAgICAgIGJhY2tncm91bmQ6IHZhcigtLXpwLXN1cmZhY2UpOyBib3JkZXItcmFkaXVzOiAxMHB4OwogICAgICBwYWRkaW5nOiAxMnB4IDE2cHg7IGJveC1zaGFkb3c6IHZhcigtLXpwLXNoYWRvdy1zbSk7CiAgICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXpwLWJvcmRlcik7IG1hcmdpbi1ib3R0b206IDZweDsKICAgICAgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiAxMnB4OwogICAgICB0ZXh0LWRlY29yYXRpb246IG5vbmU7IGNvbG9yOiBpbmhlcml0OyB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kIDAuMTVzOwogICAgfQogICAgLnpwLWFubi1pdGVtOmhvdmVyIHsgYmFja2dyb3VuZDogI2ZhZmFmOTsgfQogICAgLnpwLWFubi1waW4geyBjb2xvcjogdmFyKC0tenAtb3JhbmdlKTsgZm9udC1zaXplOiAxM3B4OyBmbGV4LXNocmluazogMDsgfQogICAgLnpwLWFubi1iYWRnZSB7IGZvbnQtc2l6ZTogMTBweDsgZm9udC13ZWlnaHQ6IDYwMDsgcGFkZGluZzogMnB4IDhweDsgYm9yZGVyLXJhZGl1czogNnB4OyB3aGl0ZS1zcGFjZTogbm93cmFwOyBmbGV4LXNocmluazogMDsgfQogICAgLnpwLWFubi10aXRsZSB7IGZsZXg6IDE7IGZvbnQtc2l6ZTogMTNweDsgZm9udC13ZWlnaHQ6IDUwMDsgd2hpdGUtc3BhY2U6IG5vd3JhcDsgb3ZlcmZsb3c6IGhpZGRlbjsgdGV4dC1vdmVyZmxvdzogZWxsaXBzaXM7IH0KICAgIC56cC1hbm4tZGF0ZSB7IGZvbnQtc2l6ZTogMTFweDsgY29sb3I6IHZhcigtLXpwLXRleHQtbXV0ZWQpOyBmbGV4LXNocmluazogMDsgfQogICAgLnpwLWFubi1tb3JlIHsgZGlzcGxheTogYmxvY2s7IHRleHQtYWxpZ246IHJpZ2h0OyBmb250LXNpemU6IDEycHg7IGNvbG9yOiB2YXIoLS16cC10ZXh0LXNlY29uZGFyeSk7IHRleHQtZGVjb3JhdGlvbjogbm9uZTsgbWFyZ2luLXRvcDogOHB4OyBmb250LXdlaWdodDogNTAwOyB9CiAgICAuenAtYW5uLW1vcmU6aG92ZXIgeyBjb2xvcjogdmFyKC0tenAtb3JhbmdlKTsgfQoKICAgIC8qIFF1aWNrIEFjdGlvbnMgKi8KICAgIC56cC1xYSB7IGRpc3BsYXk6IGdyaWQ7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogcmVwZWF0KDMsIDFmcik7IGdhcDogMTBweDsgbWFyZ2luLWJvdHRvbTogMjhweDsgfQogICAgLnpwLXFhLWl0ZW0gewogICAgICBiYWNrZ3JvdW5kOiB2YXIoLS16cC1zdXJmYWNlKTsgYm9yZGVyLXJhZGl1czogMTBweDsKICAgICAgcGFkZGluZzogMTRweCAxNnB4OyBib3gtc2hhZG93OiB2YXIoLS16cC1zaGFkb3ctc20pOwogICAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS16cC1ib3JkZXIpOwogICAgICB0ZXh0LWRlY29yYXRpb246IG5vbmU7IGNvbG9yOiBpbmhlcml0OwogICAgICBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDEycHg7CiAgICAgIHRyYW5zaXRpb246IGJhY2tncm91bmQgMC4xNXMsIGJveC1zaGFkb3cgMC4xNXM7CiAgICB9CiAgICAuenAtcWEtaXRlbTpob3ZlciB7IGJhY2tncm91bmQ6ICNmYWZhZjk7IGJveC1zaGFkb3c6IHZhcigtLXpwLXNoYWRvdy1tZCk7IH0KICAgIC56cC1xYS1pY29uIHsgd2lkdGg6IDM0cHg7IGhlaWdodDogMzRweDsgYm9yZGVyLXJhZGl1czogOHB4OyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgZm9udC1zaXplOiAxNXB4OyBmbGV4LXNocmluazogMDsgfQogICAgLnpwLXFhLXRleHQgeyBmb250LXNpemU6IDEycHg7IGZvbnQtd2VpZ2h0OiA1MDA7IGxpbmUtaGVpZ2h0OiAxLjM7IH0KICAgIC56cC1xYS1zdWIgeyBmb250LXNpemU6IDExcHg7IGNvbG9yOiB2YXIoLS16cC10ZXh0LW11dGVkKTsgfQoKICAgIC8qIEZvb3RlciAqLwogICAgLnpwLWZvb3RlciB7CiAgICAgIGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsgYWxpZ24taXRlbXM6IGNlbnRlcjsKICAgICAgcGFkZGluZzogMTZweCAwIDA7IGJvcmRlci10b3A6IDFweCBzb2xpZCB2YXIoLS16cC1ib3JkZXIpOwogICAgICBmb250LXNpemU6IDExcHg7IGNvbG9yOiB2YXIoLS16cC10ZXh0LW11dGVkKTsKICAgIH0KICAgIC56cC1yZWZyZXNoIHsKICAgICAgYmFja2dyb3VuZDogdmFyKC0tenAtc3VyZmFjZSk7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXpwLWJvcmRlcik7CiAgICAgIGJvcmRlci1yYWRpdXM6IDZweDsgcGFkZGluZzogNHB4IDEycHg7IGZvbnQtc2l6ZTogMTFweDsKICAgICAgY29sb3I6IHZhcigtLXpwLXRleHQtc2Vjb25kYXJ5KTsgY3Vyc29yOiBwb2ludGVyOyBmb250LWZhbWlseTogaW5oZXJpdDsKICAgIH0KICAgIC56cC1yZWZyZXNoOmhvdmVyIHsgYmFja2dyb3VuZDogI2Y1ZjVmNDsgfQoKICAgIEBtZWRpYSAobWF4LXdpZHRoOiA5NjBweCkgewogICAgICAuenAta3BpcywgLnpwLWFwcHMgeyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdCgyLCAxZnIpOyB9CiAgICAgIC56cC1xYSB7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogcmVwZWF0KDIsIDFmcik7IH0KICAgICAgLnpwLWdyZWV0aW5nIHsgZGlzcGxheTogbm9uZTsgfQogICAgICAuenAtbW9kYWwgeyB3aWR0aDogOTYlOyBtYXgtaGVpZ2h0OiA4NXZoOyB9CiAgICB9CiAgICBAbWVkaWEgKG1heC13aWR0aDogNjAwcHgpIHsKICAgICAgLnpwLWtwaXMsIC56cC1hcHBzLCAuenAtcWEgeyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmcjsgfQogICAgICAjemFndS1wb3J0YWwgeyBwYWRkaW5nOiAxMnB4IDEycHggMzJweDsgfQogICAgfQogIGA7CgogIC8vIOKUgOKUgCBIZWxwZXJzIOKUgOKUgAogIGZ1bmN0aW9uIGZldGNoQ291bnQoYXBwSWQsIHF1ZXJ5KSB7CiAgICB2YXIgcSA9IChxdWVyeSA/IHF1ZXJ5ICsgIiAiIDogIiIpICsgImxpbWl0IDAiOwogICAgcmV0dXJuIGtpbnRvbmUuYXBpKGtpbnRvbmUuYXBpLnVybCgiL2svdjEvcmVjb3Jkcy5qc29uIiwgdHJ1ZSksICJHRVQiLCB7IGFwcDogYXBwSWQsIHF1ZXJ5OiBxLCB0b3RhbENvdW50OiB0cnVlIH0pCiAgICAgIC50aGVuKGZ1bmN0aW9uIChyKSB7IHJldHVybiBwYXJzZUludChyLnRvdGFsQ291bnQsIDEwKSB8fCAwOyB9KTsKICB9CgogIGZ1bmN0aW9uIGZldGNoUmVjb3JkcyhhcHBJZCwgcXVlcnksIGZpZWxkcykgewogICAgcmV0dXJuIGtpbnRvbmUuYXBpKGtpbnRvbmUuYXBpLnVybCgiL2svdjEvcmVjb3Jkcy5qc29uIiwgdHJ1ZSksICJHRVQiLCB7CiAgICAgIGFwcDogYXBwSWQsIHF1ZXJ5OiBxdWVyeSwgZmllbGRzOiBmaWVsZHMKICAgIH0pLnRoZW4oZnVuY3Rpb24gKHIpIHsgcmV0dXJuIHIucmVjb3JkczsgfSk7CiAgfQoKICBmdW5jdGlvbiBncmVldCgpIHsKICAgIHZhciBoID0gbmV3IERhdGUoKS5nZXRIb3VycygpOwogICAgcmV0dXJuIGggPCAxMiA/ICJHb29kIG1vcm5pbmciIDogaCA8IDE3ID8gIkdvb2QgYWZ0ZXJub29uIiA6ICJHb29kIGV2ZW5pbmciOwogIH0KCiAgZnVuY3Rpb24gZm10RGF0ZShzKSB7CiAgICBpZiAoIXMpIHJldHVybiAiIjsKICAgIHZhciBkID0gbmV3IERhdGUocyk7CiAgICB2YXIgbSA9IFsiSmFuIiwiRmViIiwiTWFyIiwiQXByIiwiTWF5IiwiSnVuIiwiSnVsIiwiQXVnIiwiU2VwIiwiT2N0IiwiTm92IiwiRGVjIl07CiAgICByZXR1cm4gbVtkLmdldE1vbnRoKCldICsgIiAiICsgZC5nZXREYXRlKCk7CiAgfQoKICBmdW5jdGlvbiBmbXRUaW1lKCkgewogICAgdmFyIGQgPSBuZXcgRGF0ZSgpLCBoID0gZC5nZXRIb3VycygpLCBtID0gZC5nZXRNaW51dGVzKCk7CiAgICByZXR1cm4gKGggJSAxMiB8fCAxMikgKyAiOiIgKyAobSA8IDEwID8gIjAiIDogIiIpICsgbSArICIgIiArIChoID49IDEyID8gIlBNIiA6ICJBTSIpOwogIH0KCiAgZnVuY3Rpb24gZm10UGVzbyh2KSB7CiAgICB2YXIgbiA9IHBhcnNlRmxvYXQodikgfHwgMDsKICAgIHJldHVybiAi4oKxIiArIG4udG9Mb2NhbGVTdHJpbmcoImVuLVBIIiwgeyBtaW5pbXVtRnJhY3Rpb25EaWdpdHM6IDIsIG1heGltdW1GcmFjdGlvbkRpZ2l0czogMiB9KTsKICB9CgogIHZhciBDQVRfQ09MT1JTID0gewogICAgR2VuZXJhbDogeyBiZzogIiNmMGYwZWUiLCBmZzogIiM1NzUzNGUiIH0sCiAgICBQcm9tbzogeyBiZzogIiNmZWYzYzciLCBmZzogIiNiNDUzMDkiIH0sCiAgICAiUHJvZHVjdCBVcGRhdGUiOiB7IGJnOiAiI2QxZmFlNSIsIGZnOiAiIzA0Nzg1NyIgfSwKICAgIFBvbGljeTogeyBiZzogIiNlZGU5ZmUiLCBmZzogIiM2ZDI4ZDkiIH0sCiAgICBNYWludGVuYW5jZTogeyBiZzogIiNmZWUyZTIiLCBmZzogIiNiOTFjMWMiIH0sCiAgICAiU3lzdGVtIFVwZGF0ZSI6IHsgYmc6ICIjZGJlYWZlIiwgZmc6ICIjMWQ0ZWQ4IiB9CiAgfTsKCiAgdmFyIFBBWU1FTlRfQ09MT1JTID0gewogICAgUGFpZDogeyBiZzogIiNkMWZhZTUiLCBmZzogIiMwNDc4NTciIH0sCiAgICBQZW5kaW5nOiB7IGJnOiAiI2ZlZjNjNyIsIGZnOiAiI2I0NTMwOSIgfSwKICAgIFVucGFpZDogeyBiZzogIiNmZWUyZTIiLCBmZzogIiNiOTFjMWMiIH0sCiAgICAiQ09EIFBlbmRpbmciOiB7IGJnOiAiI2ZlZjNjNyIsIGZnOiAiI2I0NTMwOSIgfSwKICAgIFBhcnRpYWw6IHsgYmc6ICIjZmVmM2M3IiwgZmc6ICIjYjQ1MzA5IiB9CiAgfTsKCiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAgLy8gRFJJTExET1dOIE1PREFMCiAgLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCgogIHZhciBtb2RhbCA9IG51bGw7CgogIGZ1bmN0aW9uIGNyZWF0ZU1vZGFsKCkgewogICAgaWYgKG1vZGFsKSByZXR1cm4gbW9kYWw7CgogICAgdmFyIG92ZXJsYXkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIG92ZXJsYXkuY2xhc3NOYW1lID0gInpwLW1vZGFsLW92ZXJsYXkiOwogICAgb3ZlcmxheS5hZGRFdmVudExpc3RlbmVyKCJjbGljayIsIGZ1bmN0aW9uIChlKSB7CiAgICAgIGlmIChlLnRhcmdldCA9PT0gb3ZlcmxheSkgY2xvc2VNb2RhbCgpOwogICAgfSk7CgogICAgb3ZlcmxheS5pbm5lckhUTUwgPQogICAgICAnPGRpdiBjbGFzcz0ienAtbW9kYWwiPicgKwogICAgICAgICc8ZGl2IGNsYXNzPSJ6cC1tb2RhbC1oZWFkZXIiPicgKwogICAgICAgICAgJzxkaXYgY2xhc3M9InpwLW1vZGFsLWhlYWRlci1sZWZ0Ij4nICsKICAgICAgICAgICAgJzxzcGFuIGNsYXNzPSJ6cC1tb2RhbC1iYWRnZSIgZGF0YS1tb2RhbC1iYWRnZT48L3NwYW4+JyArCiAgICAgICAgICAgICc8c3BhbiBjbGFzcz0ienAtbW9kYWwtY291bnQiIGRhdGEtbW9kYWwtY291bnQ+PC9zcGFuPicgKwogICAgICAgICAgJzwvZGl2PicgKwogICAgICAgICAgJzxidXR0b24gY2xhc3M9InpwLW1vZGFsLWNsb3NlIiBkYXRhLW1vZGFsLWNsb3NlPuKclTwvYnV0dG9uPicgKwogICAgICAgICc8L2Rpdj4nICsKICAgICAgICAnPGRpdiBjbGFzcz0ienAtbW9kYWwtYm9keSIgZGF0YS1tb2RhbC1ib2R5PicgKwogICAgICAgICAgJzxkaXYgY2xhc3M9InpwLW1vZGFsLWxvYWRpbmciPkxvYWRpbmcgb3JkZXJzLi4uPC9kaXY+JyArCiAgICAgICAgJzwvZGl2PicgKwogICAgICAgICc8ZGl2IGNsYXNzPSJ6cC1tb2RhbC1mb290ZXIiPicgKwogICAgICAgICAgJzxhIGhyZWY9IicgKyBET01BSU4gKyAnL2svMy8iIGRhdGEtbW9kYWwtbGluaz5PcGVuIGluIE9yZGVycyBhcHAg4oaSPC9hPicgKwogICAgICAgICAgJzxzcGFuIGRhdGEtbW9kYWwtaGludD5DbGljayBhbnkgcm93IHRvIG9wZW4gdGhlIG9yZGVyPC9zcGFuPicgKwogICAgICAgICc8L2Rpdj4nICsKICAgICAgJzwvZGl2Pic7CgogICAgb3ZlcmxheS5xdWVyeVNlbGVjdG9yKCJbZGF0YS1tb2RhbC1jbG9zZV0iKS5hZGRFdmVudExpc3RlbmVyKCJjbGljayIsIGNsb3NlTW9kYWwpOwoKICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoImtleWRvd24iLCBmdW5jdGlvbiAoZSkgewogICAgICBpZiAoZS5rZXkgPT09ICJFc2NhcGUiKSBjbG9zZU1vZGFsKCk7CiAgICB9KTsKCiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpOwogICAgbW9kYWwgPSBvdmVybGF5OwogICAgcmV0dXJuIG92ZXJsYXk7CiAgfQoKICBmdW5jdGlvbiBvcGVuTW9kYWwobm9kZSkgewogICAgdmFyIG92ZXJsYXkgPSBjcmVhdGVNb2RhbCgpOwogICAgdmFyIGJhZGdlID0gb3ZlcmxheS5xdWVyeVNlbGVjdG9yKCJbZGF0YS1tb2RhbC1iYWRnZV0iKTsKICAgIHZhciBjb3VudEVsID0gb3ZlcmxheS5xdWVyeVNlbGVjdG9yKCJbZGF0YS1tb2RhbC1jb3VudF0iKTsKICAgIHZhciBib2R5ID0gb3ZlcmxheS5xdWVyeVNlbGVjdG9yKCJbZGF0YS1tb2RhbC1ib2R5XSIpOwoKICAgIGJhZGdlLnRleHRDb250ZW50ID0gbm9kZS5zdGF0dXM7CiAgICBiYWRnZS5zdHlsZS5iYWNrZ3JvdW5kID0gbm9kZS5jb2xvcjsKICAgIGNvdW50RWwudGV4dENvbnRlbnQgPSAiTG9hZGluZy4uLiI7CiAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJ6cC1tb2RhbC1sb2FkaW5nIj5Mb2FkaW5nIG9yZGVycy4uLjwvZGl2Pic7CgogICAgLy8gU2hvdyBtb2RhbAogICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZ1bmN0aW9uICgpIHsKICAgICAgb3ZlcmxheS5jbGFzc0xpc3QuYWRkKCJ6cC1tb2RhbC1vcGVuIik7CiAgICB9KTsKCiAgICAvLyBGZXRjaCByZWNvcmRzIGZvciB0aGlzIHN0YXR1cwogICAgdmFyIHEgPSAnU3RhdHVzIGluICgiJyArIG5vZGUuc3RhdHVzICsgJyIpIG9yZGVyIGJ5IG9yZGVyX2RhdGUgZGVzYyBsaW1pdCA1MCc7CiAgICB2YXIgZmllbGRzID0gWyJSZWNvcmRfbnVtYmVyIiwgIm9yZGVyX251bWJlciIsICJvcmRlcl9kYXRlIiwgImRlYWxlcl9uYW1lX2Rpc3BsYXkiLAogICAgICAgICAgICAgICAgICAic3RvcmVfbmFtZV9vcmRlciIsICJkZWFsZXJfcmVnaW9uX2Rpc3BsYXkiLCAidG90YWxfYW1vdW50IiwKICAgICAgICAgICAgICAgICAgInBheW1lbnRfbWV0aG9kIiwgInBheW1lbnRfc3RhdHVzIiwgImZ1bGZpbGxtZW50X3N0YXR1cyIsCiAgICAgICAgICAgICAgICAgICJyZWplY3Rpb25fcmVhc29uIiwgInNhcF9zYWxlc19vcmRlcl9ubyJdOwoKICAgIGZldGNoUmVjb3JkcygzLCBxLCBmaWVsZHMpLnRoZW4oZnVuY3Rpb24gKHJlY29yZHMpIHsKICAgICAgY291bnRFbC50ZXh0Q29udGVudCA9IHJlY29yZHMubGVuZ3RoICsgIiBvcmRlciIgKyAocmVjb3Jkcy5sZW5ndGggIT09IDEgPyAicyIgOiAiIik7CgogICAgICBpZiAocmVjb3Jkcy5sZW5ndGggPT09IDApIHsKICAgICAgICBib2R5LmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJ6cC1tb2RhbC1lbXB0eSI+Tm8gb3JkZXJzIGluIHRoaXMgc3RhdHVzPC9kaXY+JzsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIC8vIEJ1aWxkIHRhYmxlCiAgICAgIHZhciBpc1JlamVjdGVkID0gbm9kZS5zdGF0dXMgPT09ICJSZWplY3RlZCI7CiAgICAgIHZhciBpc1NBUCA9IG5vZGUuc3RhdHVzID09PSAiUG9zdGVkIHRvIFNBUCI7CgogICAgICB2YXIgaHRtbCA9ICc8dGFibGUgY2xhc3M9InpwLWR0Ij48dGhlYWQ+PHRyPicgKwogICAgICAgICc8dGg+T3JkZXIgIzwvdGg+PHRoPkRhdGU8L3RoPjx0aD5EZWFsZXI8L3RoPjx0aD5TdG9yZTwvdGg+PHRoPkFtb3VudDwvdGg+JzsKCiAgICAgIGlmIChpc1JlamVjdGVkKSB7CiAgICAgICAgaHRtbCArPSAnPHRoPlJlYXNvbjwvdGg+JzsKICAgICAgfSBlbHNlIGlmIChpc1NBUCkgewogICAgICAgIGh0bWwgKz0gJzx0aD5TQVAgIzwvdGg+JzsKICAgICAgfSBlbHNlIHsKICAgICAgICBodG1sICs9ICc8dGg+UGF5bWVudDwvdGg+JzsKICAgICAgfQoKICAgICAgaHRtbCArPSAnPC90cj48L3RoZWFkPjx0Ym9keT4nOwoKICAgICAgcmVjb3Jkcy5mb3JFYWNoKGZ1bmN0aW9uIChyKSB7CiAgICAgICAgdmFyIHJlY0lkID0gci5SZWNvcmRfbnVtYmVyLnZhbHVlOwogICAgICAgIHZhciBvcmRlck51bSA9IHIub3JkZXJfbnVtYmVyLnZhbHVlIHx8ICIjIiArIHJlY0lkOwogICAgICAgIHZhciBkYXRlID0gZm10RGF0ZShyLm9yZGVyX2RhdGUudmFsdWUpOwogICAgICAgIHZhciBkZWFsZXIgPSByLmRlYWxlcl9uYW1lX2Rpc3BsYXkudmFsdWUgfHwgIuKAlCI7CiAgICAgICAgdmFyIHN0b3JlID0gci5zdG9yZV9uYW1lX29yZGVyLnZhbHVlIHx8ICLigJQiOwogICAgICAgIHZhciBhbW91bnQgPSBmbXRQZXNvKHIudG90YWxfYW1vdW50LnZhbHVlKTsKICAgICAgICB2YXIgcmVjVXJsID0gRE9NQUlOICsgIi9rLzMvc2hvdyNyZWNvcmQ9IiArIHJlY0lkOwoKICAgICAgICB2YXIgZXh0cmFDb2w7CiAgICAgICAgaWYgKGlzUmVqZWN0ZWQpIHsKICAgICAgICAgIGV4dHJhQ29sID0gJzx0ZD4nICsgKHIucmVqZWN0aW9uX3JlYXNvbi52YWx1ZSB8fCAi4oCUIikgKyAnPC90ZD4nOwogICAgICAgIH0gZWxzZSBpZiAoaXNTQVApIHsKICAgICAgICAgIGV4dHJhQ29sID0gJzx0ZD4nICsgKHIuc2FwX3NhbGVzX29yZGVyX25vLnZhbHVlIHx8ICLigJQiKSArICc8L3RkPic7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIHZhciBwcyA9IHIucGF5bWVudF9zdGF0dXMudmFsdWUgfHwgIuKAlCI7CiAgICAgICAgICB2YXIgcGMgPSBQQVlNRU5UX0NPTE9SU1twc10gfHwgeyBiZzogIiNmMGYwZWUiLCBmZzogIiM1NzUzNGUiIH07CiAgICAgICAgICBleHRyYUNvbCA9ICc8dGQ+PHNwYW4gY2xhc3M9InpwLWR0LXBpbGwiIHN0eWxlPSJiYWNrZ3JvdW5kOicgKyBwYy5iZyArICc7Y29sb3I6JyArIHBjLmZnICsgJyI+JyArIHBzICsgJzwvc3Bhbj48L3RkPic7CiAgICAgICAgfQoKICAgICAgICBodG1sICs9ICc8dHIgb25jbGljaz0id2luZG93LmxvY2F0aW9uLmhyZWY9XCcnICsgcmVjVXJsICsgJ1wnIj4nICsKICAgICAgICAgICc8dGQ+PGEgY2xhc3M9InpwLWR0LW9yZGVyIiBocmVmPSInICsgcmVjVXJsICsgJyIgb25jbGljaz0iZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCkiPicgKyBvcmRlck51bSArICc8L2E+PC90ZD4nICsKICAgICAgICAgICc8dGQ+JyArIGRhdGUgKyAnPC90ZD4nICsKICAgICAgICAgICc8dGQ+JyArIGRlYWxlciArICc8L3RkPicgKwogICAgICAgICAgJzx0ZD4nICsgc3RvcmUgKyAnPC90ZD4nICsKICAgICAgICAgICc8dGQgY2xhc3M9InpwLWR0LWFtb3VudCI+JyArIGFtb3VudCArICc8L3RkPicgKwogICAgICAgICAgZXh0cmFDb2wgKwogICAgICAgICAgJzwvdHI+JzsKICAgICAgfSk7CgogICAgICBodG1sICs9ICc8L3Rib2R5PjwvdGFibGU+JzsKICAgICAgYm9keS5pbm5lckhUTUwgPSBodG1sOwoKICAgIH0pLmNhdGNoKGZ1bmN0aW9uIChlcnIpIHsKICAgICAgYm9keS5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz0ienAtbW9kYWwtZW1wdHkiPkVycm9yIGxvYWRpbmcgb3JkZXJzLiBQbGVhc2UgdHJ5IGFnYWluLjwvZGl2Pic7CiAgICAgIGNvbnNvbGUuZXJyb3IoIlBvcnRhbCBkcmlsbGRvd24gZXJyb3I6IiwgZXJyKTsKICAgIH0pOwogIH0KCiAgZnVuY3Rpb24gY2xvc2VNb2RhbCgpIHsKICAgIGlmIChtb2RhbCkgewogICAgICBtb2RhbC5jbGFzc0xpc3QucmVtb3ZlKCJ6cC1tb2RhbC1vcGVuIik7CiAgICB9CiAgfQoKICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKICAvLyBCVUlMRCBGVU5DVElPTlMKICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKCiAgZnVuY3Rpb24gYnVpbGRLUElzKCkgewogICAgdmFyIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CiAgICBlbC5jbGFzc05hbWUgPSAienAta3BpcyI7CgogICAgdmFyIGl0ZW1zID0gWwogICAgICB7IGtleTogInRvZGF5IiwgbGFiZWw6ICJUb2RheSdzIE9yZGVycyIsIGNvbG9yOiAiIzhiNWNmNiIsIHF1ZXJ5OiAib3JkZXJfZGF0ZSA9IFRPREFZKCkiLCBhcHA6IDMsIHVyZ2VuY3k6IG51bGwsIHZpZXc6ICIlRjAlOUYlOTMlODUlMjBUb2RheSdzJTIwT3JkZXJzIiB9LAogICAgICB7IGtleTogInBlbmRpbmciLCBsYWJlbDogIlBlbmRpbmcgQXBwcm92YWwiLCBjb2xvcjogIiNmNTllMGIiLCBxdWVyeTogJ1N0YXR1cyBpbiAoIlBlbmRpbmcgT05CIEFwcHJvdmFsIiknLCBhcHA6IDMsIHVyZ2VuY3k6IHsgd2FybjogNSwgY3JpdDogMTAgfSwgdmlldzogIiVGMCU5RiU5MyU4QiUyMFBlbmRpbmclMjBNeSUyMEFwcHJvdmFsIiB9LAogICAgICB7IGtleTogInByb2R1Y3RzIiwgbGFiZWw6ICJBY3RpdmUgUHJvZHVjdHMiLCBjb2xvcjogIiNFODc0MEMiLCBxdWVyeTogJ3Byb2R1Y3Rfc3RhdHVzIGluICgiQWN0aXZlIiknLCBhcHA6IDEsIHVyZ2VuY3k6IG51bGwsIHZpZXc6ICIlRjAlOUYlOUYlQTIlMjBBY3RpdmUlMjBQcm9kdWN0cyIgfSwKICAgICAgeyBrZXk6ICJkZWFsZXJzIiwgbGFiZWw6ICJBY3RpdmUgRGVhbGVycyIsIGNvbG9yOiAiIzFhN2ZhOCIsIHF1ZXJ5OiAnU3RhdHVzIGluICgiQWN0aXZlIiknLCBhcHA6IDIsIHVyZ2VuY3k6IG51bGwsIHZpZXc6ICIlRTIlOUMlODUlMjBBY3RpdmUlMjBEZWFsZXJzIiB9CiAgICBdOwoKICAgIGl0ZW1zLmZvckVhY2goZnVuY3Rpb24gKGtwaSkgewogICAgICB2YXIgY2FyZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTsKICAgICAgY2FyZC5jbGFzc05hbWUgPSAienAta3BpIjsKICAgICAgY2FyZC5ocmVmID0gRE9NQUlOICsgIi9rLyIgKyBrcGkuYXBwICsgIi8iICsgKGtwaS52aWV3ID8gIj92aWV3PSIgKyBrcGkudmlldyA6ICIiKTsKICAgICAgY2FyZC5pbm5lckhUTUwgPQogICAgICAgICc8ZGl2IGNsYXNzPSJ6cC1rcGktbGJsIj48c3BhbiBjbGFzcz0ienAta3BpLWRvdCIgc3R5bGU9ImJhY2tncm91bmQ6JyArIGtwaS5jb2xvciArICciPjwvc3Bhbj4gJyArIGtwaS5sYWJlbCArICc8L2Rpdj4nICsKICAgICAgICAnPGRpdiBjbGFzcz0ienAta3BpLXZhbCB6cC1sb2FkaW5nIiBkYXRhLWs9IicgKyBrcGkua2V5ICsgJyI+4oCUPC9kaXY+JzsKICAgICAgZWwuYXBwZW5kQ2hpbGQoY2FyZCk7CgogICAgICBmZXRjaENvdW50KGtwaS5hcHAsIGtwaS5xdWVyeSkudGhlbihmdW5jdGlvbiAobikgewogICAgICAgIHZhciB2ID0gY2FyZC5xdWVyeVNlbGVjdG9yKCJbZGF0YS1rPSciICsga3BpLmtleSArICInXSIpOwogICAgICAgIHYudGV4dENvbnRlbnQgPSBuOyB2LmNsYXNzTGlzdC5yZW1vdmUoInpwLWxvYWRpbmciKTsKICAgICAgICB2LnN0eWxlLmNvbG9yID0ga3BpLmNvbG9yOwogICAgICAgIGlmIChrcGkudXJnZW5jeSAmJiBuID49IGtwaS51cmdlbmN5Lndhcm4pIHsKICAgICAgICAgIHZhciBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgic3BhbiIpOwogICAgICAgICAgYS5jbGFzc05hbWUgPSAienAta3BpLWFsZXJ0IjsKICAgICAgICAgIGEudGV4dENvbnRlbnQgPSBuID49IGtwaS51cmdlbmN5LmNyaXQgPyAiVXJnZW50IiA6ICJBY3Rpb24gbmVlZGVkIjsKICAgICAgICAgIGEuc3R5bGUuYmFja2dyb3VuZCA9IG4gPj0ga3BpLnVyZ2VuY3kuY3JpdCA/ICIjZmVmMmYyIiA6ICIjZmZmYmViIjsKICAgICAgICAgIGEuc3R5bGUuY29sb3IgPSBuID49IGtwaS51cmdlbmN5LmNyaXQgPyAiI2RjMjYyNiIgOiAiI2Q5NzcwNiI7CiAgICAgICAgICB2LmFwcGVuZENoaWxkKGEpOwogICAgICAgIH0KICAgICAgfSkuY2F0Y2goZnVuY3Rpb24gKCkge30pOwogICAgfSk7CiAgICByZXR1cm4gZWw7CiAgfQoKICBmdW5jdGlvbiBidWlsZEFwcHMoKSB7CiAgICB2YXIgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIGVsLmNsYXNzTmFtZSA9ICJ6cC1hcHBzIjsKICAgIE9iamVjdC5rZXlzKEFQUFMpLmZvckVhY2goZnVuY3Rpb24gKGtleSkgewogICAgICB2YXIgYXBwID0gQVBQU1trZXldOwogICAgICB2YXIgY2FyZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTsKICAgICAgY2FyZC5jbGFzc05hbWUgPSAienAtYXBwIjsKICAgICAgY2FyZC5ocmVmID0gRE9NQUlOICsgIi9rLyIgKyBhcHAuaWQgKyAiLyI7CiAgICAgIGNhcmQuaW5uZXJIVE1MID0KICAgICAgICAnPGRpdiBjbGFzcz0ienAtYXBwLWljb24iIHN0eWxlPSJiYWNrZ3JvdW5kOicgKyBhcHAuY29sb3IgKyAnMTA7Y29sb3I6JyArIGFwcC5jb2xvciArICciPicgKyBhcHAuaWNvbiArICc8L2Rpdj4nICsKICAgICAgICAnPGRpdiBjbGFzcz0ienAtYXBwLW5hbWUiPicgKyBhcHAubGFiZWwgKyAnPC9kaXY+JyArCiAgICAgICAgJzxkaXYgY2xhc3M9InpwLWFwcC1kZXNjIj4nICsgYXBwLmRlc2MgKyAnPC9kaXY+JyArCiAgICAgICAgJzxkaXYgY2xhc3M9InpwLWFwcC1tZXRhIiBkYXRhLWFjPSInICsgYXBwLmlkICsgJyI+4oCUPC9kaXY+JzsKICAgICAgZWwuYXBwZW5kQ2hpbGQoY2FyZCk7CiAgICAgIGZldGNoQ291bnQoYXBwLmlkLCAiIikudGhlbihmdW5jdGlvbiAobikgeyBjYXJkLnF1ZXJ5U2VsZWN0b3IoIltkYXRhLWFjXSIpLnRleHRDb250ZW50ID0gbiArICIgcmVjb3JkcyI7IH0pOwogICAgfSk7CiAgICByZXR1cm4gZWw7CiAgfQoKICBmdW5jdGlvbiBidWlsZFdvcmtmbG93KCkgewogICAgdmFyIHdyYXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIHdyYXAuY2xhc3NOYW1lID0gInpwLXdmLXdyYXAiOwoKICAgIHZhciBXID0gNzgwLCBIID0gMTg1LCBudyA9IDc2LCBuaCA9IDQwLCBnYXAgPSAxMiwgbWFpblkgPSAzNSwgcmVqWSA9IDEzMCwgc3RhcnRYID0gMTI7CiAgICB2YXIgcG9zID0ge307CiAgICBXT1JLRkxPV19NQUlOLmZvckVhY2goZnVuY3Rpb24gKG4sIGkpIHsgcG9zW24uaWRdID0geyB4OiBzdGFydFggKyBpICogKG53ICsgZ2FwKSwgeTogbWFpblkgfTsgfSk7CiAgICBwb3MucmVqZWN0ZWQgPSB7IHg6IHBvcy5wZW5kaW5nLngsIHk6IHJlalkgfTsKCiAgICB2YXIgcyA9IFtdOwogICAgcy5wdXNoKCc8c3ZnIGNsYXNzPSJ6cC13Zi1zdmciIHZpZXdCb3g9IjAgMCAnICsgVyArICcgJyArIEggKyAnIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPicpOwogICAgcy5wdXNoKCc8dGV4dCB4PSInICsgVyAvIDIgKyAnIiB5PSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2E4YTI5ZSIgZm9udC1zaXplPSIxMCIgZm9udC1mYW1pbHk9IkRNIFNhbnMsc2Fucy1zZXJpZiIgZm9udC13ZWlnaHQ9IjUwMCIgbGV0dGVyLXNwYWNpbmc9IjAuNSI+Q2xpY2sgYW55IHN0YWdlIHRvIHZpZXcgb3JkZXJzPC90ZXh0PicpOwoKICAgIC8vIEVkZ2VzCiAgICBmb3IgKHZhciBpID0gMDsgaSA8IFdPUktGTE9XX01BSU4ubGVuZ3RoIC0gMTsgaSsrKSB7CiAgICAgIHZhciBhID0gcG9zW1dPUktGTE9XX01BSU5baV0uaWRdLCBiID0gcG9zW1dPUktGTE9XX01BSU5baSArIDFdLmlkXTsKICAgICAgdmFyIHgxID0gYS54ICsgbncgKyAxLCB5MSA9IGEueSArIG5oIC8gMiwgeDIgPSBiLnggLSAxLCB5MiA9IGIueSArIG5oIC8gMjsKICAgICAgcy5wdXNoKCc8bGluZSB4MT0iJyArIHgxICsgJyIgeTE9IicgKyB5MSArICciIHgyPSInICsgKHgyIC0gNCkgKyAnIiB5Mj0iJyArIHkyICsgJyIgY2xhc3M9InpwLXdmLWVkZ2UiLz4nKTsKICAgICAgcy5wdXNoKCc8cG9seWdvbiBwb2ludHM9IicgKyB4MiArICcsJyArIHkyICsgJyAnICsgKHgyIC0gNSkgKyAnLCcgKyAoeTIgLSAzKSArICcgJyArICh4MiAtIDUpICsgJywnICsgKHkyICsgMykgKyAnIiBjbGFzcz0ienAtd2YtZWRnZS1oZWFkIi8+Jyk7CiAgICB9CgogICAgLy8gUmVqZWN0ZWQgZWRnZQogICAgdmFyIHBwID0gcG9zLnBlbmRpbmcsIHJwID0gcG9zLnJlamVjdGVkOwogICAgdmFyIHBjeCA9IHBwLnggKyBudyAvIDI7CiAgICBzLnB1c2goJzxsaW5lIHgxPSInICsgcGN4ICsgJyIgeTE9IicgKyAocHAueSArIG5oKSArICciIHgyPSInICsgcGN4ICsgJyIgeTI9IicgKyAocnAueSAtIDEpICsgJyIgY2xhc3M9InpwLXdmLWVkZ2UgenAtd2YtcmVqLWVkZ2UiLz4nKTsKICAgIHMucHVzaCgnPHBvbHlnb24gcG9pbnRzPSInICsgcGN4ICsgJywnICsgcnAueSArICcgJyArIChwY3ggLSAzKSArICcsJyArIChycC55IC0gNSkgKyAnICcgKyAocGN4ICsgMykgKyAnLCcgKyAocnAueSAtIDUpICsgJyIgZmlsbD0iI2ZjYTVhNSIvPicpOwoKICAgIC8vIFJlc3VibWl0IGN1cnZlCiAgICB2YXIgcnggPSBycC54ICsgbncgKyAyLCByeSA9IHJwLnkgKyBuaCAvIDIsIHB4MiA9IHBwLnggKyBudyArIDIsIHB5MiA9IHBwLnkgKyBuaCAvIDI7CiAgICBzLnB1c2goJzxwYXRoIGQ9Ik0nICsgcnggKyAnLCcgKyByeSArICcgQycgKyAocnggKyAyOCkgKyAnLCcgKyByeSArICcgJyArIChweDIgKyAyOCkgKyAnLCcgKyBweTIgKyAnICcgKyBweDIgKyAnLCcgKyBweTIgKyAnIiBjbGFzcz0ienAtd2YtZWRnZSB6cC13Zi1yZWotZWRnZSIvPicpOwogICAgcy5wdXNoKCc8dGV4dCB4PSInICsgKHJ4ICsgNikgKyAnIiB5PSInICsgKHJ5IC0gMTYpICsgJyIgZmlsbD0iI2ZjYTVhNSIgZm9udC1zaXplPSI5IiBmb250LWZhbWlseT0iRE0gU2FucyxzYW5zLXNlcmlmIiBmb250LXN0eWxlPSJpdGFsaWMiIGZvbnQtd2VpZ2h0PSI1MDAiPlJlc3VibWl0PC90ZXh0PicpOwoKICAgIC8vIE5vZGVzIOKAlCB1c2luZyBkYXRhLXN0YXR1cyBhdHRyaWJ1dGUgZm9yIGNsaWNrIGhhbmRsaW5nIGluc3RlYWQgb2YgPGE+IGxpbmtzCiAgICBBTExfV09SS0ZMT1cuZm9yRWFjaChmdW5jdGlvbiAobm9kZSkgewogICAgICB2YXIgcCA9IHBvc1tub2RlLmlkXSwgY3ggPSBwLnggKyBudyAvIDIsIGN5ID0gcC55ICsgbmggLyAyOwoKICAgICAgcy5wdXNoKCc8ZyBjbGFzcz0ienAtd2Ytbm9kZSIgZGF0YS13Zi1jbGljaz0iJyArIG5vZGUuaWQgKyAnIj4nKTsKICAgICAgcy5wdXNoKCc8cmVjdCBjbGFzcz0id2YtYmciIHg9IicgKyBwLnggKyAnIiB5PSInICsgcC55ICsgJyIgd2lkdGg9IicgKyBudyArICciIGhlaWdodD0iJyArIG5oICsgJyIgcng9IjgiIGZpbGw9IicgKyBub2RlLmNvbG9yICsgJyIgc3R5bGU9InRyYW5zaXRpb246ZmlsdGVyIDAuMTVzIi8+Jyk7CgogICAgICBpZiAobm9kZS5zdWIpIHsKICAgICAgICBzLnB1c2goJzx0ZXh0IHg9IicgKyBjeCArICciIHk9IicgKyAoY3kgLSA0KSArICciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIiBmaWxsPSIjZmZmIiBmb250LXNpemU9IjEwIiBmb250LXdlaWdodD0iNjAwIiBmb250LWZhbWlseT0iRE0gU2FucyxzYW5zLXNlcmlmIj4nICsgbm9kZS5sYWJlbCArICc8L3RleHQ+Jyk7CiAgICAgICAgcy5wdXNoKCc8dGV4dCB4PSInICsgY3ggKyAnIiB5PSInICsgKGN5ICsgNykgKyAnIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0iY2VudHJhbCIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjc1KSIgZm9udC1zaXplPSI4LjUiIGZvbnQtd2VpZ2h0PSI1MDAiIGZvbnQtZmFtaWx5PSJETSBTYW5zLHNhbnMtc2VyaWYiPicgKyBub2RlLnN1YiArICc8L3RleHQ+Jyk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgcy5wdXNoKCc8dGV4dCB4PSInICsgY3ggKyAnIiB5PSInICsgY3kgKyAnIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0iY2VudHJhbCIgZmlsbD0iI2ZmZiIgZm9udC1zaXplPSIxMCIgZm9udC13ZWlnaHQ9IjYwMCIgZm9udC1mYW1pbHk9IkRNIFNhbnMsc2Fucy1zZXJpZiI+JyArIG5vZGUubGFiZWwgKyAnPC90ZXh0PicpOwogICAgICB9CgogICAgICBzLnB1c2goJzx0ZXh0IHg9IicgKyBjeCArICciIHk9IicgKyAocC55ICsgbmggKyAxMykgKyAnIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSInICsgbm9kZS5jb2xvciArICciIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSI3MDAiIGZvbnQtZmFtaWx5PSJETSBTYW5zLHNhbnMtc2VyaWYiIGRhdGEtd3M9IicgKyBub2RlLnN0YXR1cyArICciPjwvdGV4dD4nKTsKICAgICAgcy5wdXNoKCc8L2c+Jyk7CiAgICB9KTsKCiAgICBzLnB1c2goJzwvc3ZnPicpOwogICAgd3JhcC5pbm5lckhUTUwgPSBzLmpvaW4oIiIpOwoKICAgIC8vIEF0dGFjaCBjbGljayBoYW5kbGVycyB0byBTVkcgbm9kZXMKICAgIEFMTF9XT1JLRkxPVy5mb3JFYWNoKGZ1bmN0aW9uIChub2RlKSB7CiAgICAgIHZhciBnID0gd3JhcC5xdWVyeVNlbGVjdG9yKCdbZGF0YS13Zi1jbGljaz0iJyArIG5vZGUuaWQgKyAnIl0nKTsKICAgICAgaWYgKGcpIHsKICAgICAgICBnLmFkZEV2ZW50TGlzdGVuZXIoImNsaWNrIiwgZnVuY3Rpb24gKGUpIHsKICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTsKICAgICAgICAgIG9wZW5Nb2RhbChub2RlKTsKICAgICAgICB9KTsKICAgICAgfQogICAgfSk7CgogICAgLy8gTG9hZCBjb3VudHMKICAgIEFMTF9XT1JLRkxPVy5mb3JFYWNoKGZ1bmN0aW9uIChub2RlKSB7CiAgICAgIGZldGNoQ291bnQoMywgJ1N0YXR1cyBpbiAoIicgKyBub2RlLnN0YXR1cyArICciKScpLnRoZW4oZnVuY3Rpb24gKG4pIHsKICAgICAgICB2YXIgZWwgPSB3cmFwLnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLXdzPSInICsgbm9kZS5zdGF0dXMgKyAnIl0nKTsKICAgICAgICBpZiAoZWwgJiYgbiA+IDApIGVsLnRleHRDb250ZW50ID0gbjsKICAgICAgfSk7CiAgICB9KTsKCiAgICByZXR1cm4gd3JhcDsKICB9CgogIGZ1bmN0aW9uIGJ1aWxkQW5ub3VuY2VtZW50cygpIHsKICAgIHZhciBjb250YWluZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIGNvbnRhaW5lci5jbGFzc05hbWUgPSAienAtYW5uIjsKICAgIGZldGNoUmVjb3Jkcyg0LCAnaXNfYWN0aXZlIGluICgiWWVzIikgb3JkZXIgYnkgaXNfcGlubmVkIGRlc2MsIHByaW9yaXR5IGFzYyBsaW1pdCA1JywKICAgICAgWyJ0aXRsZSIsICJjYXRlZ29yeSIsICJpc19waW5uZWQiLCAicHVibGlzaF9kYXRlIiwgIlJlY29yZF9udW1iZXIiXQogICAgKS50aGVuKGZ1bmN0aW9uIChyZWNvcmRzKSB7CiAgICAgIHJlY29yZHMuZm9yRWFjaChmdW5jdGlvbiAocikgewogICAgICAgIHZhciBjYXQgPSByLmNhdGVnb3J5LnZhbHVlIHx8ICJHZW5lcmFsIjsKICAgICAgICB2YXIgY2MgPSBDQVRfQ09MT1JTW2NhdF0gfHwgQ0FUX0NPTE9SUy5HZW5lcmFsOwogICAgICAgIHZhciBwaW5uZWQgPSByLmlzX3Bpbm5lZC52YWx1ZSA9PT0gIlllcyI7CiAgICAgICAgdmFyIGl0ZW0gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJhIik7CiAgICAgICAgaXRlbS5jbGFzc05hbWUgPSAienAtYW5uLWl0ZW0iOwogICAgICAgIGl0ZW0uaHJlZiA9IERPTUFJTiArICIvay80L3Nob3cjcmVjb3JkPSIgKyByLlJlY29yZF9udW1iZXIudmFsdWU7CiAgICAgICAgaXRlbS5pbm5lckhUTUwgPQogICAgICAgICAgKHBpbm5lZCA/ICc8c3BhbiBjbGFzcz0ienAtYW5uLXBpbiI+8J+TjDwvc3Bhbj4nIDogJycpICsKICAgICAgICAgICc8c3BhbiBjbGFzcz0ienAtYW5uLWJhZGdlIiBzdHlsZT0iYmFja2dyb3VuZDonICsgY2MuYmcgKyAnO2NvbG9yOicgKyBjYy5mZyArICciPicgKyBjYXQgKyAnPC9zcGFuPicgKwogICAgICAgICAgJzxzcGFuIGNsYXNzPSJ6cC1hbm4tdGl0bGUiPicgKyByLnRpdGxlLnZhbHVlICsgJzwvc3Bhbj4nICsKICAgICAgICAgICc8c3BhbiBjbGFzcz0ienAtYW5uLWRhdGUiPicgKyBmbXREYXRlKHIucHVibGlzaF9kYXRlLnZhbHVlKSArICc8L3NwYW4+JzsKICAgICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQoaXRlbSk7CiAgICAgIH0pOwogICAgICB2YXIgbW9yZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImEiKTsKICAgICAgbW9yZS5jbGFzc05hbWUgPSAienAtYW5uLW1vcmUiOwogICAgICBtb3JlLmhyZWYgPSBET01BSU4gKyAiL2svNC8iOwogICAgICBtb3JlLnRleHRDb250ZW50ID0gIlZpZXcgYWxsIGFubm91bmNlbWVudHMg4oaSIjsKICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKG1vcmUpOwogICAgfSkuY2F0Y2goZnVuY3Rpb24gKCkge30pOwogICAgcmV0dXJuIGNvbnRhaW5lcjsKICB9CgogIGZ1bmN0aW9uIGJ1aWxkUXVpY2tBY3Rpb25zKCkgewogICAgdmFyIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CiAgICBlbC5jbGFzc05hbWUgPSAienAtcWEiOwogICAgdmFyIGFjdGlvbnMgPSBbCiAgICAgIHsgaWNvbjogIvCfk4siLCBiZzogIiNmZWYzYzciLCB0ZXh0OiAiUGVuZGluZyBNeSBBcHByb3ZhbCIsIHN1YjogIkF3YWl0aW5nIHlvdXIgYWN0aW9uIiwgaHJlZjogIi9rLzMvP3ZpZXc9JUYwJTlGJTkzJThCJTIwUGVuZGluZyUyME15JTIwQXBwcm92YWwiIH0sCiAgICAgIHsgaWNvbjogIvCfkrMiLCBiZzogIiNmY2U3ZjMiLCB0ZXh0OiAiVW5wYWlkIE9yZGVycyIsIHN1YjogIlBheW1lbnQgZm9sbG93LXVwcyIsIGhyZWY6ICIvay8zLz92aWV3PSVGMCU5RiU5MiVCMyUyMFVucGFpZCUyME9yZGVycyIgfSwKICAgICAgeyBpY29uOiAi8J+TpiIsIGJnOiAiI2RiZWFmZSIsIHRleHQ6ICJXYXJlaG91c2UgUGlwZWxpbmUiLCBzdWI6ICJQaWNraW5nIOKGkiBSZWFkeSDihpIgRG9uZSIsIGhyZWY6ICIvay8zLz92aWV3PSVGMCU5RiU5MyVBNiUyMFdhcmVob3VzZSUyMFBpcGVsaW5lIiB9LAogICAgICB7IGljb246ICLwn5+iIiwgYmc6ICIjZDFmYWU1IiwgdGV4dDogIkFjdGl2ZSBQcm9kdWN0cyIsIHN1YjogIkZ1bGwgY2F0YWxvZyIsIGhyZWY6ICIvay8xLz92aWV3PSVGMCU5RiU5RiVBMiUyMEFjdGl2ZSUyMFByb2R1Y3RzIiB9LAogICAgICB7IGljb246ICLimqDvuI8iLCBiZzogIiNmZWY5YzMiLCB0ZXh0OiAiTG93IFN0b2NrIEl0ZW1zIiwgc3ViOiAi4omkIDUwIHVuaXRzIGxlZnQiLCBocmVmOiAiL2svMS8/dmlldz0lRTIlOUElQTAlRUYlQjglOEYlMjBMb3clMjBTdG9jayUyMCglRTIlODklQTQ1MCkiIH0sCiAgICAgIHsgaWNvbjogIvCfkrAiLCBiZzogIiNmZWUyZTIiLCB0ZXh0OiAiT3V0c3RhbmRpbmcgQmFsYW5jZXMiLCBzdWI6ICJEZWFsZXJzIHdpdGggYmFsYW5jZXMiLCBocmVmOiAiL2svMi8/dmlldz0lRTIlOUElQTAlRUYlQjglOEYlMjBPdXRzdGFuZGluZyUyMEJhbGFuY2VzIiB9LAogICAgICB7IGljb246ICLwn5OFIiwgYmc6ICIjZDFmYWU1IiwgdGV4dDogIkhvbGlkYXkgQ2FsZW5kYXIiLCBzdWI6ICIyMDI2IFBIIGhvbGlkYXlzIiwgaHJlZjogIi9rLzUvP3ZpZXc9JUYwJTlGJTkzJTg1JTIwQWxsJTIwSG9saWRheXMiIH0sCiAgICAgIHsgaWNvbjogIvCfk5YiLCBiZzogIiNlZGU5ZmUiLCB0ZXh0OiAiRGVhbGVyIFVzZXIgR3VpZGUiLCBzdWI6ICJPcmRlcmluZyBtYW51YWwiLCBocmVmOiAiL2svNC8/dmlldz0lRjAlOUYlOTMlOTYlMjBHdWlkZXMiIH0KICAgIF07CiAgICBhY3Rpb25zLmZvckVhY2goZnVuY3Rpb24gKGEpIHsKICAgICAgdmFyIGNhcmQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJhIik7CiAgICAgIGNhcmQuY2xhc3NOYW1lID0gInpwLXFhLWl0ZW0iOwogICAgICBjYXJkLmhyZWYgPSBET01BSU4gKyBhLmhyZWY7CiAgICAgIGNhcmQuaW5uZXJIVE1MID0KICAgICAgICAnPGRpdiBjbGFzcz0ienAtcWEtaWNvbiIgc3R5bGU9ImJhY2tncm91bmQ6JyArIGEuYmcgKyAnIj4nICsgYS5pY29uICsgJzwvZGl2PicgKwogICAgICAgICc8ZGl2PjxkaXYgY2xhc3M9InpwLXFhLXRleHQiPicgKyBhLnRleHQgKyAnPC9kaXY+PGRpdiBjbGFzcz0ienAtcWEtc3ViIj4nICsgYS5zdWIgKyAnPC9kaXY+PC9kaXY+JzsKICAgICAgZWwuYXBwZW5kQ2hpbGQoY2FyZCk7CiAgICB9KTsKICAgIHJldHVybiBlbDsKICB9CgogIGZ1bmN0aW9uIHNlY3Rpb25IZWFkKHRpdGxlLCBtZXRhKSB7CiAgICB2YXIgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIGVsLmNsYXNzTmFtZSA9ICJ6cC1zaCI7CiAgICBlbC5pbm5lckhUTUwgPSAnPGRpdiBjbGFzcz0ienAtc2gtdGl0bGUiPicgKyB0aXRsZSArICc8L2Rpdj4nICsgKG1ldGEgPyAnPGRpdiBjbGFzcz0ienAtc2gtbWV0YSI+JyArIG1ldGEgKyAnPC9kaXY+JyA6ICcnKTsKICAgIHJldHVybiBlbDsKICB9CgogIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAogIC8vIFJFTkRFUgogIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAogIGtpbnRvbmUuZXZlbnRzLm9uKCJwb3J0YWwuc2hvdyIsIGZ1bmN0aW9uICgpIHsKICAgIHZhciBzcGFjZSA9IGtpbnRvbmUucG9ydGFsLmdldENvbnRlbnRTcGFjZUVsZW1lbnQoKTsKICAgIGlmICghc3BhY2UpIHJldHVybjsKCiAgICB2YXIgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJzdHlsZSIpOwogICAgc3R5bGUudGV4dENvbnRlbnQgPSBDU1M7CiAgICBkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTsKCiAgICB2YXIgcm9vdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgcm9vdC5pZCA9ICJ6YWd1LXBvcnRhbCI7CgogICAgdmFyIHVzZXIgPSBraW50b25lLmdldExvZ2luVXNlcigpOwoKICAgIHZhciBoZHIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIGhkci5jbGFzc05hbWUgPSAienAtaGVhZGVyIjsKICAgIGhkci5pbm5lckhUTUwgPQogICAgICAnPGRpdiBjbGFzcz0ienAtbG9nbyI+WjwvZGl2PicgKwogICAgICAnPGRpdiBjbGFzcz0ienAtaGVhZGVyLXRleHQiPjxoMT5aYWd1IE9yZGVyaW5nIFN5c3RlbTwvaDE+PHA+RGVhbGVyIE9yZGVyIE1hbmFnZW1lbnQgJiBGdWxmaWxsbWVudDwvcD48L2Rpdj4nICsKICAgICAgJzxkaXYgY2xhc3M9InpwLWdyZWV0aW5nIj4nICsgZ3JlZXQoKSArICcsIDxzdHJvbmc+JyArICh1c2VyLm5hbWUgfHwgIlVzZXIiKSArICc8L3N0cm9uZz48L2Rpdj4nOwogICAgcm9vdC5hcHBlbmRDaGlsZChoZHIpOwoKICAgIHJvb3QuYXBwZW5kQ2hpbGQoYnVpbGRLUElzKCkpOwogICAgcm9vdC5hcHBlbmRDaGlsZChzZWN0aW9uSGVhZCgiQXBwbGljYXRpb25zIikpOwogICAgcm9vdC5hcHBlbmRDaGlsZChidWlsZEFwcHMoKSk7CiAgICByb290LmFwcGVuZENoaWxkKHNlY3Rpb25IZWFkKCJPcmRlciBXb3JrZmxvdyIpKTsKICAgIHJvb3QuYXBwZW5kQ2hpbGQoYnVpbGRXb3JrZmxvdygpKTsKICAgIHJvb3QuYXBwZW5kQ2hpbGQoc2VjdGlvbkhlYWQoIkxhdGVzdCBBbm5vdW5jZW1lbnRzIiwgIk5ld3MgJiBVcGRhdGVzIikpOwogICAgcm9vdC5hcHBlbmRDaGlsZChidWlsZEFubm91bmNlbWVudHMoKSk7CiAgICByb290LmFwcGVuZENoaWxkKHNlY3Rpb25IZWFkKCJRdWljayBBY3Rpb25zIikpOwogICAgcm9vdC5hcHBlbmRDaGlsZChidWlsZFF1aWNrQWN0aW9ucygpKTsKCiAgICB2YXIgZnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIGZ0LmNsYXNzTmFtZSA9ICJ6cC1mb290ZXIiOwogICAgZnQuaW5uZXJIVE1MID0KICAgICAgJzxzcGFuPlphZ3UgT3JkZXJpbmcgU3lzdGVtIMK3IFBvd2VyZWQgYnkgS2ludG9uZSDCtyBCdWlsdCBieSBFZGFtYW1lIEluYy48L3NwYW4+JyArCiAgICAgICc8c3Bhbj5VcGRhdGVkICcgKyBmbXRUaW1lKCkgKyAnICZuYnNwOzxidXR0b24gY2xhc3M9InpwLXJlZnJlc2giIG9uY2xpY2s9ImxvY2F0aW9uLnJlbG9hZCgpIj7ihrsgUmVmcmVzaDwvYnV0dG9uPjwvc3Bhbj4nOwogICAgcm9vdC5hcHBlbmRDaGlsZChmdCk7CgogICAgc3BhY2UuYXBwZW5kQ2hpbGQocm9vdCk7CiAgfSk7Cn0pKCk7Cg==");
        return new Response(decoded, {
          status: 200,
          headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", ...CORS_HEADERS }
        });
      }
      if (path === "/health" || path === "/") {
        return jsonResponse({
          status: "ok",
          service: "Zagu Ordering Portal API",
          version: "2.4",
          timestamp: (new Date()).toISOString(),
          endpoints: ["/api/login", "/api/holidays", "/api/{app}/records", "/api/push-notification", "/portal.js"]
        });
      }
      return errorResponse("Not found", 404);
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e), stack: String(e.stack || "no stack") }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }
  }
};
