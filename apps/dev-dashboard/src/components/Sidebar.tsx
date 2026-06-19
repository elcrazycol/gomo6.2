import { useNavigate, useLocation } from "react-router-dom";
import { getSavedUser, OAuthUser } from "@/lib/oauth";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Gift,
  BookOpen,
  Github,
  LogOut,
  LogIn,
  ChevronLeft,
  ChevronRight,
  Shield,
  Menu,
  X,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/oauth";

const navItems = [
  { label: "Обзор", path: "/", icon: LayoutDashboard },
  { label: "OAuth приложения", path: "/apps", icon: Shield },
  { label: "Боты", path: "/bots", icon: Bot },
  { label: "Подарки", path: "/gifts", icon: Gift },
];

const externalLinks = [
  {
    label: "Документация",
    url: () =>
      `//docs.${window.location.hostname.replace(/^(docs|dev|www)\./, "")}/oauth`,
    icon: BookOpen,
  },
  {
    label: "GitHub",
    url: () => "https://github.com/scramble22/gomo6",
    icon: Github,
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<OAuthUser | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setUser(getSavedUser());
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div
        className={`flex items-center gap-3 px-4 h-16 border-b border-border/50 ${
          collapsed ? "justify-center" : ""
        }`}
      >
        <a
          href="/"
          className="flex items-center gap-2 font-bold text-lg tracking-tight hover:text-emerald-300 transition-colors"
        >
          <span>gomo6</span>
          {!collapsed && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">
              Dev
            </span>
          )}
        </a>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 rounded-lg transition-all duration-150 group ${
                collapsed ? "justify-center px-2 py-3" : "px-3 py-2.5"
              } ${
                active
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={`w-[18px] h-[18px] flex-shrink-0 ${
                  active ? "text-emerald-400" : "text-white/40 group-hover:text-white/70"
                }`}
              />
              {!collapsed && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
            </button>
          );
        })}

        {/* External links */}
        <div className={`pt-4 mt-4 border-t border-white/5 ${collapsed ? "px-0" : "px-1"}`}>
          {externalLinks.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.label}
                onClick={() => window.open(link.url(), "_blank")}
                className={`w-full flex items-center gap-3 rounded-lg transition-all duration-150 text-white/50 hover:bg-white/5 hover:text-white/80 group ${
                  collapsed ? "justify-center px-2 py-3" : "px-3 py-2.5"
                }`}
                title={collapsed ? link.label : undefined}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                {!collapsed && <span className="text-sm">{link.label}</span>}
              </button>
            );
          })}
        </div>
      </nav>

      {/* User section */}
      <div className="border-t border-white/5 px-3 py-3">
        {user ? (
          <div
            className={`flex items-center gap-3 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            {user.picture ? (
              <img
                src={user.picture}
                alt=""
                className="w-8 h-8 rounded-full ring-2 ring-white/10 flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-emerald-500/30 flex items-center justify-center ring-2 ring-white/10 flex-shrink-0">
                <span className="text-xs font-semibold text-emerald-200">
                  {(user.preferred_username || user.name || "?")[0].toUpperCase()}
                </span>
              </div>
            )}
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">
                  {user.preferred_username || user.name || ""}
                </p>
                <p className="text-[10px] text-white/40 truncate">
                  {user.email || ""}
                </p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={handleLogout}
                className="text-white/30 hover:text-white/70 transition-colors p-1.5 rounded-md hover:bg-white/5"
                title="Выйти"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/login")}
            className={`w-full text-white/60 hover:text-white hover:bg-white/5 ${
              collapsed ? "px-2" : ""
            }`}
          >
            <LogIn className="w-4 h-4" />
            {!collapsed && <span className="ml-2">Войти</span>}
          </Button>
        )}
      </div>

      {/* Collapse toggle (desktop only) */}
      <button
        onClick={onToggle}
        className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-sm"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronLeft className="w-3 h-3" />
        )}
      </button>
    </>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-board-header text-board-header-foreground flex items-center px-4 border-b border-border/50">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 text-white/80 hover:text-white"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-3 font-bold">gomo6</span>
        <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">
          Dev
        </span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-board-header transform transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 p-1.5 text-white/50 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex flex-col h-full">{sidebarContent}</div>
      </div>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-40 bg-board-header text-board-header-foreground transition-all duration-200 ${
          collapsed ? "w-[68px]" : "w-60"
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile spacer */}
      <div className="lg:hidden h-14" />
    </>
  );
}
