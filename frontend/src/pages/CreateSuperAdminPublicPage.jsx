import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestSuperAdminOtp, verifySuperAdminOtp } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

const CONTROL_EMAIL = "fitsiomaxtech@gmail.com";

const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-sm font-medium text-slate-700">{label}</label>
    {children}
  </div>
);

const generatePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < 14; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

export const CreateSuperAdminPublicPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState("form");
  const [form, setForm] = useState({ full_name: "", email: "", mobile_number: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [requestId, setRequestId] = useState(null);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const handleGeneratePassword = () => {
    setForm((prev) => ({ ...prev, password: generatePassword() }));
    setShowPassword(true);
  };

  const sendOtp = async (event) => {
    event.preventDefault();
    if (!form.full_name || !form.email || !form.password) {
      toast.error("Name, Email and Password are required");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (form.mobile_number && !/^\d{10}$/.test(form.mobile_number)) {
      toast.error("Mobile number must be 10 digits");
      return;
    }

    setLoading(true);
    try {
      const data = await requestSuperAdminOtp(form);
      setRequestId(data.request_id);
      setStep("otp");
      toast.success(`OTP sent to ${CONTROL_EMAIL}`);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const confirmOtp = async (event) => {
    event.preventDefault();
    if (!otp) {
      toast.error("Enter the OTP");
      return;
    }
    setLoading(true);
    try {
      await verifySuperAdminOtp({ request_id: requestId, otp });
      toast.success("Super Admin account created");
      navigate("/");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10" data-testid="public-create-super-admin-page">
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <Card className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="space-y-1 pb-2 text-center">
            <img src={LOGO_URL} alt="Fitsiomax" className="mx-auto h-14 w-14 rounded-lg object-contain" />
            <h1 className="text-xl font-bold text-slate-900">Create Super Admin</h1>
            <p className="text-sm text-slate-500">
              Requires OTP approval sent to <span className="font-medium text-slate-700">{CONTROL_EMAIL}</span>
            </p>
          </CardHeader>
          <CardContent>
            {step === "form" ? (
              <form className="space-y-4" onSubmit={sendOtp} data-testid="public-create-super-admin-form">
                <Field label="Name">
                  <Input value={form.full_name} onChange={set("full_name")} placeholder="Full name" data-testid="public-csa-name" />
                </Field>
                <Field label="Email (login credential)">
                  <Input value={form.email} onChange={set("email")} placeholder="newadmin@fitsiomax.com" data-testid="public-csa-email" />
                </Field>
                <Field label="Mobile Number">
                  <Input value={form.mobile_number} onChange={set("mobile_number")} placeholder="10-digit mobile number" data-testid="public-csa-mobile" />
                </Field>
                <Field label="Password">
                  <div className="flex gap-2">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={set("password")}
                      placeholder="Min 6 characters"
                      data-testid="public-csa-password"
                    />
                    <Button type="button" variant="outline" onClick={handleGeneratePassword} data-testid="public-csa-generate-password">
                      Generate
                    </Button>
                  </div>
                  {form.password && (
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-xs font-medium text-sky-600 hover:text-sky-700"
                    >
                      {showPassword ? "Hide password" : "Show password"}
                    </button>
                  )}
                </Field>
                <Button type="submit" disabled={loading} className="w-full bg-sky-500 text-white hover:bg-sky-600" data-testid="public-csa-send-otp">
                  {loading ? "Sending OTP..." : "Send OTP"}
                </Button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={confirmOtp} data-testid="public-create-super-admin-otp-form">
                <p className="text-sm text-slate-600">
                  Enter the 6-digit OTP sent to <span className="font-medium">{CONTROL_EMAIL}</span>. It expires in 10 minutes.
                </p>
                <Field label="OTP">
                  <Input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit code" data-testid="public-csa-otp" />
                </Field>
                <Button type="submit" disabled={loading} className="w-full bg-sky-500 text-white hover:bg-sky-600" data-testid="public-csa-confirm-otp">
                  {loading ? "Verifying..." : "Confirm & Create"}
                </Button>
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
                  data-testid="public-csa-back"
                >
                  ← Back to edit details
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
