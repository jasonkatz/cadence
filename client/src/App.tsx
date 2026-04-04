import { Routes, Route } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import WorkflowDetailPage from "./pages/WorkflowDetailPage";
import SettingsPage from "./pages/SettingsPage";
import CallbackPage from "./pages/CallbackPage";

function App() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          role="status"
          aria-label="Loading"
          className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"
        />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/callback" element={<CallbackPage />} />
    </Routes>
  );
}

export default App;
