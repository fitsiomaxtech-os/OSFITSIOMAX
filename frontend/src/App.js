import { useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "@/App.css";
import { LoginPage } from "@/pages/LoginPage";
import { CRMPage } from "@/pages/CRMPage";
import { CreateSuperAdminPage } from "@/pages/CreateSuperAdminPage";
import { clearSession, loadSession, saveSession } from "@/lib/session";

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
        <Route
          path="/app/create-super-admin"
          element={
            <RequireAuth isAuthenticated={isAuthenticated}>
              <CreateSuperAdminPage auth={auth} />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/app" : "/"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
