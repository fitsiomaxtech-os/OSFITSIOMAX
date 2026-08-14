import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Stethoscope, CalendarRange, Pill, Dumbbell, ShoppingCart, Activity, Plus, X, FlaskConical, Pencil, Trash2, ImagePlus, Wifi, MapPin, Clock, Eye, History, Salad, ChevronDown, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { uploadStoreImage, createStoreItem, updateStoreItem, deleteStoreItem, listStoreItems, getPaymentHistory, getFollowUpHistory, getLoginHistory, getBranches } from "@/lib/api";
import { StoreInventoryPanel } from "@/components/branch/StoreInventoryPanel";

export const TABS = [
  { key: "consultations", label: "Consultations", icon: Stethoscope },
  { key: "sessions", label: "Sessions", icon: CalendarRange },
  { key: "diet", label: "Diet Package", icon: Salad },
  { key: "tablet", label: "Tablet", icon: Pill },
  { key: "supplementary", label: "Supplementary", icon: FlaskConical },
  { key: "equipment", label: "Equipment", icon: Dumbbell },
  { key: "vending_machine", label: "Vending Machine", icon: ShoppingCart },
  { key: "history", label: "History", icon: History },
];

export const CONSULTATIONS_SUBTABS = [
  { key: "physiotherapy", label: "Physiotherapy", icon: Activity },
  { key: "fitness", label: "Fitness", icon: Dumbbell },
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
    noun: "Diet Package",
    header: "from-emerald-500 to-teal-600",
    durationLabel: "Diet Consultation Duration",
    emptyText: "No diet packages yet. Click Create to add one.",
  },
};

const CreateConsultationModal = ({ item, onClose, onSaved, kind = "consultation" }) => {
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
      const payload = {
        item_type: cfg.itemType,
        category: "physiotherapy",
        name: name.trim(),
        description,
        image_url,
        price_online: Number(priceOnline) || 0,
        price_offline: Number(priceOffline) || 0,
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
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Price</label>
            <PriceFields
              priceOnline={priceOnline}
              setPriceOnline={setPriceOnline}
              priceOffline={priceOffline}
              setPriceOffline={setPriceOffline}
              onlineTestId="consultation-create-price-online"
              offlineTestId="consultation-create-price-offline"
            />
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

const WEEKS_OPTIONS = [1, 2, 3, 4, 5];
const SESSIONS_PER_WEEK = 7;

const CreateSessionPackageModal = ({ item, onClose, onSaved }) => {
  const isEdit = Boolean(item);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [priceOnline, setPriceOnline] = useState(item?.price_online ?? DEFAULT_PRICE_ONLINE);
  const [priceOffline, setPriceOffline] = useState(item?.price_offline ?? DEFAULT_PRICE_OFFLINE);
  // Sessions always come from Weeks x 7 — a package's session count doesn't vary
  // by Online vs Offline, only the per-session price does. Fall back to deriving
  // Weeks from an existing item's session count when editing older data.
  const [weeks, setWeeks] = useState(item?.sessions_online ? Math.max(1, Math.round(item.sessions_online / SESSIONS_PER_WEEK)) : 1);
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

  const sessions = Number(weeks) * SESSIONS_PER_WEEK;
  const totalOnline = (Number(priceOnline) || 0) * sessions;
  const totalOffline = (Number(priceOffline) || 0) * sessions;

  const submit = async () => {
    if (!name.trim()) { toast.error("Package name is required"); return; }
    setSaving(true);
    try {
      let image_url = item?.image_url || null;
      if (imageFile) {
        const uploaded = await uploadStoreImage(imageFile);
        image_url = uploaded.url;
      }
      const payload = {
        item_type: "session",
        category: "physiotherapy",
        name: name.trim(),
        description,
        image_url,
        price_online: Number(priceOnline) || 0,
        price_offline: Number(priceOffline) || 0,
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
          <p className="text-base font-semibold">{isEdit ? "Edit Session Package" : "Add Session Package"}</p>
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

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Online &amp; Offline Setup</label>
            <div className="mb-2">
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Number of Weeks</label>
              <select
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
                className="h-8 w-full rounded-md border border-slate-200 px-2 text-sm"
                data-testid="session-create-weeks"
              >
                {WEEKS_OPTIONS.map((w) => <option key={w} value={w}>{w} Week{w > 1 ? "s" : ""}</option>)}
              </select>
              <p className="mt-1 text-[10px] text-slate-400">{sessions} sessions ({weeks} week{weeks > 1 ? "s" : ""} × {SESSIONS_PER_WEEK} sessions/week)</p>
            </div>
            <div className="grid grid-cols-2 gap-2" data-testid="session-create-mode-boxes">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-bold text-emerald-800"><Wifi className="h-3 w-3" />Online Mode</p>
                <label className="mb-0.5 block text-[10px] font-semibold text-emerald-700">Per Session Amount</label>
                <div className="relative mb-2">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-emerald-600">₹</span>
                  <Input type="number" min="0" value={priceOnline} onChange={(e) => setPriceOnline(e.target.value)} className="h-8 pl-6 text-sm" data-testid="session-create-price-online" />
                </div>
                <label className="mb-0.5 block text-[10px] font-semibold text-emerald-700">Sessions</label>
                <Input type="number" value={sessions} readOnly disabled className="h-8 bg-emerald-50 text-sm" data-testid="session-create-sessions-online" />
                <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-1.5">
                  <span className="text-[11px] font-semibold text-emerald-700">Total Amount</span>
                  <span className="text-sm font-extrabold text-emerald-900" data-testid="session-create-total-online">₹{totalOnline}</span>
                </div>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-xs font-bold text-amber-800"><MapPin className="h-3 w-3" />Offline Mode</p>
                <label className="mb-0.5 block text-[10px] font-semibold text-amber-700">Per Session Amount</label>
                <div className="relative mb-2">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-amber-600">₹</span>
                  <Input type="number" min="0" value={priceOffline} onChange={(e) => setPriceOffline(e.target.value)} className="h-8 pl-6 text-sm" data-testid="session-create-price-offline" />
                </div>
                <label className="mb-0.5 block text-[10px] font-semibold text-amber-700">Sessions</label>
                <Input type="number" value={sessions} readOnly disabled className="h-8 bg-amber-50 text-sm" data-testid="session-create-sessions-offline" />
                <div className="mt-2 flex items-center justify-between border-t border-amber-200 pt-1.5">
                  <span className="text-[11px] font-semibold text-amber-700">Total Amount</span>
                  <span className="text-sm font-extrabold text-amber-900" data-testid="session-create-total-offline">₹{totalOffline}</span>
                </div>
              </div>
            </div>
          </div>
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

export const PriceModeBadges = ({ item, isSession }) => (
  <div className="mt-2 space-y-1.5">
    <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
        <Wifi className="h-3.5 w-3.5" />Online
      </span>
      <span className="text-sm font-extrabold text-emerald-900">
        ₹{isSession ? (item.price_online ?? 0) * (item.sessions_online ?? 0) : (item.price_online ?? 0)}
      </span>
    </div>
    <div className="flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800">
        <MapPin className="h-3.5 w-3.5" />Offline
      </span>
      <span className="text-sm font-extrabold text-amber-900">
        ₹{isSession ? (item.price_offline ?? 0) * (item.sessions_offline ?? 0) : (item.price_offline ?? 0)}
      </span>
    </div>
  </div>
);

export const SessionPriceBoxes = ({ item, testid }) => (
  <div className="grid grid-cols-2 gap-2" data-testid={testid}>
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-800"><Wifi className="h-3.5 w-3.5" />Online Mode</p>
      <div className="space-y-1.5 text-xs text-emerald-800">
        <div className="flex items-center justify-between"><span>Per Session</span><span className="font-bold">₹{item.price_online ?? 0}</span></div>
        <div className="flex items-center justify-between"><span>Total Sessions</span><span className="font-bold">{item.sessions_online ?? 0} Sessions</span></div>
        <div className="mt-1 flex items-center justify-between border-t border-emerald-200 pt-1.5">
          <span className="font-semibold">Total Amount</span>
          <span className="text-sm font-extrabold text-emerald-900">₹{(item.price_online ?? 0) * (item.sessions_online ?? 0)}</span>
        </div>
      </div>
    </div>
    <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-800"><MapPin className="h-3.5 w-3.5" />Offline Mode</p>
      <div className="space-y-1.5 text-xs text-amber-800">
        <div className="flex items-center justify-between"><span>Per Session</span><span className="font-bold">₹{item.price_offline ?? 0}</span></div>
        <div className="flex items-center justify-between"><span>Total Sessions</span><span className="font-bold">{item.sessions_offline ?? 0} Sessions</span></div>
        <div className="mt-1 flex items-center justify-between border-t border-amber-200 pt-1.5">
          <span className="font-semibold">Total Amount</span>
          <span className="text-sm font-extrabold text-amber-900">₹{(item.price_offline ?? 0) * (item.sessions_offline ?? 0)}</span>
        </div>
      </div>
    </div>
  </div>
);

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
              {item.duration_minutes && (
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

const SessionsPhysiotherapyPanel = ({ reloadToken, toolbarSlot }) => {
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);

  const loadItems = () => listStoreItems("physiotherapy", "session").then(setItems).catch(() => {});
  useEffect(() => { loadItems(); }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (it) => {
    if (!window.confirm(`Permanently delete "${it.name}"? This cannot be undone.`)) return;
    try {
      await deleteStoreItem(it.id);
      toast.success("Session package deleted permanently");
      loadItems();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div className="space-y-3" data-testid="sessions-subpanel-physiotherapy">
      {toolbarSlot && createPortal(
        <Button
          onClick={() => setShowCreate(true)}
          title="Create session package"
          aria-label="Create session package"
          className="h-11 w-11 shrink-0 p-0"
          data-testid="sessions-physiotherapy-create-btn-mobile"
        >
          <Plus className="h-4 w-4" />
        </Button>,
        toolbarSlot,
      )}
      <div className="hidden items-center justify-end sm:flex">
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="sessions-physiotherapy-create-btn">
          <Plus className="mr-1 h-4 w-4" />Create
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            No session packages yet. Click Create to add one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="sessions-physiotherapy-items-grid">
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

                <SessionPriceBoxes item={it} testid={`session-item-${it.id}-highlights`} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateSessionPackageModal onClose={() => setShowCreate(false)} onSaved={loadItems} />}
      {editingItem && <CreateSessionPackageModal item={editingItem} onClose={() => setEditingItem(null)} onSaved={loadItems} />}
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

const SessionsPanel = ({ reloadToken, toolbarSlot }) => {
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

      {sub === "physiotherapy" && <SessionsPhysiotherapyPanel reloadToken={reloadToken} toolbarSlot={toolbarSlot} />}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="sessions-subpanel-fitness" />}
    </div>
  );
};

const PhysiotherapyPanel = ({ kind = "consultation", reloadToken, toolbarSlot }) => {
  const cfg = PACKAGE_KINDS[kind] || PACKAGE_KINDS.consultation;
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);

  const loadItems = () => listStoreItems("physiotherapy", cfg.itemType).then(setItems).catch(() => {});
  useEffect(() => { loadItems(); }, [cfg.itemType, reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="space-y-3" data-testid="consultations-subpanel-physiotherapy">
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
          data-testid="physiotherapy-create-btn-mobile"
        >
          <Plus className="h-4 w-4" />
        </Button>,
        toolbarSlot,
      )}
      <div className="hidden items-center justify-end sm:flex">
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="physiotherapy-create-btn">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="physiotherapy-items-grid">
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
                  <PriceModeBadges item={it} isSession={false} />
                  {it.duration_minutes && (
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

      {showCreate && <CreateConsultationModal kind={kind} onClose={() => setShowCreate(false)} onSaved={loadItems} />}
      {editingItem && <CreateConsultationModal kind={kind} item={editingItem} onClose={() => setEditingItem(null)} onSaved={loadItems} />}
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

const ConsultationsPanel = ({ reloadToken, toolbarSlot }) => {
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

      {sub === "physiotherapy" && <PhysiotherapyPanel reloadToken={reloadToken} toolbarSlot={toolbarSlot} />}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="consultations-subpanel-fitness" />}
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
const BUILT_TABS = new Set(["consultations", "sessions", "diet", "history", ...INVENTORY_TABS]);

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
  const [tab, setTab] = useState("consultations");
  // Bumped by Refresh and handed to whichever panel is open, so it refetches in place.
  const [reloadTick, setReloadTick] = useState(0);
  // A callback ref, not useRef: the portal has to re-render once the node exists, and a
  // ref object mutating in place never triggers that.
  const [createSlot, setCreateSlot] = useState(null);

  return (
    <div className="space-y-4" data-testid="packages-board">
      {/* No heading. The nav tab above already reads FITSIO STORE, and the line under it
          only listed the tabs that follow it. */}
      {/* A dropdown on a phone, the same control the Branch Admin store uses. Eight tabs
          wrapped to three rows there, which pushed the shelf being edited below the fold
          before any of its items showed. Desktop keeps the bar.

          Refresh and Create ride alongside it. Create is not this component's to render —
          each panel owns its own, against its own item type — so the panel portals an
          icon-only copy into the slot at the end of this row. */}
      <div className="flex items-center gap-2 md:hidden">
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
          data-testid="packages-subtab-select"
        >
          {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
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

      <div className="hidden flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1 md:flex" data-testid="packages-subtabs">
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

      {tab === "consultations" && <ConsultationsPanel reloadToken={reloadTick} toolbarSlot={createSlot} />}
      {tab === "sessions" && <SessionsPanel reloadToken={reloadTick} toolbarSlot={createSlot} />}
      {tab === "diet" && <PhysiotherapyPanel kind="diet" reloadToken={reloadTick} toolbarSlot={createSlot} />}
      {tab === "history" && <HistoryPanel reloadToken={reloadTick} />}
      {INVENTORY_TABS.has(tab) && <SuperAdminInventoryPanel key={tab} category={tab} reloadToken={reloadTick} />}
      {/* Whatever has no panel yet. A tab graduates by being handled above rather than by
          another branch being added here. */}
      {!BUILT_TABS.has(tab) && TABS.map((t) => tab === t.key && (
        <PlaceholderPanel key={t.key} label={t.label} testid={`packages-panel-${t.key}`} />
      ))}
    </div>
  );
};

export default PackagesBoard;
