import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiLogin } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import { ForgotPasswordModal } from "@/components/ForgotPasswordModal";

const BG_IMAGE =
  "https://images.pexels.com/photos/62693/pexels-photo-62693.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

export const LoginPage = ({ onLogin }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await apiLogin(email, password);
      onLogin(data);
      toast.success("Login successful");
      navigate(location.state?.from || "/app", { replace: true });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    setForgotOpen(true);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-white" data-testid="screen1-login-page">
      <img
        src={BG_IMAGE}
        alt="Minimal background"
        className="absolute inset-0 h-full w-full object-cover object-center"
        data-testid="screen1-login-background-image"
      />
      <div className="absolute inset-0 bg-white/90 backdrop-blur-[2px]" data-testid="screen1-login-overlay" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8 md:px-8 md:py-10">
        <Card
          className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-[0_8px_30px_rgb(2,6,23,0.06)]"
          data-testid="screen1-login-card"
        >
          <CardHeader className="space-y-1 pb-2 text-center">
            <img
              src={LOGO_URL}
              alt="Fitsiomax"
              className="mx-auto h-16 w-16 rounded-lg object-contain"
              data-testid="screen1-login-logo"
            />
            <h1 className="font-heading text-3xl font-bold text-slate-900" data-testid="screen1-login-title">
              FITSIOMAX OS
            </h1>
            <p
              className="text-xs font-medium uppercase tracking-[0.14em] text-sky-600"
              data-testid="screen1-login-brand-subtitle"
            >
              Powered by Fitsiomax Clinic
            </p>
          </CardHeader>

          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit} data-testid="screen1-login-form">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" data-testid="screen1-login-email-label">
                  Email
                </label>
                <Input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="user@fitsiomax.com"
                  className="border-slate-200 bg-white"
                  data-testid="screen1-login-email-input"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700" data-testid="screen1-login-password-label">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs font-medium text-sky-600 hover:text-sky-700"
                    data-testid="screen1-login-forgot-password"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="border-slate-200 bg-white pr-10"
                    data-testid="screen1-login-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    data-testid="screen1-login-password-toggle"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-sky-500 text-white hover:bg-sky-600"
                data-testid="screen1-login-submit-button"
              >
                {loading ? "Signing in..." : "Continue"}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-slate-400" data-testid="screen1-login-footer-note">
              Only invited users can login. Contact your admin for access.
            </p>
          </CardContent>
        </Card>
      </div>

      <ForgotPasswordModal open={forgotOpen} onOpenChange={setForgotOpen} />
    </div>
  );
};
