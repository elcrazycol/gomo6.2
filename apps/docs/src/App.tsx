import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { Introduction } from './pages/Introduction'
import { GettingStarted } from './pages/GettingStarted'
import { APIReference } from './pages/APIReference'
import { Examples } from './pages/Examples'
import { EventHandlers } from './pages/EventHandlers'
import { BestPractices } from './pages/BestPractices'
import { OAuthApiDocs } from './pages/OAuthApiDocs'
import { ThemeProvider } from './contexts/ThemeContext'

function Navigation() {
  const location = useLocation()

  const links = [
    { path: '/', label: 'Введение' },
    { path: '/getting-started', label: 'Начало работы' },
    { path: '/events', label: 'События' },
    { path: '/api', label: 'Bots API' },
    { path: '/examples', label: 'Примеры' },
    { path: '/best-practices', label: 'Best Practices' },
    { type: 'separator' as const },
    { path: '/oauth', label: 'OAuth 2.0 API' },
  ]

  return (
    <nav className="w-60 border-r border-gray-700 fixed h-screen bg-[#121212] overflow-y-auto">
      <div className="p-8">
        <div className="mb-12">
          <h1 className="text-xl font-semibold mb-1">Gomo6 Docs</h1>
          <p className="text-sm text-gray-400">Documentation</p>
        </div>

        <div className="space-y-1">
          {links.map((link) => {
            if ('type' in link && link.type === 'separator') {
              return (
                <div key="sep" className="my-4 border-t border-gray-700/50 pt-4">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 px-3 pb-1">API</p>
                </div>
              )
            }
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`block px-3 py-2 rounded text-sm transition-colors ${
                  location.pathname === link.path
                    ? 'bg-gray-800 text-white font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-gray-900'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

function AppContent() {
  return (
    <div className="flex min-h-screen bg-[#121212]">
      <Navigation />
      <main className="flex-1 ml-60">
        <div className="max-w-4xl mx-auto px-16 py-16">
          <Routes>
            <Route path="/" element={<Introduction />} />
            <Route path="/getting-started" element={<GettingStarted />} />
            <Route path="/events" element={<EventHandlers />} />
            <Route path="/api" element={<APIReference />} />
            <Route path="/examples" element={<Examples />} />
            <Route path="/best-practices" element={<BestPractices />} />
            <Route path="/oauth" element={<OAuthApiDocs />} />
          </Routes>
        </div>
      </main>
    </div>
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
