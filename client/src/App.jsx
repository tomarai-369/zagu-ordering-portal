import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, Plus, Minus, Trash2, LogOut, Package, ClipboardList,
  Search, ChevronRight, Check, X, Loader2, AlertCircle, Store,
  ArrowLeft, CreditCard, Banknote, Clock, Wifi, WifiOff,
} from "lucide-react";
import { api } from "./api.js";
import "./styles.css";

// ─── Constants ──────────────────────────────────────────────
const CATEGORY_ICONS = { "Raw Materials": "🫧", "Powder Mixes": "🥤", "Cups & Packaging": "🥛", "Syrups & Toppings": "🍯", "Equipment": "⚙️" };
const CATEGORY_COLORS = { "Raw Materials": "#8B5E3C", "Powder Mixes": "#D4A017", "Cups & Packaging": "#2E86AB", "Syrups & Toppings": "#A23B72", "Equipment": "#555" };
const STATUS_COLORS = { New: "#3B82F6", "Pending Approval": "#F59E0B", Approved: "#22C55E", Rejected: "#DC2626" };

const peso = (n) => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

// ─── Main App ───────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("login");
  const [dealer, setDealer] = useState(null);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [submitting, setSubmitting] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState("Cash");
  const [orderNotes, setOrderNotes] = useState("");
  const [viewOrder, setViewOrder] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Check API health on mount
  useEffect(() => {
    api.health().then(() => setIsLive(true)).catch(() => setIsLive(false));
  }, []);

  // Load products
  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProducts();
      setProducts(
        data.records.map((r) => ({
          id: r.$id.value, code: r.product_code.value, name: r.product_name.value,
          category: r.category.value, price: Number(r.unit_price.value),
          stock: Number(r.stock_qty.value || 0), desc: r.description.value || "",
          img: CATEGORY_ICONS[r.category.value] || "📦",
        }))
      );
      setIsLive(true);
    } catch {
      showToast("Could not load products from Kintone", "error");
    }
    setLoading(false);
  }, [showToast]);

  // Load dealer orders
  const loadOrders = useCallback(async (dealerCode) => {
    try {
      const data = await api.getOrders(`dealer_lookup = "${dealerCode}" order by order_date desc limit 50`);
      return data.records.map((r) => ({
        id: r.$id.value, date: r.order_date.value, status: r.Status?.value || "New",
        total: Number(r.total_amount.value || 0), payment: r.payment_method.value,
        notes: r.notes.value || "",
        items: (r.order_items.value || []).map((row) => ({
          code: row.value.product_lookup.value, name: row.value.product_name_display.value,
          qty: Number(row.value.quantity.value), price: Number(row.value.item_unit_price.value),
          total: Number(row.value.line_total.value),
        })),
      }));
    } catch {
      return [];
    }
  }, []);

  // Login
  const handleLogin = useCallback(async (code, password) => {
    setLoading(true);
    try {
      const { dealer: d } = await api.login(code, password);
      setDealer(d);
      setIsLive(true);
      await loadProducts();
      const o = await loadOrders(d.code);
      setOrders(o);
      setScreen("catalog");
    } catch (err) {
      showToast(err.message || "Login failed", "error");
    }
    setLoading(false);
  }, [loadProducts, loadOrders, showToast]);

  // Cart operations
  const addToCart = (product) => {
    setCart((prev) => {
      const exists = prev.find((i) => i.code === product.code);
      if (exists) return prev.map((i) => (i.code === product.code ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { ...product, qty: 1 }];
    });
    showToast(`${product.name} added to cart`);
  };
  const updateQty = (code, delta) => setCart((prev) => prev.map((i) => (i.code === code ? { ...i, qty: Math.max(1, i.qty + delta) } : i)));
  const removeFromCart = (code) => setCart((prev) => prev.filter((i) => i.code !== code));
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  // Submit order
  const submitOrder = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    const today = new Date().toISOString().split("T")[0];
    try {
      await api.createOrder({
        order_date: { value: today },
        dealer_lookup: { value: dealer.code },
        payment_method: { value: selectedPayment },
        notes: { value: orderNotes },
        order_items: {
          value: cart.map((i) => ({
            value: { product_lookup: { value: i.code }, quantity: { value: String(i.qty) } },
          })),
        },
      });
      showToast("Order submitted successfully!");
    } catch {
      showToast("Failed to submit order", "error");
      setSubmitting(false);
      return;
    }
    // Refresh orders
    const o = await loadOrders(dealer.code);
    setOrders(o);
    setCart([]);
    setOrderNotes("");
    setSubmitting(false);
    setScreen("confirmation");
  };

  // Filters
  const categories = ["All", ...new Set(products.map((p) => p.category))];
  const filtered = products.filter((p) => {
    const matchCat = activeCategory === "All" || p.category === activeCategory;
    const matchSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.code.toLowerCase().includes(searchTerm.toLowerCase());
    return matchCat && matchSearch;
  });

  const logout = () => { setDealer(null); setCart([]); setOrders([]); setScreen("login"); };

  // ─── Screens ──────────────────────────────────────────────
  if (screen === "login") return <LoginScreen onLogin={handleLogin} loading={loading} isLive={isLive} />;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo-mark">Z</div>
          <div>
            <div className="logo-title">Zagu Shakes</div>
            <div className="logo-subtitle">Dealer Ordering Portal</div>
          </div>
        </div>
        <div className="header-right">
          {isLive && <span className="live-badge"><span className="live-dot" />LIVE</span>}
          <NavBtn icon={<Package size={18} />} label="Catalog" active={screen === "catalog"} onClick={() => { setScreen("catalog"); setViewOrder(null); }} />
          <NavBtn icon={<ClipboardList size={18} />} label="Orders" active={screen === "history"} count={orders.length} onClick={() => { setScreen("history"); setViewOrder(null); }} />
          <button className="icon-btn cart-btn" onClick={() => setCartOpen(true)}>
            <ShoppingCart size={18} />
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
          <button className="icon-btn" onClick={logout}><LogOut size={16} /></button>
        </div>
      </header>

      {/* Dealer bar */}
      <div className="dealer-bar">
        <div className="dealer-info">
          <Store size={14} />
          <span className="dealer-name">{dealer?.name}</span>
          <span className="dot">•</span>
          <span>{dealer?.code}</span>
          <span className="dot">•</span>
          <span>{dealer?.region}</span>
        </div>
      </div>

      {/* Content */}
      <main className="main-content">
        {screen === "catalog" && (
          <>
            <div className="catalog-controls">
              <div className="search-wrapper">
                <Search size={18} className="search-icon" />
                <input className="search-input" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search products..." />
              </div>
              <div className="category-filters">
                {categories.map((cat) => (
                  <button key={cat} className={`cat-btn ${activeCategory === cat ? "active" : ""}`} onClick={() => setActiveCategory(cat)}>
                    {cat !== "All" && <span>{CATEGORY_ICONS[cat]}</span>}{cat}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="loading-state"><Loader2 size={32} className="spinner" /><p>Loading products...</p></div>
            ) : (
              <div className="product-grid">
                {filtered.map((p) => (
                  <ProductCard key={p.id} product={p} onAdd={() => addToCart(p)} inCart={cart.find((i) => i.code === p.code)?.qty || 0} />
                ))}
                {filtered.length === 0 && <div className="empty-state">No products found</div>}
              </div>
            )}
          </>
        )}

        {screen === "checkout" && (
          <CheckoutScreen cart={cart} cartTotal={cartTotal} dealer={dealer} selectedPayment={selectedPayment} setSelectedPayment={setSelectedPayment} orderNotes={orderNotes} setOrderNotes={setOrderNotes} submitting={submitting} onSubmit={submitOrder} onBack={() => setScreen("catalog")} updateQty={updateQty} removeFromCart={removeFromCart} />
        )}

        {screen === "confirmation" && (
          <div className="confirmation">
            <div className="confirm-icon"><Check size={40} color="#fff" /></div>
            <h2>Order Submitted!</h2>
            <p>Your order has been sent for approval. You'll receive a notification once it's processed.</p>
            <div className="confirm-actions">
              <button className="btn-primary" onClick={() => setScreen("catalog")}>Continue Shopping</button>
              <button className="btn-outline" onClick={() => setScreen("history")}>View Orders</button>
            </div>
          </div>
        )}

        {screen === "history" && <OrderHistory orders={orders} viewOrder={viewOrder} setViewOrder={setViewOrder} />}
      </main>

      {/* Cart Drawer */}
      {cartOpen && <CartDrawer cart={cart} cartTotal={cartTotal} updateQty={updateQty} removeFromCart={removeFromCart} onClose={() => setCartOpen(false)} onCheckout={() => { setCartOpen(false); setScreen("checkout"); }} />}

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === "error" ? <AlertCircle size={16} /> : <Check size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────

function NavBtn({ icon, label, active, count, onClick }) {
  return (
    <button className={`nav-btn ${active ? "active" : ""}`} onClick={onClick}>
      {icon}{label}
      {count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

function LoginScreen({ onLogin, loading, isLive }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const submit = () => code && password && onLogin(code, password);

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">Z</div>
            <h1>Zagu Shakes</h1>
            <p>Dealer Ordering Portal</p>
          </div>
          <div className="login-form">
            <div className="field">
              <label>Dealer Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. DLR-001" onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <button className="btn-primary login-btn" onClick={submit} disabled={loading || !code || !password}>
              {loading ? <><Loader2 size={18} className="spinner" /> Signing in...</> : <>Sign In <ChevronRight size={18} /></>}
            </button>
          </div>
          <div className="login-status">
            {isLive ? <><Wifi size={14} color="#22C55E" /> Connected to Kintone</> : <><WifiOff size={14} color="#DC2626" /> Server offline — start the proxy</>}
          </div>
          <div className="login-demo">
            <p className="demo-title">Demo Credentials</p>
            <p className="demo-info">Code: <strong>DLR-001</strong> to <strong>DLR-005</strong> &nbsp;|&nbsp; Password: <strong>zagu2026</strong></p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductCard({ product, onAdd, inCart }) {
  const catColor = CATEGORY_COLORS[product.category] || "#888";
  return (
    <div className="product-card">
      <div className="product-image" style={{ background: `linear-gradient(135deg, ${catColor}15, ${catColor}08)` }}>
        <span className="product-emoji">{product.img}</span>
        {inCart > 0 && <div className="in-cart-badge">{inCart} in cart</div>}
        <div className="category-tag" style={{ background: catColor }}>{product.category}</div>
      </div>
      <div className="product-details">
        <div className="product-code">{product.code}</div>
        <div className="product-name">{product.name}</div>
        <div className="product-desc">{product.desc}</div>
        <div className="product-footer">
          <div>
            <div className="product-price">{peso(product.price)}</div>
            <div className={`product-stock ${product.stock > 50 ? "high" : "low"}`}>{product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</div>
          </div>
          <button className="add-btn" onClick={(e) => { e.stopPropagation(); onAdd(); }} disabled={product.stock === 0}>
            <Plus size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CartDrawer({ cart, cartTotal, updateQty, removeFromCart, onClose, onCheckout }) {
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="cart-drawer">
        <div className="drawer-header">
          <div className="drawer-title">
            <ShoppingCart size={20} />
            <span>Your Cart</span>
            <span className="drawer-count">{cart.length}</span>
          </div>
          <button className="close-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="drawer-body">
          {cart.length === 0 ? (
            <div className="drawer-empty"><ShoppingCart size={48} strokeWidth={1} /><p>Your cart is empty</p></div>
          ) : (
            <div className="cart-items">
              {cart.map((item) => (
                <div key={item.code} className="cart-item">
                  <div className="cart-item-icon">{item.img}</div>
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.name}</div>
                    <div className="cart-item-price">{peso(item.price)} each</div>
                    <div className="cart-item-actions">
                      <div className="qty-control">
                        <button onClick={() => updateQty(item.code, -1)}><Minus size={14} /></button>
                        <span>{item.qty}</span>
                        <button onClick={() => updateQty(item.code, 1)}><Plus size={14} /></button>
                      </div>
                      <div className="cart-item-right">
                        <span className="cart-item-total">{peso(item.price * item.qty)}</span>
                        <button className="remove-btn" onClick={() => removeFromCart(item.code)}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {cart.length > 0 && (
          <div className="drawer-footer">
            <div className="drawer-subtotal">
              <span>Subtotal ({cart.reduce((s, i) => s + i.qty, 0)} items)</span>
              <span className="drawer-total-amount">{peso(cartTotal)}</span>
            </div>
            <button className="btn-primary checkout-btn" onClick={onCheckout}>Proceed to Checkout <ChevronRight size={18} /></button>
          </div>
        )}
      </div>
    </>
  );
}

function CheckoutScreen({ cart, cartTotal, dealer, selectedPayment, setSelectedPayment, orderNotes, setOrderNotes, submitting, onSubmit, onBack, updateQty, removeFromCart }) {
  const payments = [
    { value: "Online Payment", label: "Online Payment", icon: <CreditCard size={18} />, desc: "Pay via GCash, Maya, or card" },
    { value: "Cash", label: "Cash on Delivery", icon: <Banknote size={18} />, desc: "Pay upon delivery" },
    { value: "Credit Terms", label: "Credit Terms", icon: <Clock size={18} />, desc: "Bill to account" },
  ];

  return (
    <div className="checkout">
      <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /> Back to Catalog</button>
      <h2 className="section-title">Checkout</h2>
      <div className="checkout-grid">
        <div className="checkout-left">
          {/* Items */}
          <div className="card">
            <div className="card-header">Order Items ({cart.length})</div>
            {cart.map((item, i) => (
              <div key={item.code} className="checkout-item" style={{ borderBottom: i < cart.length - 1 ? "1px solid #F8F0DD" : "none" }}>
                <span className="item-emoji">{item.img}</span>
                <div className="item-info">
                  <div className="item-name">{item.name}</div>
                  <div className="item-meta">{item.code} • {peso(item.price)}</div>
                </div>
                <div className="qty-control small">
                  <button onClick={() => updateQty(item.code, -1)}><Minus size={12} /></button>
                  <span>{item.qty}</span>
                  <button onClick={() => updateQty(item.code, 1)}><Plus size={12} /></button>
                </div>
                <div className="item-total">{peso(item.price * item.qty)}</div>
                <button className="remove-btn-sm" onClick={() => removeFromCart(item.code)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          {/* Payment */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">Payment Method</div>
            <div className="payment-options">
              {payments.map((pm) => (
                <label key={pm.value} className={`payment-option ${selectedPayment === pm.value ? "selected" : ""}`} onClick={() => setSelectedPayment(pm.value)}>
                  <div className={`payment-icon ${selectedPayment === pm.value ? "active" : ""}`}>{pm.icon}</div>
                  <div><div className="payment-label">{pm.label}</div><div className="payment-desc">{pm.desc}</div></div>
                  {selectedPayment === pm.value && <Check size={18} className="payment-check" />}
                </label>
              ))}
            </div>
          </div>
          {/* Notes */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">Order Notes (Optional)</div>
            <textarea className="notes-input" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="Special instructions, delivery preferences..." rows={3} />
          </div>
        </div>
        {/* Summary */}
        <div className="checkout-right">
          <div className="card summary-card">
            <div className="summary-title">Order Summary</div>
            <div className="summary-dealer">
              <div className="summary-dealer-name">{dealer?.name}</div>
              <div className="summary-dealer-meta">{dealer?.code} • {dealer?.region}</div>
            </div>
            <div className="summary-items">
              {cart.map((i) => (
                <div key={i.code} className="summary-line">
                  <span>{i.name} × {i.qty}</span>
                  <span>{peso(i.price * i.qty)}</span>
                </div>
              ))}
            </div>
            <div className="summary-total-row">
              <span>Total</span>
              <span className="summary-total">{peso(cartTotal)}</span>
            </div>
            <button className="btn-primary submit-btn" onClick={onSubmit} disabled={submitting || cart.length === 0}>
              {submitting ? <><Loader2 size={18} className="spinner" /> Submitting...</> : <>Submit Order <ChevronRight size={18} /></>}
            </button>
            <p className="submit-note">Order will be sent for ONB approval</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderHistory({ orders, viewOrder, setViewOrder }) {
  if (viewOrder) {
    return (
      <div className="order-detail">
        <button className="back-btn" onClick={() => setViewOrder(null)}><ArrowLeft size={18} /> Back to Orders</button>
        <div className="card">
          <div className="order-detail-header">
            <div>
              <h3>Order #{viewOrder.id}</h3>
              <span className="order-meta">{viewOrder.date} • {viewOrder.payment}</span>
            </div>
            <span className="status-badge" style={{ background: STATUS_COLORS[viewOrder.status] || "#888" }}>{viewOrder.status}</span>
          </div>
          {viewOrder.items.map((item, i) => (
            <div key={i} className="order-detail-item" style={{ borderBottom: i < viewOrder.items.length - 1 ? "1px solid #F8F0DD" : "none" }}>
              <div><div className="item-name">{item.name}</div><div className="item-meta">{item.code} • {peso(item.price)} × {item.qty}</div></div>
              <div className="item-total">{peso(item.total)}</div>
            </div>
          ))}
          <div className="order-detail-total">
            <span>Total</span>
            <span className="total-amount">{peso(viewOrder.total)}</span>
          </div>
          {viewOrder.notes && <div className="order-notes"><strong>Notes:</strong> {viewOrder.notes}</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-title">Order History</h2>
      {orders.length === 0 ? (
        <div className="card empty-orders"><ClipboardList size={48} strokeWidth={1} /><p>No orders yet</p></div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <div key={order.id} className="order-row" onClick={() => setViewOrder(order)}>
              <div>
                <div className="order-id">Order #{order.id}</div>
                <div className="order-meta">{order.date} • {order.items.length} item{order.items.length > 1 ? "s" : ""} • {order.payment}</div>
              </div>
              <div className="order-row-right">
                <span className="status-badge" style={{ background: STATUS_COLORS[order.status] || "#888" }}>{order.status}</span>
                <span className="order-total">{peso(order.total)}</span>
                <ChevronRight size={16} color="#ccc" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
