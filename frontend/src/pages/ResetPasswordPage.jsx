import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { validateResetToken, resetPassword } from "@/lib/api";

const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-sm font-medium text-slate-700">{label}</label>
    {children}
  </div>
);

export const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";
  const [status, setStatus] = useState("checking"); // checking | valid | invalid | done
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    validateResetToken(token)
      .then(() => setStatus("valid"))
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await resetPassword({ token, new_password: newPassword, confirm_password: confirmPassword });
      setStatus("done");
      toast.success("Password reset successful");
      setTimeout(() => navigate("/", { replace: true }), 1500);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Failed to reset password");
      if (error?.response?.status === 400) setStatus("invalid");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10" data-testid="reset-password-page">
      <Card className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-sm">
        <CardHeader className="space-y-1 pb-2 text-center">
          <img src={LOGO_URL} alt="Fitsiomax" className="mx-auto h-14 w-14 rounded-lg object-contain" />
          <h1 className="text-xl font-bold text-slate-900">Reset Password</h1>
        </CardHeader>
        <CardContent>
          {status === "checking" && (
            <p className="text-center text-sm text-slate-500" data-testid="reset-password-checking">Checking your link...</p>
          )}

          {status === "invalid" && (
            <div className="space-y-4 text-center" data-testid="reset-password-invalid">
              <p className="text-sm text-slate-600">This reset link is invalid or has expired.</p>
              <Button onClick={() => navigate("/")} className="w-full bg-sky-500 text-white hover:bg-sky-600">
                Back to Login
              </Button>
            </div>
          )}

          {status === "valid" && (
            <form className="space-y-4" onSubmit={handleSubmit} data-testid="reset-password-form">
              <Field label="New Password">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  data-testid="reset-password-new-input"
                  autoFocus
                />
              </Field>
              <Field label="Confirm Password">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  data-testid="reset-password-confirm-input"
                />
              </Field>
              <Button type="submit" disabled={loading} className="w-full bg-sky-500 text-white hover:bg-sky-600" data-testid="reset-password-submit-btn">
                {loading ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
          )}

          {status === "done" && (
            <p className="text-center text-sm text-slate-600" data-testid="reset-password-done">
              Password reset successful. Redirecting to login...
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPasswordPage;
