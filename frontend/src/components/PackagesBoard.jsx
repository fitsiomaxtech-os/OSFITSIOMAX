import { useEffect, useRef, useState } from "react";
import { Stethoscope, CalendarRange, Pill, Dumbbell, ShoppingCart, Activity, Plus, X, FlaskConical, Pencil, Trash2, ImagePlus, Wifi, MapPin, Clock, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { uploadStoreImage, createStoreItem, updateStoreItem, deleteStoreItem, listStoreItems } from "@/lib/api";

const TABS = [
  { key: "consultations", label: "Consultations", icon: Stethoscope },
  { key: "sessions", label: "Sessions", icon: CalendarRange },
  { key: "tablet", label: "Tablet", icon: Pill },
  { key: "supplementary", label: "Supplementary", icon: FlaskConical },
  { key: "equipment", label: "Equipment", icon: Dumbbell },
  { key: "vending_machine", label: "Vending Machine", icon: ShoppingCart },
];

const CONSULTATIONS_SUBTABS = [
  { key: "physiotherapy", label: "Physiotherapy", icon: Activity },
  { key: "fitness", label: "Fitness", icon: Dumbbell },
];

const SESSIONS_SUBTABS = [
  { key: "physiotherapy", label: "Physiotherapy", icon: Activity },
  { key: "fitness", label: "Fitness", icon: Dumbbell },
];

const PlaceholderPanel = ({ label, testid }) => (
  <Card data-testid={testid}>
    <CardContent className="p-8 text-center text-sm text-slate-400">
      {label} panel — setup coming soon.
    </CardContent>
  </Card>
);

const DEFAULT_PRICE_ONLINE = 1200;
const DEFAULT_PRICE_OFFLINE = 800;

const DURATION_OPTIONS = [
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

const CreateConsultationModal = ({ item, onClose, onSaved }) => {
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
    if (!name.trim()) { toast.error("Consultation name is required"); return; }
    setSaving(true);
    try {
      let image_url = item?.image_url || null;
      if (imageFile) {
        const uploaded = await uploadStoreImage(imageFile);
        image_url = uploaded.url;
      }
      const payload = {
        item_type: "consultation",
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
        toast.success("Consultation updated");
      } else {
        await createStoreItem(payload);
        toast.success("Consultation created");
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
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-3 text-white">
          <p className="text-base font-semibold">{isEdit ? "Edit Consultation" : "Consultation"}</p>
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
            <label className="mb-1 block text-xs font-semibold text-slate-600">Consultation Duration</label>
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

const CreateSessionPackageModal = ({ item, onClose, onSaved }) => {
  const isEdit = Boolean(item);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [priceOnline, setPriceOnline] = useState(item?.price_online ?? DEFAULT_PRICE_ONLINE);
  const [priceOffline, setPriceOffline] = useState(item?.price_offline ?? DEFAULT_PRICE_OFFLINE);
  const [sessionsCount, setSessionsCount] = useState(item?.sessions_count ?? "");
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

  const sessions = Number(sessionsCount) || 0;
  const totalOnline = (Number(priceOnline) || 0) * sessions;
  const totalOffline = (Number(priceOffline) || 0) * sessions;

  const submit = async () => {
    if (!name.trim()) { toast.error("Package name is required"); return; }
    if (!sessionsCount || Number(sessionsCount) < 1) { toast.error("Enter number of sessions"); return; }
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
        sessions_count: Number(sessionsCount),
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
            <label className="mb-1 block text-xs font-semibold text-slate-600">Price (Per Session)</label>
            <PriceFields
              priceOnline={priceOnline}
              setPriceOnline={setPriceOnline}
              priceOffline={priceOffline}
              setPriceOffline={setPriceOffline}
              onlineTestId="session-create-price-online"
              offlineTestId="session-create-price-offline"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Sessions</label>
            <Input
              type="number"
              min="1"
              value={sessionsCount}
              onChange={(e) => setSessionsCount(e.target.value)}
              placeholder="Enter number of sessions"
              data-testid="session-create-sessions-count"
            />
          </div>

          <div className="grid grid-cols-2 gap-2" data-testid="session-create-total">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
              <p className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><Wifi className="h-3 w-3" />Online Total</p>
              <p className="text-[10px] text-emerald-600">Price × Sessions</p>
              <p className="mt-1 text-lg font-extrabold text-emerald-800" data-testid="session-create-total-online">₹{totalOnline}</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
              <p className="flex items-center gap-1 text-xs font-semibold text-amber-700"><MapPin className="h-3 w-3" />Offline Total</p>
              <p className="text-[10px] text-amber-600">Price × Sessions</p>
              <p className="mt-1 text-lg font-extrabold text-amber-800" data-testid="session-create-total-offline">₹{totalOffline}</p>
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

const PriceModeBadges = ({ item, isSession }) => (
  <div className="mt-2 space-y-1.5">
    <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2.5 py-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
        <Wifi className="h-3.5 w-3.5" />Online
      </span>
      <span className="text-sm font-extrabold text-emerald-900">
        ₹{isSession ? (item.price_online ?? 0) * (item.sessions_count ?? 0) : (item.price_online ?? 0)}
      </span>
    </div>
    <div className="flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800">
        <MapPin className="h-3.5 w-3.5" />Offline
      </span>
      <span className="text-sm font-extrabold text-amber-900">
        ₹{isSession ? (item.price_offline ?? 0) * (item.sessions_count ?? 0) : (item.price_offline ?? 0)}
      </span>
    </div>
  </div>
);

const ViewItemModal = ({ item, kind, onClose, onEdit }) => {
  const isSession = kind === "session";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="item-view-modal">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-3 text-white">
          <p className="flex-1 truncate text-base font-semibold" data-testid="item-view-name">{item.name}</p>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={onEdit} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="item-view-edit" title="Edit">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="item-view-close" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {item.image_url && <img src={item.image_url} alt={item.name} className="h-48 w-full rounded-lg object-cover" />}
          {item.description && <p className="text-sm text-slate-600">{item.description}</p>}

          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
            <PriceModeBadges item={item} isSession={isSession} />
            {isSession ? (
              <p className="mt-2 text-[11px] text-slate-500">
                ₹{item.price_online ?? 0} / ₹{item.price_offline ?? 0} per session × {item.sessions_count ?? 0} sessions
              </p>
            ) : (
              item.duration_minutes && (
                <div className="mt-1.5 flex items-center justify-between rounded-lg bg-sky-50 px-2.5 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-800">
                    <Clock className="h-3.5 w-3.5" />Consultation Duration
                  </span>
                  <span className="text-sm font-extrabold text-sky-900">
                    {DURATION_OPTIONS.find((d) => d.minutes === item.duration_minutes)?.label || `${item.duration_minutes} mins`}
                  </span>
                </div>
              )
            )}
            {isSession && (
              <div className="mt-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                  {item.sessions_count ?? 0} sessions
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SessionsPhysiotherapyPanel = () => {
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);

  const loadItems = () => listStoreItems("physiotherapy", "session").then(setItems).catch(() => {});
  useEffect(() => { loadItems(); }, []);

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
      <div className="flex items-center justify-end">
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
                {it.image_url && <img src={it.image_url} alt={it.name} className="h-32 w-full rounded-lg object-cover" />}
                {it.description && <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>}

                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3" data-testid={`session-item-${it.id}-highlights`}>
                  <PriceModeBadges item={it} isSession />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                      {it.sessions_count ?? 0} sessions
                    </span>
                  </div>
                </div>
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

const SessionsPanel = () => {
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

      {sub === "physiotherapy" && <SessionsPhysiotherapyPanel />}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="sessions-subpanel-fitness" />}
    </div>
  );
};

const PhysiotherapyPanel = () => {
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);

  const loadItems = () => listStoreItems("physiotherapy", "consultation").then(setItems).catch(() => {});
  useEffect(() => { loadItems(); }, []);

  const handleDelete = async (it) => {
    if (!window.confirm(`Permanently delete "${it.name}"? This cannot be undone.`)) return;
    try {
      await deleteStoreItem(it.id);
      toast.success("Consultation deleted permanently");
      loadItems();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div className="space-y-3" data-testid="consultations-subpanel-physiotherapy">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="physiotherapy-create-btn">
          <Plus className="mr-1 h-4 w-4" />Create
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">
            No consultations yet. Click Create to add one.
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
                {it.image_url && <img src={it.image_url} alt={it.name} className="h-32 w-full rounded-lg object-cover" />}
                {it.description && <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>}

                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3" data-testid={`consultation-item-${it.id}-highlights`}>
                  <PriceModeBadges item={it} isSession={false} />
                  {it.duration_minutes && (
                    <div className="mt-1.5 flex items-center justify-between rounded-lg bg-sky-50 px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-800">
                        <Clock className="h-3.5 w-3.5" />Consultation Duration
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

      {showCreate && <CreateConsultationModal onClose={() => setShowCreate(false)} onSaved={loadItems} />}
      {editingItem && <CreateConsultationModal item={editingItem} onClose={() => setEditingItem(null)} onSaved={loadItems} />}
      {viewingItem && (
        <ViewItemModal
          item={viewingItem}
          kind="consultation"
          onClose={() => setViewingItem(null)}
          onEdit={() => { setEditingItem(viewingItem); setViewingItem(null); }}
        />
      )}
    </div>
  );
};

const ConsultationsPanel = () => {
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

      {sub === "physiotherapy" && <PhysiotherapyPanel />}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="consultations-subpanel-fitness" />}
    </div>
  );
};

export const PackagesBoard = () => {
  const [tab, setTab] = useState("consultations");

  return (
    <div className="space-y-4" data-testid="packages-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">FITSIO STORE</h2>
        <p className="text-sm text-slate-500">Manage Consultations, Sessions, Tablet, Supplementary, Equipment, and Vending Machine.</p>
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

      {tab === "consultations" && <ConsultationsPanel />}
      {tab === "sessions" && <SessionsPanel />}
      {tab !== "consultations" && tab !== "sessions" && TABS.map((t) => tab === t.key && (
        <PlaceholderPanel key={t.key} label={t.label} testid={`packages-panel-${t.key}`} />
      ))}
    </div>
  );
};

export default PackagesBoard;
