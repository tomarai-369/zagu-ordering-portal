// Dual-mode API: uses Express proxy in dev, falls back to sample data on GitHub Pages
const API_BASE = "/api";
const IS_GITHUB_PAGES = window.location.hostname.includes("github.io");

// ─── Sample Data (for GitHub Pages demo) ────────────────────
const SAMPLE_PRODUCTS = [
  {$id:{value:"1"},product_code:{value:"ITM-BV-001"},product_name:{value:"Classic Pearl Shake"},category:{value:"Beverages"},unit_price:{value:"85"},stock_qty:{value:"500"},description:{value:"Signature Zagu tapioca pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"Yes"}},
  {$id:{value:"2"},product_code:{value:"ITM-BV-002"},product_name:{value:"Classic Pearl Shake - Large"},category:{value:"Beverages"},unit_price:{value:"110"},stock_qty:{value:"450"},description:{value:"Signature Zagu pearl shake large 22oz"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Large"},has_variants:{value:"Yes"}},
  {$id:{value:"3"},product_code:{value:"ITM-BV-003"},product_name:{value:"Cookies & Cream Shake"},category:{value:"Beverages"},unit_price:{value:"95"},stock_qty:{value:"380"},description:{value:"Cookies and cream flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"4"},product_code:{value:"ITM-BV-004"},product_name:{value:"Mango Graham Shake"},category:{value:"Beverages"},unit_price:{value:"95"},stock_qty:{value:"420"},description:{value:"Mango graham flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"5"},product_code:{value:"ITM-BV-005"},product_name:{value:"Ube Pearl Shake"},category:{value:"Beverages"},unit_price:{value:"95"},stock_qty:{value:"320"},description:{value:"Ube flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"6"},product_code:{value:"ITM-BV-006"},product_name:{value:"Taro Pearl Shake"},category:{value:"Beverages"},unit_price:{value:"95"},stock_qty:{value:"350"},description:{value:"Taro flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"7"},product_code:{value:"ITM-BV-007"},product_name:{value:"Matcha Pearl Shake"},category:{value:"Beverages"},unit_price:{value:"105"},stock_qty:{value:"280"},description:{value:"Japanese matcha flavored pearl shake"},product_status:{value:"Active"},item_category:{value:"Shakes"},variant_label:{value:"Regular"},has_variants:{value:"No"}},
  {$id:{value:"8"},product_code:{value:"ITM-FI-001"},product_name:{value:"Tapioca Pearl Mix - 10kg"},category:{value:"Food Ingredients"},unit_price:{value:"1250"},stock_qty:{value:"200"},description:{value:"Raw tapioca pearl mix"},product_status:{value:"Active"},item_category:{value:"Raw Materials"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"9"},product_code:{value:"ITM-FI-002"},product_name:{value:"Milk Base Powder - 5kg"},category:{value:"Food Ingredients"},unit_price:{value:"980"},stock_qty:{value:"150"},description:{value:"Powdered milk base for shakes"},product_status:{value:"Active"},item_category:{value:"Raw Materials"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"10"},product_code:{value:"ITM-FI-003"},product_name:{value:"Ube Flavor Powder - 1kg"},category:{value:"Food Ingredients"},unit_price:{value:"450"},stock_qty:{value:"280"},description:{value:"Ube flavoring powder concentrate"},product_status:{value:"Active"},item_category:{value:"Flavoring"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"11"},product_code:{value:"ITM-TS-001"},product_name:{value:"Caramel Syrup - 1L"},category:{value:"Toppings & Syrups"},unit_price:{value:"320"},stock_qty:{value:"180"},description:{value:"Caramel flavored syrup"},product_status:{value:"Active"},item_category:{value:"Syrups"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"12"},product_code:{value:"ITM-TS-002"},product_name:{value:"Chocolate Syrup - 1L"},category:{value:"Toppings & Syrups"},unit_price:{value:"320"},stock_qty:{value:"190"},description:{value:"Rich chocolate syrup"},product_status:{value:"Active"},item_category:{value:"Syrups"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"13"},product_code:{value:"ITM-PK-001"},product_name:{value:"22oz Printed Cups - 100pcs"},category:{value:"Packaging"},unit_price:{value:"550"},stock_qty:{value:"600"},description:{value:"Zagu branded cups"},product_status:{value:"Active"},item_category:{value:"Cups"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"14"},product_code:{value:"ITM-PK-002"},product_name:{value:"Cup Sealer Film - Roll"},category:{value:"Packaging"},unit_price:{value:"380"},stock_qty:{value:"400"},description:{value:"Sealing film for cup sealer"},product_status:{value:"Active"},item_category:{value:"Supplies"},variant_label:{value:""},has_variants:{value:"No"}},
  {$id:{value:"15"},product_code:{value:"ITM-EP-001"},product_name:{value:"Cup Sealer Machine"},category:{value:"Equipment & Parts"},unit_price:{value:"12500"},stock_qty:{value:"15"},description:{value:"Automatic cup sealer"},product_status:{value:"Active"},item_category:{value:"Machines"},variant_label:{value:""},has_variants:{value:"No"}},
];

const SAMPLE_DEALER = {
  dealer_code:{value:"DLR-001"},dealer_name:{value:"Juan's Zagu Franchise"},sap_bp_code:{value:"BP-10045"},
  contact_person:{value:"Juan Dela Cruz"},email:{value:"juan.dc@zagudealers.ph"},region:{value:"NCR"},
  login_password:{value:"Zagu@2026"},outstanding_balance:{value:"12500"},credit_limit:{value:"100000"},
  credit_terms:{value:"Net 30"},mfa_enabled:{value:"No"},password_expiry:{value:"2026-06-01"},
  dealer_stores:{value:[
    {value:{ds_store_code:{value:"STR-001A"},ds_store_name:{value:"SM North EDSA Branch"},ds_store_address:{value:"2F SM North EDSA, QC"}}},
    {value:{ds_store_code:{value:"STR-001B"},ds_store_name:{value:"Trinoma Branch"},ds_store_address:{value:"GF Trinoma, QC"}}},
    {value:{ds_store_code:{value:"STR-001C"},ds_store_name:{value:"Fairview Terraces"},ds_store_address:{value:"3F Fairview Terraces, QC"}}},
  ]},
};

const SAMPLE_ORDERS = [
  {$id:{value:"1"},order_number:{value:"ORD-2026-0001"},order_date:{value:"2026-01-15"},Status:{value:"Completed"},total_amount:{value:"5350"},payment_method:{value:"GCash"},payment_status:{value:"Paid"},fulfillment_status:{value:"Completed"},sap_sales_order_no:{value:"SO-2026-04521"},rejection_reason:{value:""},store_name_order:{value:"SM North EDSA Branch"},notes:{value:"Regular weekly order"},is_draft:{value:"No"},dealer_lookup:{value:"DLR-001"},order_items:{value:[{value:{product_lookup:{value:"ITM-BV-001"},product_name_display:{value:"Classic Pearl Shake"},quantity:{value:"50"},item_unit_price:{value:"85"},line_total:{value:"4250"}}},{value:{product_lookup:{value:"ITM-FI-001"},product_name_display:{value:"Pearl Mix - 10kg"},quantity:{value:"3"},item_unit_price:{value:"1250"},line_total:{value:"3750"}}}]}},
  {$id:{value:"4"},order_number:{value:"ORD-2026-0004"},order_date:{value:"2026-01-28"},Status:{value:"Approved"},total_amount:{value:"3575"},payment_method:{value:"Credit Card"},payment_status:{value:"Paid"},fulfillment_status:{value:"Warehouse Picking"},sap_sales_order_no:{value:"SO-2026-04601"},rejection_reason:{value:""},store_name_order:{value:"Trinoma Branch"},notes:{value:"Rush order"},is_draft:{value:"No"},dealer_lookup:{value:"DLR-001"},order_items:{value:[{value:{product_lookup:{value:"ITM-BV-003"},product_name_display:{value:"Cookies & Cream Shake"},quantity:{value:"25"},item_unit_price:{value:"95"},line_total:{value:"2375"}}},{value:{product_lookup:{value:"ITM-BV-007"},product_name_display:{value:"Matcha Pearl Shake"},quantity:{value:"25"},item_unit_price:{value:"105"},line_total:{value:"2625"}}}]}},
  {$id:{value:"6"},order_number:{value:"ORD-2026-0006"},order_date:{value:"2026-02-01"},Status:{value:"Rejected"},total_amount:{value:"3850"},payment_method:{value:"Cash on Pick Up"},payment_status:{value:"N/A"},fulfillment_status:{value:"Pending"},sap_sales_order_no:{value:""},rejection_reason:{value:"Outstanding balance exceeds credit limit. Please settle balance before placing new orders."},store_name_order:{value:"SM North EDSA Branch"},notes:{value:""},is_draft:{value:"No"},dealer_lookup:{value:"DLR-001"},order_items:{value:[{value:{product_lookup:{value:"ITM-FI-001"},product_name_display:{value:"Tapioca Pearl Mix"},quantity:{value:"2"},item_unit_price:{value:"1250"},line_total:{value:"2500"}}},{value:{product_lookup:{value:"ITM-FI-003"},product_name_display:{value:"Ube Flavor Powder"},quantity:{value:"3"},item_unit_price:{value:"450"},line_total:{value:"1350"}}}]}},
  {$id:{value:"8"},order_number:{value:"ORD-2026-0008"},order_date:{value:"2026-02-03"},Status:{value:"New"},total_amount:{value:"2240"},payment_method:{value:"Maya"},payment_status:{value:"Pending"},fulfillment_status:{value:"Pending"},sap_sales_order_no:{value:""},rejection_reason:{value:""},store_name_order:{value:"Fairview Terraces"},notes:{value:"Draft - still deciding on quantities"},is_draft:{value:"Yes"},dealer_lookup:{value:"DLR-001"},order_items:{value:[{value:{product_lookup:{value:"ITM-TS-001"},product_name_display:{value:"Caramel Syrup - 1L"},quantity:{value:"3"},item_unit_price:{value:"320"},line_total:{value:"960"}}},{value:{product_lookup:{value:"ITM-TS-002"},product_name_display:{value:"Chocolate Syrup - 1L"},quantity:{value:"2"},item_unit_price:{value:"320"},line_total:{value:"640"}}}]}},
];

async function proxyRequest(path, options = {}) {
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
    if (IS_GITHUB_PAGES) {
      // Demo mode: accept DLR-001/Zagu@2026 or any credentials
      if (code === "DLR-001" || code) {
        return { dealer: {
          code: "DLR-001", name: "Juan's Zagu Franchise", sapBpCode: "BP-10045",
          contact: "Juan Dela Cruz", email: "juan.dc@zagudealers.ph", region: "NCR",
          outstandingBalance: 12500, creditLimit: 100000, creditTerms: "Net 30", mfaEnabled: "No",
          stores: [
            { code: "STR-001A", name: "SM North EDSA Branch", address: "2F SM North EDSA, QC" },
            { code: "STR-001B", name: "Trinoma Branch", address: "GF Trinoma, QC" },
            { code: "STR-001C", name: "Fairview Terraces", address: "3F Fairview Terraces, QC" },
          ],
        }};
      }
      throw new Error("Invalid credentials");
    }
    return proxyRequest("/auth/login", { method: "POST", body: JSON.stringify({ code, password }) });
  },

  getProducts: async (query) => {
    if (IS_GITHUB_PAGES) return { records: SAMPLE_PRODUCTS, totalCount: String(SAMPLE_PRODUCTS.length) };
    return proxyRequest(`/products/records?query=${encodeURIComponent(query || "")}`);
  },

  getOrders: async (query) => {
    if (IS_GITHUB_PAGES) return { records: SAMPLE_ORDERS };
    return proxyRequest(`/orders/records?query=${encodeURIComponent(query || "")}`);
  },

  createOrder: async (record) => {
    if (IS_GITHUB_PAGES) return { id: String(Date.now()), revision: "1" };
    return proxyRequest("/orders/record", { method: "POST", body: JSON.stringify({ record }) });
  },

  updateOrder: async (id, record) => {
    if (IS_GITHUB_PAGES) return { revision: "1" };
    return proxyRequest("/orders/record", { method: "PUT", body: JSON.stringify({ id, record }) });
  },

  health: async () => {
    if (IS_GITHUB_PAGES) return { status: "demo", mode: "github-pages" };
    return proxyRequest("/health");
  },

  isDemo: IS_GITHUB_PAGES,
};
