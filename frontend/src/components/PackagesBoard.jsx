import { useEffect, useRef, useState } from "react";
import { Stethoscope, CalendarRange, Pill, Dumbbell, ShoppingCart, Activity, Plus, X, FlaskConical, Pencil, Trash2, ImagePlus } from "lucide-react";
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

const PlaceholderPanel = ({ label, testid }) => (
  <Card data-testid={testid}>
    <CardContent className="p-8 text-center text-sm text-slate-400">
      {label} panel — setup coming soon.
    </CardContent>
  </Card>
);

const CreateConsultationModal = ({ item, onClose, onSaved }) => {
  const isEdit = Boolean(item);
  const [name, setName] = useState(item?.name || "");
  const [description, setDescription] = useState(item?.description || "");
  const [mode, setMode] = useState(item?.mode || "online");
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
      const payload = { category: "physiotherapy", name: name.trim(), description, image_url, mode };
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
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-4 text-white">
          <p className="text-base font-semibold">{isEdit ? "Edit Consultation" : "Consultation"}</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="consultation-create-close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Initial Physiotherapy Assessment" data-testid="consultation-create-name" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
            <textarea
              rows={3}
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
              className="relative aspect-square w-36 overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-sky-400 hover:bg-sky-50/60"
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
            <label className="mb-1 block text-xs font-semibold text-slate-600">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("online")}
                className={`rounded-md border px-3 py-2 text-sm font-medium ${mode === "online" ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600"}`}
                data-testid="consultation-create-mode-online"
              >
                Online
              </button>
              <button
                type="button"
                onClick={() => setMode("offline")}
                className={`rounded-md border px-3 py-2 text-sm font-medium ${mode === "offline" ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-600"}`}
                data-testid="consultation-create-mode-offline"
              >
                Offline
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <Button variant="outline" onClick={onClose} data-testid="consultation-create-cancel">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-sky-600 text-white hover:bg-sky-700" data-testid="consultation-create-submit">
            {saving ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Create")}
          </Button>
        </div>
      </div>
    </div>
  );
};

const PhysiotherapyPanel = () => {
  const [items, setItems] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const loadItems = () => listStoreItems("physiotherapy").then(setItems).catch(() => {});
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
                {it.image_url && <img src={it.image_url} alt={it.name} className="h-32 w-full rounded-lg object-cover" />}
                <p className="font-semibold text-slate-800">{it.name}</p>
                {it.description && <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>}
                <div className="flex items-center justify-between">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${it.mode === "online" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {it.mode === "online" ? "Online" : "Offline"}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingItem(it)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-600"
                      data-testid={`consultation-item-${it.id}-edit`}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateConsultationModal onClose={() => setShowCreate(false)} onSaved={loadItems} />}
      {editingItem && <CreateConsultationModal item={editingItem} onClose={() => setEditingItem(null)} onSaved={loadItems} />}
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
      {tab !== "consultations" && TABS.map((t) => tab === t.key && (
        <PlaceholderPanel key={t.key} label={t.label} testid={`packages-panel-${t.key}`} />
      ))}
    </div>
  );
};

export default PackagesBoard;
