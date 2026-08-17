import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Plus, RefreshCw, Save, Salad, Stethoscope, Activity, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { toast } from "@/components/ui/sonner";
import {
  createShift,
  deleteShift,
  getShiftRoster,
  listShifts,
  setDoctorShift,
  updateShift,
} from "@/lib/api";
import { to12h } from "@/lib/time";

/**
 * TIME MANAGEMENT — the hours the branch runs, and who works which of them.
 *
 * A calendar used to be opened across one fixed window for everybody (8 AM to 10 PM),
 * which is not how the floor works: a morning physio leaves at 2 and an evening consultant
 * only starts at 3. Publishing a 9 PM slot for either offers a patient a time nobody will
 * be there for.
 *
 * So a window gets a name — Morning, Evening, Online, Full Time — and an expert gets put on
 * one. From then on their CONSULTANT / PHYSIO / DIET calendar is cut across exactly those
 * hours: pick Yamini on Morning here, and her day opens 7 AM – 2 PM over there.
 *
 * The four seeded shifts are a starting point, not a rule — name and both ends are editable
 * and a branch can add its own, because every clinic keeps its own hours.
 *
 * Changing a shift never touches slots already published. It governs the days opened from
 * then on, so a patient booked into a 6 PM slot keeps it when the physio moves to mornings;
 * closing that day down is the Unsave button on the calendar, deliberately a separate act.
 */

// The three calendars this rosters, in the order MANAGEMENT lists them. `profile_type` is
// what the backend keys experts on — the same value each calendar tab passes.
const CALENDAR_KINDS = [
  { key: "head_physio", label: "CONSULTANT CALENDAR", short: "Consultant", icon: Stethoscope, noun: "CONSULTANT", plural: "CONSULTANTS" },
  { key: "physio", label: "PHYSIO CALENDAR", short: "Physio", icon: Activity, noun: "Physio", plural: "Physios" },
  { key: "nutrition_coach", label: "DIET CALENDAR", short: "Diet", icon: Salad, noun: "Nutritionist", plural: "Nutritionists" },
];

const NEW_SHIFT = { name: "", start_time: "09:00", end_time: "18:00" };

const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

/** "07:00"–"14:00" -> "7 hrs". The length of the working day, in the card's own words. */
const spanLabel = (start, end) => {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === null || to === null || to <= from) return "—";
  const mins = to - from;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs ? `${hrs} hr${hrs > 1 ? "s" : ""}` : ""}${rem ? `${hrs ? " " : ""}${rem} min` : ""}` || "—";
};

const windowLabel = (start, end) => `${to12h(start)} – ${to12h(end)}`;

/** One editable shift. Kept local until Save, so a half-typed time never reaches the API. */
function ShiftCard({ shift, onSaved, onDeleted }) {
  const [draft, setDraft] = useState({ name: shift.name, start_time: shift.start_time, end_time: shift.end_time });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Re-sync when the list reloads under it (another edit saved, or a refresh), otherwise
  // the card would keep showing values the server no longer holds.
  useEffect(() => {
    setDraft({ name: shift.name, start_time: shift.start_time, end_time: shift.end_time });
  }, [shift.id, shift.name, shift.start_time, shift.end_time]);

  const dirty = draft.name !== shift.name || draft.start_time !== shift.start_time || draft.end_time !== shift.end_time;
  const from = minutesOf(draft.start_time);
  const to = minutesOf(draft.end_time);
  const invalid = !draft.name.trim() || from === null || to === null || to <= from;

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      const updated = await updateShift(shift.id, {
        name: draft.name.trim(),
        start_time: draft.start_time,
        end_time: draft.end_time,
      });
      toast.success(`${updated.name}: ${windowLabel(updated.start_time, updated.end_time)}`);
      await onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save the shift");
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!window.confirm(`Delete the ${shift.name} shift? Anyone on it goes back to no shift.`)) return;
    setRemoving(true);
    try {
      const res = await deleteShift(shift.id);
      toast.success(
        `${shift.name} deleted`
        + (res?.unassigned ? ` · ${res.unassigned} expert${res.unassigned > 1 ? "s" : ""} taken off it` : ""),
      );
      await onDeleted();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't delete the shift");
    }
    setRemoving(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`shift-card-${shift.id}`}>
      <div className="flex items-center gap-2">
        <Input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className="h-8 flex-1 text-sm font-semibold"
          placeholder="Shift name"
          data-testid={`shift-name-${shift.id}`}
        />
        <button
          type="button"
          onClick={remove}
          disabled={removing}
          title="Delete this shift"
          className="shrink-0 rounded-md p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
          data-testid={`shift-delete-${shift.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 24-hour inputs on purpose — an <input type="time"> hands back "HH:MM" whatever the
          browser displays, which is exactly what the API stores. The 12-hour reading sits
          underneath, because that is how the clinic says it out loud. */}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="time"
          value={draft.start_time}
          onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none"
          data-testid={`shift-start-${shift.id}`}
        />
        <span className="shrink-0 text-xs text-slate-400">to</span>
        <input
          type="time"
          value={draft.end_time}
          onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-sm text-slate-700 focus:border-violet-400 focus:outline-none"
          data-testid={`shift-end-${shift.id}`}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className={`min-w-0 truncate text-[11px] ${invalid ? "text-rose-500" : "text-slate-400"}`}>
          {invalid
            ? (!draft.name.trim() ? "Name it first" : "Must end after it starts")
            : `${windowLabel(draft.start_time, draft.end_time)} · ${spanLabel(draft.start_time, draft.end_time)}`}
        </p>
        {dirty && (
          <Button
            size="sm"
            onClick={save}
            disabled={saving || invalid}
            className="h-7 shrink-0 bg-violet-600 px-2.5 text-[11px] text-white hover:bg-violet-700"
            data-testid={`shift-save-${shift.id}`}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="mr-1 h-3 w-3" /> Save</>}
          </Button>
        )}
      </div>
    </div>
  );
}

export const TimeManagementPanel = ({ branchId }) => {
  const [shifts, setShifts] = useState([]);
  const [profileType, setProfileType] = useState("head_physio");
  const [experts, setExperts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  // Which expert's dropdown is mid-save — the row shows a spinner rather than the whole
  // list blanking, since several can be rostered one after another.
  const [assigning, setAssigning] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newShift, setNewShift] = useState(NEW_SHIFT);
  const [creating, setCreating] = useState(false);

  const kind = CALENDAR_KINDS.find((k) => k.key === profileType) || CALENDAR_KINDS[0];

  const loadShifts = useCallback(async () => {
    if (!branchId) return;
    try {
      const data = await listShifts(branchId);
      setShifts(data?.shifts || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load the shifts");
    }
  }, [branchId]);

  const loadRoster = useCallback(async () => {
    if (!branchId) return;
    setRosterLoading(true);
    try {
      const data = await getShiftRoster(branchId, profileType);
      setExperts(data?.experts || []);
    } catch {
      setExperts([]);
    }
    setRosterLoading(false);
  }, [branchId, profileType]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadShifts().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadShifts]);

  useEffect(() => { loadRoster(); }, [loadRoster]);

  const assign = async (expert, shiftId) => {
    setAssigning(expert.id);
    try {
      const updated = await setDoctorShift(expert.id, shiftId);
      toast.success(
        shiftId
          ? `${expert.full_name} works ${updated.shift_name} · ${windowLabel(updated.shift_start, updated.shift_end)}`
          : `${expert.full_name} taken off their shift`,
      );
      await loadRoster();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't set the shift");
    }
    setAssigning(null);
  };

  const create = async () => {
    const from = minutesOf(newShift.start_time);
    const to = minutesOf(newShift.end_time);
    if (!newShift.name.trim()) { toast.error("Give the shift a name"); return; }
    if (from === null || to === null || to <= from) { toast.error("The shift must end after it starts"); return; }
    setCreating(true);
    try {
      const created = await createShift(branchId, { ...newShift, name: newShift.name.trim() });
      toast.success(`${created.name} added · ${windowLabel(created.start_time, created.end_time)}`);
      setNewShift(NEW_SHIFT);
      setAdding(false);
      await loadShifts();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't add the shift");
    }
    setCreating(false);
  };

  // A CONSULTANT is org-wide — one record taking consultations at any branch — so the shift
  // on them may have been defined by another branch. Offer it alongside this branch's own
  // rather than showing a dropdown stuck on a value it has no option for.
  const optionsFor = useMemo(() => {
    const known = new Set(shifts.map((s) => s.id));
    return (expert) => {
      const own = shifts.map((s) => ({ id: s.id, label: `${s.name} · ${windowLabel(s.start_time, s.end_time)}` }));
      if (expert.shift_id && !known.has(expert.shift_id)) {
        own.push({
          id: expert.shift_id,
          label: `${expert.shift_name || "Shift"} · ${windowLabel(expert.shift_start, expert.shift_end)} (another branch)`,
        });
      }
      return own;
    };
  }, [shifts]);

  const rostered = experts.filter((e) => e.shift_id).length;

  return (
    <div className="flex flex-col gap-4" data-testid="time-management-root">
      {/* ------------------------------------------------- The windows themselves */}
      <section className="rounded-xl border border-slate-200 bg-white" data-testid="shift-definitions">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 p-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Clock className="h-4 w-4 text-violet-500" /> Shift Timings
            </h3>
            <p className="mt-1 text-[11px] text-slate-400">
              The hours this branch runs. Rename them or move either end — a calendar is only ever opened across the shift its expert is on.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={loadShifts} className="h-8 text-xs" data-testid="shifts-refresh">
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setAdding((v) => !v)}
              className="h-8 bg-violet-600 text-xs text-white hover:bg-violet-700"
              data-testid="shift-add-toggle"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Shift
            </Button>
          </div>
        </div>

        <div className="p-4">
          {adding && (
            <div className="mb-3 rounded-xl border border-dashed border-violet-300 bg-violet-50/40 p-3" data-testid="shift-add-form">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={newShift.name}
                  onChange={(e) => setNewShift((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Shift name (e.g. Late Evening)"
                  className="h-8 min-w-[10rem] flex-1 text-sm"
                  data-testid="shift-new-name"
                />
                <input
                  type="time"
                  value={newShift.start_time}
                  onChange={(e) => setNewShift((s) => ({ ...s, start_time: e.target.value }))}
                  className="h-8 rounded-md border border-slate-200 px-2 text-sm text-slate-700"
                  data-testid="shift-new-start"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="time"
                  value={newShift.end_time}
                  onChange={(e) => setNewShift((s) => ({ ...s, end_time: e.target.value }))}
                  className="h-8 rounded-md border border-slate-200 px-2 text-sm text-slate-700"
                  data-testid="shift-new-end"
                />
                <Button size="sm" onClick={create} disabled={creating} className="h-8 bg-violet-600 text-xs text-white hover:bg-violet-700" data-testid="shift-new-save">
                  {creating ? "Adding..." : "Add"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setAdding(false); setNewShift(NEW_SHIFT); }} className="h-8 text-xs">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading shifts…</p>
          ) : shifts.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No shifts yet — add one above.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="shift-list">
              {shifts.map((s) => (
                <ShiftCard key={s.id} shift={s} onSaved={() => Promise.all([loadShifts(), loadRoster()])} onDeleted={() => Promise.all([loadShifts(), loadRoster()])} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------- Who works which of them */}
      <section className="rounded-xl border border-slate-200 bg-white" data-testid="shift-roster">
        <div className="border-b border-slate-100 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <kind.icon className="h-4 w-4 text-violet-500" /> Who Works Which Shift
              </h3>
              <p className="mt-1 text-[11px] text-slate-400">
                Pick the calendar, then put each {kind.noun} on a shift. Their day on {kind.label} opens across those hours only.
              </p>
            </div>
            {experts.length > 0 && (
              <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700" data-testid="roster-count">
                {rostered} of {experts.length} rostered
              </span>
            )}
          </div>
          <div className="mt-3">
            <SegmentedTabs
              tabs={CALENDAR_KINDS}
              value={profileType}
              onChange={setProfileType}
              mobileCols={3}
              testid="roster-calendar-kind"
            />
          </div>
        </div>

        <div className="divide-y divide-slate-100" data-testid="roster-list">
          {rosterLoading ? (
            <p className="py-8 text-center text-xs text-slate-400">Loading {kind.plural.toLowerCase()}…</p>
          ) : experts.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">
              No {kind.plural} {profileType === "head_physio" ? "created" : "assigned to this branch"} yet — ask HR Admin to add one.
            </p>
          ) : (
            experts.map((expert) => (
              <div key={expert.id} className="flex flex-wrap items-center gap-3 p-3" data-testid={`roster-row-${expert.id}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                  {expert.full_name?.charAt(0)?.toUpperCase() || "E"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{expert.full_name}</p>
                  <p className="text-[10px] text-slate-400">
                    {expert.specialization || kind.noun}
                    {expert.slots_open > 0 && ` · ${expert.slots_open} slot${expert.slots_open > 1 ? "s" : ""} already published`}
                  </p>
                </div>
                {/* The window they will get, stated in full — the dropdown says the name,
                    this says what it means for their day. */}
                <span
                  className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    expert.shift_id ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"
                  }`}
                  data-testid={`roster-window-${expert.id}`}
                >
                  {expert.shift_id ? windowLabel(expert.shift_start, expert.shift_end) : "Full day (no shift)"}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {assigning === expert.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />}
                  <select
                    value={expert.shift_id || ""}
                    onChange={(e) => assign(expert, e.target.value)}
                    disabled={assigning === expert.id}
                    className="max-w-[15rem] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
                    data-testid={`roster-select-${expert.id}`}
                  >
                    <option value="">No shift — full day</option>
                    {optionsFor(expert).map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400">
          Moving someone to another shift changes the days opened from now on. Slots already published stay
          as they are — close them from <b>{kind.label} → Unsave</b>, so a patient's booked time is never
          dropped by a settings change.
        </p>
      </section>
    </div>
  );
};

export default TimeManagementPanel;
