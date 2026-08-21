import { useCallback, useEffect, useMemo, useState } from "react";
import { Dumbbell, IndianRupee, Pencil, Plus, RefreshCw, Search, Trash2, X, PlayCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { StatTile } from "@/components/ui/stat-tile";
import { listFitness, addFitness, updateFitness, setFitnessStatus, deleteFitness, collectFitnessPayment, renewFitness, listStoreItems } from "@/lib/api";

/**
 * Branch Admin > Fitness — the gym's membership roll.
 *
 * Its own desk beside Zumba rather than a mode of it. Zumba carries a referral pipeline,
 * masters who own a class roll and a revenue share; the gym has none of those. What it has
 * is memberships that run out and need renewing, which is why the cards here count who is
 * training, who is paused, and who owes money that is already due.
 *
 * The package list is the Fitness shelf from Services and Products — the same catalogue
 * Super Admin maintains — so a membership is always sold at a price the org actually
 * publishes, and the name and figure are copied onto the row so repricing the shelf later
 * cannot rewrite what this member was sold.
 */

const GENDERS = [
  { value: "", label: "Not set" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

const PAYMENT_MODES = [
  { value: "", label: "Nothing collected" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "account_transfer", label: "Bank Transfer" },
];
const MODE_LABELS = Object.fromEntries(PAYMENT_MODES.map((m) => [m.value, m.label]));
// Cash leaves no number behind; the other three do, and it is worth keeping.
const REFERENCE_MODES = ["upi", "card", "account_transfer"];
const REFERENCE_LABELS = { upi: "UPI ID", card: "Transaction ID", account_transfer: "Transaction ID" };

const STATUS_META = {
  active: { label: "Training", classes: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  leave: { label: "On leave", classes: "border-amber-200 bg-amber-50 text-amber-700" },
  discontinued: { label: "Discontinued", classes: "border-rose-200 bg-rose-50 text-rose-700" },
};

const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const shortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", yyyy: undefined, year: "numeric" });
};

/** A month on from a date, which is what a gym membership is usually sold in. */
const monthAfter = (iso) => {
  const d = new Date(`${(iso || todayIso()).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};

// What a Fitness package off the shelf actually costs. Store items hold a per-session rate
// and a session count in both modes, so the membership price is the two multiplied out —
// the same arithmetic the Zumba plan picker does, for the same stored shape.
const packageTotal = (item) => Math.round(
  (Number(item?.price_offline ?? item?.price_online) || 0) * (item?.sessions_offline || item?.sessions_online || 0),
);
const packageSessions = (item) => item?.sessions_offline || item?.sessions_online || 0;

const FieldLabel = ({ children }) => (
  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</label>
);

/** One dropdown shape, so the form's several selects cannot drift into several looks. */
const FormSelect = ({ value, onChange, children, testid }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-sky-400 focus:outline-none"
    data-testid={testid}
  >
    {children}
  </select>
);

export const FitnessPanel = ({ branchId }) => {
  const [data, setData] = useState({ registrations: [], counts: {}, totals: {} });
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [card, setCard] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [editing, setEditing] = useState(null);   // a row, or {} for a new one
  const [collecting, setCollecting] = useState(null);
  const [renewing, setRenewing] = useState(null); // the membership being sold another term
  const [viewing, setViewing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listFitness(branchId));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't load memberships");
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  // The Fitness shelf, loaded once. Sold as a session package like everything else in the
  // store, which is why this asks for that item_type rather than a kind of its own.
  useEffect(() => {
    listStoreItems("fitness", "session").then((rows) => setPackages(rows || [])).catch(() => setPackages([]));
  }, []);

  const rows = data.registrations || [];
  const counts = data.counts || {};

  // Which rows a card shows. Kept in step with the server's own counting — the cards read
  // the server's numbers, so a card that filtered differently would show a count and a list
  // that disagree.
  const CARDS = [
    { key: "all", label: "All", value: counts.all, color: "#6366f1", sub: "on the roll" },
    { key: "current", label: "Current", value: counts.current, color: "#059669", sub: "training now" },
    { key: "unpaid", label: "Not Paid", value: counts.unpaid_this_month, color: "#dc2626", sub: "due this month" },
    { key: "paid", label: "Paid Up", value: counts.paid, color: "#0284c7", sub: "nothing owed" },
    { key: "discontinued", label: "Discontinued", value: counts.discontinued, color: "#64748b", sub: "left the gym" },
  ];

  const monthStart = data.month_start || "";
  const isUnpaidThisMonth = (r) => {
    if (Number(r.fee_amount || 0) <= 0) return false;
    if (Number(r.fee_paid || 0) >= Number(r.fee_amount || 0)) return false;
    if (r.status === "discontinued") return false;
    const due = (r.due_date || "").slice(0, 10);
    if (!due) return true;
    // Anything due before the start of next month is already owed.
    return due < monthAfter(monthStart || todayIso());
  };

  const visible = useMemo(() => {
    let list = rows;
    // Matches the server's own counting — a card whose list filtered differently would
    // show a number and a set of rows that disagree.
    if (card === "current") list = list.filter((r) => r.status !== "discontinued");
    else if (card === "discontinued") list = list.filter((r) => r.status === "discontinued");
    else if (card === "paid") list = list.filter((r) => r.fully_paid);
    else if (card === "unpaid") list = list.filter(isUnpaidThisMonth);

    if (modeFilter === "none") list = list.filter((r) => !r.payment_mode);
    else if (modeFilter !== "all") list = list.filter((r) => r.payment_mode === modeFilter);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        (r.name || "").toLowerCase().includes(q)
        || (r.phone || "").toLowerCase().includes(q)
        || (r.package_name || "").toLowerCase().includes(q));
    }
    return list;
  }, [rows, card, modeFilter, search, monthStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeStatus = async (row, status) => {
    try {
      const res = await setFitnessStatus(row.id, status);
      toast.success(res?.message || "Updated");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't update");
    }
  };

  const remove = async (row) => {
    try {
      await deleteFitness(row.id);
      toast.success(`${row.name} removed`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="space-y-4" data-testid="branch-fitness-panel">
      {/* Five columns for five cards. It asked for six, so on a wide screen the row
          stopped a column short of the page and left a gap that read as a card yet to
          load. Written as a literal because Tailwind reads class names out of the source:
          a count built from CARDS.length at runtime compiles to nothing. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {CARDS.map((c) => (
          <StatTile
            key={c.key}
            label={c.label}
            value={c.value ?? 0}
            sub={c.sub}
            icon={Dumbbell}
            color={c.color}
            active={card === c.key}
            onClick={() => setCard(c.key)}
            testid={`fitness-card-${c.key}`}
          />
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Dumbbell className="h-4 w-4 text-slate-400" /> Gym Memberships
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{visible.length}</span>
          </p>
          <div className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone or package..."
              className="h-10 pl-8"
              data-testid="fitness-search"
            />
          </div>
          <Button
            onClick={load}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="h-10 w-10 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
            data-testid="fitness-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={() => setEditing({})}
            className="h-10 w-10 shrink-0 bg-sky-600 p-0 text-white hover:bg-sky-700 sm:w-auto sm:px-4"
            title="Add Member"
            aria-label="Add Member"
            data-testid="fitness-add-btn"
          >
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Add Member</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Paid by</span>
          {[{ value: "all", label: "All Modes" }, ...PAYMENT_MODES.filter((m) => m.value), { value: "none", label: "Nothing collected" }].map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setModeFilter(m.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                modeFilter === m.value
                  ? "border-sky-600 bg-sky-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
              }`}
              data-testid={`fitness-mode-${m.value}`}
            >
              {m.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-slate-500">
            Collected <b className="text-emerald-700">{rupees(data.totals?.fee_paid)}</b>
            {" · "}Outstanding <b className="text-rose-700">{rupees(data.totals?.fee_due)}</b>
          </span>
        </div>

        {loading && rows.length === 0 ? (
          <p className="px-4 py-14 text-center text-sm text-slate-400" data-testid="fitness-loading">Loading memberships...</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center" data-testid="fitness-empty">
            <Dumbbell className="h-9 w-9 text-slate-300" />
            <p className="text-sm text-slate-500">
              {rows.length === 0 ? "No gym members yet." : "Nothing matches this filter."}
            </p>
            {rows.length === 0 && (
              <p className="text-xs text-slate-400">Click <span className="font-semibold">Add Member</span> to register the first one.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] table-fixed text-left text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {/* The Zumba tab's columns, in its order and under its names, so a branch
                    reading one roll after the other reads the same row twice rather than
                    two layouts for the same kind of person. */}
                <tr>
                  <th className="w-[4%] px-3 py-2.5">S.No</th>
                  <th className="w-[17%] px-3 py-2.5">Name</th>
                  <th className="w-[11%] px-3 py-2.5">Phone Number</th>
                  <th className="w-[13%] px-3 py-2.5">Package</th>
                  <th className="w-[9%] px-3 py-2.5">Start</th>
                  <th className="w-[9%] px-3 py-2.5">Finish</th>
                  <th className="w-[9%] px-3 py-2.5">Collected</th>
                  <th className="w-[9%] px-3 py-2.5">Due</th>
                  <th className="w-[9%] px-3 py-2.5">Status</th>
                  <th className="w-[10%] px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r, i) => {
                  const meta = STATUS_META[r.status] || STATUS_META.active;
                  const due = Number(r.fee_due || 0);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setViewing(r)}
                      className="cursor-pointer align-top hover:bg-slate-50/60"
                      data-testid={`fitness-row-${r.id}`}
                    >
                      <td className="px-3 py-3 text-xs leading-5 text-slate-400">{i + 1}</td>
                      {/* Age and gender go to the record, as they do on the Zumba tab: the
                          day they joined has a column of its own now, and the columns
                          beside the name are what the list is read for. */}
                      <td className="px-3 py-3">
                        <p className="max-w-full truncate text-sm font-semibold leading-5 text-slate-800" title={r.name}>{r.name}</p>
                      </td>
                      <td className="px-3 py-3 text-xs leading-5 text-slate-600">{r.phone || "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-0.5">
                          <p className="max-w-full truncate text-xs leading-5 text-slate-600" title={r.package_name}>{r.package_name || "—"}</p>
                          {r.package_sessions ? <p className="text-[10px] leading-4 text-slate-400">{r.package_sessions} sessions</p> : null}
                        </div>
                      </td>
                      {/* When the membership began. */}
                      <td className="px-3 py-3">
                        <p className="text-xs leading-5 text-slate-600">{shortDate(r.joined_date || r.created_at)}</p>
                      </td>
                      {/* When the paid-up period runs out. The gym stores this as the date
                          the next payment falls due, which is the same day the current one
                          stops covering -- so it is that date under this heading, not a
                          second one worked out from the package. A membership with none
                          recorded says so rather than inventing one. */}
                      <td className="px-3 py-3">
                        {r.due_date
                          ? <p className="text-xs leading-5 text-slate-600">{shortDate(r.due_date)}</p>
                          : <span className="text-xs leading-5 text-slate-300">—</span>}
                      </td>
                      {/* What has come in, and what has not, in a column each. The price is
                          neither: it is their sum, and the package names it. */}
                      <td className="px-3 py-3">
                        <p className="text-xs font-semibold leading-5 text-emerald-700">{rupees(r.fee_paid)}</p>
                      </td>
                      <td className="px-3 py-3">
                        {due > 0
                          ? <p className="text-xs font-semibold leading-5 text-rose-600">{rupees(due)}</p>
                          : Number(r.fee_amount || 0) > 0
                            ? <p className="text-xs leading-5 text-emerald-600">Paid up</p>
                            : <p className="text-xs leading-5 text-slate-300">—</p>}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex whitespace-nowrap rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${meta.classes}`}>{meta.label}</span>
                      </td>
                      {/* The actions cell swallows the click: pressing Collect or Delete
                          should not also open the row behind the dialog it just opened. */}
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {/* Wherever there is a balance, whatever the membership's state.
                              This was gated on the member not having discontinued, which hid
                              the button on exactly the people a gym chases hardest: somebody
                              who left owing money still owes it, and the endpoint takes the
                              payment perfectly well — it refuses an unpriced or a paid-up
                              membership, not a closed one. Nothing to take is the only
                              reason to hide it. */}
                          {due > 0 && (
                            <button
                              onClick={() => setCollecting(r)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                              title={`Collect ${rupees(due)}`}
                              data-testid={`fitness-collect-${r.id}`}
                            >
                              <IndianRupee className="h-3.5 w-3.5" /> Collect
                            </button>
                          )}
                          {/* Only once the term is nearly up. A renewal offered in the first
                              week of a month is a button nobody presses, and one offered the
                              day after it lapses is a conversation already missed. */}
                          {r.renewal_due && (
                            <button
                              onClick={() => setRenewing(r)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100"
                              title={typeof r.days_left === "number" && r.days_left < 0
                                ? `Ran out ${Math.abs(r.days_left)} days ago — sell them another term`
                                : `${r.days_left} days left — sell them another term`}
                              data-testid={`fitness-renew-${r.id}`}
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> Renew
                            </button>
                          )}
                          {/* Bringing somebody back is the move that needed finding, so it
                              carries a word rather than an icon — a bare glyph on a
                              discontinued row reads as "play" and nothing says it restores
                              the membership. Going the other way stays an icon: it sits
                              beside Edit and Delete on every active row and would crowd
                              them out labelled. */}
                          {r.status === "active" ? (
                            <button
                              onClick={() => changeStatus(r, "discontinued")}
                              className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              title="Discontinue"
                              data-testid={`fitness-discontinue-${r.id}`}
                            >
                              <LogOut className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => changeStatus(r, "active")}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                              title="Put this membership back on the roll"
                              data-testid={`fitness-resume-${r.id}`}
                            >
                              <PlayCircle className="h-3.5 w-3.5" /> Make Current
                            </button>
                          )}
                          <button
                            onClick={() => setEditing(r)}
                            className="rounded p-1.5 text-slate-400 hover:bg-sky-50 hover:text-sky-600"
                            title="Edit"
                            data-testid={`fitness-edit-${r.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(r)}
                            className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Delete"
                            data-testid={`fitness-delete-${r.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <FitnessDetailDialog
          member={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onCollect={() => { setCollecting(viewing); setViewing(null); }}
          onStatus={(status) => { const m = viewing; setViewing(null); changeStatus(m, status); }}
        />
      )}

      {renewing && (
        <RenewMembershipDialog
          member={renewing}
          packages={packages}
          onClose={() => setRenewing(null)}
          onRenewed={load}
        />
      )}

      {collecting && (
        <CollectPaymentDialog
          member={collecting}
          onClose={() => setCollecting(null)}
          onCollected={() => { setCollecting(null); load(); }}
        />
      )}

      {editing && (
        <FitnessMemberDialog
          member={editing.id ? editing : null}
          packages={packages}
          branchId={branchId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl" data-testid="fitness-delete-dialog">
            <div className="border-b p-5">
              <h3 className="text-base font-semibold text-slate-800">Delete {confirmDelete.name}?</h3>
              <p className="mt-1 text-[11px] text-slate-500">
                The membership and its payment record go with it. To keep the record and just stop the
                membership, use Discontinue instead.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t p-4">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button size="sm" onClick={() => remove(confirmDelete)} className="bg-rose-600 text-white hover:bg-rose-700" data-testid="fitness-delete-confirm">
                Yes, delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Register a gym member, or correct one.
 *
 * Picking a package fills the fee from the shelf rather than asking for it twice, and the
 * figure stays editable afterwards — a branch discounts, and a price it cannot type is a
 * price it will record somewhere else.
 */
const FitnessMemberDialog = ({ member, packages, branchId, onClose, onSaved }) => {
  const isEdit = !!member;
  const [form, setForm] = useState(() => ({
    name: member?.name || "",
    phone: member?.phone || "",
    age: member?.age ?? "",
    gender: member?.gender || "",
    email: member?.email || "",
    address: member?.address || "",
    package_id: member?.package_id || "",
    package_name: member?.package_name || "",
    package_mode: member?.package_mode || "offline",
    package_sessions: member?.package_sessions ?? "",
    fee_amount: member?.fee_amount ?? "",
    fee_paid: member?.fee_paid ?? "",
    // Taken at the desk while the member is standing there, the way the Zumba form takes
    // it. Not part of the membership payload: it is posted through Collect the moment the
    // row exists, so the money arrives as a payment with a mode and a reference behind it
    // rather than as a balance that moved with nothing to show for it.
    collect_amount: "",
    collect_mode: "cash",
    collect_reference: "",
    payment_mode: member?.payment_mode || "",
    payment_reference: member?.payment_reference || "",
    joined_date: (member?.joined_date || "").slice(0, 10) || todayIso(),
    due_date: (member?.due_date || "").slice(0, 10) || monthAfter(todayIso()),
    status: member?.status || "active",
    notes: member?.notes || "",
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const pickPackage = (id) => {
    const item = packages.find((p) => p.id === id);
    if (!item) {
      setForm((p) => ({ ...p, package_id: "", package_name: "", package_sessions: "" }));
      return;
    }
    // The name and the figure are copied onto the member, not looked up later — repricing
    // the shelf must not rewrite what somebody was already sold.
    setForm((p) => ({
      ...p,
      package_id: item.id,
      package_name: item.name,
      package_sessions: packageSessions(item),
      fee_amount: packageTotal(item),
    }));
  };

  // Against what has actually been collected, since this form no longer sets that.
  const collected = Number(member?.fee_paid) || 0;
  const due = Math.max(0, (Number(form.fee_amount) || 0) - collected);
  // A fee below what has been taken leaves the membership overpaid, which the server
  // refuses too — said here so the button can go dead instead of the save failing.
  const overpaid = collected > (Number(form.fee_amount) || 0);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Member name is required"); return; }
    if (overpaid) { toast.error(`${rupees(collected)} has already been collected — the fee cannot be below that`); return; }
    setSaving(true);
    const payload = {
      ...form,
      age: form.age === "" ? null : Number(form.age),
      package_sessions: form.package_sessions === "" ? null : Number(form.package_sessions),
      fee_amount: Number(form.fee_amount) || 0,
      fee_paid: Number(form.fee_paid) || 0,
    };
    try {
      if (isEdit) {
        await updateFitness(member.id, payload);
        toast.success(`${form.name.trim()} updated`);
      } else {
        const created = await addFitness(payload, branchId);
        const takingNow = Number(form.collect_amount) || 0;
        if (takingNow > 0 && created?.id) {
          // Its own try: the member is registered either way, and a payment that will not
          // go through is not a reason to lose them. Says which half failed.
          try {
            await collectFitnessPayment(created.id, [{
              mode: form.collect_mode,
              amount: takingNow,
              reference: REFERENCE_MODES.includes(form.collect_mode) ? (form.collect_reference || "").trim() : "",
            }]);
            toast.success(`${form.name.trim()} registered · ${rupees(takingNow)} collected`);
          } catch (err) {
            toast.error(`${form.name.trim()} registered, but the payment did not go through: ${err?.response?.data?.detail || "try Collect on the row"}`);
          }
        } else {
          toast.success(`${form.name.trim()} registered`);
        }
      }
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || (isEdit ? "Couldn't update" : "Couldn't register"));
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl" data-testid="fitness-member-dialog">
        <div className="flex items-start justify-between border-b p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{isEdit ? `Edit ${member.name}` : "Add Gym Member"}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Packages come from Services and Products → Fitness. The fee fills in from the one you pick and stays editable.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="fitness-dialog-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Client</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel>Full Name *</FieldLabel>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus data-testid="fitness-form-name" />
              </div>
              <div>
                <FieldLabel>Phone</FieldLabel>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit number" data-testid="fitness-form-phone" />
              </div>
              <div>
                <FieldLabel>Age</FieldLabel>
                <Input type="number" min="1" max="119" value={form.age} onChange={(e) => set("age", e.target.value)} data-testid="fitness-form-age" />
              </div>
              <div>
                <FieldLabel>Gender</FieldLabel>
                <FormSelect value={form.gender} onChange={(v) => set("gender", v)} testid="fitness-form-gender">
                  {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </FormSelect>
              </div>
              <div>
                <FieldLabel>Email</FieldLabel>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="fitness-form-email" />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Address</FieldLabel>
                <Input value={form.address} onChange={(e) => set("address", e.target.value)} data-testid="fitness-form-address" />
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Membership</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel>Package</FieldLabel>
                <FormSelect value={form.package_id} onChange={pickPackage} testid="fitness-form-package">
                  <option value="">— Select a Fitness package —</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{packageSessions(p) ? ` · ${packageSessions(p)} sessions` : ""} · {rupees(packageTotal(p))}
                    </option>
                  ))}
                </FormSelect>
                {packages.length === 0 && (
                  // Says where the list comes from rather than showing an empty dropdown
                  // and leaving the branch to guess it is broken.
                  <p className="mt-1 text-[11px] text-amber-700" data-testid="fitness-no-packages">
                    No Fitness packages published yet — Super Admin adds them in Services and Products → Sessions → Fitness.
                  </p>
                )}
              </div>
              <div>
                <FieldLabel>Mode</FieldLabel>
                <FormSelect value={form.package_mode} onChange={(v) => set("package_mode", v)} testid="fitness-form-mode">
                  <option value="offline">Offline</option>
                  <option value="online">Online</option>
                </FormSelect>
              </div>
              <div>
                <FieldLabel>Sessions</FieldLabel>
                <Input type="number" min="0" value={form.package_sessions} onChange={(e) => set("package_sessions", e.target.value)} data-testid="fitness-form-sessions" />
              </div>
              <div>
                <FieldLabel>Joined</FieldLabel>
                <Input type="date" value={form.joined_date} onChange={(e) => set("joined_date", e.target.value)} data-testid="fitness-form-joined" />
              </div>
              <div>
                <FieldLabel>Next Payment Due</FieldLabel>
                <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} data-testid="fitness-form-due" />
                {/* This date is what the Not Paid card reads, so it is worth saying what it
                    does rather than leaving it as one more box. */}
                <p className="mt-1 text-[10px] text-slate-400">Drives the Not Paid card.</p>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Payment</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>Fee</FieldLabel>
                <Input type="number" min="0" value={form.fee_amount} onChange={(e) => set("fee_amount", e.target.value)} data-testid="fitness-form-fee" />
              </div>
              {/* Registering somebody usually means taking their first payment there and
                  then, which the Zumba form does on the form and this one made you save,
                  find the row and press Collect for.

                  It asks here now, but it does not write the balance: what is entered is
                  posted through Collect the instant the row exists, so it lands as a
                  payment with a mode, a reference and a name against it. That is the whole
                  reason a box for "collected" never belonged on this form -- a balance that
                  moves with nothing behind it leaves the two records disagreeing about the
                  same money. */}
              {!isEdit && Number(form.fee_amount) > 0 && (
                <div className="sm:col-span-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3" data-testid="fitness-form-collect">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Collect now (optional)</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div>
                      <FieldLabel>Amount</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        max={Number(form.fee_amount) || 0}
                        value={form.collect_amount}
                        onChange={(e) => set("collect_amount", e.target.value)}
                        placeholder="0"
                        data-testid="fitness-form-collect-amount"
                      />
                    </div>
                    <div>
                      <FieldLabel>Mode</FieldLabel>
                      <select
                        value={form.collect_mode}
                        onChange={(e) => set("collect_mode", e.target.value)}
                        className="h-10 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                        data-testid="fitness-form-collect-mode"
                      >
                        {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>{REFERENCE_LABELS[form.collect_mode] || "Reference"}</FieldLabel>
                      <Input
                        value={form.collect_reference}
                        onChange={(e) => set("collect_reference", e.target.value)}
                        disabled={!REFERENCE_MODES.includes(form.collect_mode)}
                        placeholder={REFERENCE_MODES.includes(form.collect_mode) ? "" : "Cash leaves no reference"}
                        data-testid="fitness-form-collect-reference"
                      />
                    </div>
                  </div>
                  {Number(form.collect_amount) > Number(form.fee_amount || 0) && (
                    <p className="text-[11px] font-semibold text-rose-600" data-testid="fitness-form-collect-over">
                      That is more than the fee. Collect at most {rupees(form.fee_amount)}.
                    </p>
                  )}
                  <p className="text-[10px] text-emerald-700/80">
                    Recorded as a payment on the membership, with the notes countable later through Collect.
                  </p>
                </div>
              )}
              {/* The balance itself is never typed. Shown read-only so the figure is still
                  in front of whoever is editing. */}
              <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-xs font-semibold text-slate-500">
                  Collected <b className="text-slate-700">{rupees(member?.fee_paid)}</b>
                  {isEdit && <span className="ml-1 font-normal text-slate-400">— taken with the Collect button on the row</span>}
                </span>
                <span className={`text-sm font-extrabold ${due > 0 ? "text-rose-700" : "text-emerald-700"}`} data-testid="fitness-form-balance">
                  {due > 0 ? `${rupees(due)} due` : "Paid up"}
                </span>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Notes</FieldLabel>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} data-testid="fitness-form-notes" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving || overpaid || Number(form.collect_amount || 0) > Number(form.fee_amount || 0)} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="fitness-form-save">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Register Member"}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Take a payment against a membership.
 *
 * A collection is a list of lines rather than one amount and one mode, because that is how
 * money actually arrives: two thousand in cash and the rest by UPI is one payment taken two
 * ways, and recording it as either one alone loses half of what happened.
 *
 * Cash is counted in notes. A branch emptying a drawer knows how many 500s it has, not what
 * they come to, and the count is also the thing worth keeping — "2900 cash" cannot be
 * checked against a till at the end of the day, and "1x2000, 1x500, 2x200" can.
 */
const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5];

const COLLECT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "account_transfer", label: "Bank Transfer" },
];
const COLLECT_REFERENCE_LABELS = { upi: "UPI ID", card: "Transaction ID", account_transfer: "Transaction ID" };

/** What one payment line comes to, and what a set of them adds up to.
 *
 * Counted notes settle a line rather than sitting beside it: two numbers that can disagree
 * is one number nobody trusts, and the count is the one somebody actually looked at.
 *
 * At module scope now that two dialogs take money -- collecting a balance and renewing a
 * term. Written twice they are two places for the note list or the settling rule to drift.
 */
const noteTotal = (l) => DENOMINATIONS.reduce((sum, d) => sum + d * (Number(l?.notes?.[d]) || 0), 0);
const lineTotal = (l) => (l?.mode === "cash" && noteTotal(l) > 0 ? noteTotal(l) : Number(l?.amount) || 0);
const linesTotal = (lines) => (lines || []).reduce((sum, l) => sum + lineTotal(l), 0);
const EMPTY_LINE = { mode: "cash", amount: "", reference: "", notes: {} };

/** The payment lines a dialog sends, in the shape the server settles from. */
const paymentPayload = (lines) => (lines || [])
  .filter((l) => lineTotal(l) > 0)
  .map((l) => ({
    mode: l.mode,
    amount: lineTotal(l),
    reference: l.reference || "",
    // Only sent for cash, and only what was actually counted — an empty map would read as
    // "counted nothing" rather than "did not count".
    denominations: l.mode === "cash" && noteTotal(l) > 0
      ? Object.fromEntries(DENOMINATIONS.filter((d) => Number(l.notes?.[d]) > 0).map((d) => [String(d), Number(l.notes[d])]))
      : undefined,
  }));

/** The first line missing the number its mode is traced by, so the desk is told which one
 *  is short before the round trip rather than after it. */
const lineMissingReference = (lines) => (lines || []).find(
  (l) => lineTotal(l) > 0 && COLLECT_REFERENCE_LABELS[l.mode] && !(l.reference || "").trim(),
);

/**
 * Another term on a membership that is nearly up.
 *
 * Asks the two things a renewal is: which package they are going back on, and what they
 * have handed over for it. Everything else about the member is already known and is not
 * asked again — a renewal is not a second registration.
 *
 * When the new term starts is the server's to decide, not this dialog's: it runs on from
 * the end of the current one, so a member renewing early keeps the days they paid for.
 */
const RenewMembershipDialog = ({ member, packages, onClose, onRenewed }) => {
  const [pick, setPick] = useState(null);
  const [months, setMonths] = useState(1);
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);

  const setLine = (i, patch) => setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, prev.length === 0 ? { ...EMPTY_LINE } : { ...EMPTY_LINE, mode: "upi" }]);
  const dropLine = (i) => setLines((prev) => prev.filter((_, n) => n !== i));

  const price = pick ? packageTotal(pick) * months : 0;
  const taking = linesTotal(lines);
  const over = taking > price;

  const submit = async () => {
    if (!pick) { toast.error("Pick the package they are renewing on"); return; }
    if (over) { toast.error(`That is ${rupees(taking)} against a ${rupees(price)} term`); return; }
    const missingRef = lineMissingReference(lines);
    if (missingRef) { toast.error(`Enter the ${COLLECT_REFERENCE_LABELS[missingRef.mode]}`); return; }
    setSaving(true);
    try {
      const res = await renewFitness(member.id, {
        package_id: pick.id,
        package_name: pick.name,
        package_sessions: packageSessions(pick) || null,
        fee_amount: price,
        months,
        lines: paymentPayload(lines),
      });
      // The server's own sentence, so what the branch reads back is what was recorded.
      toast.success(res?.message || "Membership renewed", { duration: 7000 });
      onRenewed();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't renew");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" data-testid="fitness-renew-dialog">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b bg-slate-50/60 p-5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-800">Renew {member.name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {member.package_name ? `${member.package_name} · ` : ""}
              {member.due_date ? `runs out ${shortDate(member.due_date)}` : "no end date on the current term"}
              {typeof member.days_left === "number"
                ? member.days_left < 0
                  ? ` · ${Math.abs(member.days_left)} days ago`
                  : ` · ${member.days_left} days left`
                : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Close" data-testid="fitness-renew-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-2">
            <FieldLabel>Renewing On</FieldLabel>
            {packages.length === 0 ? (
              <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
                No gym packages on the shelf yet. Add them in Services and Products → Fitness.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3" data-testid="fitness-renew-packages">
                {packages.map((item) => {
                  const on = pick?.id === item.id;
                  const amount = packageTotal(item);
                  const sessions = packageSessions(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPick(on ? null : item)}
                      className={`rounded-lg border p-3 text-left transition ${
                        on
                          ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                          : "border-sky-100 bg-sky-50/60 text-sky-800 hover:border-sky-300 hover:bg-sky-50"
                      }`}
                      title={item.name}
                      data-testid={`fitness-renew-package-${item.id}`}
                    >
                      <span className="block truncate text-xs font-bold">{item.name}</span>
                      <span className="mt-1 block text-lg font-extrabold leading-none">{rupees(amount)}</span>
                      {sessions ? (
                        <span className={`mt-1.5 block text-[11px] ${on ? "text-white/80" : "text-sky-700/70"}`}>
                          {sessions} sessions
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* How many of that package. A gym term is sold by the month and members often
              take several at once; multiplying here beats making them renew three times. */}
          <div className="space-y-2">
            <FieldLabel>Terms</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {[1, 3, 6, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMonths(n)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${months === n ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  data-testid={`fitness-renew-months-${n}`}
                >
                  {n} {n === 1 ? "month" : "months"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel>Fee Collected</FieldLabel>
            {lines.length === 0 ? (
              <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
                Nothing collected yet. A renewal can be recorded now and paid for later.
              </p>
            ) : (
              lines.map((l, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3" data-testid={`fitness-renew-line-${i}`}>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[150px] flex-1">
                      <FieldLabel>Paid By</FieldLabel>
                      <FormSelect value={l.mode} onChange={(v) => setLine(i, { mode: v, notes: {}, reference: "" })} testid={`fitness-renew-mode-${i}`}>
                        {COLLECT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </FormSelect>
                    </div>
                    <div className="min-w-[120px] flex-1">
                      <FieldLabel>Amount</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        value={l.mode === "cash" && noteTotal(l) > 0 ? noteTotal(l) : l.amount}
                        onChange={(e) => setLine(i, { amount: e.target.value })}
                        readOnly={l.mode === "cash" && noteTotal(l) > 0}
                        className={l.mode === "cash" && noteTotal(l) > 0 ? "bg-slate-50" : ""}
                        data-testid={`fitness-renew-amount-${i}`}
                      />
                    </div>
                    {COLLECT_REFERENCE_LABELS[l.mode] && (
                      <div className="min-w-[160px] flex-1">
                        <FieldLabel>{COLLECT_REFERENCE_LABELS[l.mode]}</FieldLabel>
                        <Input value={l.reference} onChange={(e) => setLine(i, { reference: e.target.value })} data-testid={`fitness-renew-reference-${i}`} />
                      </div>
                    )}
                    <button
                      onClick={() => dropLine(i)}
                      className="mb-1 rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Remove this line"
                      aria-label="Remove this line"
                      data-testid={`fitness-renew-drop-${i}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {l.mode === "cash" && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Notes counted
                        <span className="ml-1 font-normal normal-case text-slate-400">— leave blank to just type the amount</span>
                      </p>
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                        {DENOMINATIONS.map((d) => (
                          <div key={d}>
                            <label className="mb-0.5 block text-center text-[11px] font-bold text-slate-500">₹{d}</label>
                            <Input
                              type="number"
                              min="0"
                              value={l.notes?.[d] ?? ""}
                              onChange={(e) => setLine(i, { notes: { ...l.notes, [d]: e.target.value } })}
                              className="h-9 px-1 text-center text-sm"
                              data-testid={`fitness-renew-note-${i}-${d}`}
                            />
                          </div>
                        ))}
                      </div>
                      {noteTotal(l) > 0 && (
                        <p className="mt-2 text-right text-[11px] text-slate-500">
                          {DENOMINATIONS.filter((d) => Number(l.notes?.[d]) > 0).map((d) => `${l.notes[d]}×₹${d}`).join("  +  ")}
                          {" = "}<b className="text-slate-700">{rupees(noteTotal(l))}</b>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            <Button type="button" variant="outline" size="sm" onClick={addLine} data-testid="fitness-renew-add">
              <Plus className="mr-1 h-3.5 w-3.5" />
              {lines.length === 0 ? "Add Payment" : "Another payment mode"}
            </Button>
          </div>

          {pick && (
            <div className={`rounded-lg border p-3 ${over ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`} data-testid="fitness-renew-summary">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-600">This term</span>
                <span className={`text-lg font-extrabold ${over ? "text-rose-700" : "text-emerald-700"}`}>{rupees(price)}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-600">
                {over
                  ? `Collecting ${rupees(taking)}, which is more than the term costs.`
                  : taking >= price
                    ? "Paid up front."
                    : `${rupees(price - taking)} of it will be outstanding.`}
                {" The new term runs on from "}
                {member.due_date ? shortDate(member.due_date) : "today"}.
              </p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t bg-slate-50/60 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="fitness-renew-cancel">Cancel</Button>
          <Button size="sm" className="bg-sky-600 hover:bg-sky-700" disabled={saving || !pick || over} onClick={submit} data-testid="fitness-renew-save">
            {saving ? "Saving…" : "Renew"}
          </Button>
        </div>
      </div>
    </div>
  );
};

const CollectPaymentDialog = ({ member, onClose, onCollected }) => {
  const outstanding = Math.max(0, Number(member.fee_amount || 0) - Number(member.fee_paid || 0));
  // Starts on one cash line, because most payments are one payment. A second mode is one
  // click away rather than a form everybody fills in twice.
  const [lines, setLines] = useState([{ mode: "cash", amount: "", reference: "", notes: {} }]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const setLine = (i, patch) => setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { mode: "upi", amount: "", reference: "", notes: {} }]);
  const dropLine = (i) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, n) => n !== i)));

  const total = linesTotal(lines);
  const over = total > outstanding;
  const remaining = Math.max(0, outstanding - total);

  const submit = async () => {
    if (total <= 0) { toast.error("Enter an amount to collect"); return; }
    if (over) { toast.error(`That is ${rupees(total)} against ${rupees(outstanding)} outstanding`); return; }
    setSaving(true);
    try {
      const res = await collectFitnessPayment(member.id, paymentPayload(lines), note);
      // The server's own sentence, so what the branch reads back is what was recorded
      // rather than a second version of it assembled here.
      toast.success(res?.message || "Payment collected", { duration: 7000 });
      onCollected();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't collect");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl" data-testid="fitness-collect-dialog">
        <div className="flex items-start justify-between border-b p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Collect from {member.name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {member.package_name ? `${member.package_name} · ` : ""}Fee {rupees(member.fee_amount)} ·
              Already paid {rupees(member.fee_paid)} · <b className="text-rose-600">{rupees(outstanding)} outstanding</b>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="fitness-collect-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3" data-testid={`fitness-collect-line-${i}`}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[150px] flex-1">
                  <FieldLabel>Paid By</FieldLabel>
                  <FormSelect value={l.mode} onChange={(v) => setLine(i, { mode: v, notes: {} })} testid={`fitness-collect-mode-${i}`}>
                    {COLLECT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </FormSelect>
                </div>
                <div className="min-w-[120px] flex-1">
                  <FieldLabel>Amount</FieldLabel>
                  <Input
                    type="number"
                    min="0"
                    value={l.mode === "cash" && noteTotal(l) > 0 ? noteTotal(l) : l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    // Counted notes drive the figure, so the box shows the count rather than
                    // inviting a second, different number beside it.
                    readOnly={l.mode === "cash" && noteTotal(l) > 0}
                    className={l.mode === "cash" && noteTotal(l) > 0 ? "bg-slate-50" : ""}
                    data-testid={`fitness-collect-amount-${i}`}
                  />
                </div>
                {l.mode !== "cash" && (
                  <div className="min-w-[160px] flex-1">
                    <FieldLabel>{COLLECT_REFERENCE_LABELS[l.mode]}</FieldLabel>
                    <Input value={l.reference} onChange={(e) => setLine(i, { reference: e.target.value })} data-testid={`fitness-collect-reference-${i}`} />
                  </div>
                )}
                {lines.length > 1 && (
                  <button
                    onClick={() => dropLine(i)}
                    className="mb-1 rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Remove this line"
                    data-testid={`fitness-collect-drop-${i}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {l.mode === "cash" && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Notes counted
                    <span className="ml-1 font-normal normal-case text-slate-400">— leave blank to just type the amount</span>
                  </p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {DENOMINATIONS.map((d) => (
                      <div key={d}>
                        <label className="mb-0.5 block text-center text-[11px] font-bold text-slate-500">₹{d}</label>
                        <Input
                          type="number"
                          min="0"
                          value={l.notes?.[d] ?? ""}
                          onChange={(e) => setLine(i, { notes: { ...l.notes, [d]: e.target.value } })}
                          className="h-9 px-1 text-center text-sm"
                          data-testid={`fitness-collect-note-${i}-${d}`}
                        />
                      </div>
                    ))}
                  </div>
                  {noteTotal(l) > 0 && (
                    <p className="mt-2 text-right text-[11px] text-slate-500" data-testid={`fitness-collect-note-total-${i}`}>
                      {DENOMINATIONS.filter((d) => Number(l.notes?.[d]) > 0).map((d) => `${l.notes[d]}×₹${d}`).join("  +  ")}
                      {" = "}<b className="text-slate-700">{rupees(noteTotal(l))}</b>
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={addLine} data-testid="fitness-collect-add-line">
              <Plus className="mr-1 h-3.5 w-3.5" /> Another payment mode
            </Button>
            <div>
              <FieldLabel>Note</FieldLabel>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="min-w-[220px]" data-testid="fitness-collect-note" />
            </div>
          </div>

          <div className={`rounded-lg border p-3 ${over ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-600">Collecting now</span>
              <span className={`text-lg font-extrabold ${over ? "text-rose-700" : "text-emerald-700"}`} data-testid="fitness-collect-total">{rupees(total)}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-600" data-testid="fitness-collect-summary">
              {over
                ? `That is more than the ${rupees(outstanding)} outstanding.`
                : remaining > 0
                  ? `${rupees(remaining)} will still be due after this.`
                  : total > 0 ? "This clears the membership." : "Nothing entered yet."}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={saving || over || total <= 0}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            data-testid="fitness-collect-submit"
          >
            {saving ? "Collecting..." : `Collect ${rupees(total)}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Everything on one membership, read-only.
 *
 * The table shows what a branch scans for; this shows what it opens a row to find out. It
 * is also the only place the payment history surfaces — every collection has been kept on
 * the membership since Collect was built, with its lines, the notes counted, who took it
 * and when, and none of that was on screen anywhere.
 */
const DetailLine = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
    <span className="min-w-0 text-right text-sm text-slate-700">{children ?? "—"}</span>
  </div>
);

const FitnessDetailDialog = ({ member, onClose, onEdit, onCollect, onStatus }) => {
  const meta = STATUS_META[member.status] || STATUS_META.active;
  const due = Number(member.fee_due || 0);
  // Newest first: the last thing that happened is the thing being looked for.
  const payments = [...(member.payments || [])].reverse();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl" data-testid="fitness-detail-dialog">
        <div className="flex items-start justify-between border-b p-5">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-800">
              {member.name}
              <span className={`inline-flex rounded-[5px] border px-2 py-0.5 text-[10px] font-bold ${meta.classes}`}>{meta.label}</span>
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {member.phone || "No phone"}{member.age ? ` · ${member.age}` : ""}{member.gender ? ` · ${member.gender}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="fitness-detail-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* The same balance the Zumba tab draws: the headline first, then the three
              figures on one line in the order they happen -- what it cost, what came in,
              what is left. Stacked in a corner they read as a footnote to the balance
              rather than as the arithmetic behind it. */}
          <div className={`rounded-xl border p-4 ${due > 0 ? "border-rose-200 bg-rose-50/70" : "border-emerald-200 bg-emerald-50/70"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Balance</p>
                <p className={`mt-0.5 text-2xl font-extrabold leading-none ${due > 0 ? "text-rose-700" : "text-emerald-700"}`} data-testid="fitness-detail-balance">
                  {due > 0 ? `${rupees(due)} due` : Number(member.fee_amount || 0) > 0 ? "Paid up" : "Nothing sold yet"}
                </p>
              </div>
              {/* Offered from the balance rather than the footer, because it is the one
                  thing to do about the figure beside it. */}
              {due > 0 && (
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={onCollect} data-testid="fitness-detail-collect-top">
                  <IndianRupee className="mr-1 h-3.5 w-3.5" /> Collect {rupees(due)}
                </Button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/70 pt-3 text-center">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fee</p>
                <p className="text-sm font-bold text-slate-700">{rupees(member.fee_amount)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Collected</p>
                <p className="text-sm font-bold text-emerald-700">{rupees(member.fee_paid)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Due</p>
                <p className={`text-sm font-bold ${due > 0 ? "text-rose-700" : "text-slate-400"}`}>{due > 0 ? rupees(due) : "—"}</p>
              </div>
            </div>
          </div>

          {/* How far through the term they are, as the Zumba record shows it. The gym keeps
              no end date of its own, so the term runs to the day the next payment falls due
              -- the day the current one stops covering. The bar is time elapsed rather than
              classes left: a gym membership is sold by the month and nothing counts down
              per visit, so drawing it as sessions would be inventing a number. */}
          {(member.joined_date || member.created_at) && member.due_date && (
            <div className="rounded-xl border border-slate-200 p-4" data-testid="fitness-detail-term">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Term</p>
                <p className="text-xs font-medium text-slate-600">
                  {shortDate(member.joined_date || member.created_at)} <span className="text-slate-300">→</span> {shortDate(member.due_date)}
                </p>
              </div>
              {(() => {
                const start = new Date(`${(member.joined_date || member.created_at || "").slice(0, 10)}T00:00:00`).getTime();
                const end = new Date(`${member.due_date.slice(0, 10)}T00:00:00`).getTime();
                if (!start || !end || end <= start) return null;
                const now = Date.now();
                const leftMs = end - now;
                const daysLeft = Math.ceil(leftMs / 86400000);
                const remaining = Math.min(100, Math.max(0, (leftMs / (end - start)) * 100));
                const soon = daysLeft <= 7;
                return (
                  <>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${daysLeft <= 0 ? "bg-rose-500" : soon ? "bg-amber-500" : "bg-emerald-500"}`}
                        style={{ width: `${remaining}%` }}
                      />
                    </div>
                    <p className={`mt-1.5 text-[11px] ${daysLeft <= 0 ? "font-semibold text-rose-600" : soon ? "font-semibold text-amber-600" : "text-slate-500"}`}>
                      {daysLeft <= 0
                        ? "The term has run out."
                        : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left${soon ? " — due a renewal" : ""}.`}
                    </p>
                  </>
                );
              })()}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Customer</p>
              <DetailLine label="Phone">{member.phone}</DetailLine>
              <DetailLine label="Age">{member.age}</DetailLine>
              <DetailLine label="Gender">{member.gender}</DetailLine>
              <DetailLine label="Email">{member.email}</DetailLine>
              <DetailLine label="Address">{member.address}</DetailLine>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Membership</p>
              <DetailLine label="Package">{member.package_name}</DetailLine>
              <DetailLine label="Sessions">{member.package_sessions}</DetailLine>
              <DetailLine label="Mode">{member.package_mode}</DetailLine>
              <DetailLine label="Joined">{shortDate(member.joined_date || member.created_at)}</DetailLine>
              <DetailLine label="Next Due">{shortDate(member.due_date)}</DetailLine>
            </div>
          </div>

          {member.notes && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{member.notes}</p>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Payments <span className="font-normal normal-case text-slate-400">({payments.length})</span>
            </p>
            {payments.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400" data-testid="fitness-detail-no-payments">
                Nothing collected through Collect yet.
                {Number(member.fee_paid) > 0 && " The figure above was set on the membership directly."}
              </p>
            ) : (
              <ul className="space-y-2" data-testid="fitness-detail-payments">
                {payments.map((p) => (
                  <li key={p.id} className="rounded-md border border-slate-100 bg-slate-50/60 p-2.5" data-testid={`fitness-detail-payment-${p.id}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-emerald-700">{rupees(p.amount)}</span>
                      <span className="text-[11px] text-slate-400">
                        {shortDate(p.collected_at)}{p.collected_by ? ` · ${p.collected_by}` : ""}
                      </span>
                    </div>
                    {(p.lines || []).map((l, i) => (
                      <div key={i} className="mt-1 text-[11px] text-slate-600">
                        <span className="font-semibold">{MODE_LABELS[l.mode] || l.mode}</span> {rupees(l.amount)}
                        {l.reference ? <span className="text-slate-400"> · {l.reference}</span> : null}
                        {/* The notes counted, spelled out — this is what a till is checked
                            against at the end of the day. */}
                        {l.denominations && Object.keys(l.denominations).length > 0 && (
                          <span className="text-slate-400">
                            {" · "}
                            {Object.entries(l.denominations)
                              .sort((a, b) => Number(b[0]) - Number(a[0]))
                              .map(([note, count]) => `${count}×₹${note}`)
                              .join(" + ")}
                          </span>
                        )}
                      </div>
                    ))}
                    {p.note && <p className="mt-1 text-[11px] italic text-slate-500">{p.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Ending a membership is a decision about the person, so it is offered where the
            person is read rather than only as an icon on the row -- the same place the
            Zumba record offers it. Collect is not here: it sits on the balance it
            settles, and a second copy down here was the same button twice. */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button variant="outline" size="sm" onClick={onEdit} data-testid="fitness-detail-edit">
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
          </Button>
          {member.status === "active" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                onClick={() => onStatus("discontinued")}
                data-testid="fitness-detail-discontinue"
              >
                Discontinue
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-200 text-amber-700 hover:bg-amber-50"
                onClick={() => onStatus("leave")}
                data-testid="fitness-detail-leave"
              >
                Leave
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => onStatus("active")} data-testid="fitness-detail-restore">
              <PlayCircle className="mr-1 h-3.5 w-3.5" /> Back to training
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default FitnessPanel;
