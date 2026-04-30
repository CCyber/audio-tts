import { useLocation, useNavigate } from "@solidjs/router";
import { Icon } from "../common/Icon";

const TABS = [
  { path: "/", icon: "home", label: "Home" },
  { path: "/projects", icon: "grid", label: "Projekte" },
  { path: "/library", icon: "library", label: "Library" },
  { path: "/search", icon: "search", label: "Suche" },
];

export function TabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <nav class="tab-bar">
      {TABS.map((t) => (
        <button class={`tab-btn ${isActive(t.path) ? "tab-active" : ""}`} onClick={() => navigate(t.path)}>
          <Icon name={t.icon} size={24} />
          <span class="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
