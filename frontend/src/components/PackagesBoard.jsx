import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Stethoscope, CalendarRange, Pill, Dumbbell, ShoppingCart, Activity, Plus, X, FlaskConical, Pencil, Trash2, ImagePlus, Wifi, MapPin, Clock, Eye, History, Salad, ChevronDown, RefreshCw, ClipboardList, HeartPulse, Music2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { uploadStoreImage, createStoreItem, updateStoreItem, deleteStoreItem, listStoreItems, getPaymentHistory, getFollowUpHistory, getLoginHistory, getBranches } from "@/lib/api";
import { StoreInventoryPanel } from "@/components/branch/StoreInventoryPanel";
import { TreatmentTypesBoard } from "@/components/TreatmentTypesBoard";
import { PhysioTypesBoard } from "@/components/PhysioTypesBoard";

export const TABS = [
  { key: "consultations", label: "Consultations", icon: Stethoscope },
  { key: "sessions", label: "Sessions", icon: CalendarRange },
  // Three more programmes sold the same way a session package is — same create form, same
  // per-session pricing — each with its own catalogue rather than a sub-tab of Sessions,
  // because that is the shelf a branch browses them from. Zumba is offline only; the
  // other two sell both ways (see MODE_TAB_KEYS).
  { key: "rehab", label: "Rehab", icon: HeartPulse },
  { key: "zumba", label: "Zumba Class", icon: Music2 },
  { key: "fitness", label: "Fitness", icon: Dumbbell },
  { key: "diet", label: "Diet Package", icon: Salad },
  { key: "tablet", label: "Tablet", icon: Pill },
  { key: "supplementary", label: "Supplementary", icon: FlaskConical },
  { key: "equipment", label: "Equipment", icon: Dumbbell },
  { key: "vending_machine", label: "Vending Machine", icon: ShoppingCart },
  // Moved in from its own top-level nav tab — the treatment catalogue belongs beside the
  // other things Super Admin catalogues here, not among Dashboard/HR/Branches.
  { key: "treatment", label: "Treatments", icon: ClipboardList },
  // Beside Treatments, and after it, because the two are read together: a treatment is
  // what is wrong with the patient, a physio type is the service sold to them.
  { key: "physio_type", label: "Type of Physios", icon: Activity },
  { key: "history", label: "History", icon: History },
];

export const CONSULTATIONS_SUBTABS = [
  { key: "physiotherapy", label: "Physiotherapy", icon: Activity },
  { key: "fitness", label: "Fitness", icon: Dumbbell },
  // item_type "diet" — the bookable Diet Consultation, priced and timed exactly like a
  // physio consultation (v3_store.py validates it against the same duration rules). Split
  // from item_type "diet_package" (the top-level Diet Package tab's plain product
  // catalogue, no duration) once this booking flow moved here.
  { key: "diet", label: "Diet Consultations", icon: Salad },
];

export const SESSIONS_SUBTABS = [
  { key: "physiotherapy", label: "Physiotherapy", icon: Activity },
  { key: "fitness", label: "Fitness", icon: Dumbbell },
];

export const PlaceholderPanel = ({ label, testid }) => (
  <Card data-testid={testid}>
    <CardContent className="p-8 text-center text-sm text-slate-400">
      {label} panel — setup coming soon.
    </CardContent>
  </Card>
);

const DEFAULT_PRICE_ONLINE = 1200;
const DEFAULT_PRICE_OFFLINE = 800;

export const DURATION_OPTIONS = [
  { minutes: 15, label: "15 mins" },
  { minutes: 30, label: "30 mins" },
  { minutes: 45, label: "45 mins" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
];

const PriceFields = ({ priceOnline, setPriceOnline, priceOffline, setPriceOffline, onlineTestId, offlineTestId }) => (
  <div className="grid grid-cols-2 gap-2">
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600"><Wifi className="h-3 w-3 text-emerald-600" />Online Price</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">₹</span>
        <Input type="number" min="0" value={priceOnline} onChange={(e) => setPriceOnline(e.target.value)} className="pl-7" data-testid={onlineTestId} />
      </div>
    </div>
    <div>
      <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600"><MapPin className="h-3 w-3 text-amber-600" />Offline Price</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">₹</span>
        <Input type="number" min="0" value={priceOffline} onChange={(e) => setPriceOffline(e.target.value)} className="pl-7" data-testid={offlineTestId} />
      </div>
    </div>
  </div>
);

// Diet Consultation is priced and timed exactly like a physio consultation, so it reuses
// the same panel and the same modal. Only the wording, the item_type and the header colour
// differ — a second copy of 200 lines would drift the moment one of them was edited.
const PACKAGE_KINDS = {
  consultation: {
    itemType: "consultation",
    noun: "Consultation",
    header: "from-sky-500 to-indigo-600",
    durationLabel: "Consultation Duration",
    emptyText: "No consultations yet. Click Create to add one.",
  },
  diet: {
    itemType: "diet",
    noun: "Diet Consultation",
    header: "from-emerald-500 to-teal-600",
    durationLabel: "Diet Consultation Duration",
    emptyText: "No diet consultations yet. Click Create to add one.",
    // A diet consultation costs the same wherever it is delivered — the consultation is
    // the same conversation on a screen or in a room. One field instead of two, written to
    // both stored prices so the booking path, which still picks price_online or
    // price_offline off the chosen mode, gets the same number either way.
    singlePrice: true,
  },
  // The Diet Chart-style product the top-level Diet Package tab now catalogs — a plain
  // priced item (name, description, image, price), no booking slot. Split out from "diet"
  // once the actual Diet Consultation booking moved to the Consultations tab; sharing one
  // item_type between "a diet chart for sale" and "a bookable consultation slot" was the
  // thing forcing a Duration field onto a product that has no duration.
  diet_package: {
    itemType: "diet_package",
    noun: "Diet Package",
    header: "from-emerald-500 to-teal-600",
    emptyText: "No diet packages yet. Click Create to add one.",
    singlePrice: true,
    noDuration: true,
  },
};

const CreateConsultationModal = ({ item, onClose, onSaved, kind = "consultation", category = "physiotherapy" }) => {
  const cfg = PACKAGE_KINDS[kind] || PACKAGE_KINDS.consultation;
  const isEdit = Boolean(item);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [priceOnline, setPriceOnline] = useState(item?.price_online ?? DEFAULT_PRICE_ONLINE);
  const [priceOffline, setPriceOffline] = useState(item?.price_offline ?? DEFAULT_PRICE_OFFLINE);
  const [duration, setDuration] = useState(item?.duration_minutes ?? 30);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(item?.image_url || null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    if (!name.trim()) { toast.error(`${cfg.noun} name is required`); return; }
    setSaving(true);
    try {
      let image_url = item?.image_url || null;
      if (imageFile) {
        const uploaded = await uploadStoreImage(imageFile);
        image_url = uploaded.url;
      }
      // Both prices carry the one figure when the kind is single-priced. Sending only
      // price_online would leave an offline booking reading zero.
      const online = Number(priceOnline) || 0;
      const offline = cfg.singlePrice ? online : (Number(priceOffline) || 0);
      const payload = {
        item_type: cfg.itemType,
        category,
        name: name.trim(),
        description,
        image_url,
        price_online: online,
        price_offline: offline,
        duration_minutes: duration,
      };
      if (isEdit) {
        await updateStoreItem(item.id, payload);
        toast.success(`${cfg.noun} updated`);
      } else {
        await createStoreItem(payload);
        toast.success(`${cfg.noun} created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || `Failed to ${isEdit ? "update" : "create"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="consultation-create-modal">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className={`flex shrink-0 items-center justify-between bg-gradient-to-r ${cfg.header} px-5 py-3 text-white`}>
          <p className="text-base font-semibold">{isEdit ? `Edit ${cfg.noun}` : cfg.noun}</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="consultation-create-close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Initial Physiotherapy Assessment" data-testid="consultation-create-name" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
            <textarea
              rows={2}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
              placeholder="Describe this consultation..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="consultation-create-description"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Image <span className="font-normal text-slate-400">(Square, 1080 x 1080px)</span>
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative aspect-square w-24 overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-sky-400 hover:bg-sky-50/60"
              data-testid="consultation-create-image-dropzone"
            >
              {imagePreview ? (
                <img src={imagePreview} alt="preview" className="h-full w-full object-cover" data-testid="consultation-create-image-preview" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                  <ImagePlus className="h-6 w-6 text-slate-400" />
                  <span className="text-[11px] font-semibold text-slate-500">1080 x 1080</span>
                  <span className="text-[10px] text-slate-400">(1:1 ratio)</span>
                </div>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleImageChange}
              data-testid="consultation-create-image"
              className="hidden"
            />
          </div>
          {!cfg.noDuration && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">{cfg.durationLabel}</label>
              <div className="flex flex-wrap gap-2" data-testid="consultation-create-duration">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d.minutes}
                    type="button"
                    onClick={() => setDuration(d.minutes)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium ${duration === d.minutes ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600"}`}
                    data-testid={`consultation-create-duration-${d.minutes}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Price</label>
            {cfg.singlePrice ? (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">₹</span>
                <Input
                  type="number"
                  value={priceOnline}
                  onChange={(e) => setPriceOnline(e.target.value)}
                  className="pl-7"
                  data-testid="consultation-create-price"
                />
              </div>
            ) : (
              <PriceFields
                priceOnline={priceOnline}
                setPriceOnline={setPriceOnline}
                priceOffline={priceOffline}
                setPriceOffline={setPriceOffline}
                onlineTestId="consultation-create-price-online"
                offlineTestId="consultation-create-price-offline"
              />
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="consultation-create-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="consultation-create-submit">
            {saving ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Create")}
          </Button>
        </div>
      </div>
    </div>
  );
};

// A package's session count doesn't vary by Online vs Offline, only the per-session
// price does — no dropdown to configure it, it's fixed per catalogue.
const FIXED_SESSIONS = 7;

// Rehab runs a longer course than the rest, so its shelf is fixed at its own length.
// Anything not named here keeps the standard count.
const FIXED_SESSIONS_BY_CATEGORY = { rehab: 26, zumba: 12 };
const fixedSessionsFor = (category) => FIXED_SESSIONS_BY_CATEGORY[category] ?? FIXED_SESSIONS;

/**
 * Zumba is not sold as a bundle of loose classes but as a membership. The class runs
 * three days a week - Monday, Wednesday, Friday - which comes to 12 a month, and that
 * never varies. What a member picks is how many months they pay for up front.
 */
const ZUMBA_CLASSES_PER_MONTH = 12;
const ZUMBA_CLASS_DAYS = "Mon · Wed · Fri";
const ZUMBA_PLANS = [
  { months: 1, label: "1 Month", price: 3000 },
  { months: 3, label: "3 Months", price: 9000 },
  { months: 6, label: "6 Months", price: 15000 },
];
const zumbaSessionsFor = (months) => months * ZUMBA_CLASSES_PER_MONTH;
const formatRupees = (amount) => {
  const n = Number(amount) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

// What gets stored is still the per-session rate every session package stores, so
// assignment and collection keep charging rate x sessions and nothing downstream has to
// learn that some shelves are sold as a whole course. The course amount is what that rate
// was derived from, recovered here for display: neither 15000 / 72 nor 18000 / 26 divides
// evenly, so the total is rounded back to the price that was actually typed rather than
// shown as the rate multiplied out.
const packageTotalFrom = (rate, sessions) => Math.round((Number(rate) || 0) * (Number(sessions) || 0));

/**
 * Shelves priced as a whole course rather than per session.
 *
 * Rehab is sold as one 26-session programme at one price — what a buyer agrees is the
 * course, not a rate — so its form takes that figure and divides it down, the same way
 * Zumba's membership price does. 18000 / 26 is not a round rate, which is exactly why the
 * form must not ask for the rate: typing 692 to reach 18,000 lands on 17,992.
 */
const COURSE_TOTAL_CATEGORIES = new Set(["rehab"]);
const COURSE_TOTAL_DEFAULTS = { rehab: { online: 14000, offline: 18000 } };

// Only a whole number of months is a plan. Anything else is a Zumba row saved before this
// existed, and calling it "1 Month" would contradict the class count printed beside it.
const zumbaMonthsFor = (sessions) => (
  sessions > 0 && sessions % ZUMBA_CLASSES_PER_MONTH === 0 ? sessions / ZUMBA_CLASSES_PER_MONTH : null
);

const CreateSessionPackageModal = ({ item, onClose, onSaved, category = "physiotherapy" }) => {
  const isEdit = Boolean(item);
  const isZumba = category === "zumba";
  // Rehab and anything else sold as a whole course: the two price boxes hold the course
  // amount, not a per-session rate. What is stored is still the rate (see submit) — this is
  // only about which figure the person filling the form is asked for.
  const isCourseTotal = COURSE_TOTAL_CATEGORIES.has(category);
  // Zumba's two dials, in the terms it is actually sold in: how many months, and what the
  // membership costs. Everything else about the plan is fixed.
  const [planMonths, setPlanMonths] = useState(
    () => zumbaMonthsFor(item?.sessions_offline || item?.sessions_online || 0) || ZUMBA_PLANS[0].months,
  );
  const [planPrice, setPlanPrice] = useState(() => (
    item
      ? packageTotalFrom(item.price_offline ?? item.price_online, item.sessions_offline || item.sessions_online)
      : ZUMBA_PLANS[0].price
  ));
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  // On a course-priced shelf these hold the course total, recovered from the stored rate
  // when editing so the box shows the figure that was typed rather than the rate behind it.
  const [priceOnline, setPriceOnline] = useState(() => {
    if (!isCourseTotal) return item?.price_online ?? DEFAULT_PRICE_ONLINE;
    if (item) return packageTotalFrom(item.price_online, item.sessions_online);
    return COURSE_TOTAL_DEFAULTS[category]?.online ?? DEFAULT_PRICE_ONLINE;
  });
  const [priceOffline, setPriceOffline] = useState(() => {
    if (!isCourseTotal) return item?.price_offline ?? DEFAULT_PRICE_OFFLINE;
    if (item) return packageTotalFrom(item.price_offline, item.sessions_offline);
    return COURSE_TOTAL_DEFAULTS[category]?.offline ?? DEFAULT_PRICE_OFFLINE;
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(item?.image_url || null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // An existing package keeps the count it was saved with. Editing one to correct a price
  // should not quietly relabel it as a course of a different length — which is exactly what
  // recalculating from the catalogue default would do to everything saved before this.
  // A Zumba membership is the exception: its length is the plan, so the picker sets the
  // class count outright instead of the saved one being preserved.
  const sessions = isZumba
    ? zumbaSessionsFor(planMonths)
    : (item?.sessions_online || item?.sessions_offline || fixedSessionsFor(category));
  const perClass = sessions > 0 ? (Number(planPrice) || 0) / sessions : 0;
  const courseRate = (total) => (sessions > 0 ? (Number(total) || 0) / sessions : 0);
  // A course shelf's boxes already hold the totals; everywhere else the total is the rate
  // multiplied out.
  const totalOnline = isCourseTotal ? (Number(priceOnline) || 0) : (Number(priceOnline) || 0) * sessions;
  const totalOffline = isCourseTotal ? (Number(priceOffline) || 0) : (Number(priceOffline) || 0) * sessions;

  const submit = async () => {
    if (!name.trim()) { toast.error("Package name is required"); return; }
    if (isZumba && !(Number(planPrice) > 0)) { toast.error("Plan amount is required"); return; }
    setSaving(true);
    try {
      let image_url = item?.image_url || null;
      if (imageFile) {
        const uploaded = await uploadStoreImage(imageFile);
        image_url = uploaded.url;
      }
      const payload = {
        item_type: "session",
        category,
        name: name.trim(),
        description,
        image_url,
        // Zumba runs offline only, but both prices are written all the same - the booking
        // path picks one by mode, and leaving the other at zero would read as free.
        // Stored as a per-session rate in every case. A course shelf divides its total by
        // the session count here, so assignment and collection keep charging rate x
        // sessions and arrive back at exactly the figure that was typed.
        price_online: isZumba ? perClass : (isCourseTotal ? courseRate(priceOnline) : Number(priceOnline) || 0),
        price_offline: isZumba ? perClass : (isCourseTotal ? courseRate(priceOffline) : Number(priceOffline) || 0),
        sessions_online: sessions,
        sessions_offline: sessions,
      };
      if (isEdit) {
        await updateStoreItem(item.id, payload);
        toast.success("Session package updated");
      } else {
        await createStoreItem(payload);
        toast.success("Session package created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || `Failed to ${isEdit ? "update" : "create"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="session-create-modal">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-3 text-white">
          <p className="text-base font-semibold">{`${isEdit ? "Edit" : "Add"} ${isZumba ? "Zumba Membership" : "Session Package"}`}</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="session-create-close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Package Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter package name" data-testid="session-create-name" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
            <textarea
              rows={2}
              maxLength={250}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
              placeholder="Enter package description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="session-create-description"
            />
            <p className="mt-0.5 text-right text-[10px] text-slate-400">{description.length}/250</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Image <span className="font-normal text-slate-400">(Square, 1080 x 1080px)</span>
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative aspect-square w-24 overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-sky-400 hover:bg-sky-50/60"
              data-testid="session-create-image-dropzone"
            >
              {imagePreview ? (
                <img src={imagePreview} alt="preview" className="h-full w-full object-cover" data-testid="session-create-image-preview" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                  <ImagePlus className="h-6 w-6 text-slate-400" />
                  <span className="text-[11px] font-semibold text-slate-500">1080 x 1080</span>
                  <span className="text-[10px] text-slate-400">(1:1 ratio)</span>
                </div>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleImageChange}
              data-testid="session-create-image"
              className="hidden"
            />
          </div>

          {isZumba ? (
          <div data-testid="zumba-plan-setup">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Membership Plan</label>
            <div className="flex flex-wrap gap-2" data-testid="zumba-plan-options">
              {ZUMBA_PLANS.map((plan) => (
                <button
                  key={plan.months}
                  type="button"
                  onClick={() => { setPlanMonths(plan.months); setPlanPrice(plan.price); }}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${planMonths === plan.months ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                  data-testid={`zumba-plan-${plan.months}m`}
                >
                  {plan.label}<span className="ml-1.5 text-xs font-normal opacity-70">₹{plan.price}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/60 p-3">
              <p className="mb-2 flex items-center gap-1 text-xs font-bold text-violet-800"><CalendarRange className="h-3 w-3" />Class Schedule</p>
              <div className="space-y-1 text-[11px] text-violet-800">
                <div className="flex items-center justify-between"><span>Days</span><span className="font-bold">{ZUMBA_CLASS_DAYS}</span></div>
                <div className="flex items-center justify-between"><span>Classes a month</span><span className="font-bold">{ZUMBA_CLASSES_PER_MONTH}</span></div>
                <div className="flex items-center justify-between"><span>Total classes</span><span className="font-bold" data-testid="zumba-plan-sessions">{sessions}</span></div>
              </div>
              <label className="mb-0.5 mt-2 block text-[10px] font-semibold text-violet-700">Plan Amount</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-violet-600">₹</span>
                <Input type="number" min="0" value={planPrice} onChange={(e) => setPlanPrice(e.target.value)} className="h-8 pl-6 text-sm" data-testid="zumba-plan-price" />
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-violet-200 pt-1.5">
                <span className="text-[11px] font-semibold text-violet-700">Per Class</span>
                <span className="text-sm font-extrabold text-violet-900" data-testid="zumba-plan-per-class">₹{formatRupees(perClass)}</span>
              </div>
            </div>
          </div>
          ) : (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Online &amp; Offline Setup</label>
            <div className="grid grid-cols-2 gap-2" data-testid="session-create-mode-boxes">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-bold text-emerald-800"><Wifi className="h-3 w-3" />Online Mode</p>
                {/* The box asks for whatever that shelf is actually sold in — the whole
                    course on Rehab, a rate everywhere else. Asking for the rate on a
                    course-priced shelf is what made 18,000 unreachable. */}
                <label className="mb-0.5 block text-[10px] font-semibold text-emerald-700">{isCourseTotal ? `Amount for ${sessions} Sessions` : "Per Session Amount"}</label>
                <div className="relative mb-2">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-emerald-600">₹</span>
                  <Input type="number" min="0" value={priceOnline} onChange={(e) => setPriceOnline(e.target.value)} className="h-8 pl-6 text-sm" data-testid="session-create-price-online" />
                </div>
                <label className="mb-0.5 block text-[10px] font-semibold text-emerald-700">Sessions</label>
                <Input type="number" value={sessions} readOnly disabled className="h-8 bg-emerald-50 text-sm" data-testid="session-create-sessions-online" />
                <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-1.5">
                  <span className="text-[11px] font-semibold text-emerald-700">{isCourseTotal ? "Per Session" : "Total Amount"}</span>
                  <span className="text-sm font-extrabold text-emerald-900" data-testid="session-create-total-online">₹{isCourseTotal ? formatRupees(courseRate(priceOnline)) : totalOnline}</span>
                </div>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-bold text-amber-800"><MapPin className="h-3 w-3" />Offline Mode</p>
                <label className="mb-0.5 block text-[10px] font-semibold text-amber-700">{isCourseTotal ? `Amount for ${sessions} Sessions` : "Per Session Amount"}</label>
                <div className="relative mb-2">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-amber-600">₹</span>
                  <Input type="number" min="0" value={priceOffline} onChange={(e) => setPriceOffline(e.target.value)} className="h-8 pl-6 text-sm" data-testid="session-create-price-offline" />
                </div>
                <label className="mb-0.5 block text-[10px] font-semibold text-amber-700">Sessions</label>
                <Input type="number" value={sessions} readOnly disabled className="h-8 bg-amber-50 text-sm" data-testid="session-create-sessions-offline" />
                <div className="mt-2 flex items-center justify-between border-t border-amber-200 pt-1.5">
                  <span className="text-[11px] font-semibold text-amber-700">{isCourseTotal ? "Per Session" : "Total Amount"}</span>
                  <span className="text-sm font-extrabold text-amber-900" data-testid="session-create-total-offline">₹{isCourseTotal ? formatRupees(courseRate(priceOffline)) : totalOffline}</span>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="session-create-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="session-create-submit">
            {saving ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Save Package")}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Online and Offline prices side by side — unless the item is single-priced, in which
 * case one figure. A diet package stores the same number in both fields, and showing it
 * twice under two different labels invites the reader to look for a difference that is
 * not there and contradicts a form that offered one box.
 */
// mode: "all" | "offline" | "online" — defaults to "all" so BranchStoreBoard.jsx's own
// call (which never passes it) keeps showing both, exactly as before. Super Admin's
// Services page passes its own All/Offline/Online pill selection through here, since an
// Offline Branch Admin only ever needs this item's offline price and an Online one only
// the online price.
export const PriceModeBadges = ({ item, isSession, mode = "all" }) => (
  item.item_type === "diet" || item.item_type === "diet_package" ? (
    <div className="mt-2">
      <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5">
        <span className="text-xs font-bold text-emerald-800">Price</span>
        <span className="text-sm font-extrabold text-emerald-900">₹{item.price_online ?? 0}</span>
      </div>
    </div>
  ) : (
  <div className="mt-2 space-y-1.5">
    {mode !== "offline" && (
      <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
          <Wifi className="h-3.5 w-3.5" />Online
        </span>
        <span className="text-sm font-extrabold text-emerald-900">
          ₹{isSession ? packageTotalFrom(item.price_online, item.sessions_online) : (item.price_online ?? 0)}
        </span>
      </div>
    )}
    {mode !== "online" && (
      <div className="flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800">
          <MapPin className="h-3.5 w-3.5" />Offline
        </span>
        <span className="text-sm font-extrabold text-amber-900">
          ₹{isSession ? packageTotalFrom(item.price_offline, item.sessions_offline) : (item.price_offline ?? 0)}
        </span>
      </div>
    )}
  </div>
  )
);

// Same mode convention as PriceModeBadges — "all" (default) keeps both boxes, exactly
// what every existing caller (ViewItemModal, BranchStoreBoard) still gets since neither
// passes it.
export const SessionPriceBoxes = ({ item, testid, mode = "all" }) => {
  // A Zumba row is a membership: the schedule is fixed and the money that changes hands is
  // the plan amount, so the per-session pair every other package shows would be reading out
  // an internal figure. Offline only, so one box either way.
  if (item.category === "zumba") {
    const classes = item.sessions_offline || item.sessions_online || 0;
    const months = zumbaMonthsFor(classes);
    return (
      <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3" data-testid={testid}>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-violet-800">
          <Music2 className="h-3.5 w-3.5" />{months ? `${months} Month${months > 1 ? "s" : ""} Plan` : "Zumba Class"}
        </p>
        <div className="space-y-1.5 text-xs text-violet-800">
          <div className="flex items-center justify-between"><span>Days</span><span className="font-bold">{ZUMBA_CLASS_DAYS}</span></div>
          <div className="flex items-center justify-between">
            <span>Classes</span>
            <span className="font-bold">{months ? `${ZUMBA_CLASSES_PER_MONTH}/month · ${classes} total` : `${classes} total`}</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-violet-200 pt-1.5">
            <span className="font-semibold">Plan Amount</span>
            <span className="text-sm font-extrabold text-violet-900">₹{packageTotalFrom(item.price_offline ?? item.price_online, classes)}</span>
          </div>
        </div>
      </div>
    );
  }
  return (
  <div className={`grid gap-2 ${mode === "all" ? "grid-cols-2" : "grid-cols-1"}`} data-testid={testid}>
    {mode !== "offline" && (
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800"><Wifi className="h-3.5 w-3.5" />Online Mode</p>
        <div className="space-y-1.5 text-xs text-emerald-800">
          <div className="flex items-center justify-between"><span>Per Session</span><span className="font-bold">₹{item.price_online ?? 0}</span></div>
          <div className="flex items-center justify-between"><span>Total Sessions</span><span className="font-bold">{item.sessions_online ?? 0} Sessions</span></div>
          <div className="mt-1 flex items-center justify-between border-t border-emerald-200 pt-1.5">
            <span className="font-semibold">Total Amount</span>
            <span className="text-sm font-extrabold text-emerald-900">₹{packageTotalFrom(item.price_online, item.sessions_online)}</span>
          </div>
        </div>
      </div>
    )}
    {mode !== "online" && (
      <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-800"><MapPin className="h-3.5 w-3.5" />Offline Mode</p>
        <div className="space-y-1.5 text-xs text-amber-800">
          <div className="flex items-center justify-between"><span>Per Session</span><span className="font-bold">₹{item.price_offline ?? 0}</span></div>
          <div className="flex items-center justify-between"><span>Total Sessions</span><span className="font-bold">{item.sessions_offline ?? 0} Sessions</span></div>
          <div className="mt-1 flex items-center justify-between border-t border-amber-200 pt-1.5">
            <span className="font-semibold">Total Amount</span>
            <span className="text-sm font-extrabold text-amber-900">₹{packageTotalFrom(item.price_offline, item.sessions_offline)}</span>
          </div>
        </div>
      </div>
    )}
  </div>
  );
};

export const ViewItemModal = ({ item, kind, onClose, onEdit, canEdit = true }) => {
  const isSession = kind === "session";
  // Sessions are not a PACKAGE_KINDS entry — they carry a session count, not a duration —
  // so this falls back rather than assuming every kind has one.
  const viewCfg = PACKAGE_KINDS[kind] || PACKAGE_KINDS.consultation;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="item-view-modal">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className={`flex shrink-0 items-center justify-between bg-gradient-to-r ${viewCfg.header} px-5 py-3 text-white`}>
          <p className="flex-1 truncate text-base font-semibold" data-testid="item-view-name">{item.name}</p>
          <div className="flex shrink-0 items-center gap-1">
            {canEdit && (
              <button onClick={onEdit} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="item-view-edit" title="Edit">
                <Pencil className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="item-view-close" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {item.image_url && <img src={item.image_url} alt={item.name} className="h-48 w-full rounded-lg object-cover" />}
          {item.description && <p className="text-sm text-slate-600">{item.description}</p>}

          {isSession ? (
            <SessionPriceBoxes item={item} testid="item-view-session-boxes" />
          ) : (
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <PriceModeBadges item={item} isSession={false} />
              {!viewCfg.noDuration && item.duration_minutes && (
                <div className="mt-1.5 flex items-center justify-between rounded-lg bg-sky-50 px-2.5 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-800">
                    <Clock className="h-3.5 w-3.5" />{viewCfg.durationLabel}
                  </span>
                  <span className="text-sm font-extrabold text-sky-900">
                    {DURATION_OPTIONS.find((d) => d.minutes === item.duration_minutes)?.label || `${item.duration_minutes} mins`}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Backs both Sessions sub-tabs; see PhysiotherapyPanel for why this is one component
// with a category rather than two copies.
const SessionsPhysiotherapyPanel = ({ category = "physiotherapy", reloadToken, toolbarSlot, modeFilter = "all", noun = "session package" }) => {
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);

  const loadItems = () => listStoreItems(category, "session").then(setItems).catch(() => {});
  // category in the deps, or switching sub-tab keeps the other one's list on screen.
  useEffect(() => { loadItems(); }, [category, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (it) => {
    if (!window.confirm(`Permanently delete "${it.name}"? This cannot be undone.`)) return;
    try {
      await deleteStoreItem(it.id);
      toast.success(`${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted permanently`);
      loadItems();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div className="space-y-3" data-testid={`sessions-subpanel-${category}`}>
      {toolbarSlot && createPortal(
        <Button
          onClick={() => setShowCreate(true)}
          title={`Create ${noun}`}
          aria-label={`Create ${noun}`}
          className="h-11 w-11 shrink-0 p-0"
          data-testid={`sessions-${category}-create-btn-mobile`}
        >
          <Plus className="h-4 w-4" />
        </Button>,
        toolbarSlot,
      )}
      <div className="hidden items-center justify-end sm:flex">
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid={`sessions-${category}-create-btn`}>
          <Plus className="mr-1 h-4 w-4" />Create
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            No {noun}s yet. Click Create to add one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid={`sessions-${category}-items-grid`}>
          {items.map((it) => (
            <Card key={it.id} data-testid={`session-item-${it.id}`}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex-1 font-semibold text-slate-800">{it.name}</p>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => setViewingItem(it)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-600"
                      data-testid={`session-item-${it.id}-view`}
                      title="View"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(it)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      data-testid={`session-item-${it.id}-delete`}
                      title="Delete permanently"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {it.image_url && <img src={it.image_url} alt={it.name} className="h-[200px] w-full rounded-lg object-cover" />}
                {it.description && <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>}

                <SessionPriceBoxes item={it} mode={modeFilter} testid={`session-item-${it.id}-highlights`} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateSessionPackageModal category={category} onClose={() => setShowCreate(false)} onSaved={loadItems} />}
      {editingItem && <CreateSessionPackageModal category={category} item={editingItem} onClose={() => setEditingItem(null)} onSaved={loadItems} />}
      {viewingItem && (
        <ViewItemModal
          item={viewingItem}
          kind="session"
          onClose={() => setViewingItem(null)}
          onEdit={() => { setEditingItem(viewingItem); setViewingItem(null); }}
        />
      )}
    </div>
  );
};

const SessionsPanel = ({ reloadToken, toolbarSlot, modeFilter = "all" }) => {
  const [sub, setSub] = useState("physiotherapy");
  return (
    <div className="space-y-4" data-testid="packages-panel-sessions">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="sessions-subtabs">
        {SESSIONS_SUBTABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              data-testid={`sessions-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {sub === "physiotherapy" && <SessionsPhysiotherapyPanel reloadToken={reloadToken} toolbarSlot={toolbarSlot} modeFilter={modeFilter} />}
      {sub === "fitness" && <SessionsPhysiotherapyPanel category="fitness" reloadToken={reloadToken} toolbarSlot={toolbarSlot} modeFilter={modeFilter} />}
    </div>
  );
};

/**
 * The consultation/diet catalogue for one category.
 *
 * Named for Physiotherapy because that is all it served at first; it now backs Fitness
 * too, which needs the identical panel against a different `category`. Parameterised
 * rather than copied — two hundred lines duplicated would drift the first time either
 * was edited, and the ask was explicitly for the same create option, not a new one.
 */
const PhysiotherapyPanel = ({ kind = "consultation", category = "physiotherapy", reloadToken, toolbarSlot, modeFilter = "all" }) => {
  const cfg = PACKAGE_KINDS[kind] || PACKAGE_KINDS.consultation;
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);

  const loadItems = () => listStoreItems(category, cfg.itemType).then(setItems).catch(() => {});
  // category in the deps, or switching sub-tab would show the other one's list until
  // something else happened to trigger a refetch.
  useEffect(() => { loadItems(); }, [cfg.itemType, category, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (it) => {
    if (!window.confirm(`Permanently delete "${it.name}"? This cannot be undone.`)) return;
    try {
      await deleteStoreItem(it.id);
      toast.success(`${cfg.noun} deleted permanently`);
      loadItems();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div className="space-y-3" data-testid={`consultations-subpanel-${category}`}>
      {/* Two Create buttons, one visible at a time. On a phone it belongs beside the tab
          dropdown and Refresh, which is a row this panel does not own — so it is portaled
          into a slot up there, and the slot itself is hidden from sm up. The labelled one
          below is desktop's, hidden under sm. Rendering both and letting CSS choose beats
          measuring the viewport in JS to decide which to mount. */}
      {toolbarSlot && createPortal(
        <Button
          onClick={() => setShowCreate(true)}
          title={`Create ${cfg.noun}`}
          aria-label={`Create ${cfg.noun}`}
          className="h-11 w-11 shrink-0 p-0"
          data-testid={`${category}-create-btn-mobile`}
        >
          <Plus className="h-4 w-4" />
        </Button>,
        toolbarSlot,
      )}
      <div className="hidden items-center justify-end sm:flex">
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid={`${category}-create-btn`}>
          <Plus className="mr-1 h-4 w-4" />Create
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            {cfg.emptyText}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid={`${category}-items-grid`}>
          {items.map((it) => (
            <Card key={it.id} data-testid={`consultation-item-${it.id}`}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex-1 font-semibold text-slate-800">{it.name}</p>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => setViewingItem(it)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-600"
                      data-testid={`consultation-item-${it.id}-view`}
                      title="View"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(it)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      data-testid={`consultation-item-${it.id}-delete`}
                      title="Delete permanently"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {it.image_url && <img src={it.image_url} alt={it.name} className="h-[200px] w-full rounded-lg object-cover" />}
                {it.description && <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>}

                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3" data-testid={`consultation-item-${it.id}-highlights`}>
                  <PriceModeBadges item={it} isSession={false} mode={modeFilter} />
                  {!cfg.noDuration && it.duration_minutes && (
                    <div className="mt-1.5 flex items-center justify-between rounded-lg bg-sky-50 px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-800">
                        <Clock className="h-3.5 w-3.5" />{cfg.durationLabel}
                      </span>
                      <span className="text-sm font-extrabold text-sky-900">
                        {DURATION_OPTIONS.find((d) => d.minutes === it.duration_minutes)?.label || `${it.duration_minutes} mins`}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateConsultationModal kind={kind} category={category} onClose={() => setShowCreate(false)} onSaved={loadItems} />}
      {editingItem && <CreateConsultationModal kind={kind} category={category} item={editingItem} onClose={() => setEditingItem(null)} onSaved={loadItems} />}
      {viewingItem && (
        <ViewItemModal
          item={viewingItem}
          kind={kind}
          onClose={() => setViewingItem(null)}
          onEdit={() => { setEditingItem(viewingItem); setViewingItem(null); }}
        />
      )}
    </div>
  );
};

const ConsultationsPanel = ({ reloadToken, toolbarSlot, modeFilter = "all" }) => {
  const [sub, setSub] = useState("physiotherapy");
  return (
    <div className="space-y-4" data-testid="packages-panel-consultations">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="consultations-subtabs">
        {CONSULTATIONS_SUBTABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              data-testid={`consultations-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {sub === "physiotherapy" && <PhysiotherapyPanel reloadToken={reloadToken} toolbarSlot={toolbarSlot} modeFilter={modeFilter} />}
      {sub === "fitness" && <PhysiotherapyPanel category="fitness" reloadToken={reloadToken} toolbarSlot={toolbarSlot} modeFilter={modeFilter} />}
      {/* kind="diet" — the bookable Diet Consultation catalogue, separate from the
          top-level Diet Package tab's kind="diet_package" (a plain product, no duration). */}
      {sub === "diet" && <PhysiotherapyPanel kind="diet" reloadToken={reloadToken} toolbarSlot={toolbarSlot} modeFilter={modeFilter} />}
    </div>
  );
};

const HISTORY_ACTION_LABELS = {
  consultation_paid: "Consultation Sold",
  package_sold: "Package Sold",
  package_assigned: "Package Assigned",
  package_payment_collected: "Consultation Fee Collected",
  treatment_fee_collected: "Treatment Fee Collected",
  fee_collected: "Fee Collected",
  follow_up_scheduled: "Follow-Up Scheduled · Pre-Sales",
  follow_up_rescheduled: "Follow-Up Rescheduled · Pre-Sales",
  branch_follow_up_scheduled: "Follow-Up Scheduled · Branch",
  branch_follow_up_rescheduled: "Follow-Up Rescheduled · Branch",
  consultation_follow_up_scheduled: "Follow-Up Scheduled · Consultation",
  consultation_follow_up_rescheduled: "Follow-Up Rescheduled · Consultation",
};

const ActivityHistoryTable = ({ fetchFn, emptyLabel, testidPrefix, reloadToken }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    fetchFn(200)
      .then((res) => setRows(res.history || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [fetchFn, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3" data-testid={`${testidPrefix}-panel`}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} entr{rows.length === 1 ? "y" : "ies"}</p>
        <Button size="sm" variant="outline" onClick={load} data-testid={`${testidPrefix}-refresh-btn`}>Refresh</Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            {loading ? "Loading..." : emptyLabel}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-slate-200">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Patient</th>
                  <th className="px-4 py-2 text-left">Branch</th>
                  <th className="px-4 py-2 text-left">Action</th>
                  <th className="px-4 py-2 text-left">Details</th>
                  <th className="px-4 py-2 text-left">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100" data-testid={`${testidPrefix}-row-${r.id}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{(r.created_at || "").replace("T", " ").slice(0, 16)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.patient_name || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.branch_name || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">
                        {HISTORY_ACTION_LABELS[r.action] || r.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{r.details || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{r.created_by || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const LoginHistoryTable = ({ reloadToken }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    getLoginHistory(200)
      .then((res) => setRows(res.history || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3" data-testid="login-history-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} login{rows.length === 1 ? "" : "s"}</p>
        <Button size="sm" variant="outline" onClick={load} data-testid="login-history-refresh-btn">Refresh</Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            {loading ? "Loading..." : "No logins recorded yet."}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-slate-200">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Date &amp; Time</th>
                  <th className="px-4 py-2 text-left">User</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-left">Branch</th>
                  <th className="px-4 py-2 text-left">Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100" data-testid={`login-history-row-${r.id}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{(r.created_at || "").replace("T", " ").slice(0, 16)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.user_name || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold capitalize text-sky-700">
                        {(r.role || "—").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.branch_name || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{r.email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const HISTORY_SUBTABS = [
  { key: "payments", label: "Payment History" },
  { key: "followups", label: "Follow Up History" },
  { key: "logins", label: "Login Tracker" },
];

const HistoryPanel = ({ reloadToken }) => {
  const [sub, setSub] = useState("payments");
  return (
    <div className="space-y-3" data-testid="packages-panel-history">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="history-subtabs">
        {HISTORY_SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            data-testid={`history-subtab-${t.key}`}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${sub === t.key ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === "payments" && (
        <ActivityHistoryTable fetchFn={getPaymentHistory} emptyLabel="No payments collected yet." testidPrefix="payment-history" reloadToken={reloadToken} />
      )}
      {sub === "followups" && (
        <ActivityHistoryTable fetchFn={getFollowUpHistory} emptyLabel="No follow-ups scheduled yet." testidPrefix="followup-history" reloadToken={reloadToken} />
      )}
      {sub === "logins" && <LoginHistoryTable reloadToken={reloadToken} />}
    </div>
  );
};

// The three stock shelves. One panel serves all of them, told which by its category —
// the same panel Branch Admin uses, so the two stores cannot drift apart.
const INVENTORY_TABS = new Set(["tablet", "supplementary", "equipment"]);

// Which tabs have a panel. Everything else falls through to the placeholder; Vending
// Machine is the only one left, and it has no backend at all yet.
/**
 * The tabs that are a session package under another name: Rehab, Zumba Class and Fitness.
 *
 * Each is its own catalogue (`category`) sold through the session form, so Create on any of
 * them opens exactly what Sessions opens. `noun` only changes the wording on the empty
 * state and the button's title — the shelf, the form and the record are the same shape.
 *
 * Fitness deliberately points at the category the Sessions > Fitness sub-tab already
 * writes to, so the tab shows that catalogue rather than an empty second one beside it.
 */
const SESSION_LIKE_TABS = {
  rehab: { category: "rehab", noun: "rehab package" },
  zumba: { category: "zumba", noun: "Zumba class" },
  fitness: { category: "fitness", noun: "fitness package" },
};

const BUILT_TABS = new Set(["consultations", "sessions", "rehab", "zumba", "fitness", "diet", "history", "treatment", "physio_type", ...INVENTORY_TABS]);

// TABS above stays a flat, unbroken export — BranchStoreBoard.jsx imports and filters it
// for its own layout too, and reshaping it here would reshape that board's as well.
//
// Which catalogue tabs sit next to Consultations/Sessions depends on the mode picked
// below — the online/offline split of what a branch actually stocks. All is
// unrestricted (the full catalogue, Vending Machine included, since it isn't yet sorted
// into either mode); Offline drops Vending Machine; Online drops everything that only
// makes sense at a physical location (Tablet, Supplementary, Equipment, Vending Machine).
// Catalogue tabs only Super Admin maintains. They ride in MODE_TAB_KEYS because that is
// what decides which tabs a mode shows, but a branch has no business in them: the write
// endpoints are super_admin-only, so a branch would get a list it cannot add to and a
// button that 403s. BranchStoreBoard subtracts these.
//
// Treatments is deliberately not in here. It already shows in the branch store and has
// since it was built; taking it away is a change to what branches see today, and not
// one to make as a side effect of adding a neighbouring tab.
export const SUPER_ADMIN_CATALOGUE_TABS = new Set(["physio_type"]);

export const MODE_TAB_KEYS = {
  all: new Set(["consultations", "sessions", "rehab", "zumba", "fitness", "diet", "tablet", "supplementary", "equipment", "vending_machine", "treatment", "physio_type"]),
  offline: new Set(["consultations", "sessions", "rehab", "zumba", "fitness", "diet", "tablet", "supplementary", "equipment", "treatment", "physio_type"]),
  online: new Set(["consultations", "sessions", "rehab", "fitness", "diet", "treatment", "physio_type"]),
};

const MODE_FILTERS = [
  { key: "all", label: "All" },
  { key: "offline", label: "Offline" },
  { key: "online", label: "Online" },
];

/**
 * The stock shelves as Super Admin sees them.
 *
 * Stock is held per branch and Super Admin has no branch of their own, so a branch has to
 * be named before there is anything to show — every stock call refuses without one. The
 * picker is that choice, and nothing loads until it is made rather than the panel opening
 * on an error.
 *
 * The catalogue behind it is org-wide: a tablet added here is the same row every branch
 * sees, which is exactly why Super Admin needs this screen. Until now only Branch Admins
 * could add to that shared catalogue, so two branches spelling the same tablet differently
 * ended up with two rows that could never be transferred between them.
 */
/**
 * The branch picker, in the shape the finance boards' filter dropdowns use: a bordered
 * trigger that opens a panel of pill rows rather than a native select's system menu.
 *
 * Colourless on purpose. Those boards give each branch its own tint because colour is
 * carrying meaning there — it ties a row in the table to the branch that owns it. Here
 * there is one selection and nothing to tie it to, so a palette would be decoration that
 * reads as information. The selected row is marked by weight and a filled ground instead.
 */
const BranchSelect = ({ value, options, onChange, testId }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const current = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 min-w-[190px] items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        data-testid={testId}
      >
        <span className="truncate">{current?.label || "-- choose a branch --"}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-64 min-w-[190px] space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid={`${testId}-list`}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`block w-full whitespace-nowrap rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${
                o.value === value
                  ? "border-slate-300 bg-slate-100 text-slate-900"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              data-testid={`${testId}-option-${o.value}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SuperAdminInventoryPanel = ({ category, reloadToken }) => {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");

  useEffect(() => {
    getBranches()
      .then((rows) => {
        setBranches(rows || []);
        // One branch is not a choice, so it is made here rather than asked for.
        if ((rows || []).length === 1) setBranchId(rows[0].id);
      })
      .catch(() => setBranches([]));
  }, []);

  return (
    <div className="space-y-3" data-testid={`packages-inventory-${category}`}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-xs font-medium text-slate-600">Branch:</label>
        <BranchSelect
          value={branchId}
          onChange={setBranchId}
          options={[
            { value: "", label: "-- choose a branch --" },
            ...branches.map((b) => ({ value: b.id, label: b.branch_name || b.name || "Unnamed branch" })),
          ]}
          testId={`packages-inventory-branch-${category}`}
        />
        <span className="text-[11px] text-slate-400">
          Stock is held per branch. The catalogue itself is shared across all of them.
        </span>
      </div>

      {branchId ? (
        // Keyed on both: without it React keeps the same instance across a change and the
        // previous branch's or shelf's rows sit there until the new ones land.
        <StoreInventoryPanel key={`${category}-${branchId}`} category={category} branchId={branchId} reloadToken={reloadToken} />
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            {branches.length === 0 ? "No branches yet." : "Choose a branch to see its stock."}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export const PackagesBoard = () => {
  // All / Offline / Online — which of the catalogue tabs sit next to Consultations and
  // Sessions (MODE_TAB_KEYS), and, within Consultations/Sessions themselves, which of a
  // package's two prices its cards show. History sits outside this split entirely — a
  // read-only report, not a mode of the catalogue — so it's a second, independent toggle
  // rather than a fourth option crammed into the same three.
  const [modeFilter, setModeFilter] = useState("all");
  const [view, setView] = useState("catalog"); // "catalog" | "history"
  const [tab, setTab] = useState("consultations");
  // Bumped by Refresh and handed to whichever panel is open, so it refetches in place.
  const [reloadTick, setReloadTick] = useState(0);
  // A callback ref, not useRef: the portal has to re-render once the node exists, and a
  // ref object mutating in place never triggers that.
  const [createSlot, setCreateSlot] = useState(null);

  const visibleTabs = TABS.filter((t) => MODE_TAB_KEYS[modeFilter].has(t.key));

  // Falls back to Consultations rather than leaving `tab` pointed at a key the new mode
  // doesn't carry — Equipment picked under Offline, then Online clicked, would otherwise
  // show a sub-tab bar with nothing selected.
  const selectMode = (key) => {
    setModeFilter(key);
    setView("catalog");
    if (!MODE_TAB_KEYS[key].has(tab)) setTab("consultations");
  };

  return (
    <div className="space-y-4" data-testid="packages-board">
      {/* No heading. The nav tab above already reads Services and Products, and the line
          under it only listed the tabs that follow it. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="packages-mode-filter">
        {MODE_FILTERS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => selectMode(m.key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              view === "catalog" && modeFilter === m.key ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
            }`}
            data-testid={`packages-mode-filter-${m.key}`}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setView("history")}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
            view === "history" ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
          }`}
          data-testid="packages-view-history"
        >
          History
        </button>
      </div>

      {/* A dropdown on a phone, the same control the Branch Admin store uses. Eight tabs
          wrapped to three rows there, which pushed the shelf being edited below the fold
          before any of its items showed. Desktop keeps the bar. Neither one has anything
          to pick under History — it has no sub-tabs of its own — so both drop out there;
          Refresh and the Create slot stay put regardless, since History still refreshes.

          Refresh and Create ride alongside it. Create is not this component's to render —
          each panel owns its own, against its own item type — so the panel portals an
          icon-only copy into the slot at the end of this row. */}
      <div className="flex items-center gap-2 md:hidden">
        {view === "catalog" && (
          <select
            value={tab}
            onChange={(e) => setTab(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
            data-testid="packages-subtab-select"
          >
            {visibleTabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        )}
        <Button
          onClick={() => setReloadTick((n) => n + 1)}
          title="Refresh"
          aria-label="Refresh"
          className="h-11 w-11 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="packages-refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <div ref={setCreateSlot} className="flex shrink-0 items-center" data-testid="packages-create-slot" />
      </div>

      {view === "catalog" && (
        // Justified across the bar: all twelve on one line at a desk width, spread to the
        // full width rather than packed at the left with a gap trailing off the end.
        // 13px type with the padding pulled in to pay for it — the space that buys goes
        // between the tabs, where justify-between puts it, instead of inside each one.
        // Still wrapping rather than scrolling: the fit is a fit and not a guarantee, and a
        // narrower window taking a second row is the honest failure. As a scroller the
        // overflow was a half-cut tab at the right edge with nothing to say it continued.
        <div className="hidden flex-wrap justify-between gap-1 rounded-lg border border-slate-200 bg-white p-1 md:flex" data-testid="packages-subtabs">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={`packages-subtab-${t.key}`}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-2 text-[13px] font-medium transition ${active ? "bg-violet-50 text-violet-600" : "text-slate-600 hover:bg-slate-50"}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />{t.label}
              </button>
            );
          })}
        </div>
      )}

      {view === "catalog" && tab === "consultations" && <ConsultationsPanel reloadToken={reloadTick} toolbarSlot={createSlot} modeFilter={modeFilter} />}
      {view === "catalog" && tab === "sessions" && <SessionsPanel reloadToken={reloadTick} toolbarSlot={createSlot} modeFilter={modeFilter} />}
      {/* The same panel Sessions runs, told which catalogue it is looking at. Its Create
          opens the session package form, which is what was asked for — one form, three
          more shelves, rather than three near-copies that drift apart. */}
      {view === "catalog" && SESSION_LIKE_TABS[tab] && (
        <SessionsPhysiotherapyPanel
          key={tab}
          category={SESSION_LIKE_TABS[tab].category}
          noun={SESSION_LIKE_TABS[tab].noun}
          reloadToken={reloadTick}
          toolbarSlot={createSlot}
          modeFilter={modeFilter}
        />
      )}
      {view === "catalog" && tab === "diet" && <PhysiotherapyPanel kind="diet_package" reloadToken={reloadTick} toolbarSlot={createSlot} />}
      {view === "history" && <HistoryPanel reloadToken={reloadTick} />}
      {view === "catalog" && tab === "treatment" && <TreatmentTypesBoard />}
      {view === "catalog" && tab === "physio_type" && <PhysioTypesBoard />}
      {view === "catalog" && INVENTORY_TABS.has(tab) && <SuperAdminInventoryPanel key={tab} category={tab} reloadToken={reloadTick} />}
      {/* Whatever has no panel yet. A tab graduates by being handled above rather than by
          another branch being added here. */}
      {view === "catalog" && !BUILT_TABS.has(tab) && visibleTabs.map((t) => tab === t.key && (
        <PlaceholderPanel key={t.key} label={t.label} testid={`packages-panel-${t.key}`} />
      ))}
    </div>
  );
};

export default PackagesBoard;
