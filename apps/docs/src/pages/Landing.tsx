import { Link } from 'react-router-dom'
import { Code2, Key } from 'lucide-react'

export function Landing() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-2xl w-full px-6">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">Gomo6 API Documentation</h1>
          <p className="text-lg text-muted-foreground">
            Полная документация по REST API и OAuth 2.0 для интеграций и ботов
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Link
            to="/rest-api"
            className="group block p-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-200"
          >
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Code2 className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">REST API</h2>
            <p className="text-sm text-muted-foreground">
              Полная справка по API. Автоматическая генерация из кода, интерактивные запросы.
            </p>
          </Link>
          <Link
            to="/oauth"
            className="group block p-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-200"
          >
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Key className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">OAuth 2.0</h2>
            <p className="text-sm text-muted-foreground">
              Авторизация и токены. Интеграция с внешними приложениями.
            </p>
          </Link>
        </div>
      </div>
    </div>
  )
}
