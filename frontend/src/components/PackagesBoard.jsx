import { useEffect, useState } from "react";
import { Stethoscope, Activity, Dumbbell, ClipboardList, CalendarRange, Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBranches } from "@/lib/api";
import { ConsultationsBoard } from "@/components/ConsultationsBoard";

const TABS = [
  { key: "consultation", label: "Consultation", icon: Stethoscope },
  { key: "treatment", label: "Treatment", icon: Activity },
  { key: "rehab", label: "Rehab", icon: Dumbbell },
];

const PlaceholderPanel = ({ label, testid }) => (
  <Card data-testid={testid}>
    <CardContent className="p-8 text-center text-sm text-slate-400">
      {label} panel — setup coming soon.
    </CardContent>
  </Card>
);

const CONSULTATION_SUBTABS = [
  { key: "consultation", label: "Consultation", icon: Stethoscope },
  { key: "assessment", label: "Consultation + Assessment", icon: ClipboardList },
  { key: "sessions", label: "Session Creation", icon: CalendarRange },
];

const ConsultationBoardPanel = () => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");

  useEffect(() => {
    getBranches().then((rows) => {
      setBranches(rows);
      if (rows.length === 1) setBranchId(rows[0].id);
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-3" data-testid="consultation-subpanel-consultation">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600">Branch</label>
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="h-9 rounded-md border border-slate-200 px-2 text-sm"
          data-testid="packages-consultation-branch-select"
        >
          <option value="">Select branch...</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.branch_name || b.name}</option>
          ))}
        </select>
      </div>
      {branchId ? (
        <ConsultationsBoard branchId={branchId} />
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            Select a branch to view its consultations.
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const WEEKS_PER_MONTH = 4;
const makeMonth = () => ({ weeks: Array.from({ length: WEEKS_PER_MONTH }, () => ({ created: false, details: "" })) });

const SessionCreationPanel = () => {
  const [months, setMonths] = useState([makeMonth()]);
  const [selected, setSelected] = useState(0); // flat index across all weeks

  const addMonth = () => setMonths((m) => [...m, makeMonth()]);

  const flatWeeks = months.flatMap((mo, monthIdx) => mo.weeks.map((w, weekIdx) => ({ ...w, monthIdx, weekIdx })));
  const selectedWeek = flatWeeks[selected];

  const updateSelectedWeek = (patch) => {
    setMonths((m) => m.map((mo, mi) => {
      if (mi !== selectedWeek.monthIdx) return mo;
      const weeks = mo.weeks.slice();
      weeks[selectedWeek.weekIdx] = { ...weeks[selectedWeek.weekIdx], ...patch };
      return { ...mo, weeks };
    }));
  };

  const createSession = () => updateSelectedWeek({ created: true });
  const deleteSession = () => updateSelectedWeek({ created: false, details: "" });

  return (
    <div className="space-y-4" data-testid="consultation-subpanel-sessions">
      <div className="flex flex-wrap gap-2" data-testid="session-week-selector">
        {flatWeeks.map((w, idx) => (
          <button
            key={idx}
            onClick={() => setSelected(idx)}
            data-testid={`session-week-chip-${idx + 1}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              idx === selected
                ? "bg-sky-600 text-white"
                : w.created
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Week {idx + 1}
          </button>
        ))}
      </div>

      <Card data-testid="session-selected-week-panel">
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-semibold text-slate-800">Month {selectedWeek.monthIdx + 1} · Week {selected + 1} Session</p>
          {selectedWeek.created ? (
            <>
              <Input
                value={selectedWeek.details}
                onChange={(e) => updateSelectedWeek({ details: e.target.value })}
                placeholder="Session details..."
                data-testid={`session-week-${selected + 1}-input`}
              />
              <Button variant="outline" className="text-rose-600 hover:bg-rose-50" onClick={deleteSession} data-testid="session-delete-btn">
                <Trash2 className="mr-1 h-4 w-4" />Delete Session
              </Button>
            </>
          ) : (
            <Button onClick={createSession} data-testid="session-create-btn">
              <Plus className="mr-1 h-4 w-4" />Create Session
            </Button>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={addMonth} data-testid="session-add-month">
        <Plus className="mr-1 h-4 w-4" />Add Month
      </Button>
    </div>
  );
};

const ConsultationTab = () => {
  const [sub, setSub] = useState("consultation");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="consultation-subtabs">
        {CONSULTATION_SUBTABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              data-testid={`consultation-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {sub === "consultation" && <ConsultationBoardPanel />}
      {sub === "assessment" && <PlaceholderPanel label="Consultation + Assessment" testid="consultation-subpanel-assessment" />}
      {sub === "sessions" && <SessionCreationPanel />}
    </div>
  );
};

export const PackagesBoard = () => {
  const [tab, setTab] = useState("consultation");

  return (
    <div className="space-y-4" data-testid="packages-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Packages</h2>
        <p className="text-sm text-slate-500">Manage Consultation, Treatment, and Rehab packages.</p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="packages-subtabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`packages-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-violet-50 text-violet-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "consultation" && <ConsultationTab />}
      {tab === "treatment" && <PlaceholderPanel label="Treatment" testid="packages-panel-treatment" />}
      {tab === "rehab" && <PlaceholderPanel label="Rehab" testid="packages-panel-rehab" />}
    </div>
  );
};

export default PackagesBoard;
