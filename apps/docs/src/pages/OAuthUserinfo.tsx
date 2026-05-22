import { useState } from 'react'
import { User, CheckCircle, Shield, FileText, Fingerprint } from 'lucide-react'

const CodeBlock = ({ code, language = 'bash' }: { code: string; language?: string }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative group my-4">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{language}</span>
        <button onClick={handleCopy} className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded text-xs transition-colors">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="bg-black/50 rounded-lg p-4 pt-10 overflow-x-auto text-sm font-mono leading-relaxed text-gray-300 border border-gray-700/50">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const curlUserinfo = `curl http://localhost:8080/oauth/userinfo \\
  -H "Authorization: Bearer ACCESS_TOKEN"`

const userinfoResponse = `{
  "sub": "user_uuid",
  "name": "Имя пользователя",
  "preferred_username": "username",
  "email": "user@example.com",
  "email_verified": true,
  "picture": "https://cdn.gomo6.net/avatars/..."
}`

const curlTokenExtract = `// Расшифровка ID токена (клиентская сторона)
function parseUserFromIdToken(idToken) {
  const payload = idToken.split('.')[1];
  const decoded = JSON.parse(atob(payload));
  return {
    sub: decoded.sub,
    name: decoded.name,
    email: decoded.email,
    picture: decoded.picture,
  };
}`

export const OAuthUserinfo = () => {
  return (
    <div className="text-gray-300 space-y-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">Данные пользователя</h1>
        <p className="text-gray-400">Получение информации о пользователе через UserInfo и ID Token</p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 p-5 hover:border-blue-500/30 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">UserInfo Endpoint</h3>
          </div>
          <p className="text-xs text-gray-400">
            GET-запрос с Bearer token. Возвращает полную информацию о пользователе.
            Требуется валидный access_token.
          </p>
        </div>
        <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 p-5 hover:border-emerald-500/30 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <Fingerprint className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">ID Token (OpenID Connect)</h3>
          </div>
          <p className="text-xs text-gray-400">
            JWT, полученный при обмене кода. Содержит claims о пользователе.
            Можно расшифровать на клиенте без дополнительных запросов.
          </p>
        </div>
      </div>

      {/* UserInfo endpoint */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <User className="w-5 h-5 text-blue-400" />
          UserInfo Endpoint
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Используйте access_token для получения информации о пользователе:
        </p>
        <CodeBlock language="bash" code={curlUserinfo} />
        <div className="mt-4 bg-gray-800/30 border border-gray-700/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Формат ответа</h3>
          </div>
          <pre className="text-xs font-mono text-gray-400">{userinfoResponse}</pre>
        </div>
      </section>

      {/* Claims Table */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-400" />
          Доступные claims
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Какие данные вы получите в зависимости от запрошенных scopes:
        </p>
        <div className="overflow-x-auto rounded-xl border border-gray-700/30">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800/50 border-b border-gray-700/50">
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Claim</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Тип</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Scope</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-300 text-xs uppercase tracking-wider">Описание</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-gray-300">sub</code></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">string</code></td>
                <td className="py-3 px-4"><code className="text-xs text-emerald-400">openid</code></td>
                <td className="py-3 px-4 text-gray-400 text-xs">Уникальный ID пользователя</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-gray-300">name</code></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">string</code></td>
                <td className="py-3 px-4"><code className="text-xs text-blue-400">profile</code></td>
                <td className="py-3 px-4 text-gray-400 text-xs">Отображаемое имя</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-gray-300">preferred_username</code></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">string</code></td>
                <td className="py-3 px-4"><code className="text-xs text-blue-400">profile</code></td>
                <td className="py-3 px-4 text-gray-400 text-xs">Имя пользователя (логин)</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-gray-300">picture</code></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">string (URL)</code></td>
                <td className="py-3 px-4"><code className="text-xs text-blue-400">profile</code></td>
                <td className="py-3 px-4 text-gray-400 text-xs">URL аватара пользователя</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-gray-300">email</code></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">string</code></td>
                <td className="py-3 px-4"><code className="text-xs text-amber-400">email</code></td>
                <td className="py-3 px-4 text-gray-400 text-xs">Email адрес</td>
              </tr>
              <tr className="hover:bg-gray-800/30 transition-colors">
                <td className="py-3 px-4"><code className="bg-gray-800 px-1.5 py-0.5 rounded text-xs text-gray-300">email_verified</code></td>
                <td className="py-3 px-4"><code className="text-xs text-gray-400">boolean</code></td>
                <td className="py-3 px-4"><code className="text-xs text-amber-400">email</code></td>
                <td className="py-3 px-4 text-gray-400 text-xs">Подтверждён ли email</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ID Token */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          ID Token (OpenID Connect)
        </h2>
        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-emerald-300 mb-1">Данные без лишних запросов</h3>
              <p className="text-xs text-gray-400">
                ID Token — это JWT, который вы получаете вместе с access_token. Он уже содержит
                базовую информацию о пользователе. Расшифруйте его на клиенте — никаких дополнительных
                HTTP запросов не нужно.
              </p>
            </div>
          </div>
        </div>
        <CodeBlock language="javascript" code={curlTokenExtract} />
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              UserInfo
            </div>
            <ul className="space-y-1 text-xs text-gray-400">
              <li>+ Всегда актуальные данные</li>
              <li>+ Дополнительные claims из profile/email</li>
              <li>— Требует HTTP запрос</li>
            </ul>
          </div>
          <div className="rounded-lg bg-gray-800/30 border border-gray-700/30 p-3">
            <div className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-2">
              <Fingerprint className="w-3.5 h-3.5 text-blue-400" />
              ID Token
            </div>
            <ul className="space-y-1 text-xs text-gray-400">
              <li>+ Мгновенно, без запросов</li>
              <li>+ Работает офлайн</li>
              <li>— Данные на момент выдачи</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Example usage */}
      <section>
        <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
          <User className="w-5 h-5 text-blue-400" />
          Пример использования
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          После авторизации отобразите данные пользователя:
        </p>
        <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 p-4">
          <pre className="text-xs font-mono text-gray-400 overflow-x-auto">{`async function displayUserProfile() {
  // UserInfo запрос
  const res = await fetch('http://localhost:8080/oauth/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const user = await res.json();

  return (
    <div>
      <img src={user.picture} alt={user.name} />
      <h2>{user.name}</h2>
      <p>@{user.preferred_username}</p>
      <p>{user.email}</p>
    </div>
  );
}`}</pre>
        </div>
      </section>

    </div>
  )
}
