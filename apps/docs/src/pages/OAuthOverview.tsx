import { Link } from 'react-router-dom'
import { Key, Shield, ExternalLink, ArrowRight, Smartphone, Server } from 'lucide-react'

const rootDomain = typeof window !== 'undefined' ? window.location.hostname.replace(/^(docs|dev|www)\./, '') : 'localhost';

export const OAuthOverview = () => {
  return (
    <div className="text-gray-300 space-y-8">

      {/* Hero */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/10">
            <Key className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">OAuth 2.0 API</h1>
            <p className="text-sm text-gray-400">Интеграция «Войти через gomo6» для сторонних сайтов</p>
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-3 mb-8">
        <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-2">
          <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">OpenID Connect</span>
          <span className="text-sm text-gray-400">Полностью совместимо</span>
        </div>
        <a
          href={window.location.protocol + '//' + window.location.host + '/.well-known/openid-configuration'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-gray-800/50 border border-gray-700/30 rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white hover:border-gray-600/50 transition-colors"
        >
          Discovery document
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Description */}
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Быстрая интеграция</h2>
        <p className="text-sm text-gray-400 leading-relaxed mb-4">
          gomo6 предоставляет стандартный OAuth 2.0 + OpenID Connect API для авторизации пользователей.
          Поддерживаются <strong className="text-gray-300">confidential</strong> и <strong className="text-gray-300">public</strong> клиенты, PKCE (S256),
          refresh tokens и интроспекция по RFC 7662.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Shield, label: 'Безопасность', desc: 'PKCE, state, nonce, CSRF защита' },
            { icon: Server, label: 'Гибкость', desc: 'Confidential и Public клиенты' },
            { icon: Smartphone, label: 'Совместимость', desc: 'SPA, мобильные, серверные приложения' },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3 bg-gray-800/50 rounded-lg p-3 border border-gray-700/30">
              <Icon className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-gray-300">{label}</div>
                <div className="text-[11px] text-gray-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Start */}
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-3">Начало работы в 3 шага</h2>
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-400">1</span>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-200 mb-1">Создайте приложение</h3>
              <p className="text-xs text-gray-400">
                Зайдите в{' '}
                <a href={'//dev.' + rootDomain} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  Dev Dashboard
                </a>
                {' '}→ «Создать приложение». Укажите название и redirect URI.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-400">2</span>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-200 mb-1">Добавьте кнопку входа</h3>
              <p className="text-xs text-gray-400">
                Используйте наш TypeScript клиент для быстрой интеграции или реализуйте OAuth flow самостоятельно через HTTP.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-blue-400">3</span>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-200 mb-1">Получайте данные пользователя</h3>
              <p className="text-xs text-gray-400">
                Используйте access token для запроса profile, email и других данных через UserInfo endpoint.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Client Types */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Типы клиентов</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 p-5 hover:border-blue-500/30 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <Server className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Confidential</div>
                <div className="text-[11px] text-gray-500">Серверные приложения</div>
              </div>
            </div>
            <ul className="space-y-1.5 text-xs text-gray-400">
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-purple-400" />
                Хранит client_secret на сервере
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-purple-400" />
                Поддержка refresh и introspect
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-purple-400" />
                Node.js, Go, Python, PHP, Java
              </li>
            </ul>
          </div>
          <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 p-5 hover:border-emerald-500/30 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Smartphone className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Public</div>
                <div className="text-[11px] text-gray-500">SPA, мобильные приложения</div>
              </div>
            </div>
            <ul className="space-y-1.5 text-xs text-gray-400">
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-emerald-400" />
                Использует PKCE (S256)
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-emerald-400" />
                Не требует client_secret
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-emerald-400" />
                React, Vue, Swift, Kotlin
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Navigation Cards */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Документация</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link to="/oauth/authorization"
            className="flex items-center justify-between p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 hover:border-blue-500/30 hover:bg-gray-800/50 transition-all group"
          >
            <div>
              <div className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">Авторизация</div>
              <div className="text-xs text-gray-500 mt-0.5">Redirect flow, PKCE, обмен кода</div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
          </Link>
          <Link to="/oauth/tokens"
            className="flex items-center justify-between p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 hover:border-blue-500/30 hover:bg-gray-800/50 transition-all group"
          >
            <div>
              <div className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">Управление токенами</div>
              <div className="text-xs text-gray-500 mt-0.5">Refresh, revoke, introspect</div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
          </Link>
          <Link to="/oauth/userinfo"
            className="flex items-center justify-between p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 hover:border-blue-500/30 hover:bg-gray-800/50 transition-all group"
          >
            <div>
              <div className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">Данные пользователя</div>
              <div className="text-xs text-gray-500 mt-0.5">UserInfo endpoint, claims</div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
          </Link>
          <Link to="/oauth/client-library"
            className="flex items-center justify-between p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 hover:border-blue-500/30 hover:bg-gray-800/50 transition-all group"
          >
            <div className="flex items-center gap-2">
              <div>
                <div className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">TypeScript клиент</div>
                <div className="text-xs text-gray-500 mt-0.5">OAuthClient + useOAuth React hook</div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">NEW</span>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
          </Link>
          <Link to="/oauth/reference"
            className="flex items-center justify-between p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 hover:border-blue-500/30 hover:bg-gray-800/50 transition-all group"
          >
            <div>
              <div className="text-sm font-medium text-white group-hover:text-blue-400 transition-colors">Справочник</div>
              <div className="text-xs text-gray-500 mt-0.5">Endpoints, scopes, audit log</div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
          </Link>
        </div>
      </div>

    </div>
  )
}
