import { HashRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoadingSpinner, Alert } from "./components/ui";
import { useData } from "./hooks/useData";
import Dashboard from "./pages/Dashboard";
import Procedures from "./pages/Procedures";
import ProcedureDetail from "./pages/ProcedureDetail";
import ReviewRequired from "./pages/ReviewRequired";
import ExecutiveSummary from "./pages/ExecutiveSummary";

function AppRoutes() {
  const { data, loading, error } = useData();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-slate-50">
        <LoadingSpinner />
        <p className="text-sm text-slate-500">Loading analyzer output…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 bg-slate-50">
        <div className="max-w-lg w-full space-y-4">
          <Alert type="error">
            <p className="font-bold mb-1">Failed to load procedures.json</p>
            <p className="text-sm text-red-700">{error}</p>
          </Alert>
          <div className="surface p-5 text-sm text-slate-600 space-y-2">
            <p className="font-semibold text-slate-800">Setup instructions:</p>
            <ol className="list-decimal list-inside space-y-2 text-slate-500">
              <li>
                Copy{" "}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">
                  output/procedures.json
                </code>{" "}
                to{" "}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">
                  frontend/public/data/procedures.json
                </code>
              </li>
              <li>
                Optionally copy{" "}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">
                  output/parser_validation.csv
                </code>{" "}
                to{" "}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">
                  frontend/public/data/
                </code>
              </li>
              <li>
                Run{" "}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">
                  npm run dev
                </code>{" "}
                from the{" "}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">
                  frontend/
                </code>{" "}
                directory
              </li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard data={data} />} />
        <Route path="/procedures" element={<Procedures data={data} />} />
        <Route path="/procedures/:name" element={<ProcedureDetail data={data} />} />
        <Route path="/review" element={<ReviewRequired data={data} />} />
        <Route path="/executive" element={<ExecutiveSummary data={data} />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}
