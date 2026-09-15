import { Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import { waNumber } from "@/lib/phone";
import { credentialLines, portalCopyText, portalUrl, portalWhatsAppText } from "@/lib/portalCredentials";

// What became of the email the server tried to send. Anything but "sent" points the desk at
// WhatsApp, which is the one delivery they can still do by hand right now.
const EMAIL_STATUS = {
  sent: { tone: "border-emerald-200 bg-emerald-50 text-emerald-800", text: (email) => `Login emailed to ${email}` },
  failed: { tone: "border-rose-200 bg-rose-50 text-rose-800", text: () => "The email could not be sent — share it on WhatsApp instead." },
  not_configured: { tone: "border-amber-200 bg-amber-50 text-amber-800", text: () => "Email is not set up on this server — share it on WhatsApp instead." },
  no_email: { tone: "border-slate-200 bg-slate-50 text-slate-700", text: () => "No email on file — share it on WhatsApp." },
};

/**
 * Shown straight after a treatment course is booked, when the server has just made the
 * patient's Client Portal login on its own (see auto_portal_login_for_treatment).
 *
 * This is the only moment the password exists outside its hash, so it is shown here once,
 * with the WhatsApp hand-off beside it. A patient added to a family's existing login gets
 * no new password, and the popup says so instead.
 */
export function PortalLoginCreatedDialog({ portal, onClose }) {
  if (!portal || !["created", "joined"].includes(portal.status)) return null;

  const name = portal.patient_name || "there";
  const joined = portal.status === "joined";
  const email = EMAIL_STATUS[portal.email_status];

  const shareOnWhatsApp = () => {
    const num = waNumber(portal.phone);
    if (!num) { toast.error("This patient has no phone number on file"); return; }
    // Same-tab handoff, not window.open(..., "_blank") — that leaves the tab on a blank
    // white screen on the way back on mobile (see PhysioBoard's Call/WhatsApp fix).
    window.location.href = `https://wa.me/${num}?text=${encodeURIComponent(portalWhatsAppText(name, portal))}`;
  };

  const copyCredentials = async () => {
    try {
      await navigator.clipboard.writeText(portalCopyText(portal));
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy — copy manually");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="portal-login-created-dialog"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {joined ? "Added to family portal login" : "Client Portal login created"}
          </h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100" data-testid="portal-login-created-close">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {joined ? (
            <p className="text-xs text-slate-700" data-testid="portal-login-created-joined">
              {name} now shares the login already used by {(portal.shared_with || []).join(", ")}. The password stays
              the same, so nothing new needs sending — they pick {name} after signing in.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                Made automatically for {name}. Share it once — the password won&apos;t be shown again.
              </p>
              {email && (
                <p className={`rounded-md border px-2.5 py-1.5 text-[11px] ${email.tone}`} data-testid="portal-login-created-email">
                  {email.text(portal.email)}
                </p>
              )}
              <div className="space-y-1 rounded-md border border-violet-200 bg-violet-50/40 p-3">
                <p className="text-xs text-slate-700">Link: <span className="break-all font-mono">{portalUrl()}</span></p>
                {credentialLines(portal).map(([label, value]) => (
                  <p key={label} className="text-xs text-slate-700">{label}: <span className="font-mono">{value}</span></p>
                ))}
                {(portal.shared_with || []).length > 0 && (
                  <p className="text-[11px] text-amber-700">This password also applies to {portal.shared_with.join(", ")}.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 bg-[#25D366] text-xs text-white hover:bg-[#1da851]" onClick={shareOnWhatsApp} data-testid="portal-login-created-whatsapp">
                  <WhatsAppIcon className="mr-1.5 h-3.5 w-3.5" /> Send on WhatsApp
                </Button>
                <Button size="sm" variant="outline" className="text-xs" onClick={copyCredentials} data-testid="portal-login-created-copy">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
