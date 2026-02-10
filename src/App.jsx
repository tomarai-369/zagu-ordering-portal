import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, Plus, Minus, Trash2, LogOut, Package, ClipboardList,
  Search, ChevronRight, Check, X, Loader2, AlertCircle, Store,
  ArrowLeft, CreditCard, Banknote, Clock, Wifi, WifiOff, Save,
  Building2, Smartphone, Landmark, MapPin, FileText, AlertTriangle,
  BarChart3, User, Download, RefreshCw, ShieldAlert, Megaphone,
  ChevronDown, Bell, Tag, Info, Sparkles, BookOpen, CalendarDays,
} from "lucide-react";
import { api, session, initFirebaseMessaging } from "./api.js";
import { generateOrderPDF } from "./OrderPDF.js";
import Dashboard from "./Dashboard.jsx";
import DealerProfile from "./DealerProfile.jsx";
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

const NEWS_ICONS = { General: Info, Promo: Tag, "Product Update": Sparkles, Policy: FileText, Maintenance: AlertTriangle };
const NEWS_COLORS = { General: "#3B82F6", Promo: "#F59E0B", "Product Update": "#8B5CF6", Policy: "#059669", Maintenance: "#DC2626" };
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
  const [news, setNews] = useState([]);
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [storeSwitcherOpen, setStoreSwitcherOpen] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [loginError, setLoginError] = useState("");

  const showToast = useCallback((msg, type = "success", duration = 3000) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => { api.health().then(() => setIsLive(true)).catch(() => setIsLive(false)); }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProducts();
      setProducts(data.records.map((r) => {
        const imgFile = r.product_image?.value?.[0];
        return {
          id: r.$id.value, code: r.product_code.value, name: r.product_name.value,
          category: r.category.value, price: Number(r.unit_price.value),
          stock: Number(r.stock_qty.value || 0), desc: r.description.value || "",
          itemCategory: r.item_category?.value || "", variant: r.variant_label?.value || "",
          hasVariants: r.has_variants?.value === "Yes",
          img: CATEGORY_ICONS[r.category.value] || "📦",
          imageUrl: imgFile ? `${api.getBaseUrl()}/file?fileKey=${encodeURIComponent(imgFile.fileKey)}` : null,
        };
      }));
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

  const loadNews = useCallback(async () => {
    try {
      const data = await api.getNews();
      return (data.records || []).map((r) => ({
        id: r.$id.value, title: r.title.value, content: r.content.value,
        category: r.category.value, date: r.publish_date.value,
        pinned: r.is_pinned?.value === "Yes",
      }));
    } catch { return []; }
  }, []);

  // ─── Holiday / Business Day utilities ─────────────────────
  const loadHolidays = useCallback(async () => {
    try {
      const d = await api.getHolidays();
      setHolidays((d.holidays || []).map((h) => h.date));
    } catch {}
  }, []);

  const isBusinessDay = useCallback((date) => {
    const day = date.getDay();
    if (day === 0) return false;
    const dateStr = date.toISOString().split("T")[0];
    return !holidays.includes(dateStr);
  }, [holidays]);

  const addBusinessDays = useCallback((startDate, numDays) => {
    let d = new Date(startDate);
    let added = 0;
    while (added < numDays) {
      d.setDate(d.getDate() + 1);
      if (isBusinessDay(d)) added++;
    }
    return d;
  }, [isBusinessDay]);

  const canOrderToday = useCallback(() => {
    const today = new Date();
    if (!isBusinessDay(today)) {
      const day = today.getDay();
      if (day === 0) return { ok: false, reason: "Orders cannot be placed on Sundays." };
      return { ok: false, reason: "Today is a holiday. Orders can only be placed on business days (Monday–Saturday, excluding holidays)." };
    }
    return { ok: true };
  }, [isBusinessDay]);

  const getEstimatedDelivery = useCallback(() => {
    return addBusinessDays(new Date(), 5);
  }, [addBusinessDays]);

  // ─── Session restoration on mount ───────────────────────────
  useEffect(() => {
    const restoreSession = async () => {
      const hadSession = !!localStorage.getItem("zagu_session");
      const saved = session.restore();
      if (!saved || !saved.dealer) {
        if (hadSession) setLoginError("Your session has expired. Please sign in again.");
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
        const n = await loadNews();
        setNews(n);
        loadHolidays();
        setScreen("catalog");
        setIsLive(true);
      } catch {
        // Session restore failed — fall back to login with message
        session.clear();
        setLoginError("Your session has expired. Please sign in again.");
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
    setLoginError("");
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
      const n = await loadNews();
      setNews(n);
      loadHolidays();
      setScreen(d.stores.length > 1 ? "store-select" : "catalog");
      if (n.length > 0) setTimeout(() => setShowNewsModal(true), 500);
      // Initialize push notifications (fire-and-forget)
      initFirebaseMessaging(d.code, (payload) => {
        const { title, body } = payload.notification || {};
        if (title) showToast(`${title}${body ? " — " + body : ""}`, "success", 6000);
      }).catch(() => {});
    } catch (err) {
      const msg = err.message || "Login failed";
      setLoginError(msg === "Failed to fetch" ? "Unable to connect to server. Please check your internet connection." : msg);
    }
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

  const deleteDraft = async (order) => {
    if (!confirm(`Delete draft "${order.number}"? This cannot be undone.`)) return;
    try {
      await api.deleteOrder([Number(order.id)]);
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      setViewOrder(null);
      showToast(`Draft ${order.number} deleted`);
    } catch { showToast("Failed to delete draft", "error"); }
  };

  // Submit order (or save draft) — now uses composite endpoint for non-drafts
  const submitOrder = async (isDraft = false) => {
    if (cart.length === 0) return;
    // Block ordering on holidays/Sundays (except drafts)
    if (!isDraft) {
      const check = canOrderToday();
      if (!check.ok) { showToast(check.reason, "error", 5000); return; }
    }
    setSubmitting(true);
    const today = new Date().toISOString().split("T")[0];
    const orderNum = `ORD-${Date.now().toString(36).toUpperCase()}`;
    const estDelivery = getEstimatedDelivery().toISOString().split("T")[0];
    try {
      const record = {
        order_number: { value: orderNum },
        order_date: { value: today },
        dealer_lookup: { value: dealer.code },
        store_code_order: { value: selectedStore?.code || "" },
        store_name_order: { value: selectedStore?.name || "" },
        sap_bp_code_order: { value: selectedStore?.sapBpCode || dealer?.sapBpCode || "" },
        estimated_delivery: { value: estDelivery },
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

  if (screen === "login") return <LoginScreen onLogin={handleLogin} loading={loading} isLive={isLive} error={loginError} clearError={() => setLoginError("")} />;
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
          <NavBtn icon={<BarChart3 size={18} />} label="Dashboard" active={screen === "dashboard"} onClick={() => { setScreen("dashboard"); setViewOrder(null); }} />
          <NavBtn icon={<Package size={18} />} label="Catalog" active={screen === "catalog"} onClick={() => { setScreen("catalog"); setViewOrder(null); }} />
          <NavBtn icon={<ClipboardList size={18} />} label="Orders" active={screen === "history"} count={orders.length} onClick={() => { setScreen("history"); setViewOrder(null); }} />
          <NavBtn icon={<User size={16} />} label="Profile" active={screen === "profile"} onClick={() => { setScreen("profile"); setViewOrder(null); }} />
          <NavBtn icon={<Megaphone size={16} />} label="News" active={screen === "news"} count={news.filter((n) => n.pinned).length} onClick={() => { setScreen("news"); setViewOrder(null); }} />
          <NavBtn icon={<BookOpen size={16} />} label="Guide" active={screen === "guide"} onClick={() => { setScreen("guide"); setViewOrder(null); }} />
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
          {selectedStore && dealer?.stores?.length > 1 ? (
            <button className="store-switch-btn" onClick={() => setStoreSwitcherOpen(!storeSwitcherOpen)}>
              <MapPin size={12} /><span>{selectedStore.name}</span><ChevronDown size={12} />
            </button>
          ) : selectedStore ? (
            <><span className="dot">•</span><MapPin size={12} /><span>{selectedStore.name}</span></>
          ) : null}
          <span className="dot">•</span><span>{dealer?.region}</span>
        </div>
        {hasBalance && (
          <div className="balance-warn">
            <AlertTriangle size={13} />Outstanding: {peso(dealer.outstandingBalance)}
          </div>
        )}
      </div>

      {/* Store switcher dropdown */}
      {storeSwitcherOpen && (
        <>
          <div className="store-switcher-overlay" onClick={() => setStoreSwitcherOpen(false)} />
          <div className="store-switcher-dropdown">
            <div className="store-switcher-title">Switch Store</div>
            {dealer?.stores?.map((s) => (
              <button key={s.code} className={`store-switcher-item ${s.code === selectedStore?.code ? "active" : ""}`}
                onClick={() => { setSelectedStore(s); session.save(dealer, s); setStoreSwitcherOpen(false); showToast(`Switched to ${s.name}`); }}>
                <Building2 size={16} />
                <div><div className="store-name">{s.name}</div><div className="store-meta">{s.code}{s.address && ` • ${s.address}`}</div></div>
                {s.code === selectedStore?.code && <Check size={16} style={{ color: "#22C55E", marginLeft: "auto" }} />}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Password expiry warning */}
      {(() => {
        if (!dealer?.passwordExpiry) return null;
        const days = Math.ceil((new Date(dealer.passwordExpiry) - new Date()) / (1000 * 60 * 60 * 24));
        if (days > 7) return null;
        return (
          <div className="pw-expiry-banner">
            <ShieldAlert size={15} />
            <span>
              {days <= 0
                ? "Your password has expired! Please change it now."
                : `Your password expires in ${days} day${days === 1 ? "" : "s"}. Please change it soon.`}
            </span>
            <button className="pw-expiry-btn" onClick={() => setScreen("profile")}>Change Password</button>
          </div>
        );
      })()}

      <main className="main-content">
        {screen === "dashboard" && <Dashboard orders={orders} dealer={dealer} />}

        {screen === "news" && <NewsScreen news={news} />}

        {screen === "guide" && <GuideScreen />}

        {screen === "profile" && (
          <DealerProfile dealer={dealer} selectedStore={selectedStore} showToast={showToast}
            onPasswordChanged={(newExpiry) => setDealer((d) => ({ ...d, passwordExpiry: newExpiry }))} />
        )}

        {screen === "catalog" && (
          <>
            {!canOrderToday().ok && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", marginBottom: 16, background: "#FEF3C7", borderRadius: 10, border: "1px solid #FDE68A", fontSize: 13, color: "#92400E" }}>
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span><strong>Ordering is unavailable today.</strong> {canOrderToday().reason} You can still browse and save drafts.</span>
              </div>
            )}
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
            onBack={() => setScreen("catalog")} updateQty={updateQty} removeFromCart={removeFromCart}
            estimatedDelivery={getEstimatedDelivery()} orderBlocked={canOrderToday()} />
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

        {screen === "history" && <OrderHistory orders={orders} viewOrder={viewOrder} setViewOrder={setViewOrder}
          onReorder={(order) => {
            const newItems = order.items.map((item) => ({
              code: item.code, name: item.name, price: item.price, qty: item.qty,
              img: CATEGORY_ICONS[products.find((p) => p.code === item.code)?.category] || "📦",
              imageUrl: products.find((p) => p.code === item.code)?.imageUrl || null,
            }));
            setCart((prev) => {
              const merged = [...prev];
              newItems.forEach((ni) => {
                const exists = merged.find((i) => i.code === ni.code);
                if (exists) exists.qty += ni.qty;
                else merged.push(ni);
              });
              return merged;
            });
            setScreen("catalog");
            setViewOrder(null);
            showToast(`${newItems.length} items added to cart from ${order.number}`);
          }}
          onDownloadPDF={(order) => generateOrderPDF(order, dealer, selectedStore)}
          onDeleteDraft={deleteDraft}
          dealer={dealer} selectedStore={selectedStore}
        />}
      </main>

      {cartOpen && <CartDrawer cart={cart} cartTotal={cartTotal} updateQty={updateQty} removeFromCart={removeFromCart} onClose={() => setCartOpen(false)} onCheckout={() => { setCartOpen(false); setScreen("checkout"); }} />}

      {/* News modal on login */}
      {showNewsModal && news.length > 0 && (
        <div className="drawer-overlay" onClick={() => setShowNewsModal(false)}>
          <div className="news-modal" onClick={(e) => e.stopPropagation()}>
            <div className="news-modal-header">
              <div className="news-modal-title"><Megaphone size={20} /> News & Announcements</div>
              <button className="close-btn" onClick={() => setShowNewsModal(false)}><X size={20} /></button>
            </div>
            <div className="news-modal-body">
              {news.slice(0, 5).map((item) => {
                const Icon = NEWS_ICONS[item.category] || Info;
                const color = NEWS_COLORS[item.category] || "#888";
                return (
                  <div key={item.id} className="news-modal-item">
                    <div className="news-item-icon" style={{ background: `${color}15`, color }}><Icon size={16} /></div>
                    <div className="news-item-content">
                      <div className="news-item-header">
                        <span className="news-item-cat" style={{ color }}>{item.category}</span>
                        {item.pinned && <span className="news-pinned-tag">📌 Pinned</span>}
                        <span className="news-item-date">{item.date}</span>
                      </div>
                      <div className="news-item-title">{item.title}</div>
                      <div className="news-item-preview">{item.content.substring(0, 120)}{item.content.length > 120 ? "..." : ""}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="news-modal-footer">
              <button className="btn-primary" style={{ width: "100%" }} onClick={() => { setShowNewsModal(false); setScreen("news"); }}>
                View All Announcements <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="mobile-bottom-nav">
        <button className={`bottom-nav-item ${screen === "catalog" ? "active" : ""}`} onClick={() => { setScreen("catalog"); setViewOrder(null); }}>
          <Package size={20} /><span>Catalog</span>
        </button>
        <button className={`bottom-nav-item ${screen === "history" ? "active" : ""}`} onClick={() => { setScreen("history"); setViewOrder(null); }}>
          <ClipboardList size={20} /><span>Orders</span>
        </button>
        <button className="bottom-nav-item cart-tab" onClick={() => setCartOpen(true)}>
          <div className="bottom-cart-wrap">
            <ShoppingCart size={20} />
            {cartCount > 0 && <span className="bottom-cart-badge">{cartCount}</span>}
          </div>
          <span>Cart</span>
        </button>
        <button className={`bottom-nav-item ${screen === "news" ? "active" : ""}`} onClick={() => { setScreen("news"); setViewOrder(null); }}>
          <Megaphone size={20} /><span>News</span>
        </button>
        <button className={`bottom-nav-item ${screen === "dashboard" || screen === "profile" ? "active" : ""}`} onClick={() => { setScreen("profile"); setViewOrder(null); }}>
          <User size={20} /><span>More</span>
        </button>
      </nav>
      {toast && (<div className={`toast toast-${toast.type}`}>{toast.type === "error" ? <AlertCircle size={16} /> : <Check size={16} />}{toast.msg}</div>)}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────
function NavBtn({ icon, label, active, count, onClick }) {
  return (
    <button className={`nav-btn ${active ? "active" : ""}`} onClick={onClick}>
      {icon}<span className="nav-label">{label}</span>{count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

function LoginScreen({ onLogin, loading, isLive, error, clearError }) {
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot" | "reset"
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  // Registration fields
  const [regEmail, setRegEmail] = useState("");
  const [regCode, setRegCode] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regName, setRegName] = useState("");
  const [regContact, setRegContact] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regRegion, setRegRegion] = useState("NCR");
  const [regLoading, setRegLoading] = useState(false);
  const [regMessage, setRegMessage] = useState(null); // { text, type: "success"|"error" }
  const [showRegPw, setShowRegPw] = useState(false);

  // Forgot password fields
  const [forgotCode, setForgotCode] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState(null);

  // Reset password fields
  const [resetToken, setResetToken] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState(null);

  // Detect ?reset=TOKEN&code=DLR-001 in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");
    const dealerCode = params.get("code");
    if (token && dealerCode) {
      setResetToken(token);
      setResetCode(dealerCode);
      setMode("reset");
      // Clean URL without reloading
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const submitLogin = () => code.trim() && password && onLogin(code.trim(), password);

  const submitForgotPassword = async () => {
    if (!forgotCode.trim()) { setForgotMessage({ text: "Please enter your dealer code.", type: "error" }); return; }
    setForgotLoading(true); setForgotMessage(null);
    try {
      const result = await api.forgotPassword(forgotCode.trim());
      setForgotMessage({ text: result.message || "If an account exists, a reset email has been sent.", type: "success" });
    } catch (err) {
      setForgotMessage({ text: err.message || "Something went wrong. Please try again.", type: "error" });
    }
    setForgotLoading(false);
  };

  const submitResetPassword = async () => {
    if (!resetPw || !resetConfirm) { setResetMessage({ text: "Please fill in all fields.", type: "error" }); return; }
    if (resetPw.length < 6) { setResetMessage({ text: "Password must be at least 6 characters.", type: "error" }); return; }
    if (resetPw !== resetConfirm) { setResetMessage({ text: "Passwords do not match.", type: "error" }); return; }
    setResetLoading(true); setResetMessage(null);
    try {
      const result = await api.resetPassword(resetToken, resetCode, resetPw);
      setResetMessage({ text: result.message || "Password reset successfully! You can now log in.", type: "success" });
    } catch (err) {
      setResetMessage({ text: err.message || "Reset failed. The link may have expired.", type: "error" });
    }
    setResetLoading(false);
  };

  const submitRegister = async () => {
    if (!regEmail || !regCode || !regPassword || !regName || !regContact) {
      setRegMessage({ text: "Please fill in all required fields.", type: "error" }); return;
    }
    if (regPassword.length < 6) {
      setRegMessage({ text: "Password must be at least 6 characters.", type: "error" }); return;
    }
    if (regPassword !== regConfirm) {
      setRegMessage({ text: "Passwords do not match.", type: "error" }); return;
    }
    setRegLoading(true); setRegMessage(null);
    try {
      const result = await api.register({
        email: regEmail, dealerCode: regCode, password: regPassword,
        dealerName: regName, contactPerson: regContact, phone: regPhone, region: regRegion,
      });
      setRegMessage({ text: result.message || "Registration submitted! Awaiting approval from Zagu back office.", type: "success" });
    } catch (err) {
      setRegMessage({ text: err.message || "Registration failed. Please try again.", type: "error" });
    }
    setRegLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <img src="./zagu-logo.png" alt="Zagu Shakes" className="login-logo-img" />
            <p>Dealer Ordering Portal</p>
          </div>

          {mode === "login" ? (
            <>
              <div className="login-form">
                {error && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", marginBottom: 12, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, fontSize: 13, color: "#DC2626" }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <div className="field"><label>Dealer Code</label>
                  <input value={code} onChange={(e) => { setCode(e.target.value); if (error) clearError(); }} placeholder="Enter your dealer code" onKeyDown={(e) => e.key === "Enter" && submitLogin()} autoCapitalize="characters" />
                </div>
                <div className="field"><label>Password</label>
                  <div style={{ position: "relative" }}>
                    <input type={showPw ? "text" : "password"} value={password} onChange={(e) => { setPassword(e.target.value); if (error) clearError(); }} placeholder="Enter password" onKeyDown={(e) => e.key === "Enter" && submitLogin()} style={{ paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", padding: 4 }} tabIndex={-1}>
                      {showPw ? <X size={16} /> : <Search size={16} />}
                    </button>
                  </div>
                </div>
                <button className="btn-primary login-btn" onClick={submitLogin} disabled={loading || !code.trim() || !password}>
                  {loading ? <><Loader2 size={18} className="spinner" /> Signing in...</> : <>Sign In <ChevronRight size={18} /></>}
                </button>
                <div style={{ textAlign: "right", marginTop: 4 }}>
                  <button className="link-btn" onClick={() => { setMode("forgot"); setForgotMessage(null); setForgotCode(""); }} style={{ fontSize: 12, color: "#D4A017" }}>Forgot Password?</button>
                </div>
              </div>
              <div className="login-register-link">
                Don't have an account? <button className="link-btn" onClick={() => { setMode("register"); setRegMessage(null); }}>Register as a Dealer</button>
              </div>
            </>
          ) : mode === "forgot" ? (
            <>
              {forgotMessage?.type === "success" ? (
                <div className="reg-success">
                  <div className="reg-success-icon" style={{ background: "#FEF3C7", color: "#D4A017" }}>📧</div>
                  <h3>Check Your Email</h3>
                  <p>{forgotMessage.text}</p>
                  <p className="reg-success-note">The reset link will expire in 30 minutes. Check your spam folder if you don't see it.</p>
                  <button className="btn-primary login-btn" onClick={() => { setMode("login"); setForgotMessage(null); }}>
                    <ArrowLeft size={16} /> Back to Login
                  </button>
                </div>
              ) : (
                <div className="login-form">
                  <div className="reg-title">Forgot Password</div>
                  <div className="reg-subtitle">Enter your dealer code below. We'll send a password reset link to the email address registered with your account.</div>
                  {forgotMessage?.type === "error" && (
                    <div className="reg-error"><AlertCircle size={14} /> {forgotMessage.text}</div>
                  )}
                  <div className="field"><label>Dealer Code</label>
                    <input value={forgotCode} onChange={(e) => setForgotCode(e.target.value.toUpperCase())} placeholder="e.g. DLR-001" onKeyDown={(e) => e.key === "Enter" && submitForgotPassword()} autoCapitalize="characters" />
                  </div>
                  <button className="btn-primary login-btn" onClick={submitForgotPassword} disabled={forgotLoading || !forgotCode.trim()}>
                    {forgotLoading ? <><Loader2 size={18} className="spinner" /> Sending...</> : <>Send Reset Link <ChevronRight size={18} /></>}
                  </button>
                </div>
              )}
              {forgotMessage?.type !== "success" && (
                <div className="login-register-link">
                  Remember your password? <button className="link-btn" onClick={() => { setMode("login"); setForgotMessage(null); }}>Sign In</button>
                </div>
              )}
            </>
          ) : mode === "reset" ? (
            <>
              {resetMessage?.type === "success" ? (
                <div className="reg-success">
                  <div className="reg-success-icon" style={{ background: "#D1FAE5", color: "#059669" }}><Check size={32} /></div>
                  <h3>Password Reset!</h3>
                  <p>{resetMessage.text}</p>
                  <button className="btn-primary login-btn" onClick={() => { setMode("login"); setResetMessage(null); setCode(resetCode); }}>
                    <ArrowLeft size={16} /> Sign In Now
                  </button>
                </div>
              ) : (
                <div className="login-form">
                  <div className="reg-title">Set New Password</div>
                  <div className="reg-subtitle">Create a new password for dealer <strong>{resetCode}</strong>.</div>
                  {resetMessage?.type === "error" && (
                    <div className="reg-error"><AlertCircle size={14} /> {resetMessage.text}</div>
                  )}
                  <div className="field"><label>New Password</label>
                    <input type="password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="Min 6 characters" onKeyDown={(e) => e.key === "Enter" && submitResetPassword()} />
                  </div>
                  <div className="field"><label>Confirm Password</label>
                    <input type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="Re-enter password" onKeyDown={(e) => e.key === "Enter" && submitResetPassword()} />
                  </div>
                  <button className="btn-primary login-btn" onClick={submitResetPassword} disabled={resetLoading || !resetPw || !resetConfirm}>
                    {resetLoading ? <><Loader2 size={18} className="spinner" /> Resetting...</> : <>Reset Password <ChevronRight size={18} /></>}
                  </button>
                </div>
              )}
              {resetMessage?.type !== "success" && (
                <div className="login-register-link">
                  <button className="link-btn" onClick={() => setMode("login")}>Back to Login</button>
                </div>
              )}
            </>
          ) : (
            <>
              {regMessage?.type === "success" ? (
                <div className="reg-success">
                  <div className="reg-success-icon"><Check size={32} /></div>
                  <h3>Registration Submitted!</h3>
                  <p>{regMessage.text}</p>
                  <p className="reg-success-note">You will be able to log in once Zagu back office approves your account.</p>
                  <button className="btn-primary login-btn" onClick={() => { setMode("login"); setRegMessage(null); }}>
                    <ArrowLeft size={16} /> Back to Login
                  </button>
                </div>
              ) : (
                <div className="login-form reg-form">
                  <div className="reg-title">Dealer Registration</div>
                  <div className="reg-subtitle">Fill in your details below. Your account will be reviewed and approved by Zagu back office before you can log in.</div>

                  {regMessage?.type === "error" && (
                    <div className="reg-error"><AlertCircle size={14} /> {regMessage.text}</div>
                  )}

                  <div className="reg-row">
                    <div className="field"><label>Email Address *</label>
                      <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="dealer@example.com" />
                    </div>
                    <div className="field"><label>Dealer Code *</label>
                      <input value={regCode} onChange={(e) => setRegCode(e.target.value.toUpperCase())} placeholder="e.g. DLR-100" />
                    </div>
                  </div>

                  <div className="field"><label>Dealer / Business Name *</label>
                    <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="e.g. Juan's Zagu Franchise" />
                  </div>

                  <div className="reg-row">
                    <div className="field"><label>Contact Person *</label>
                      <input value={regContact} onChange={(e) => setRegContact(e.target.value)} placeholder="Full name" />
                    </div>
                    <div className="field"><label>Phone</label>
                      <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="09XX XXX XXXX" />
                    </div>
                  </div>

                  <div className="field"><label>Region</label>
                    <select value={regRegion} onChange={(e) => setRegRegion(e.target.value)}>
                      <option value="NCR">NCR</option>
                      <option value="North Luzon">North Luzon</option>
                      <option value="South Luzon">South Luzon</option>
                    </select>
                  </div>

                  <div className="reg-row">
                    <div className="field"><label>Password *</label>
                      <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="Min 6 characters" />
                    </div>
                    <div className="field"><label>Confirm Password *</label>
                      <input type="password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} placeholder="Re-enter password" />
                    </div>
                  </div>

                  <button className="btn-primary login-btn" onClick={submitRegister} disabled={regLoading || !regEmail || !regCode || !regPassword || !regName || !regContact}>
                    {regLoading ? <><Loader2 size={18} className="spinner" /> Submitting...</> : <>Register <ChevronRight size={18} /></>}
                  </button>
                </div>
              )}
              {regMessage?.type !== "success" && (
                <div className="login-register-link">
                  Already have an account? <button className="link-btn" onClick={() => { setMode("login"); setRegMessage(null); }}>Sign In</button>
                </div>
              )}
            </>
          )}

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
      <div className="product-image" style={{ background: product.imageUrl ? "#fff" : `linear-gradient(135deg, ${catColor}15, ${catColor}08)` }}>
        {product.imageUrl
          ? <img src={product.imageUrl} alt={product.name} className="product-img-real" />
          : <span className="product-emoji">{product.img}</span>
        }
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

function CheckoutScreen({ cart, cartTotal, dealer, store, selectedPayment, setSelectedPayment, orderNotes, setOrderNotes, submitting, onSubmit, onSaveDraft, onBack, updateQty, removeFromCart, estimatedDelivery, orderBlocked }) {
  const creditTermsAvail = dealer?.creditTerms !== "None";
  const availablePayments = PAYMENT_OPTIONS.filter((p) => p.value !== "Credit Terms" || creditTermsAvail);
  const estDate = estimatedDelivery ? estimatedDelivery.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "";

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
            {estDate && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", fontSize: 13, color: "#6B7280", borderTop: "1px solid #F3F4F6" }}>
                <CalendarDays size={14} style={{ color: "#8B5CF6" }} />
                <span>Est. delivery: <strong style={{ color: "#1F2937" }}>{estDate}</strong> <span style={{ fontSize: 11, color: "#9CA3AF" }}>(5 business days)</span></span>
              </div>
            )}
            {orderBlocked && !orderBlocked.ok && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: 12, marginBottom: 12, background: "#FEF2F2", borderRadius: 8, fontSize: 13, color: "#DC2626" }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div><strong>Ordering unavailable today</strong><br />{orderBlocked.reason}<br /><span style={{ fontSize: 12, color: "#9CA3AF" }}>You can still save as draft.</span></div>
              </div>
            )}
            <button className="btn-primary submit-btn" onClick={onSubmit} disabled={submitting || cart.length === 0 || (orderBlocked && !orderBlocked.ok)}>
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

function OrderHistory({ orders, viewOrder, setViewOrder, onReorder, onDownloadPDF, onDeleteDraft, dealer, selectedStore }) {
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
          {/* Action buttons */}
          <div className="order-actions">
            <button className="btn-outline order-action-btn" onClick={() => onReorder(viewOrder)}>
              <RefreshCw size={14} /> Reorder Items
            </button>
            <button className="btn-outline order-action-btn" onClick={() => onDownloadPDF(viewOrder)}>
              <Download size={14} /> Download PDF
            </button>
            {viewOrder.isDraft && (
              <button className="btn-outline order-action-btn" style={{ color: "#DC2626", borderColor: "#FECACA" }} onClick={() => onDeleteDraft(viewOrder)}>
                <Trash2 size={14} /> Delete Draft
              </button>
            )}
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
                {drafts.map((order) => <OrderRow key={order.id} order={order} onClick={() => setViewOrder(order)} onReorder={onReorder} onDeleteDraft={onDeleteDraft} />)}
              </div>
            </div>
          )}
          <div className="orders-section">
            {drafts.length > 0 && <div className="orders-section-title"><ClipboardList size={16} /> Submitted ({submitted.length})</div>}
            <div className="orders-list">
              {submitted.map((order) => <OrderRow key={order.id} order={order} onClick={() => setViewOrder(order)} onReorder={onReorder} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OrderRow({ order, onClick, onReorder, onDeleteDraft }) {
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
        <button className="reorder-btn" title="Reorder" onClick={(e) => { e.stopPropagation(); onReorder(order); }}><RefreshCw size={14} /></button>
        {order.isDraft && onDeleteDraft && (
          <button className="reorder-btn" title="Delete draft" style={{ color: "#DC2626" }} onClick={(e) => { e.stopPropagation(); onDeleteDraft(order); }}><Trash2 size={14} /></button>
        )}
        <ChevronRight size={16} color="#ccc" />
      </div>
    </div>
  );
}

function NewsScreen({ news }) {
  const [expandedId, setExpandedId] = useState(null);
  return (
    <div>
      <h2 className="section-title"><Megaphone size={22} style={{ verticalAlign: "middle", marginRight: 8 }} />News & Announcements</h2>
      {news.length === 0 ? (
        <div className="card empty-orders"><Megaphone size={48} strokeWidth={1} /><p>No announcements</p></div>
      ) : (
        <div className="news-list">
          {news.map((item) => {
            const Icon = NEWS_ICONS[item.category] || Info;
            const color = NEWS_COLORS[item.category] || "#888";
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className={`news-card card ${item.pinned ? "news-pinned" : ""}`} onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                <div className="news-card-top">
                  <div className="news-card-icon" style={{ background: `${color}15`, color }}><Icon size={18} /></div>
                  <div className="news-card-info">
                    <div className="news-card-meta">
                      <span style={{ color, fontWeight: 600 }}>{item.category}</span>
                      {item.pinned && <span className="news-pinned-tag">📌 Pinned</span>}
                      <span className="news-item-date">{item.date}</span>
                    </div>
                    <div className="news-card-title">{item.title}</div>
                  </div>
                  <ChevronRight size={16} color="#ccc" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: ".2s", flexShrink: 0 }} />
                </div>
                {isExpanded && <div className="news-card-body">{item.content}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GuideScreen() {
  const sections = [
    { icon: "🔐", title: "Logging In", content: "Go to the Zagu Ordering Portal and enter your Dealer Code (e.g., DLR-001) and password. Complete MFA verification if enabled. Contact your Zagu representative if you forgot your credentials." },
    { icon: "🛒", title: "Placing an Order", content: "From the Dashboard, select your Store from the dropdown. Browse the product catalog — use categories or search to find items. Enter quantities and click \"Add to Cart\". Review your cart, then click \"Submit Order\".\n\n⚠️ Orders can only be placed Monday–Saturday (no Sundays or holidays). Minimum 5 business days lead time applies." },
    { icon: "📋", title: "Order Statuses", content: "• New — Order created (draft)\n• Submitted — Sent for processing\n• Pending ONB Approval — Awaiting Order & Billing review\n• Approved — Cleared for SAP posting\n• Posted to SAP — Sales Order created in SAP B1\n• Picking — Warehouse is preparing your order\n• Ready for Pickup — Order packed, waiting for courier\n• Completed — Order delivered\n• Rejected — Declined (see reason; you may resubmit)" },
    { icon: "💳", title: "Payment Methods", content: "Accepted methods: Credit Card, GCash, Maya, Bank Transfer, Cash on Pick Up.\n\nPayment can be collected at order placement or upon delivery. Your payment status is visible on each order in Order History." },
    { icon: "📄", title: "Drafts & Reorders", content: "You can save orders as drafts and submit them later — drafts are not affected by holiday/Sunday restrictions.\n\nTo reorder a previous order, go to Order History, open any completed order, and click \"Reorder Items\". All items will be added to your cart." },
    { icon: "📥", title: "Download PDF", content: "You can download a PDF copy of any order from the Order History screen. Click on an order, then click \"Download PDF\"." },
    { icon: "❓", title: "Need Help?", content: "Contact your assigned Zagu representative or email support@zagushakes.com.\n\nCheck the News & Announcements section for system updates, promotions, and policy changes." },
  ];

  return (
    <div>
      <h2 className="section-title"><BookOpen size={22} style={{ verticalAlign: "middle", marginRight: 8 }} />Authorized Dealer Guide</h2>
      <div style={{ maxWidth: 800 }}>
        {sections.map((s, i) => (
          <div key={i} className="card" style={{ marginBottom: 12, padding: "20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 24 }}>{s.icon}</span>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "#1F2937" }}>{s.title}</h3>
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#4B5563", whiteSpace: "pre-line" }}>{s.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
