import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, MapPin, CheckCircle2, Package as PackageIcon, RefreshCw, XCircle, Search, Phone, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { getConsultationsBoard, moveConsultationStage, listPackages, sellPackage } from "@/lib/api";

const STAGES = [
  "New Appointment",
  "Clinic Visit",
  "Package Chosen",
  "Follow Up",
  "Completed",
  "Cancelled",
];

const STAGE_META = {
  "New Appointment":  { hex: "#3b82f6", icon: Calendar },
  "Clinic Visit":     { hex: "#8b5cf6", icon: MapPin },
  "Package Chosen":   { hex: "#14b8a6", icon: PackageIcon },
  "Follow Up":        { hex: "#f97316", icon: RefreshCw },
  "Completed":        { hex: "#22c55e", icon: CheckCircle2 },
  "Cancelled":        { hex: "#f43f5e", icon: XCircle },
};

export const ConsultationsBoard = ({ branchId }) => {
  const [board, setBoard] = useState({ leads: [], stage_counts: {} });
  const [stageFilter, setStageFilter] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState(null);
  const [packages, setPackages] = useState([]);
  const [pkgPick, setPkgPick] = useState("");
  const [pkgPaid, setPkgPaid] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getConsultationsBoard(branchId);
        if (!cancelled) setBoard(res);
      } catch (err) {
        console.error("Consultations board load error:", err);
        if (!cancelled) toast.error("Failed to load consultations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [branchId]);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setLoading(true);
      const res = await getConsultationsBoard(branchId);
      setBoard(res);
    } catch (err) {
      console.error("Consultations board load error:", err);
      toast.error("Failed to load consultations");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  const filtered = useMemo(() => {
    let rows = board.leads || [];
    if (stageFilter) rows = rows.filter((l) => l.consultation_stage === stageFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((l) => `${l.name || ""} ${l.phone || ""}`.toLowerCase().includes(q));
    }
    return rows;
  }, [board.leads, stageFilter, search]);

  useEffect(() => {
    listPackages({ active_only: true }).then(setPackages).catch(() => setPackages([]));
  }, []);

  const moveStage = async (lead, next) => {
    if (next === lead.consultation_stage) return;
    try {
      const updated = await moveConsultationStage(lead.id, next);
      toast.success(`${lead.name || "Lead"} moved → ${next}`);
      setSelectedLead(null);
      // Optimistic update
      setBoard((b) => {
        const leads = (b.leads || []).map((l) => l.id === lead.id ? { ...l, consultation_stage: updated.consultation_stage } : l);
        const stage_counts = {};
        STAGES.forEach((s) => { stage_counts[s] = leads.filter((l) => l.consultation_stage === s).length; });
        return { ...b, leads, stage_counts };
      });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Move failed");
    }
  };

  return (
    <div className="space-y-3" data-testid="consultations-board">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patients in Consultations..."
          className="h-8 border-0 p-0 focus-visible:ring-0"
          data-testid="cons-search"
        />
        <Button variant="outline" size="sm" onClick={load} data-testid="cons-refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* Table */}
      <Card className="overflow-hidden border-slate-200">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Patient</th>
                <th className="px-4 py-2 text-left">Phone</th>
                <th className="px-4 py-2 text-left">Consultation Stage</th>
                <th className="px-4 py-2 text-left">Assigned Expert</th>
                <th className="px-4 py-2 text-left">Appointment</th>
                <th className="px-4 py-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const meta = STAGE_META[l.consultation_stage] || { hex: "#64748b", icon: User };
                return (
                  <tr key={l.id} onClick={() => setSelectedLead(l)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" data-testid={`cons-row-${l.id}`}>
                    <td className="px-4 py-3 font-medium text-slate-800">{l.name || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{l.phone || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: `${meta.hex}14`, color: meta.hex, border: `1px solid ${meta.hex}33` }}
                      >
                        {l.consultation_stage || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.assigned_physio_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{l.appointment_date ? `${l.appointment_date} ${l.appointment_time || ""}` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{(l.updated_at || "").slice(0, 10)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-sm text-slate-400">
                  {loading ? "Loading…" : "No leads in consultations yet. Book an appointment with a Head Physio to populate this list."}
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Detail / move-stage dialog */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="cons-detail-dialog">
          <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900" data-testid="cons-detail-title">{selectedLead.name || "Lead"}</h3>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <Phone className="h-3 w-3" /> {selectedLead.phone || "—"}
                  {selectedLead.appointment_date && (
                    <>· <Calendar className="ml-1 h-3 w-3" /> {selectedLead.appointment_date} {selectedLead.appointment_time}</>
                  )}
                </p>
                {selectedLead.assigned_physio_name && (
                  <p className="mt-0.5 text-xs text-emerald-600">Expert: {selectedLead.assigned_physio_name}</p>
                )}
              </div>
              <button onClick={() => setSelectedLead(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="cons-detail-close"><XCircle className="h-4 w-4" /></button>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Move to Stage</p>
              <div className="grid grid-cols-2 gap-1.5">
                {STAGES.map((s) => {
                  const meta = STAGE_META[s];
                  const active = selectedLead.consultation_stage === s;
                  return (
                    <button
                      key={s}
                      onClick={() => moveStage(selectedLead, s)}
                      disabled={active}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:opacity-100"
                      style={
                        active
                          ? { background: meta.hex, color: "white", borderColor: meta.hex }
                          : { background: `${meta.hex}10`, color: meta.hex, borderColor: `${meta.hex}33` }
                      }
                      data-testid={`cons-move-${s}`}
                    >
                      <span>{s}</span>
                      {active && <CheckCircle2 className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sell Package quick form */}
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3" data-testid="cons-sell-package">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-violet-700">Sell Package</p>
              {selectedLead.package_name ? (
                <p className="text-xs text-violet-800">Current package: <b>{selectedLead.package_name}</b> · {selectedLead.package_weeks}w · ₹{selectedLead.package_paid ?? selectedLead.package_price}</p>
              ) : null}
              <div className="mt-2 grid grid-cols-3 gap-2">
                <select value={pkgPick} onChange={(e) => setPkgPick(e.target.value)} className="col-span-2 h-9 rounded-md border border-violet-200 px-2 text-xs" data-testid="cons-pkg-select">
                  <option value="">-- choose a package --</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {p.weeks}w · ₹{p.price}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="0"
                  value={pkgPaid}
                  onChange={(e) => setPkgPaid(e.target.value)}
                  placeholder="Paid"
                  className="h-9"
                  data-testid="cons-pkg-paid"
                />
              </div>
              <Button
                className="mt-2 w-full bg-violet-600 hover:bg-violet-700"
                onClick={async () => {
                  if (!pkgPick) { toast.error("Choose a package"); return; }
                  try {
                    await sellPackage(selectedLead.id, { package_id: pkgPick, paid_amount: pkgPaid ? parseFloat(pkgPaid) : null });
                    toast.success("Package sold — moved to Package Chosen");
                    setPkgPick(""); setPkgPaid("");
                    setSelectedLead(null);
                    setBoard((b) => {
                      const leads = (b.leads || []).map((l) => l.id === selectedLead.id ? { ...l, consultation_stage: "Package Chosen" } : l);
                      const stage_counts = {};
                      STAGES.forEach((ss) => { stage_counts[ss] = leads.filter((l) => l.consultation_stage === ss).length; });
                      return { ...b, leads, stage_counts };
                    });
                  } catch (err) {
                    toast.error(err?.response?.data?.detail || "Failed to sell");
                  }
                }}
                data-testid="cons-pkg-sell"
              >
                Sell & Move to Package Chosen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsultationsBoard;
