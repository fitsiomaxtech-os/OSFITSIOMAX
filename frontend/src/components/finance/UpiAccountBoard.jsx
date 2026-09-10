import { useEffect, useRef, useState } from "react";
import { Building2, ImagePlus, Lock, LockOpen, Pencil, QrCode, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  bmGetUpiAccount, bmSaveUpiAccount, bmLockUpiAccount, bmUnlockUpiAccount,
  bmUploadQrImage, bmListUpiAccounts,
} from "@/lib/api";

const IMAGE_TYPES = /\.(jpe?g|png|webp)$/i;
const blankDraft = { qr_code_url: "", upi_id: "", bank_name: "", account_holder_name: "", bank_branch: "" };

// Same pick/preview/resolve shape as usePackageImage in PackagesBoard.jsx — nothing is
// uploaded unless a new file was actually chosen, so re-saving the other four fields
// costs no round trip against the QR that is already sitting there.
const useQrImage = (savedUrl) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(savedUrl || null);
  const [cleared, setCleared] = useState(false);
  const objectUrl = useRef(null);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  const showPreview = (next) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = next;
    setPreview(next);
  };

  const reset = (url) => { setFile(null); setCleared(false); showPreview(url || null); };

  const pick = (e) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    if (!IMAGE_TYPES.test(chosen.name || "")) {
      toast.error("Only JPG, PNG or WEBP images can be used here");
      e.target.value = "";
      return;
    }
    setFile(chosen);
    setCleared(false);
    showPreview(URL.createObjectURL(chosen));
    e.target.value = "";
  };

  const clear = () => { setFile(null); setCleared(true); showPreview(null); };

  const resolve = async () => {
    if (file) return (await bmUploadQrImage(file)).url;
    return cleared ? "" : (savedUrl || "");
  };

  return { preview, pick, clear, reset, resolve };
};

const QrDropzone = ({ image, testidPrefix }) => {
  const fileInputRef = useRef(null);
  const open = () => fileInputRef.current?.click();
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">QR Code</label>
      <div className="flex items-end gap-3">
        <button
          type="button"
          onClick={open}
          className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-sky-400 hover:bg-sky-50/60"
          title={image.preview ? "Choose a different QR image" : "Upload the QR"}
          data-testid={`${testidPrefix}-qr-dropzone`}
        >
          {image.preview ? (
            <img src={image.preview} alt="UPI QR" className="h-full w-full object-contain bg-white p-1" data-testid={`${testidPrefix}-qr-preview`} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
              <ImagePlus className="h-6 w-6 text-slate-400" />
              <span className="text-[11px] font-semibold text-slate-500">Upload QR</span>
            </div>
          )}
        </button>
        {image.preview && (
          <div className="flex flex-col gap-1.5" data-testid={`${testidPrefix}-qr-actions`}>
            <button
              type="button"
              onClick={open}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
              data-testid={`${testidPrefix}-qr-change`}
            >
              <Pencil className="h-3 w-3" />Change
            </button>
            <button
              type="button"
              onClick={image.clear}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50"
              data-testid={`${testidPrefix}-qr-remove`}
            >
              <Trash2 className="h-3 w-3" />Remove
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={image.pick}
        data-testid={`${testidPrefix}-qr-input`}
        className="hidden"
      />
    </div>
  );
};

/**
 * Finance > UPI — one branch's own UPI collection account: the QR a patient scans, the
 * UPI ID it resolves to, and whose bank it settles into. Every branch keeps its own —
 * Anna Nagar's account is not Parrys' — so a payment collected by UPI at a branch is
 * already, by carrying that branch's branch_id, a payment against that branch's own
 * account here; nothing further ties the two together.
 *
 * `branchId` undefined means "All Branches" is picked in the pill row above this board —
 * there is no one UPI account for that, so this renders a read-only grid of every
 * branch's own card instead, each opening onto its own editor via `onSelectBranch`.
 */
export const UpiAccountBoard = ({ branchId, branchName, onSelectBranch }) => {
  if (!branchId) return <UpiAccountsGrid onSelectBranch={onSelectBranch} />;
  return <SingleBranchUpiCard branchId={branchId} branchName={branchName} />;
};

const UpiAccountsGrid = ({ onSelectBranch }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    bmListUpiAccounts().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="py-10 text-center text-sm text-slate-400">Loading...</p>;
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-slate-400">No branches yet.</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="upi-accounts-grid">
      {rows.map((r) => {
        const acc = r.upi_account;
        return (
          <button
            key={r.branch_id}
            type="button"
            onClick={() => onSelectBranch?.(r.branch_id)}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-sm"
            data-testid={`upi-account-card-${r.branch_id}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />{r.branch_name}
              </p>
              {acc?.locked ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <Lock className="h-3 w-3" />Locked
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {acc ? "Unlocked" : "Not set up"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex aspect-square w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-100 bg-slate-50">
                {acc?.qr_code_url ? (
                  <img src={acc.qr_code_url} alt={`${r.branch_name} UPI QR`} className="h-full w-full object-contain bg-white" />
                ) : (
                  <QrCode className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div className="min-w-0 text-xs text-slate-500">
                <p className="truncate font-medium text-slate-700">{acc?.upi_id || "No UPI ID yet"}</p>
                <p className="truncate">{acc?.bank_name || "—"}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

const FIELD_LABELS = {
  upi_id: "UPI ID",
  bank_name: "Bank Name",
  account_holder_name: "Account Holder Name",
  bank_branch: "Bank Branch",
};

const SingleBranchUpiCard = ({ branchId, branchName }) => {
  const [account, setAccount] = useState(null); // null until loaded; {} once loaded with nothing saved yet
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);
  const image = useQrImage(account?.qr_code_url);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    bmGetUpiAccount(branchId).then((res) => {
      if (cancelled) return;
      const acc = res.upi_account || null;
      setAccount(acc);
      // Nothing saved yet — go straight to the editor rather than an empty card with
      // an Edit button whose whole job would be to open the same form a second click.
      setEditing(!acc);
      setDraft({ ...blankDraft, ...(acc || {}) });
      image.reset(acc?.qr_code_url);
    }).catch(() => { if (!cancelled) { setAccount(null); setEditing(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const startEdit = () => {
    setDraft({ ...blankDraft, ...(account || {}) });
    image.reset(account?.qr_code_url);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft({ ...blankDraft, ...(account || {}) });
    image.reset(account?.qr_code_url);
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const qr_code_url = await image.resolve();
      const res = await bmSaveUpiAccount(branchId, { ...draft, qr_code_url });
      setAccount(res.upi_account);
      setEditing(false);
      toast.success("UPI account saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save the UPI account");
    }
    setSaving(false);
  };

  const lock = async () => {
    setLocking(true);
    try {
      const res = await bmLockUpiAccount(branchId);
      setAccount(res.upi_account);
      toast.success("UPI account locked");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not lock this account");
    }
    setLocking(false);
  };

  const unlock = async () => {
    setLocking(true);
    try {
      const res = await bmUnlockUpiAccount(branchId);
      setAccount(res.upi_account);
      toast.success("UPI account unlocked");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not unlock this account");
    }
    setLocking(false);
  };

  if (loading) return <p className="py-10 text-center text-sm text-slate-400">Loading...</p>;

  const locked = !!account?.locked;

  return (
    <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-5" data-testid="upi-account-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Building2 className="h-4 w-4 text-slate-400" />{branchName || "This branch"}'s UPI Account
          </p>
          {locked && account?.locked_by && (
            <p className="mt-0.5 text-[11px] text-slate-400">Locked by {account.locked_by}</p>
          )}
        </div>
        {locked && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700" data-testid="upi-account-locked-badge">
            <Lock className="h-3.5 w-3.5" />Locked
          </span>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <QrDropzone image={image} testidPrefix="upi-account" />
          {Object.keys(FIELD_LABELS).map((key) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-semibold text-slate-600">{FIELD_LABELS[key]}</label>
              <Input
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                placeholder={FIELD_LABELS[key]}
                data-testid={`upi-account-${key}`}
              />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            {account && (
              <Button variant="outline" onClick={cancelEdit} disabled={saving} data-testid="upi-account-cancel">Cancel</Button>
            )}
            <Button onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-700" data-testid="upi-account-save">
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex aspect-square w-32 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {account?.qr_code_url ? (
              <img src={account.qr_code_url} alt={`${branchName || "Branch"} UPI QR`} className="h-full w-full object-contain bg-white p-1" data-testid="upi-account-qr" />
            ) : (
              <QrCode className="h-8 w-8 text-slate-300" />
            )}
          </div>
          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {Object.keys(FIELD_LABELS).map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-4 px-3 py-2">
                <dt className="shrink-0 text-xs text-slate-500">{FIELD_LABELS[key]}</dt>
                <dd className="min-w-0 truncate text-right text-sm font-semibold text-slate-800">{account?.[key] || "—"}</dd>
              </div>
            ))}
          </dl>
          <div className="flex justify-end gap-2 pt-1">
            {locked ? (
              <Button variant="outline" onClick={unlock} disabled={locking} data-testid="upi-account-unlock">
                <LockOpen className="mr-1.5 h-3.5 w-3.5" />{locking ? "Unlocking..." : "Unlock"}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={startEdit} data-testid="upi-account-edit">
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />Edit
                </Button>
                <Button onClick={lock} disabled={locking} className="bg-emerald-600 hover:bg-emerald-700" data-testid="upi-account-lock">
                  <Lock className="mr-1.5 h-3.5 w-3.5" />{locking ? "Locking..." : "Lock"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
