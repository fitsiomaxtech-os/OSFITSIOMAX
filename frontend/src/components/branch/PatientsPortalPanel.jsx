import { useCallback, useEffect, useState } from "react";
import { Copy, PhoneCall, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  getBranchBoard, updateLead,
  getPortalAccountStatus, createOrResetPortalAccount,
} from "@/lib/api";

/** Same E.164-for-wa.me sanitizer used in BranchAdminBoard.jsx / PhysioBoard.jsx —
 *  duplicated locally rather than exported/shared, matching how this codebase already
 *  keeps this small helper alongside each file that needs it. */
const waNumber = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};

const WhatsAppIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884M20.52 3.449C18.24 1.245 15.24.03 12.045 0c-6.472 0-11.734 5.262-11.736 11.735a11.7 11.7 0 001.567 5.87L.057 24l6.607-1.732a11.7 11.7 0 005.376 1.37h.005c6.472 0 11.734-5.262 11.735-11.734a11.68 11.68 0 00-3.26-8.457" />
  </svg>
);

const portalUrl = () => `${window.location.origin}/portal`;

export const PatientsPortalPanel = ({ branchId }) => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const data = await getBranchBoard(branchId);
      // A lead becomes a patient the moment any Treatment Fee amount is recorded —
      // same convention ConsultationsBoard's "Treatments" filter already uses.
      setLeads((data.leads || []).filter((l) => l.treatment_fee_paid != null));
    } catch { /* silent */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const visible = q
    ? leads.filter((l) => (l.name || "").toLowerCase().includes(q) || (l.phone || "").includes(q))
    : leads;

  return (
    <div data-testid="branch-patients-panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Patients</h3>
        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-semibold text-sky-700">{visible.length} patients</span>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search patient by name or phone..."
        className="mb-3 h-10 max-w-sm"
        data-testid="branch-patients-search"
      />

      {visible.length === 0 && !loading ? (
        <div className="py-16 text-center">
          <User className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <p className="text-sm text-slate-400">No patients yet — a lead shows up here once their Treatment Fee is collected</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Treatment Fee</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setSelected(l)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                  data-testid={`branch-patient-row-${l.id}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-bold text-sky-700">
                        {l.name?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                      <span className="font-medium text-slate-800">{l.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.phone || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">Rs.{l.treatment_fee_paid} <span className="capitalize text-slate-400">({l.treatment_fee_payment_mode})</span></td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Paid</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <PatientPortalDetailModal
          lead={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
            setSelected((prev) => (prev ? { ...prev, ...updated } : prev));
          }}
        />
      )}
    </div>
  );
};

function PatientPortalDetailModal({ lead, onClose, onSaved }) {
  const [name, setName] = useState(lead.name || "");
  const [phone, setPhone] = useState(lead.phone || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [account, setAccount] = useState(null); // { exists, email? } | null while loading
  const [emailInput, setEmailInput] = useState(lead.email || "");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(null); // { email, password } | null

  const loadAccount = useCallback(async () => {
    try { setAccount(await getPortalAccountStatus(lead.id)); } catch { setAccount({ exists: false }); }
  }, [lead.id]);

  useEffect(() => { loadAccount(); }, [loadAccount]);

  const saveProfile = async () => {
    if (!name.trim() || !phone.trim()) { toast.error("Name and phone are required"); return; }
    setSavingProfile(true);
    try {
      const updated = await updateLead(lead.id, { name: name.trim(), phone: phone.trim() });
      toast.success("Patient details updated");
      onSaved(updated);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update patient");
    }
    setSavingProfile(false);
  };

  const generateAccess = async () => {
    setCreating(true);
    try {
      const result = await createOrResetPortalAccount(lead.id, { email: emailInput.trim() || undefined });
      setJustCreated(result);
      setAccount({ exists: true, email: result.email });
      toast.success(account?.exists ? "Portal password reset" : "Portal access created");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to create portal access");
    }
    setCreating(false);
  };

  const shareOnWhatsApp = () => {
    if (!justCreated) return;
    const num = waNumber(phone);
    if (!num) { toast.error("This patient has no phone number on file"); return; }
    const text = [
      `Hi ${name}, here are your Fitsiomax Client Portal details:`,
      `Link: ${portalUrl()}`,
      `Username: ${justCreated.email}`,
      `Password: ${justCreated.password}`,
    ].join("\n");
    // Same-tab handoff, not window.open(..., "_blank") — that leaves the tab on a
    // blank white screen on the way back on mobile (see PhysioBoard's Call/WhatsApp fix).
    window.location.href = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  };

  const copyCredentials = async () => {
    if (!justCreated) return;
    const text = `${portalUrl()}\nUsername: ${justCreated.email}\nPassword: ${justCreated.password}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy — copy manually");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl" data-testid="branch-patient-detail-modal">
        <div className="flex items-center justify-between border-b p-5">
          <h3 className="text-base font-semibold text-slate-800">{lead.name}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5 text-slate-400" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Patient Details</p>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" data-testid="branch-patient-name-input" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9" data-testid="branch-patient-phone-input" />
            </div>
            <Button
              size="sm"
              className="bg-sky-600 text-xs hover:bg-sky-700"
              onClick={saveProfile}
              disabled={savingProfile || (name.trim() === lead.name && phone.trim() === lead.phone)}
              data-testid="branch-patient-save"
            >
              {savingProfile ? "Saving..." : "Save Changes"}
            </Button>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Treatment Fee</p>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Paid</span>
            </div>
            <p className="text-xs text-slate-600">Rs.{lead.treatment_fee_paid} <span className="capitalize text-slate-400">via {lead.treatment_fee_payment_mode}</span></p>
          </div>

          <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Client Portal</p>

            {account === null ? (
              <p className="text-xs text-slate-400">Loading...</p>
            ) : (
              <>
                {account.exists && (
                  <p className="text-xs text-slate-600">Current login: <span className="font-semibold text-slate-800">{account.email}</span></p>
                )}

                {!account.exists && (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-500">Email (used to log in)</label>
                    <Input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="patient@example.com"
                      className="h-9"
                      data-testid="branch-patient-portal-email"
                    />
                  </div>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={generateAccess}
                  disabled={creating || (!account.exists && !emailInput.trim())}
                  data-testid="branch-patient-portal-generate"
                >
                  {creating ? "Working..." : account.exists ? "Reset Password" : "Generate Portal Access"}
                </Button>

                {justCreated && (
                  <div className="space-y-2 rounded-md border border-violet-300 bg-white p-3" data-testid="branch-patient-portal-credentials">
                    <p className="text-[11px] font-semibold text-violet-700">Share these once — the password won't be shown again</p>
                    <p className="text-xs text-slate-700">Link: <span className="break-all font-mono">{portalUrl()}</span></p>
                    <p className="text-xs text-slate-700">Username: <span className="font-mono">{justCreated.email}</span></p>
                    <p className="text-xs text-slate-700">Password: <span className="font-mono">{justCreated.password}</span></p>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="flex-1 bg-[#25D366] text-xs text-white hover:bg-[#1da851]" onClick={shareOnWhatsApp} data-testid="branch-patient-portal-whatsapp">
                        <WhatsAppIcon className="mr-1.5 h-3.5 w-3.5" /> Share on WhatsApp
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={copyCredentials} data-testid="branch-patient-portal-copy">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => { if (phone) window.location.href = `tel:${phone.replace(/[^0-9+]/g, "")}`; }} data-testid="branch-patient-portal-call">
                        <PhoneCall className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
