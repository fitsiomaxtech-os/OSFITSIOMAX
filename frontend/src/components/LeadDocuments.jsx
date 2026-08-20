import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { leadDocuments, uploadLeadDocument, deleteLeadDocument, openLeadDocument, setDocumentShared } from "@/lib/api";

/**
 * Documents held against one client — scans, reports, prescriptions, scheme letters.
 *
 * The bytes never come from a URL the browser can fetch on its own. These are patient
 * records, and the OS's /uploads mount is public to anyone holding the link, so every
 * open goes through the authenticated download route and arrives as a blob. That has one
 * visible consequence: a document opens on click rather than being an <a href> you can
 * copy, which is the point rather than a limitation.
 */

/**
 * Says what actually went wrong instead of "Upload failed".
 *
 * Our API always answers with a JSON `detail`, so an error without one did not come from
 * the API — it came from the web server in front of it, or the request never arrived. The
 * commonest case by far is nginx's client_max_body_size, which defaults to 1MB: it rejects
 * the upload with a 413 and an HTML page, the `detail` lookup finds nothing, and every
 * cause collapses into the same unhelpful sentence. Naming the status turns "it doesn't
 * work" into something someone can fix.
 */
// Above uploadError, which reads fmtSize. A const is not hoisted, so writing these
// below the only caller left the file in an order the reader could not follow and the
// linter would not accept.
const KB = 1024;
const fmtSize = (n) => (n >= KB * KB ? `${(n / KB / KB).toFixed(1)} MB` : `${Math.max(1, Math.round(n / KB))} KB`);

const uploadError = (err, file) => {
  const status = err?.response?.status;
  const detail = err?.response?.data?.detail;
  if (detail) return detail;
  if (status === 413) {
    return `Rejected by the server as too large (${fmtSize(file?.size || 0)}). The upload limit on the web server needs raising — nginx client_max_body_size.`;
  }
  if (status === 401 || status === 403) return "You don't have permission to upload here.";
  if (status) return `Upload failed (HTTP ${status}).`;
  return "Upload failed — no response from the server. Check the connection and try again.";
};

// Kept in step with MAX_UPLOAD_BYTES in backend/routers/v3_lead_documents.py. The server
// is the one that enforces it; this copy only exists to fail fast.
const MAX_UPLOAD_MB = 500;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * KB * KB;

// A phone camera writes 3-6MB for one sheet of A4, almost all of it detail that a form
// filled in biro does not have. Resized to 2000px on the long edge and re-encoded, the
// same page lands around 300-600KB and reads identically — the handwriting is legible
// well below the resolution the sensor captured.
//
// This exists because it makes the upload smaller everywhere it travels: quicker over a
// phone connection at the front desk, smaller on the VPS disk, and comfortably under any
// web-server body limit sitting in front of the app. It is not a substitute for raising
// that limit — a multi-page PDF cannot be shrunk here and will still be refused if it is
// over the cap.
const MAX_IMAGE_EDGE = 2000;
const IMAGE_QUALITY = 0.82;
const LEAVE_ALONE_UNDER = 900 * KB;

const compressImage = (file) => new Promise((resolve) => {
  if (!String(file.type || "").startsWith("image/")) return resolve(file);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const longest = Math.max(img.width, img.height);
    const scale = Math.min(1, MAX_IMAGE_EDGE / (longest || 1));
    // Already modest and already small — re-encoding would only lose detail for nothing.
    if (scale === 1 && file.size <= LEAVE_ALONE_UNDER) return resolve(file);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        // Keep whichever is smaller. Re-encoding a screenshot or an already-optimised
        // PNG can come out bigger, and shipping the larger one would be worse than
        // having done nothing.
        if (!blob || blob.size >= file.size) return resolve(file);
        // Renamed to .jpg because that is now what it is — the backend checks the
        // extension, and a JPEG called .png would be refused.
        const base = (file.name || "page").replace(/\.[^.]+$/, "");
        resolve(new File([blob], `${base}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      IMAGE_QUALITY,
    );
  };
  // A format the browser can't decode (HEIC straight off an iPhone, say) goes up
  // untouched and is judged by the server's own extension check.
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  img.src = url;
});
const isImage = (t) => String(t || "").startsWith("image/");
const fmtWhen = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : "—");

export const LeadDocuments = ({ leadId, canEdit = true, kind = "general", fixedLabel = "", hint }) => {
  const [docs, setDocs] = useState([]);
  const [sharing, setSharing] = useState(null); // the doc whose share flag is in flight
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    leadDocuments(leadId, kind)
      .then((r) => setDocs(r.documents || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [leadId, kind]);

  useEffect(() => { load(); }, [load]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    // Cleared straight away so choosing the same file twice still fires a change event —
    // re-uploading a corrected scan under the same name is a normal thing to do.
    e.target.value = "";
    if (!file) return;
    // Checked here as well as on the server, so an oversized file fails in the moment
    // rather than after however long it takes to push it up and be told no.
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`That file is ${fmtSize(file.size)} — the limit is ${MAX_UPLOAD_MB}MB.`);
      return;
    }
    setBusy(true);
    let sent = file;
    try {
      sent = await compressImage(file);
      // A fixed label names the pages for you — the consultation form is always the
      // consultation form, and asking someone to type that on every page is a field
      // they will leave blank.
      await uploadLeadDocument(leadId, sent, fixedLabel || label, kind);
      toast.success(
        sent.size < file.size
          ? `Uploaded · ${fmtSize(file.size)} shrunk to ${fmtSize(sent.size)}`
          : "Document uploaded",
      );
      setLabel("");
      load();
    } catch (err) {
      // Reports the size actually sent, so a 413 names the number the server refused
      // rather than the one on disk before compression.
      toast.error(uploadError(err, sent));
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

  const toggleShare = async (doc) => {
    const next = !doc.shared_with_patient;
    setSharing(doc.id);
    try {
      await setDocumentShared(leadId, doc.id, next);
      // Patched in place rather than reloading: the list is the same, only this flag moved.
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, shared_with_patient: next } : d)));
      toast.success(next ? "Shared with the patient's portal" : "Hidden from the patient's portal");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't change sharing");
    }
    setSharing(null);
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
          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">{fixedLabel ? `Upload ${fixedLabel.toLowerCase()} pages` : "Upload a document"}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{hint || "Scans, reports, prescriptions · JPG, PNG, WEBP or PDF"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!fixedLabel && (
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="What is it? e.g. MRI report"
                className="h-9 min-w-0 flex-1 bg-white sm:max-w-xs"
                data-testid="lead-doc-label"
              />
            )}
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
          {fixedLabel ? `No ${fixedLabel.toLowerCase()} pages uploaded yet.` : "No documents yet."}
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
                {/* Whether the patient can see this in their own Client Portal.
                    Consultation forms are shared on upload — it is the patient's own
                    form. Reports and scans are not, because a patient reading a finding
                    before a clinician has explained it is the branch's call to make
                    deliberately, one document at a time. */}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => toggleShare(d)}
                    disabled={sharing === d.id}
                    className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold transition disabled:opacity-50 ${
                      d.shared_with_patient
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-slate-200 text-slate-400 hover:bg-slate-50"
                    }`}
                    title={d.shared_with_patient
                      ? "Visible to the patient in their portal — click to hide"
                      : "Hidden from the patient — click to share"}
                    data-testid={`lead-doc-share-${d.id}`}
                  >
                    {d.shared_with_patient ? "SHARED" : "PRIVATE"}
                  </button>
                )}
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
