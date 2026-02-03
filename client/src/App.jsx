import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, Plus, Minus, Trash2, LogOut, Package, ClipboardList,
  Search, ChevronRight, Check, X, Loader2, AlertCircle, Store,
  ArrowLeft, CreditCard, Banknote, Clock, Wifi, WifiOff, Save,
  Building2, Smartphone, Landmark, MapPin, FileText, AlertTriangle,
} from "lucide-react";
import { api, session } from "./api.js";
import "./styles.css";

// ─── Constants (aligned with SAP data) ──────────────────────
const CATEGORY_ICONS = {
  "Beverages": "🥤", "Food Ingredients": "🫧", "Packaging": "🥛",
  "Toppings & Syrups": "🍯", "Equipment & Parts": "⚙️", "Promotional Items": "🎁",
};
const CATEGORY_COLORS = {
  "Beverages": "#D4A017", "Food Ingredients": "#8B5E3C", "Packaging": "#2E86AB",
  "Toppings & Syrups": "#A23B72", "Equipment & Parts": "#555", "Promotional Items": "#16A34A",
};
const STATUS_MAP = {
  "New": { color: "#94A3B8", label: "Draft" },
  "Submitted": { color: "#3B82F6", label: "Submitted" },
  "Pending ONB Approval": { color: "#F59E0B", label: "Pending Approval" },
  "Approved": { color: "#22C55E", label: "Approved" },
  "Posted to SAP": { color: "#8B5CF6", label: "Posted to SAP" },
  "Picking": { color: "#06B6D4", label: "Warehouse Picking" },
  "Ready for Pickup": { color: "#10B981", label: "Ready for Pickup" },
  "Completed": { color: "#059669", label: "Completed" },
  "Rejected": { color: "#DC2626", label: "Rejected" },
};
const FULFILLMENT_MAP = {
  "Pending": "⏳", "Posted to SAP": "📋", "Warehouse Picking": "📦",
  "Ready for Pickup": "✅", "Completed": "🎉",
};
const PAYMENT_OPTIONS = [
  { value: "Credit Card", label: "Credit Card", icon: CreditCard, desc: "Visa, Mastercard" },
  { value: "GCash", label: "GCash", icon: Smartphone, desc: "Pay via GCash" },
  { value: "Maya", label: "Maya", icon: Smartphone, desc: "Pay via Maya" },
  { value: "Bank Transfer", label: "Bank Transfer", icon: Landmark, desc: "Direct bank deposit" },
  { value: "Cash on Pick Up", label: "Cash on Pick Up", icon: Banknote, desc: "Pay when you pick up" },
  { value: "Credit Terms", label: "Credit Terms", icon: Clock, desc: "Bill to account" },
];

const peso = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

// ─── Main App ───────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("login");
  const [dealer, setDealer] = useState(null);
  const [selectedStore, setSelectedStore] = useState(null);
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
  const [selectedPayment, setSelectedPayment] = useState("Cash on Pick Up");
  const [orderNotes, setOrderNotes] = useState("");
  const [viewOrder, setViewOrder] = useState(null);
  const [restoringSession, setRestoringSession] = useState(true);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { api.health().then(() => setIsLive(true)).catch(() => setIsLive(false)); }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProducts();
      setProducts(data.records.map((r) => ({
        id: r.$id.value, code: r.product_code.value, name: r.product_name.value,
        category: r.category.value, price: Number(r.unit_price.value),
        stock: Number(r.stock_qty.value || 0), desc: r.description.value || "",
        itemCategory: r.item_category?.value || "", variant: r.variant_label?.value || "",
        hasVariants: r.has_variants?.value === "Yes",
        img: CATEGORY_ICONS[r.category.value] || "📦",
      })));
      setIsLive(true);
    } catch { showToast("Could not load products", "error"); }
    setLoading(false);
  }, [showToast]);

  const loadOrders = useCallback(async (dealerCode) => {
    try {
      const data = await api.getOrders(`dealer_lookup = "${dealerCode}" order by order_date desc limit 50`);
      return data.records.map((r) => ({
        id: r.$id.value, number: r.order_number?.value || `#${r.$id.value}`,
        date: r.order_date.value, status: r.Status?.value || "New",
        total: Number(r.total_amount.value || 0), payment: r.payment_method.value,
        paymentStatus: r.payment_status?.value || "Pending",
        fulfillment: r.fulfillment_status?.value || "Pending",
        sapOrder: r.sap_sales_order_no?.value || "",
        rejectionReason: r.rejection_reason?.value || "",
        storeName: r.store_name_order?.value || "",
        notes: r.notes.value || "",
        isDraft: r.is_draft?.value === "Yes",
        items: (r.order_items.value || []).map((row) => ({
          code: row.value.product_lookup.value, name: row.value.product_name_display.value,
          qty: Number(row.value.quantity.value), price: Number(row.value.item_unit_price.value),
          total: Number(row.value.line_total.value),
        })),
      }));
    } catch { return []; }
  }, []);

  // ─── Session restoration on mount ───────────────────────────
  useEffect(() => {
    const restoreSession = async () => {
      const saved = session.restore();
      if (!saved || !saved.dealer) {
        setRestoringSession(false);
        return;
      }
      try {
        setDealer(saved.dealer);
        setSelectedStore(saved.selectedStore);
        const savedCart = session.restoreCart();
        if (savedCart.length > 0) setCart(savedCart);
        await loadProducts();
        const o = await loadOrders(saved.dealer.code);
        setOrders(o);
        setScreen("catalog");
        setIsLive(true);
      } catch {
        // Session restore failed — fall back to login
        session.clear();
      }
      setRestoringSession(false);
    };
    restoreSession();
  }, [loadProducts, loadOrders]);

  // ─── Persist cart changes ───────────────────────────────────
  useEffect(() => {
    if (dealer) session.saveCart(cart);
  }, [cart, dealer]);

  const handleLogin = useCallback(async (code, password) => {
    setLoading(true);
    try {
      const { dealer: d } = await api.login(code, password);
      setDealer(d);
      setIsLive(true);
      let store = null;
      if (d.stores.length === 1) { store = d.stores[0]; setSelectedStore(store); }
      else if (d.stores.length === 0) { store = { code: d.code, name: d.name, address: "" }; setSelectedStore(store); }
      // Save session immediately
      session.save(d, store);
      await loadProducts();
      const o = await loadOrders(d.code);
      setOrders(o);
      setScreen(d.stores.length > 1 ? "store-select" : "catalog");
    } catch (err) { showToast(err.message || "Login failed", "error"); }
    setLoading(false);
  }, [loadProducts, loadOrders, showToast]);

  // Cart ops
  const addToCart = (product) => {
    setCart((prev) => {
      const exists = prev.find((i) => i.code === product.code);
      if (exists) return prev.map((i) => (i.code === product.code ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { ...product, qty: 1 }];
    });
    showToast(`${product.name} added`);
  };
  const updateQty = (code, delta) => setCart((p) => p.map((i) => (i.code === code ? { ...i, qty: Math.max(1, i.qty + delta) } : i)));
  const removeFromCart = (code) => setCart((p) => p.filter((i) => i.code !== code));
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  // Submit order (or save draft) — now uses composite endpoint for non-drafts
  const submitOrder = async (isDraft = false) => {
    if (cart.length === 0) return;
    setSubmitting(true);
    const today = new Date().toISOString().split("T")[0];
    const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;
    try {
      const record = {
        order_number: { value: orderNum },
        order_date: { value: today },
        dealer_lookup: { value: dealer.code },
        store_code_order: { value: selectedStore?.code || "" },
        store_name_order: { value: selectedStore?.name || "" },
        is_draft: { value: isDraft ? "Yes" : "No" },
        payment_method: { value: selectedPayment },
        outstanding_balance_snapshot: { value: String(dealer.outstandingBalance || 0) },
        notes: { value: orderNotes },
        order_items: {
          value: cart.map((i) => ({
            value: { product_lookup: { value: i.code }, quantity: { value: String(i.qty) } },
          })),
        },
      };

      // Use composite endpoint — creates record AND advances process management
      const result = await api.submitOrder(record, isDraft);

      if (result.statusError) {
        showToast("Order created but status update pending — staff will process manually", "success");
      } else {
        showToast(isDraft ? "Draft saved!" : "Order submitted for approval!");
      }
    } catch {
      showToast("Failed to submit order", "error");
      setSubmitting(false);
      return;
    }
    const o = await loadOrders(dealer.code);
    setOrders(o);
    setCart([]);
    setOrderNotes("");
    setSubmitting(false);
    setScreen(isDraft ? "catalog" : "confirmation");
  };

  const categories = ["All", ...new Set(products.map((p) => p.category).filter(Boolean))];
  const filtered = products.filter((p) => {
    const matchCat = activeCategory === "All" || p.category === activeCategory;
    const matchSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.code.toLowerCase().includes(searchTerm.toLowerCase());
    return matchCat && matchSearch;
  });
  const logout = () => {
    setDealer(null); setCart([]); setOrders([]); setSelectedStore(null); setScreen("login");
    session.clear();
  };

  // Show loading spinner while restoring session
  if (restoringSession) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <Loader2 size={36} className="spinner" style={{ color: "#D4A017" }} />
            <p style={{ marginTop: 16, color: "#8B7355" }}>Restoring session...</p>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "login") return <LoginScreen onLogin={handleLogin} loading={loading} isLive={isLive} />;
  if (screen === "store-select") return (
    <StoreSelectScreen dealer={dealer} onSelect={(s) => {
      setSelectedStore(s);
      session.save(dealer, s);
      setScreen("catalog");
    }} />
  );

  const hasBalance = dealer?.outstandingBalance > 0;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <img src="./zagu-logo.png" alt="Zagu Shakes" className="header-logo" />
          <div className="logo-subtitle">Dealer Portal</div>
        </div>
        <div className="header-right">
          {isLive && <span className="live-badge"><span className="live-dot" />LIVE</span>}
          <NavBtn icon={<Package size={18} />} label="Catalog" active={screen === "catalog"} onClick={() => { setScreen("catalog"); setViewOrder(null); }} />
          <NavBtn icon={<ClipboardList size={18} />} label="Orders" active={screen === "history"} count={orders.length} onClick={() => { setScreen("history"); setViewOrder(null); }} />
          <button className="icon-btn cart-btn" onClick={() => setCartOpen(true)}>
            <ShoppingCart size={18} />{cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
          <button className="icon-btn" onClick={logout}><LogOut size={16} /></button>
        </div>
      </header>

      {/* Dealer bar */}
      <div className="dealer-bar">
        <div className="dealer-info">
          <Store size={14} />
          <span className="dealer-name">{dealer?.name}</span>
          <span className="dot">•</span><span>{dealer?.code}</span>
          {selectedStore && (<><span className="dot">•</span><MapPin size={12} /><span>{selectedStore.name}</span></>)}
          <span className="dot">•</span><span>{dealer?.region}</span>
        </div>
        {hasBalance && (
          <div className="balance-warn">
            <AlertTriangle size={13} />Outstanding: {peso(dealer.outstandingBalance)}
          </div>
        )}
      </div>

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
          <CheckoutScreen cart={cart} cartTotal={cartTotal} dealer={dealer} store={selectedStore}
            selectedPayment={selectedPayment} setSelectedPayment={setSelectedPayment}
            orderNotes={orderNotes} setOrderNotes={setOrderNotes}
            submitting={submitting} onSubmit={() => submitOrder(false)} onSaveDraft={() => submitOrder(true)}
            onBack={() => setScreen("catalog")} updateQty={updateQty} removeFromCart={removeFromCart} />
        )}

        {screen === "confirmation" && (
          <div className="confirmation">
            <div className="confirm-icon"><Check size={40} color="#fff" /></div>
            <h2>Order Submitted!</h2>
            <p>Your order has been sent to ONB (Order & Billing) for approval.<br />You'll receive a confirmation once processed.</p>
            <div className="confirm-actions">
              <button className="btn-primary" onClick={() => setScreen("catalog")}>Continue Shopping</button>
              <button className="btn-outline" onClick={() => setScreen("history")}>View Orders</button>
            </div>
          </div>
        )}

        {screen === "history" && <OrderHistory orders={orders} viewOrder={viewOrder} setViewOrder={setViewOrder} />}
      </main>

      {cartOpen && <CartDrawer cart={cart} cartTotal={cartTotal} updateQty={updateQty} removeFromCart={removeFromCart} onClose={() => setCartOpen(false)} onCheckout={() => { setCartOpen(false); setScreen("checkout"); }} />}
      {toast && (<div className={`toast toast-${toast.type}`}>{toast.type === "error" ? <AlertCircle size={16} /> : <Check size={16} />}{toast.msg}</div>)}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────
function NavBtn({ icon, label, active, count, onClick }) {
  return (
    <button className={`nav-btn ${active ? "active" : ""}`} onClick={onClick}>
      {icon}{label}{count > 0 && <span className="nav-count">{count}</span>}
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
            <img src="./zagu-logo.png" alt="Zagu Shakes" className="login-logo-img" />
            <p>Dealer Ordering Portal</p>
          </div>
          <div className="login-form">
            <div className="field"><label>Dealer Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter your dealer code" onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <div className="field"><label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" onKeyDown={(e) => e.key === "Enter" && submit()} />
            </div>
            <button className="btn-primary login-btn" onClick={submit} disabled={loading || !code || !password}>
              {loading ? <><Loader2 size={18} className="spinner" /> Signing in...</> : <>Sign In <ChevronRight size={18} /></>}
            </button>
          </div>
          <div className="login-status">
            {isLive ? <><Wifi size={14} color="#22C55E" /> Connected to Kintone</> : <><WifiOff size={14} color="#DC2626" /> Server offline — start the proxy</>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StoreSelectScreen({ dealer, onSelect }) {
  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header" style={{ marginBottom: 24 }}>
            <img src="./zagu-logo.png" alt="Zagu Shakes" className="login-logo-img" />
            <h1>Select Store</h1>
            <p>Choose which store you're ordering for</p>
          </div>
          <div className="store-list">
            {dealer.stores.map((s) => (
              <button key={s.code} className="store-option" onClick={() => onSelect(s)}>
                <Building2 size={20} />
                <div className="store-details">
                  <div className="store-name">{s.name}</div>
                  <div className="store-meta">{s.code}{s.address && ` • ${s.address}`}</div>
                </div>
                <ChevronRight size={18} />
              </button>
            ))}
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
        <div className="product-code">{product.code}{product.variant && <span className="variant-tag">{product.variant}</span>}</div>
        <div className="product-name">{product.name}</div>
        <div className="product-desc">{product.desc}</div>
        <div className="product-footer">
          <div>
            <div className="product-price">{peso(product.price)}</div>
            <div className={`product-stock ${product.stock > 50 ? "high" : product.stock > 0 ? "low" : "out"}`}>
              {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
            </div>
          </div>
          <button className="add-btn" onClick={(e) => { e.stopPropagation(); onAdd(); }} disabled={product.stock === 0}><Plus size={20} /></button>
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
          <div className="drawer-title"><ShoppingCart size={20} /><span>Your Cart</span><span className="drawer-count">{cart.length}</span></div>
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
            <div className="drawer-subtotal"><span>Subtotal ({cart.reduce((s, i) => s + i.qty, 0)} items)</span><span className="drawer-total-amount">{peso(cartTotal)}</span></div>
            <button className="btn-primary checkout-btn" onClick={onCheckout}>Proceed to Checkout <ChevronRight size={18} /></button>
          </div>
        )}
      </div>
    </>
  );
}

function CheckoutScreen({ cart, cartTotal, dealer, store, selectedPayment, setSelectedPayment, orderNotes, setOrderNotes, submitting, onSubmit, onSaveDraft, onBack, updateQty, removeFromCart }) {
  const creditTermsAvail = dealer?.creditTerms !== "None";
  const availablePayments = PAYMENT_OPTIONS.filter((p) => p.value !== "Credit Terms" || creditTermsAvail);

  return (
    <div className="checkout">
      <button className="back-btn" onClick={onBack}><ArrowLeft size={18} /> Back to Catalog</button>
      <h2 className="section-title">Checkout</h2>
      <div className="checkout-grid">
        <div className="checkout-left">
          <div className="card">
            <div className="card-header">Order Items ({cart.length})</div>
            {cart.map((item, i) => (
              <div key={item.code} className="checkout-item" style={{ borderBottom: i < cart.length - 1 ? "1px solid #F8F0DD" : "none" }}>
                <span className="item-emoji">{item.img}</span>
                <div className="item-info"><div className="item-name">{item.name}</div><div className="item-meta">{item.code} • {peso(item.price)}</div></div>
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
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">Payment Method</div>
            <div className="payment-options">
              {availablePayments.map((pm) => {
                const Icon = pm.icon;
                return (
                  <label key={pm.value} className={`payment-option ${selectedPayment === pm.value ? "selected" : ""}`} onClick={() => setSelectedPayment(pm.value)}>
                    <div className={`payment-icon ${selectedPayment === pm.value ? "active" : ""}`}><Icon size={18} /></div>
                    <div><div className="payment-label">{pm.label}</div><div className="payment-desc">{pm.desc}</div></div>
                    {selectedPayment === pm.value && <Check size={18} className="payment-check" />}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">Order Notes (Optional)</div>
            <textarea className="notes-input" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="Special instructions, delivery preferences..." rows={3} />
          </div>
        </div>
        <div className="checkout-right">
          <div className="card summary-card">
            <div className="summary-title">Order Summary</div>
            <div className="summary-dealer">
              <div className="summary-dealer-name">{dealer?.name}</div>
              <div className="summary-dealer-meta">{dealer?.code} • {dealer?.region}</div>
              {store && <div className="summary-dealer-meta"><MapPin size={11} /> {store.name}</div>}
            </div>
            {dealer?.outstandingBalance > 0 && (
              <div className="summary-balance-warn">
                <AlertTriangle size={14} />
                <div><div className="balance-label">Outstanding Balance</div><div className="balance-amount">{peso(dealer.outstandingBalance)}</div></div>
              </div>
            )}
            <div className="summary-items">
              {cart.map((i) => (<div key={i.code} className="summary-line"><span>{i.name} × {i.qty}</span><span>{peso(i.price * i.qty)}</span></div>))}
            </div>
            <div className="summary-total-row"><span>Total</span><span className="summary-total">{peso(cartTotal)}</span></div>
            <button className="btn-primary submit-btn" onClick={onSubmit} disabled={submitting || cart.length === 0}>
              {submitting ? <><Loader2 size={18} className="spinner" /> Submitting...</> : <>Submit Order <ChevronRight size={18} /></>}
            </button>
            <button className="btn-outline draft-btn" onClick={onSaveDraft} disabled={submitting}>
              <Save size={16} /> Save as Draft
            </button>
            <p className="submit-note">Order will be sent to ONB for approval</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderHistory({ orders, viewOrder, setViewOrder }) {
  if (viewOrder) {
    const st = STATUS_MAP[viewOrder.status] || { color: "#888", label: viewOrder.status };
    return (
      <div className="order-detail">
        <button className="back-btn" onClick={() => setViewOrder(null)}><ArrowLeft size={18} /> Back to Orders</button>
        <div className="card">
          <div className="order-detail-header">
            <div>
              <h3>{viewOrder.number}</h3>
              <span className="order-meta">{viewOrder.date} • {viewOrder.payment}{viewOrder.storeName && ` • ${viewOrder.storeName}`}</span>
            </div>
            <span className="status-badge" style={{ background: st.color }}>{st.label}</span>
          </div>
          {viewOrder.isDraft && (
            <div className="draft-banner"><FileText size={14} /> This is a draft order — submit when ready.</div>
          )}
          {viewOrder.rejectionReason && (
            <div className="rejection-banner"><AlertCircle size={14} /> <strong>Rejected:</strong> {viewOrder.rejectionReason}</div>
          )}
          {viewOrder.sapOrder && (
            <div className="sap-ref">SAP Sales Order: <strong>{viewOrder.sapOrder}</strong></div>
          )}
          {viewOrder.fulfillment && viewOrder.fulfillment !== "Pending" && (
            <div className="fulfillment-bar">
              {FULFILLMENT_MAP[viewOrder.fulfillment] || "📋"} Fulfillment: <strong>{viewOrder.fulfillment}</strong>
            </div>
          )}
          {viewOrder.items.map((item, i) => (
            <div key={i} className="order-detail-item" style={{ borderBottom: i < viewOrder.items.length - 1 ? "1px solid #F8F0DD" : "none" }}>
              <div><div className="item-name">{item.name}</div><div className="item-meta">{item.code} • {peso(item.price)} × {item.qty}</div></div>
              <div className="item-total">{peso(item.total)}</div>
            </div>
          ))}
          <div className="order-detail-total"><span>Total</span><span className="total-amount">{peso(viewOrder.total)}</span></div>
          {viewOrder.notes && <div className="order-notes"><strong>Notes:</strong> {viewOrder.notes}</div>}
        </div>
      </div>
    );
  }

  const drafts = orders.filter((o) => o.isDraft);
  const submitted = orders.filter((o) => !o.isDraft);

  return (
    <div>
      <h2 className="section-title">Order History</h2>
      {orders.length === 0 ? (
        <div className="card empty-orders"><ClipboardList size={48} strokeWidth={1} /><p>No orders yet</p></div>
      ) : (
        <>
          {drafts.length > 0 && (
            <div className="orders-section">
              <div className="orders-section-title"><FileText size={16} /> Drafts ({drafts.length})</div>
              <div className="orders-list">
                {drafts.map((order) => <OrderRow key={order.id} order={order} onClick={() => setViewOrder(order)} />)}
              </div>
            </div>
          )}
          <div className="orders-section">
            {drafts.length > 0 && <div className="orders-section-title"><ClipboardList size={16} /> Submitted ({submitted.length})</div>}
            <div className="orders-list">
              {submitted.map((order) => <OrderRow key={order.id} order={order} onClick={() => setViewOrder(order)} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OrderRow({ order, onClick }) {
  const st = STATUS_MAP[order.status] || { color: "#888", label: order.status };
  return (
    <div className="order-row" onClick={onClick}>
      <div>
        <div className="order-id">{order.number}{order.isDraft && <span className="draft-tag">DRAFT</span>}</div>
        <div className="order-meta">{order.date} • {order.items.length} item{order.items.length > 1 ? "s" : ""} • {order.payment}{order.storeName && ` • ${order.storeName}`}</div>
      </div>
      <div className="order-row-right">
        <span className="status-badge" style={{ background: st.color }}>{st.label}</span>
        <span className="order-total">{peso(order.total)}</span>
        <ChevronRight size={16} color="#ccc" />
      </div>
    </div>
  );
}
