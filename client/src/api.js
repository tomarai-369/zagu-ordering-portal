// API layer — connects to Express backend (Kintone proxy)
// Falls back to demo mode only if backend is unreachable

const BACKEND_URLS = [
  import.meta.env.VITE_API_URL,          // explicit env override
  window.__ZAGU_API_URL__,               // runtime config
  window.location.hostname === "localhost" ? "/api" : null,
  "https://zagu-api.tom-arai.workers.dev/api", // Cloudflare Worker (production)
].filter(Boolean);

let API_BASE = null;
let IS_DEMO = false;

// Probe backend on startup
async function resolveBackend() {
  for (const base of BACKEND_URLS) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) { API_BASE = base; IS_DEMO = false; return; }
    } catch {}
  }
  IS_DEMO = true;
  console.warn("[Zagu] No backend reachable — running in demo mode");
}

const backendReady = resolveBackend();

// ─── Session persistence ─────────────────────────────────────
const SESSION_KEY = "zagu_session";
const CART_KEY = "zagu_cart";

export const session = {
  save(dealer, selectedStore) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ dealer, selectedStore, ts: Date.now() }));
    } catch {}
  },
  restore() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Expire sessions after 8 hours
      if (Date.now() - data.ts > 8 * 60 * 60 * 1000) { session.clear(); return null; }
      return data;
    } catch { return null; }
  },
  clear() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(CART_KEY);
    } catch {}
  },
  saveCart(cart) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  },
  restoreCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },
};

// ─── Demo data (fallback only) ──────────────────────────────
const DEMO_PRODUCTS = [
  {$id:{value:"1"},product_code:{value:"ITM-BV-001"},product_name:{value:"Classic Pearl Shake"},category:{value:"Beverages"},unit_price:{value:"85"},stock_qty:{value:"500"},description:{value:"Signature Zagu tapioca pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"Yes"}},
  {$id:{value:"2"},product_code:{value:"ITM-BV-002"},product_name:{value:"Classic Pearl Shake - Large"},category:{value:"Beverages"},unit_price:{value:"110"},stock_qty:{value:"450"},description:{value:"Signature Zagu pearl shake large 22oz"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Large"},has_variants:{value:"Yes"}},
  {$id:{value:"3"},product_code:{value:"ITM-BV-003"},product_name:{value:"Cookies & Cream Shake"},category:{value:"Beverages"},unit_price:{value:"95"},stock_qty:{value:"380"},description:{value:"Cookies and cream flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"4"},product_code:{value:"ITM-BV-004"},product_name:{value:"Mango Graham Shake"},category:{value:"Beverages"},unit_price:{value:"95"},stock_qty:{value:"420"},description:{value:"Mango graham flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"5"},product_code:{value:"ITM-BV-005"},product_name:{value:"Ube Pearl Shake"},category:{value:"Beverages"},unit_price:{value:"95"},stock_qty:{value:"320"},description:{value:"Ube flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"8"},product_code:{value:"ITM-FI-001"},product_name:{value:"Tapioca Pearl Mix - 10kg"},category:{value:"Food Ingredients"},unit_price:{value:"1250"},stock_qty:{value:"200"},description:{value:"Raw tapioca pearl mix"},product_status:{value:"Active"},item_category:{value:"Raw Materials"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"11"},product_code:{value:"ITM-TS-001"},product_name:{value:"Caramel Syrup - 1L"},category:{value:"Toppings & Syrups"},unit_price:{value:"320"},stock_qty:{value:"180"},description:{value:"Caramel flavored syrup"},product_status:{value:"Active"},item_category:{value:"Syrups"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"13"},product_code:{value:"ITM-PK-001"},product_name:{value:"22oz Printed Cups - 100pcs"},category:{value:"Packaging"},unit_price:{value:"550"},stock_qty:{value:"600"},description:{value:"Zagu branded cups"},product_status:{value:"Active"},item_category:{value:"Cups"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"15"},product_code:{value:"ITM-EP-001"},product_name:{value:"Cup Sealer Machine"},category:{value:"Equipment & Parts"},unit_price:{value:"12500"},stock_qty:{value:"15"},description:{value:"Automatic cup sealer"},product_status:{value:"Active"},item_category:{value:"Machines"},variant_label:{value:""},has_variants:{value:"No"}},
];

const DEMO_DEALER = {
  code: "DLR-001", name: "Juan's Zagu Franchise", sapBpCode: "BP-10045",
  contact: "Juan Dela Cruz", email: "juan.dc@zagudealers.ph", region: "NCR",
  outstandingBalance: 12500, creditLimit: 100000, creditTerms: "Net 30", mfaEnabled: "No",
  stores: [
    { code: "STR-001A", name: "SM North EDSA Branch", address: "2F SM North EDSA, QC" },
    { code: "STR-001B", name: "Trinoma Branch", address: "GF Trinoma, QC" },
    { code: "STR-001C", name: "Fairview Terraces", address: "3F Fairview Terraces, QC" },
  ],
};

const DEMO_ORDERS = [
  {$id:{value:"1"},order_number:{value:"ORD-2026-0001"},order_date:{value:"2026-01-15"},Status:{value:"Completed"},total_amount:{value:"9100"},payment_method:{value:"GCash"},payment_status:{value:"Paid"},fulfillment_status:{value:"Completed"},sap_sales_order_no:{value:"SO-2026-04521"},rejection_reason:{value:""},store_name_order:{value:"SM North EDSA Branch"},notes:{value:"Regular weekly order"},is_draft:{value:"No"},dealer_lookup:{value:"DLR-001"},order_items:{value:[{value:{product_lookup:{value:"ITM-BV-001"},product_name_display:{value:"Classic Pearl Shake"},quantity:{value:"50"},item_unit_price:{value:"85"},line_total:{value:"4250"}}},{value:{product_lookup:{value:"ITM-FI-001"},product_name_display:{value:"Tapioca Pearl Mix - 10kg"},quantity:{value:"3"},item_unit_price:{value:"1250"},line_total:{value:"3750"}}}]}},
  {$id:{value:"4"},order_number:{value:"ORD-2026-0004"},order_date:{value:"2026-01-28"},Status:{value:"Pending ONB Approval"},total_amount:{value:"5600"},payment_method:{value:"Credit Card"},payment_status:{value:"Pending"},fulfillment_status:{value:"Pending"},sap_sales_order_no:{value:""},rejection_reason:{value:""},store_name_order:{value:"Trinoma Branch"},notes:{value:"Rush order"},is_draft:{value:"No"},dealer_lookup:{value:"DLR-001"},order_items:{value:[{value:{product_lookup:{value:"ITM-BV-003"},product_name_display:{value:"Cookies & Cream Shake"},quantity:{value:"25"},item_unit_price:{value:"95"},line_total:{value:"2375"}}}]}},
  {$id:{value:"8"},order_number:{value:"ORD-2026-0008"},order_date:{value:"2026-02-03"},Status:{value:"New"},total_amount:{value:"2720"},payment_method:{value:"Maya"},payment_status:{value:"Pending"},fulfillment_status:{value:"Pending"},sap_sales_order_no:{value:""},rejection_reason:{value:""},store_name_order:{value:"Fairview Terraces"},notes:{value:"Draft - still deciding on quantities"},is_draft:{value:"Yes"},dealer_lookup:{value:"DLR-001"},order_items:{value:[{value:{product_lookup:{value:"ITM-TS-001"},product_name_display:{value:"Caramel Syrup - 1L"},quantity:{value:"3"},item_unit_price:{value:"320"},line_total:{value:"960"}}}]}},
];

// ─── API calls ──────────────────────────────────────────────
async function proxyRequest(path, options = {}) {
  await backendReady;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

export const api = {
  login: async (code, password) => {
    await backendReady;
    if (IS_DEMO) {
      if (code) return { dealer: DEMO_DEALER };
      throw new Error("Invalid credentials");
    }
    return proxyRequest("/auth/login", { method: "POST", body: JSON.stringify({ code, password }) });
  },

  getProducts: async (query) => {
    await backendReady;
    if (IS_DEMO) return { records: DEMO_PRODUCTS, totalCount: String(DEMO_PRODUCTS.length) };
    return proxyRequest(`/products/records?query=${encodeURIComponent(query || 'product_status in ("Active") order by product_code asc')}`);
  },

  getOrders: async (query) => {
    await backendReady;
    if (IS_DEMO) return { records: DEMO_ORDERS };
    return proxyRequest(`/orders/records?query=${encodeURIComponent(query || "order by order_date desc")}`);
  },

  // Original create (kept for backward compat, used for drafts)
  createOrder: async (record) => {
    await backendReady;
    if (IS_DEMO) return { id: String(Date.now()), revision: "1" };
    return proxyRequest("/orders/record", { method: "POST", body: JSON.stringify({ record }) });
  },

  // Composite: create + advance process management (for non-draft submissions)
  submitOrder: async (record, isDraft = false) => {
    await backendReady;
    if (IS_DEMO) return { id: String(Date.now()), revision: "1", status: isDraft ? "draft" : "pending_approval" };
    return proxyRequest("/orders/submit-order", {
      method: "POST",
      body: JSON.stringify({ record, isDraft }),
    });
  },

  updateOrder: async (id, record) => {
    await backendReady;
    if (IS_DEMO) return { revision: "1" };
    return proxyRequest("/orders/record", { method: "PUT", body: JSON.stringify({ id, record }) });
  },

  updateOrderStatus: async (id, action, assignee) => {
    await backendReady;
    if (IS_DEMO) return { revision: "1" };
    return proxyRequest("/orders/status", { method: "POST", body: JSON.stringify({ id, action, assignee }) });
  },

  health: async () => {
    await backendReady;
    if (IS_DEMO) return { status: "demo", mode: "no-backend" };
    return proxyRequest("/health");
  },

  changePassword: async (code, currentPassword, newPassword) => {
    await backendReady;
    if (IS_DEMO) return { success: true, newExpiry: "2026-05-03" };
    return proxyRequest("/auth/change-password", {
      method: "PUT",
      body: JSON.stringify({ code, currentPassword, newPassword }),
    });
  },

  register: async (data) => {
    await backendReady;
    if (IS_DEMO) return { success: true, id: "99", message: "Registration submitted (demo mode)." };
    return proxyRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  get isDemo() { return IS_DEMO; },
  get backendUrl() { return API_BASE; },
  getBaseUrl: () => API_BASE,
  ready: backendReady,
};

