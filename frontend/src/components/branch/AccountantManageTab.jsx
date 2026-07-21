import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { getBranches, getBranchFinanceSettings, updateBranchFinanceSettings } from "@/lib/api";

const CONSULTATION_FEE_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
];
const TREATMENT_FEE_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "partial", label: "Partial Payment" },
];

/**
 * Accountant Manage — branch-by-branch payment mode config. Super Admin (under
 * Branch Management > Accountant Management) picks a branch and toggles which
 * modes are allowed there; Branch Admin (under their own "Branch Accountant
 * Management" tab) sees the same settings for their own branch, read-only.
 */
export const AccountantManageTab = ({ branchId: fixedBranchId, readOnly = false }) => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(fixedBranchId || "");
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fixedBranchId) return;
    getBranches().then(setBranches).catch(() => setBranches([]));
  }, [fixedBranchId]);

  const load = useCallback(() => {
    if (!branchId) { setSettings(null); return; }
    setLoading(true);
    getBranchFinanceSettings(branchId).then(setSettings).catch(() => setSettings(null)).finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (field, value) => {
    if (readOnly || !settings) return;
    const current = settings[field] || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setSettings({ ...settings, [field]: next });
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await updateBranchFinanceSettings(branchId, {
        consultation_fee_payment_modes: settings.consultation_fee_payment_modes,
        treatment_fee_payment_modes: settings.treatment_fee_payment_modes,
      });
      setSettings(updated);
      toast.success("Payment modes updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    }
    setSaving(false);
  };

  const ModeGroup = ({ title, field, options }) => (
    <Card>
      <CardContent className="p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <div className="flex flex-wrap gap-2">
          {options.map((m) => {
            const active = (settings[field] || []).includes(m.value);
            return (
              <button
                key={m.value}
                type="button"
                disabled={readOnly}
                onClick={() => toggle(field, m.value)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                  active ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-400"
                } ${readOnly ? "cursor-default" : "hover:border-sky-300"}`}
                data-testid={`accountant-manage-${field}-${m.value}`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4" data-testid="accountant-manage-tab">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Accountant Manage</h2>
        <p className="text-sm text-slate-500">
          {readOnly
            ? "Payment modes enabled for your branch — managed by Super Admin."
            : "Choose which payment modes each branch can use to collect Consultation and Treatment Fees."}
        </p>
      </div>

      {!fixedBranchId && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="text-xs font-medium text-slate-600">Branch:</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            data-testid="accountant-manage-branch-select"
          >
            <option value="">— Select a branch —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select>
        </div>
      )}

      {!branchId ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400" data-testid="accountant-manage-empty">
          Pick a branch above to view/edit its payment mode settings.
        </div>
      ) : loading || !settings ? (
        <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
      ) : (
        <>
          <ModeGroup title="Consultation Fee — Payment Modes" field="consultation_fee_payment_modes" options={CONSULTATION_FEE_MODES} />
          <ModeGroup title="Treatment Fee — Payment Modes" field="treatment_fee_payment_modes" options={TREATMENT_FEE_MODES} />
          {!readOnly && (
            <Button onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-700" data-testid="accountant-manage-save">
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </>
      )}
    </div>
  );
};

export default AccountantManageTab;
