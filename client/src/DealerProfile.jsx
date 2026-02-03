import { useState } from "react";
import {
  User, Building2, MapPin, Mail, Phone, CreditCard, AlertTriangle,
  Shield, Key, ChevronRight, Loader2, Check, Eye, EyeOff,
} from "lucide-react";
import { api } from "./api.js";

const peso = (n) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

export default function DealerProfile({ dealer, selectedStore, onPasswordChanged, showToast }) {
  const [showChangePw, setShowChangePw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changing, setChanging] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const daysUntilExpiry = dealer?.passwordExpiry
    ? Math.ceil((new Date(dealer.passwordExpiry) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  const handleChangePassword = async () => {
    if (!currentPw || !newPw) return;
    if (newPw !== confirmPw) { showToast("Passwords do not match", "error"); return; }
    if (newPw.length < 6) { showToast("Password must be at least 6 characters", "error"); return; }

    setChanging(true);
    try {
      const result = await api.changePassword(dealer.code, currentPw, newPw);
      showToast("Password changed successfully!");
      setShowChangePw(false);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      if (onPasswordChanged) onPasswordChanged(result.newExpiry);
    } catch (err) {
      showToast(err.message || "Failed to change password", "error");
    }
    setChanging(false);
  };

  return (
    <div className="profile">
      <h2 className="section-title"><User size={20} /> Dealer Profile</h2>

      <div className="profile-grid">
        {/* Main info card */}
        <div className="card profile-card">
          <div className="profile-header-section">
            <div className="profile-avatar">{dealer?.name?.charAt(0) || "Z"}</div>
            <div>
              <h3 className="profile-name">{dealer?.name}</h3>
              <span className="profile-code">{dealer?.code}</span>
              {dealer?.sapBpCode && <span className="profile-sap">SAP: {dealer.sapBpCode}</span>}
            </div>
          </div>

          <div className="profile-fields">
            <ProfileField icon={<User size={15} />} label="Contact Person" value={dealer?.contact} />
            <ProfileField icon={<Mail size={15} />} label="Email" value={dealer?.email} />
            <ProfileField icon={<MapPin size={15} />} label="Region" value={dealer?.region} />
          </div>
        </div>

        {/* Financial card */}
        <div className="card profile-card">
          <div className="card-header"><CreditCard size={16} /> Financial Information</div>
          <div className="profile-fields">
            <ProfileField label="Credit Limit" value={peso(dealer?.creditLimit)} />
            <ProfileField label="Credit Terms" value={dealer?.creditTerms || "None"} />
            <ProfileField label="Outstanding Balance" value={peso(dealer?.outstandingBalance)}
              warn={dealer?.outstandingBalance > 0} />
          </div>
          {dealer?.outstandingBalance > 0 && (
            <div className="profile-balance-warn">
              <AlertTriangle size={14} />
              <span>Outstanding balance of {peso(dealer.outstandingBalance)} may affect order approvals.</span>
            </div>
          )}
        </div>

        {/* Security card */}
        <div className="card profile-card">
          <div className="card-header"><Shield size={16} /> Security</div>
          <div className="profile-fields">
            <ProfileField label="MFA" value={dealer?.mfaEnabled === "Yes" ? "Enabled" : "Not enabled"} />
            <ProfileField label="Password Expires" value={
              dealer?.passwordExpiry
                ? `${dealer.passwordExpiry}${daysUntilExpiry !== null ? ` (${daysUntilExpiry <= 0 ? "Expired!" : `${daysUntilExpiry} days left`})` : ""}`
                : "No expiry set"
            } warn={daysUntilExpiry !== null && daysUntilExpiry <= 7} />
          </div>

          {!showChangePw ? (
            <button className="btn-outline profile-pw-btn" onClick={() => setShowChangePw(true)}>
              <Key size={15} /> Change Password <ChevronRight size={15} />
            </button>
          ) : (
            <div className="change-pw-form">
              <div className="field">
                <label>Current Password</label>
                <div className="pw-input-wrap">
                  <input type={showCurrent ? "text" : "password"} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Enter current password" />
                  <button className="pw-toggle" onClick={() => setShowCurrent(!showCurrent)} type="button">
                    {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div className="field">
                <label>New Password</label>
                <div className="pw-input-wrap">
                  <input type={showNew ? "text" : "password"} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min 6 characters" />
                  <button className="pw-toggle" onClick={() => setShowNew(!showNew)} type="button">
                    {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div className="field">
                <label>Confirm New Password</label>
                <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Re-enter new password" />
              </div>
              <div className="change-pw-actions">
                <button className="btn-primary" onClick={handleChangePassword} disabled={changing || !currentPw || !newPw || !confirmPw}>
                  {changing ? <><Loader2 size={15} className="spinner" /> Saving...</> : <><Check size={15} /> Save</>}
                </button>
                <button className="btn-outline" onClick={() => { setShowChangePw(false); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Stores card */}
        {dealer?.stores?.length > 0 && (
          <div className="card profile-card">
            <div className="card-header"><Building2 size={16} /> Stores ({dealer.stores.length})</div>
            <div className="profile-stores">
              {dealer.stores.map((s) => (
                <div key={s.code} className={`profile-store ${selectedStore?.code === s.code ? "active" : ""}`}>
                  <Building2 size={16} />
                  <div>
                    <div className="store-name">{s.name}</div>
                    <div className="store-meta">{s.code}{s.address ? ` • ${s.address}` : ""}</div>
                  </div>
                  {selectedStore?.code === s.code && <span className="current-tag">Current</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileField({ icon, label, value, warn }) {
  return (
    <div className="profile-field">
      <div className="pf-label">{icon} {label}</div>
      <div className={`pf-value ${warn ? "pf-warn" : ""}`}>{value || "—"}</div>
    </div>
  );
}
