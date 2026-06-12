"use client";

/**
 * Admin → Finance → Loyalty Program.
 *
 * Two responsibilities:
 *   1. The earning rate (points per £1 of real money spent) — saved into the
 *      shared app settings; every earn path reads it live.
 *   2. The reward catalog — point-priced menu items customers redeem from
 *      /account?tab=rewards. CRUD via /api/admin/rewards.
 */

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { LoyaltyReward } from "@/types";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { Gift, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";

export default function LoyaltyPanel() {
  const { settings, updateSettings, menuItems } = useApp();
  const sym = settings.currency?.symbol || DEFAULT_CURRENCY.symbol;

  // Earning rate — string state so users can clear the input while typing.
  const [pointsPer, setPointsPer] = useState(settings.loyaltyPointsPerPound?.toString() || "1");
  const [saved, setSaved] = useState(false);

  // Re-sync local state when settings load from Supabase after mount
  useEffect(() => {
    setPointsPer(settings.loyaltyPointsPerPound?.toString() || "1");
  }, [settings.loyaltyPointsPerPound]);

  function handleSave() {
    updateSettings({ loyaltyPointsPerPound: parseFloat(pointsPer) || 0 });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  // ── Reward catalog state ──
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loadingRewards, setLoadingRewards] = useState(true);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formMenuItemId, setFormMenuItemId] = useState("");
  const [formPoints, setFormPoints] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  async function loadRewards() {
    try {
      const res = await fetch("/api/admin/rewards", { cache: "no-store" });
      const json = await res.json() as { ok: boolean; rewards?: LoyaltyReward[] };
      if (json.ok) setRewards(json.rewards ?? []);
    } finally {
      setLoadingRewards(false);
    }
  }
  useEffect(() => { void loadRewards(); }, []);

  function openCreate() {
    setEditingId(null);
    setFormMenuItemId("");
    setFormPoints("");
    setFormName("");
    setFormDescription("");
    setRewardError(null);
    setShowForm(true);
  }

  function openEdit(r: LoyaltyReward) {
    setEditingId(r.id);
    setFormMenuItemId(r.menuItemId);
    setFormPoints(String(r.pointsCost));
    setFormName(r.name);
    setFormDescription(r.description);
    setRewardError(null);
    setShowForm(true);
  }

  async function submitReward() {
    const pointsCost = parseInt(formPoints, 10);
    if (!formMenuItemId) { setRewardError("Pick a menu item for the reward."); return; }
    if (!Number.isFinite(pointsCost) || pointsCost <= 0) { setRewardError("Points cost must be a positive whole number."); return; }
    setFormBusy(true);
    setRewardError(null);
    try {
      const res = await fetch(editingId ? `/api/admin/rewards/${editingId}` : "/api/admin/rewards", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menuItemId: formMenuItemId,
          pointsCost,
          name: formName.trim(),
          description: formDescription.trim(),
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) { setRewardError(json.error ?? "Could not save the reward."); return; }
      setShowForm(false);
      await loadRewards();
    } catch {
      setRewardError("Connection error. Please try again.");
    } finally {
      setFormBusy(false);
    }
  }

  async function toggleActive(r: LoyaltyReward) {
    const res = await fetch(`/api/admin/rewards/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    const json = await res.json() as { ok: boolean };
    if (json.ok) setRewards((prev) => prev.map((x) => x.id === r.id ? { ...x, active: !r.active } : x));
  }

  async function deleteReward(id: string) {
    const res = await fetch(`/api/admin/rewards/${id}`, { method: "DELETE" });
    const json = await res.json() as { ok: boolean };
    if (json.ok) setRewards((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* ── Earning rate ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Gift size={18} className="text-purple-600 flex-shrink-0" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Earning rate</h2>
            <p className="text-xs text-gray-400">How many points customers collect per {sym}1 of real money spent</p>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Points per {sym}
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={pointsPer}
              onChange={(e) => { setPointsPer(e.target.value); setSaved(false); }}
              placeholder="1"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 transition"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Points accrue on real money paid only — gift card and store credit portions never earn.
            </p>
          </div>
          <div className="flex items-end pb-5">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl transition"
              >
                Save earning rate
              </button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
                  <CheckCircle2 size={16} /> Saved
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Reward catalog ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <Gift size={18} className="text-purple-600 flex-shrink-0" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Reward catalog</h2>
              <p className="text-xs text-gray-400">Free menu items priced in points — customers redeem them from their account page</p>
            </div>
          </div>
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition"
          >
            + Add reward
          </button>
        </div>

        <div className="p-6">
          {loadingRewards ? (
            <p className="text-sm text-gray-400 py-3">Loading rewards…</p>
          ) : rewards.length === 0 && !showForm ? (
            <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-sm text-gray-400">No rewards yet — add your first one (e.g. a free side at 2,000 points).</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rewards.map((r) => {
                const name = r.name.trim() || r.menuItemName || "(deleted item)";
                return (
                  <div key={r.id} className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 ${r.active ? "border-gray-100" : "border-gray-100 bg-gray-50 opacity-70"}`}>
                    {r.menuItemImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.menuItemImage} alt={name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                        <Gift size={16} className="text-purple-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {name}
                        {!r.active && <span className="ml-2 text-[10px] font-bold text-gray-400 uppercase">Hidden</span>}
                        {r.menuItemActive === false && <span className="ml-2 text-[10px] font-bold text-red-400 uppercase">Item unavailable</span>}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {r.pointsCost.toLocaleString()} points
                        {r.menuItemPrice != null && ` · worth ${sym}${r.menuItemPrice.toFixed(2)}`}
                        {r.menuItemName && r.name.trim() && ` · ${r.menuItemName}`}
                      </p>
                    </div>
                    <button
                      onClick={() => void toggleActive(r)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition flex-shrink-0 ${r.active ? "bg-green-50 text-green-600 hover:bg-green-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                    >
                      {r.active ? "Active" : "Inactive"}
                    </button>
                    <button
                      onClick={() => openEdit(r)}
                      className="text-[11px] font-bold text-purple-600 hover:text-purple-800 flex-shrink-0"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void deleteReward(r.id)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition flex-shrink-0"
                      title="Delete reward"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add / edit form */}
          {showForm && (
            <div className="mt-3 border border-purple-200 bg-purple-50/40 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-purple-700">{editingId ? "Edit reward" : "New reward"}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Menu item</label>
                  <select
                    value={formMenuItemId}
                    onChange={(e) => setFormMenuItemId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    <option value="">Choose an item…</option>
                    {menuItems.filter((m) => m.active !== false).map((m) => (
                      <option key={m.id} value={m.id}>{m.name} — {sym}{m.price.toFixed(2)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Points cost</label>
                  <input
                    type="number" min="1" step="1"
                    value={formPoints}
                    onChange={(e) => setFormPoints(e.target.value)}
                    placeholder="e.g. 2000"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Display name (optional)</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Defaults to the menu item name"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-600 mb-1">Description (optional)</label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Shown on the customer rewards page"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>
              {rewardError && (
                <p className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertCircle size={13} /> {rewardError}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void submitReward()}
                  disabled={formBusy}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
                >
                  {formBusy ? "Saving…" : editingId ? "Save changes" : "Add reward"}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-800 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
