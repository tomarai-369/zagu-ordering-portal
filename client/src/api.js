const API_BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (code, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ code, password }) }),

  // Products
  getProducts: (query = 'product_status = "Active" order by product_code asc limit 100') =>
    request(`/products/records?query=${encodeURIComponent(query)}`),

  // Dealers
  getDealers: (query = "") =>
    request(`/dealers/records?query=${encodeURIComponent(query)}`),

  // Orders
  getOrders: (query = "") =>
    request(`/orders/records?query=${encodeURIComponent(query)}`),

  createOrder: (record) =>
    request("/orders/record", { method: "POST", body: JSON.stringify({ record }) }),

  // Health
  health: () => request("/health"),
};
