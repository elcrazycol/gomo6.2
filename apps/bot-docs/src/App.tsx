import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { Introduction } from './pages/Introduction'
import { GettingStarted } from './pages/GettingStarted'
import { APIReference } from './pages/APIReference'
import { Examples } from './pages/Examples'
import { EventHandlers } from './pages/EventHandlers'
import { BestPractices } from './pages/BestPractices'
import { ThemeProvider } from './contexts/ThemeContext'

function Navigation() {
  const location = useLocation()

  const links = [
    { path: '/', label: 'Введение' },
    { path: '/getting-started', label: 'Начало работы' },
    { path: '/events', label: 'События' },
    { path: '/api', label: 'API' },
    { path: '/examples', label: 'Примеры' },
    { path: '/best-practices', label: 'Best Practices' },
  ]

  return (
    <nav className="w-56 border-r border-gray-700 fixed h-screen bg-[#121212]">
      <div className="p-8">
        <div className="mb-12">
          <h1 className="text-xl font-semibold mb-1">Gomo6 Bots</h1>
          <p className="text-sm text-gray-400">Documentation</p>
        </div>

        <div className="space-y-1">
          {links.map((link) => (
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
          ))}
        </div>
      </div>
    </nav>
  )
}

function AppContent() {
  return (
    <div className="flex min-h-screen bg-[#121212]">
      <Navigation />
      <main className="flex-1 ml-56">
        <div className="max-w-4xl mx-auto px-16 py-16">
          <Routes>
            <Route path="/" element={<Introduction />} />
            <Route path="/getting-started" element={<GettingStarted />} />
            <Route path="/events" element={<EventHandlers />} />
            <Route path="/api" element={<APIReference />} />
            <Route path="/examples" element={<Examples />} />
            <Route path="/best-practices" element={<BestPractices />} />
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
