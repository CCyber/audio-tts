import { useLocation, useNavigate } from "@solidjs/router";
import { Icon } from "../common/Icon";

const ITEMS = [
  { path: "/", icon: "home", label: "Home" },
  { path: "/projects", icon: "grid", label: "Projekte" },
  { path: "/library", icon: "library", label: "Library" },
  { path: "/search", icon: "search", label: "Suche" },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <aside class="sidebar">
      <h1 class="sidebar-brand accent-text">Aria</h1>
      <nav class="sidebar-nav">
        {ITEMS.map((it) => (
          <button class={`sidebar-item ${isActive(it.path) ? "sidebar-item-active" : ""}`} onClick={() => navigate(it.path)}>
            <Icon name={it.icon} size={20} />
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
