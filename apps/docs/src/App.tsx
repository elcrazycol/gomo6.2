import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { useState, lazy, Suspense } from 'react'
import { Landing } from './pages/Landing'
import { OAuthOverview } from './pages/OAuthOverview'
import { OAuthAuthorization } from './pages/OAuthAuthorization'
import { OAuthTokens } from './pages/OAuthTokens'
import { OAuthUserinfo } from './pages/OAuthUserinfo'
import { OAuthClientLibrary } from './pages/OAuthClientLibrary'
import { OAuthReference } from './pages/OAuthReference'
import { ThemeProvider } from './contexts/ThemeContext'
import { Key, ChevronRight, Menu, X, ExternalLink, Code2, BookOpen } from 'lucide-react'

const RestApiReference = lazy(() => import('./pages/RestApiReference'))

const sidebarSections = [
  {
    id: 'rest-api',
    label: 'REST API',
    icon: Code2,
    items: [
      { path: '/rest-api', label: 'API Reference', icon: Code2 },
    ],
  },
  {
    id: 'oauth',
    label: 'OAuth 2.0',
    icon: Key,
    items: [
      { path: '/oauth', label: 'Обзор', icon: BookOpen },
      { path: '/oauth/authorization', label: 'Авторизация', icon: Key },
      { path: '/oauth/tokens', label: 'Токены', icon: Key },
      { path: '/oauth/userinfo', label: 'Данные пользователя', icon: Key },
      { path: '/oauth/client-library', label: 'TS клиент', icon: Code2, badge: 'NEW' },
      { path: '/oauth/reference', label: 'Справочник', icon: Key },
    ],
  },
]

function Sidebar({ onNavClick }: { onNavClick?: () => void }) {
  const location = useLocation()
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['rest-api', 'oauth'])
  )

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const isActive = (path: string) => location.pathname === path

  return (
    <aside className="w-64 border-r border-[var(--sidebar-border)] h-screen fixed top-0 left-0 overflow-y-auto bg-[var(--sidebar)] z-40 flex flex-col">
      <div className="p-5 border-b border-[var(--sidebar-border)]">
        <Link to="/" className="flex items-center gap-3 group" onClick={onNavClick}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/10 group-hover:shadow-emerald-500/20 transition-shadow">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">Gomo6 Docs</h1>
            <p className="text-[11px] text-muted-foreground">API Documentation</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {sidebarSections.map((section) => {
          const SectionIcon = section.icon
          const isExpanded = expandedSections.has(section.id)

          return (
            <div key={section.id}>
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[var(--sidebar-hover)] transition-all duration-150"
              >
                <div className="flex items-center gap-2">
                  <SectionIcon className="w-4 h-4" />
                  <span>{section.label}</span>
                </div>
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                />
              </button>

              <div
                className={`overflow-hidden transition-all duration-200 ${
                  isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="ml-2 mt-0.5 space-y-0.5 border-l border-[var(--sidebar-border)] pl-2">
                  {section.items.map((item) => {
                    const ItemIcon = item.icon
                    const active = isActive(item.path)

                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={onNavClick}
                        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-all duration-150 ${
                          active
                            ? 'bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20'
                            : 'text-muted-foreground hover:text-foreground hover:bg-[var(--sidebar-hover)]'
                        }`}
                      >
                        <ItemIcon className={`w-3.5 h-3.5 ${active ? 'text-emerald-400' : ''}`} />
                        <span>{item.label}</span>
                        {(item as any).badge && (
                          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {(item as any).badge}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      <div className="p-3 border-t border-[var(--sidebar-border)]">
        <a
          href={`//dev.${window.location.hostname.replace(/^(docs|dev|www)\./, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-[var(--sidebar-hover)] transition-all duration-150"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Dev Dashboard</span>
        </a>
      </div>
    </aside>
  )
}

function TopBar({ onMenuToggle }: { onMenuToggle: () => void }) {
  return (
    <div className="lg:hidden sticky top-0 z-50 bg-[var(--sidebar)] border-b border-[var(--sidebar-border)] px-4 h-12 flex items-center justify-between">
      <button
        onClick={onMenuToggle}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--sidebar-hover)] transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
          <BookOpen className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold">Gomo6 Docs</span>
      </div>
      <button
        onClick={onMenuToggle}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--sidebar-hover)] transition-colors invisible"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

function PageContainer({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onNavClick={() => setSidebarOpen(false)} />
      </div>

      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <TopBar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

      <main className="lg:ml-64">
        <div className="max-w-4xl mx-auto px-6 sm:px-10 lg:px-16 py-8 lg:py-16">
          <div className="prose">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}

function AppContent() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/rest-api" element={
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#0f0f13]"><div className="text-white">Loading API Reference...</div></div>}>
          <RestApiReference />
        </Suspense>
      } />
      <Route path="/oauth" element={<PageContainer><OAuthOverview /></PageContainer>} />
      <Route path="/oauth/authorization" element={<PageContainer><OAuthAuthorization /></PageContainer>} />
      <Route path="/oauth/tokens" element={<PageContainer><OAuthTokens /></PageContainer>} />
      <Route path="/oauth/userinfo" element={<PageContainer><OAuthUserinfo /></PageContainer>} />
      <Route path="/oauth/client-library" element={<PageContainer><OAuthClientLibrary /></PageContainer>} />
      <Route path="/oauth/reference" element={<PageContainer><OAuthReference /></PageContainer>} />
    </Routes>
  )
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
