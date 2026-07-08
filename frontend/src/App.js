import { useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@/App.css";
import { LoginPage } from "@/pages/LoginPage";
import { CRMPage } from "@/pages/CRMPage";
import { CreateSuperAdminPage } from "@/pages/CreateSuperAdminPage";
import { clearSession, loadSession, saveSession } from "@/lib/session";

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
            isAuthenticated ? (
              <CRMPage auth={auth} onLogout={handleLogout} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/app/create-super-admin"
          element={
            isAuthenticated ? (
              <CreateSuperAdminPage auth={auth} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/app" : "/"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
