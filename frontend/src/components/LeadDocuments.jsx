import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { leadDocuments, uploadLeadDocument, deleteLeadDocument, openLeadDocument } from "@/lib/api";

/**
 * Documents held against one client — scans, reports, prescriptions, scheme letters.
 *
 * The bytes never come from a URL the browser can fetch on its own. These are patient
 * records, and the OS's /uploads mount is public to anyone holding the link, so every
 * open goes through the authenticated download route and arrives as a blob. That has one
 * visible consequence: a document opens on click rather than being an <a href> you can
 * copy, which is the point rather than a limitation.
 */

const KB = 1024;
const fmtSize = (n) => (n >= KB * KB ? `${(n / KB / KB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / KB))} KB`);
const isImage = (t) => String(t || "").startsWith("image/");
const fmtWhen = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : "—");

export const LeadDocuments = ({ leadId, canEdit = true }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    leadDocuments(leadId)
      .then((r) => setDocs(r.documents || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    // Cleared straight away so choosing the same file twice still fires a change event —
    // re-uploading a corrected scan under the same name is a normal thing to do.
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await uploadLeadDocument(leadId, file, label);
      toast.success("Document uploaded");
      setLabel("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    }
    setBusy(false);
  };

  const open = async (doc) => {
    try {
      const url = await openLeadDocument(leadId, doc.id);
      window.open(url, "_blank", "noopener");
      // Revoked on a delay rather than immediately: the new tab has to finish reading the
      // blob first, and revoking on the next line leaves it opening a dead URL.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error("Could not open that document");
    }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.label || doc.original_name}"? This cannot be undone.`)) return;
    try {
      await deleteLeadDocument(leadId, doc.id);
      toast.success("Document deleted");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div className="space-y-3" data-testid="lead-documents">
      {canEdit && (
        <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">Upload a document</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Scans, reports, prescriptions · JPG, PNG, WEBP or PDF, up to 10MB</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="What is it? e.g. MRI report"
              className="h-9 min-w-0 flex-1 bg-white sm:max-w-xs"
              data-testid="lead-doc-label"
            />
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              className="hidden"
              onChange={pick}
              data-testid="lead-doc-input"
            />
            <Button
              size="sm"
              className="bg-sky-600 hover:bg-sky-700"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              data-testid="lead-doc-choose"
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {busy ? "Uploading…" : "Choose File"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-400">
          No documents yet.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="lead-doc-list">
          {docs.map((d) => {
            const Icon = isImage(d.content_type) ? ImageIcon : FileText;
            return (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5" data-testid={`lead-doc-${d.id}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon className="h-4 w-4" />
                </span>
                <button
                  type="button"
                  onClick={() => open(d)}
                  className="min-w-0 flex-1 text-left"
                  data-testid={`lead-doc-open-${d.id}`}
                >
                  <p className="truncate text-sm font-semibold text-slate-800">{d.label || d.original_name}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {/* The original filename only when it isn't already the title, so a
                        document with no label doesn't print its name twice. */}
                    {d.label && d.original_name !== d.label ? `${d.original_name} · ` : ""}
                    {fmtSize(d.size_bytes || 0)} · {fmtWhen(d.created_at)} · {d.uploaded_by || "—"}
                  </p>
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove(d)}
                    className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Delete"
                    data-testid={`lead-doc-delete-${d.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default LeadDocuments;
