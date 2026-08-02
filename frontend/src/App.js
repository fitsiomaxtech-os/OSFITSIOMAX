import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "@/App.css";
import { LoginPage } from "@/pages/LoginPage";
import { CRMPage } from "@/pages/CRMPage";
import { CreateSuperAdminPublicPage } from "@/pages/CreateSuperAdminPublicPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { PatientPortalPage } from "@/pages/PatientPortalPage";
import { clearSession, loadSession, saveSession } from "@/lib/session";
import { apiMe } from "@/lib/api";

const RequireAuth = ({ isAuthenticated, children }) => {
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return children;
};

function App() {
  const [auth, setAuth] = useState(loadSession());

  const isAuthenticated = useMemo(() => Boolean(auth?.token), [auth]);

  useEffect(() => {
    if (!auth?.token) return;
    apiMe()
      .then((user) => {
        setAuth((prev) => {
          if (!prev) return prev;
          const next = { ...prev, user };
          saveSession(next);
          return next;
        });
      })
      .catch(() => { /* keep cached profile if the refresh fails */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

  const handleLogin = (loginResponse) => {
    saveSession(loginResponse);
    setAuth(loginResponse);
  };

  const handleLogout = () => {
    clearSession();
    setAuth(null);
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            isAuthenticated ? (
              <Navigate to="/app" replace />
            ) : (
              <LoginPage onLogin={handleLogin} />
            )
          }
        />
        <Route
          path="/app"
          element={
            <RequireAuth isAuthenticated={isAuthenticated}>
              <CRMPage auth={auth} onLogout={handleLogout} />
            </RequireAuth>
          }
        />
        <Route path="/createsuperadmin" element={<CreateSuperAdminPublicPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/portal" element={<PatientPortalPage />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/app" : "/"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
