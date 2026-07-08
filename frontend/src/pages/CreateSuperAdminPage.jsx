import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { hrCreateUser } from "@/lib/api";
import { toast } from "@/components/ui/sonner";

const DEFAULT_EMAIL = "fitsiomaxtech@gmail.com";

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-sm font-medium text-slate-700">{label}</label>
    {children}
  </div>
);

export const CreateSuperAdminPage = ({ auth }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: "",
    email: DEFAULT_EMAIL,
    mobile_number: "",
    aadhar_number: "",
    password: "",
    confirm: "",
  });
  const [loading, setLoading] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (!auth?.token) {
    return <Navigate to="/" replace />;
  }
  if (auth?.user?.role !== "super_admin") {
    return <Navigate to="/app" replace />;
  }

  const submit = async (event) => {
    event.preventDefault();
    if (!form.full_name || !form.email || !form.password) {
      toast.error("Name, Email and Password are required");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (form.mobile_number && !/^\d{10}$/.test(form.mobile_number)) {
      toast.error("Mobile number must be 10 digits");
      return;
    }
    if (form.aadhar_number && !/^\d{12}$/.test(form.aadhar_number)) {
      toast.error("Aadhar number must be 12 digits");
      return;
    }

    setLoading(true);
    try {
      await hrCreateUser({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        role: "super_admin",
        mobile_number: form.mobile_number || null,
        aadhar_number: form.aadhar_number || null,
      });
      toast.success("Super Admin created");
      navigate("/app");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Create failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10" data-testid="create-super-admin-page">
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <button
          onClick={() => navigate("/app")}
          className="self-start text-sm font-medium text-sky-600 hover:text-sky-700"
          data-testid="create-super-admin-back"
        >
          ← Back to Dashboard
        </button>

        <Card className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="space-y-1 pb-2">
            <h1 className="text-xl font-bold text-slate-900">Create Super Admin</h1>
            <p className="text-sm text-slate-500">
              Provision a new Super Admin login for FitsiomaxOS. Only existing Super Admins can access this page.
            </p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit} data-testid="create-super-admin-form">
              <Field label="Name">
                <Input
                  value={form.full_name}
                  onChange={set("full_name")}
                  placeholder="Full name"
                  data-testid="create-super-admin-name"
                />
              </Field>

              <Field label="Email (login credential)">
                <Input
                  value={form.email}
                  onChange={set("email")}
                  placeholder="user@fitsiomax.com"
                  data-testid="create-super-admin-email"
                />
              </Field>

              <Field label="Mobile Number">
                <Input
                  value={form.mobile_number}
                  onChange={set("mobile_number")}
                  placeholder="10-digit mobile number"
                  data-testid="create-super-admin-mobile"
                />
              </Field>

              <Field label="Aadhar Number">
                <Input
                  value={form.aadhar_number}
                  onChange={set("aadhar_number")}
                  placeholder="12-digit Aadhar number"
                  data-testid="create-super-admin-aadhar"
                />
              </Field>

              <Field label="Password">
                <Input
                  type="password"
                  value={form.password}
                  onChange={set("password")}
                  placeholder="Min 6 characters"
                  data-testid="create-super-admin-password"
                />
              </Field>

              <Field label="Confirm Password">
                <Input
                  type="password"
                  value={form.confirm}
                  onChange={set("confirm")}
                  placeholder="Confirm password"
                  data-testid="create-super-admin-confirm"
                />
              </Field>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-sky-500 text-white hover:bg-sky-600"
                data-testid="create-super-admin-submit"
              >
                {loading ? "Creating..." : "Create Super Admin"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
