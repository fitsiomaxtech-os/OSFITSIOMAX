import { useCallback, useEffect, useState } from "react";
import { Copy, Phone, PhoneCall, RefreshCw, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import {
  getBranchBoard, updateLead,
  getPortalAccountStatus, createOrResetPortalAccount,
} from "@/lib/api";
// Was a local copy of waNumber, identical to the three still inlined elsewhere. Now that
// lib/phone.js exists this one points at it — the others can follow as they're touched.
import { waNumber } from "@/lib/phone";

const portalUrl = () => `${window.location.origin}/portal`;

/**
 * Whether this patient is on a course of treatment, and so belongs on this list.
 *
 * Mirrors has_treatment() in backend/routers/v3_patient_portal.py — the server enforces
 * it on the account itself, and this keeps the list from offering someone the server will
 * then refuse. Change one and change the other.
 *
 * Presence, never an amount: a patient on a 10,000 package who has paid 2,000 is
 * mid-treatment and belongs here. Excluded are "Consultation Only" and anyone who came
 * for a Diet Consultation alone — paying patients both, treatment patients neither.
 */
const hasTreatment = (l) => (
  l.treatment_fee_paid != null
  || !!l.session_package_id
  || l.consultation_decision === "consultation_treatment"
);

/** Everything this patient has actually paid. Everyone listed here is on treatment, but
    many also have a Consultation Fee and some a Diet one, so the column reports the total
    rather than a single fee that only ever tells part of it. */
const feesPaid = (l) => (l.package_paid || 0) + (l.treatment_fee_paid || 0) + (l.diet_fee_paid || 0);

/** Green once any money is in, amber while none is. Deliberately not a judgement about
    whether the whole package is settled — a partial payer is a normal treatment patient,
    and Accountant Manage is where a balance is chased. */
const PaidBadge = ({ lead }) => (
  feesPaid(lead) > 0 ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Paid</span>
  ) : (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Awaiting</span>
  )
);

/** Which fees make up that figure. A patient whose treatment package is chosen but whose
    money has not come in yet belongs on this list and has none, so that case is named
    rather than rendering an empty pair of brackets. */
const feeParts = (l) => [
  l.package_paid != null ? "Consultation" : null,
  l.treatment_fee_paid != null ? "Treatment" : null,
  l.diet_fee_paid != null ? "Diet" : null,
].filter(Boolean).join(" + ") || "nothing collected yet";

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
      setLeads((data.leads || []).filter(hasTreatment));
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

      {/* Refresh beside the search, icon-only and grey, as the other boards carry it. The
          list is a snapshot of the branch board — a patient who pays or starts treatment
          in another tab appears only on a reload, and there was no way to ask for one. */}
      <div className="mb-3 flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient by name or phone..."
          className="h-10 min-w-0 flex-1 sm:max-w-sm sm:flex-none"
          data-testid="branch-patients-search"
        />
        <Button
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="branch-patients-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {visible.length === 0 && !loading ? (
        <div className="py-16 text-center">
          <User className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <p className="text-sm text-slate-400">No patients yet — a lead shows up here once they are on a course of treatment</p>
        </div>
      ) : (
        <>
        {/* Cards on a phone. Four columns can't hold their width there — the phone
            column was cut off mid-number, which is the one thing this list is used to
            look up. Call and WhatsApp sit on the card for the same reason. */}
        <div className="space-y-2 md:hidden" data-testid="branch-patients-mobile">
          {visible.map((l) => {
            const wa = waNumber(l.phone);
            return (
              // A div, not a button: the actions below are interactive themselves.
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(l)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(l); } }}
                className="w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-3 text-left active:bg-slate-50"
                data-testid={`branch-patient-card-${l.id}`}
              >
                <div className="flex items-start gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-bold text-sky-700">
                    {l.name?.charAt(0)?.toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-semibold text-slate-800">{l.name}</span>
                      <span className="shrink-0"><PaidBadge lead={l} /></span>
                    </div>
                    <p className="truncate text-xs text-slate-600">{l.phone || "—"}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Rs.{feesPaid(l)} paid
                      <span className="text-slate-400"> · {feeParts(l)}</span>
                    </p>
                  </div>
                </div>
                {wa && (
                  <div className="mt-2.5 flex gap-2 border-t border-slate-100 pt-2.5">
                    <a
                      href={`tel:${wa}`}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-700 active:bg-slate-100"
                      data-testid={`branch-patient-call-${l.id}`}
                    >
                      <Phone className="h-3.5 w-3.5" /> Call
                    </a>
                    <a
                      href={`https://wa.me/${wa}`}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 py-2 text-xs font-semibold text-[#128C7E] active:bg-[#25D366]/20"
                      data-testid={`branch-patient-whatsapp-${l.id}`}
                    >
                      <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-500 text-left text-xs uppercase text-white">
              <tr>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Fees Paid</th>
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
                  <td className="px-4 py-3 text-slate-600">Rs.{feesPaid(l)} <span className="text-slate-400">({feeParts(l)})</span></td>
                  {/* Not a blanket "Paid": a patient can be on treatment with a balance
                      still owed, or with nothing collected yet, and both belong here. */}
                  <td className="px-4 py-3"><PaidBadge lead={l} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
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
    // Blank lines between each field, *bold* labels (WhatsApp markdown), and the
    // auto-linked URL last on its own line — a credential sandwiched right next to
    // label text with no visual gap is exactly what gets over-selected on a small
    // touchscreen when the patient copies it by hand.
    const text = [
      `Hi ${name}, here is your Fitsiomax Client Portal access:`,
      "",
      `*Username:* ${justCreated.email}`,
      "",
      `*Password:* ${justCreated.password}`,
      "",
      `*Login here:* ${portalUrl()}`,
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

          {/* Each fee that was actually collected, rather than a Treatment Fee row that
              read "Rs.undefined" for a patient who never had one. */}
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fees Paid</p>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Rs.{feesPaid(lead)}</span>
            </div>
            <div className="space-y-1 text-xs text-slate-600">
              {feesPaid(lead) === 0 && <p className="text-slate-400">Nothing collected yet.</p>}
              {lead.package_paid != null && (
                <p>Consultation Rs.{lead.package_paid} <span className="capitalize text-slate-400">via {lead.package_payment_mode}</span></p>
              )}
              {lead.treatment_fee_paid != null && (
                <p>Treatment Rs.{lead.treatment_fee_paid} <span className="capitalize text-slate-400">via {lead.treatment_fee_payment_mode}</span></p>
              )}
              {lead.diet_fee_paid != null && (
                <p>Diet Rs.{lead.diet_fee_paid} <span className="capitalize text-slate-400">via {lead.diet_fee_payment_mode}</span></p>
              )}
            </div>
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
