import { Routes, Route, Navigate } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import NewWorkflowPage from "./pages/NewWorkflowPage";
import WorkflowDetailPage from "./pages/WorkflowDetailPage";
import SettingsPage from "./pages/SettingsPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/workflows/new" element={<NewWorkflowPage />} />
      <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  );
}

export default App;
