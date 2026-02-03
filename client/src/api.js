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
  login: (code, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ code, password }) }),

  getProducts: (query = 'product_status = "Active" order by product_code asc limit 500') =>
    request(`/products/records?query=${encodeURIComponent(query)}`),

  getOrders: (query = "") =>
    request(`/orders/records?query=${encodeURIComponent(query)}`),

  createOrder: (record) =>
    request("/orders/record", { method: "POST", body: JSON.stringify({ record }) }),

  updateOrder: (id, record) =>
    request("/orders/record", { method: "PUT", body: JSON.stringify({ id, record }) }),

  health: () => request("/health"),
};
