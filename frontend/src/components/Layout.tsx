import { type ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { clsx } from "clsx";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: "📊" },
  { path: "/procedures", label: "Procedures", icon: "📋" },
  { path: "/mapping-editor", label: "Mapping Editor", icon: "✏️" },
  { path: "/output-preview", label: "Output Preview", icon: "🔭" },
  { path: "/migration", label: "Migration Planning", icon: "🗺️" },
  { path: "/review", label: "Review Required", icon: "⚠️" },
  { path: "/executive", label: "Executive Summary", icon: "📝" },
];

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside
        className={clsx(
          "flex flex-col bg-slate-900 text-white transition-all duration-200 shrink-0",
          collapsed ? "w-14" : "w-60"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700">
          <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center text-sm font-bold shrink-0">
            E
          </div>
          {!collapsed && (
            <div>
              <p className="text-sm font-bold leading-tight">EDI Analyzer</p>
              <p className="text-xs text-slate-400">810 · Standardization</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3">
          {/* Analysis group */}
          {!collapsed && (
            <p className="px-4 pt-2 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Analysis
            </p>
          )}
          {NAV_ITEMS.slice(0, 2).map((item) => (
            <NavItem key={item.path} item={item} collapsed={collapsed} location={location} />
          ))}

          {/* Standardization group */}
          {!collapsed && (
            <p className="px-4 pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Standardization
            </p>
          )}
          {NAV_ITEMS.slice(2, 4).map((item) => (
            <NavItem key={item.path} item={item} collapsed={collapsed} location={location} />
          ))}

          {/* Planning group */}
          {!collapsed && (
            <p className="px-4 pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Planning
            </p>
          )}
          {NAV_ITEMS.slice(4).map((item) => (
            <NavItem key={item.path} item={item} collapsed={collapsed} location={location} />
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-4 text-slate-500 hover:text-white transition-colors border-t border-slate-700 text-left text-xs"
        >
          {collapsed ? "→" : "← Collapse"}
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-screen-xl mx-auto px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

function NavItem({
  item,
  collapsed,
  location,
}: {
  item: (typeof NAV_ITEMS)[0];
  collapsed: boolean;
  location: ReturnType<typeof useLocation>;
}) {
  const active =
    item.path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(item.path);

  return (
    <Link
      to={item.path}
      title={collapsed ? item.label : undefined}
      className={clsx(
        "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-blue-600 text-white"
          : "text-slate-400 hover:text-white hover:bg-slate-800"
      )}
    >
      <span className="text-base shrink-0">{item.icon}</span>
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}
