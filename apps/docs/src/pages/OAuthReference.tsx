import { Globe, Table, Shield, Activity, CheckCircle, User, Mail, RefreshCw } from 'lucide-react'

export const OAuthReference = () => {
  return (
    <div className="text-gray-300 space-y-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Справочник</h1>
        <p className="text-gray-400">Все endpoint'ы, scopes, типы клиентов и audit log</p>
      </div>

      {/* Endpoints */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-400" />
          Endpoint'ы
        </h2>
        <p className="text-sm text-gray-400 mb-4">Все OAuth 2.0 / OpenID Connect endpoint'ы сервера gomo6:</p>
        <div className="overflow-x-auto rounded-xl border border-gray-700/30">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-700/50">
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Method</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Path</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider hidden sm:table-cell">Описание</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Auth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              <EndpointRow method="GET" path="/oauth/authorize" desc="Авторизация пользователя (редирект)" auth="—" />
              <EndpointRow method="POST" path="/oauth/token" desc="Обмен кода на токены" auth="client_secret" />
              <EndpointRow method="POST" path="/oauth/revoke" desc="Отзыв токена" auth="client_secret" />
              <EndpointRow method="GET" path="/oauth/userinfo" desc="Информация о пользователе" auth="Bearer" />
              <EndpointRow method="POST" path="/oauth/introspect" desc="Интроспекция токена" auth="Bearer / client" />
              <EndpointRow method="GET" path="/oauth/app-info" desc="Информация о приложении" auth="—" />
              <EndpointRow method="GET" path="/.well-known/openid-configuration" desc="OpenID Discovery" auth="—" />
              <EndpointRow method="GET" path="/.well-known/jwks.json" desc="Публичные ключи JWT" auth="—" />
            </tbody>
          </table>
        </div>
      </section>

      {/* Scopes */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Table className="w-5 h-5 text-purple-400" />
          Scopes
        </h2>
        <p className="text-sm text-gray-400 mb-4">Какие данные запрашивать и что вы получите:</p>
        <div className="overflow-x-auto rounded-xl border border-gray-700/30">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-700/50">
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Scope</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Доступ</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Claims</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider hidden sm:table-cell">Описание</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-emerald-400">openid</code></td>
                <td className="py-3 px-4"><CheckCircle className="w-4 h-4 text-emerald-400" /></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">sub</code></td>
                <td className="py-3 px-4 text-xs text-gray-500 hidden sm:table-cell">Базовая аутентификация</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-blue-400">profile</code></td>
                <td className="py-3 px-4"><User className="w-4 h-4 text-blue-400" /></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">name</code>, <code className="text-xs text-gray-400">preferred_username</code>, <code className="text-xs text-gray-400">picture</code></td>
                <td className="py-3 px-4 text-xs text-gray-500 hidden sm:table-cell">Данные профиля</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-amber-400">email</code></td>
                <td className="py-3 px-4"><Mail className="w-4 h-4 text-amber-400" /></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">email</code>, <code className="text-xs text-gray-400">email_verified</code></td>
                <td className="py-3 px-4 text-xs text-gray-500 hidden sm:table-cell">Email адрес</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-purple-400">offline_access</code></td>
                <td className="py-3 px-4"><RefreshCw className="w-4 h-4 text-purple-400" /></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">—</code></td>
                <td className="py-3 px-4 text-xs text-gray-500 hidden sm:table-cell">Refresh token</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Audit Log */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-orange-400" />
          Audit Log
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Все действия в OAuth системе логируются для безопасности. Лог содержит user_id, client_id,
          название приложения, IP адрес и timestamp.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ["authorize", "Пользователь разрешил доступ"],
            ["token_exchange", "Обмен кода на токены"],
            ["token_refresh", "Обновление токена"],
            ["token_revoke", "Отзыв токена"],
            ["token_introspect", "Интроспекция токена"],
            ["app_created", "Создание приложения"],
            ["app_updated", "Обновление приложения"],
            ["app_deleted", "Удаление приложения"],
            ["secret_regenerated", "Сброс client_secret"],
            ["user_tokens_revoked", "Отзыв токенов пользователя"],
          ].map(([action, desc]) => (
            <div key={action} className="flex items-center gap-2 text-xs bg-gray-800/30 rounded-lg p-2.5 border border-gray-700/30 hover:bg-gray-800/50 transition-colors">
              <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded shrink-0 font-mono">{action}</code>
              <span className="text-gray-500">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Client Types Comparison */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          Сравнение типов клиентов
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-700/30">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-700/50">
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Характеристика</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Confidential</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Public</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {[
                ["client_secret", "Требуется", "Не требуется"],
                ["PKCE", "Опционально", "Обязательно"],
                ["Refresh token", "Да", "Да"],
                ["Интроспекция", "По client_secret", "По Bearer токену"],
                ["Пример", "Node.js, Go, Python", "React, Vue, Swift"],
              ].map(([feature, conf, pub]) => (
                <tr key={feature} className="hover:bg-gray-800/30 transition-colors">
                  <td className="py-2.5 px-4 text-xs text-gray-300">{feature}</td>
                  <td className="py-2.5 px-4 text-xs text-purple-400">{conf}</td>
                  <td className="py-2.5 px-4 text-xs text-emerald-400">{pub}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}

const EndpointRow = ({ method, path, desc, auth }: { method: string; path: string; desc: string; auth: string }) => {
  const colorMap: Record<string, string> = {
    GET: "text-green-400",
    POST: "text-blue-400",
    PUT: "text-orange-400",
    DELETE: "text-red-400",
  }

  return (
    <tr className="hover:bg-gray-800/30 transition-colors">
      <td className="py-3 px-4">
        <span className={`text-xs font-mono font-bold ${colorMap[method] || ''}`}>{method}</span>
      </td>
      <td className="py-3 px-4">
        <code className="text-xs text-gray-300 font-mono">{path}</code>
      </td>
      <td className="py-3 px-4 text-xs text-gray-500 hidden sm:table-cell">{desc}</td>
      <td className="py-3 px-4">
        <span className="text-[10px] text-gray-500 bg-gray-800/50 px-1.5 py-0.5 rounded">{auth}</span>
      </td>
    </tr>
  )
}
