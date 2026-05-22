import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const CodeBlock = ({ code, language = "bash" }: { code: string; language?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Скопировано!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider opacity-60">{language}</Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="bg-muted/80 rounded-lg p-4 pt-8 overflow-x-auto text-sm font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const Section = ({ title, id, children }: { title: string; id: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-20">
    <div className="mb-6">
      <h2 className="text-2xl font-bold mb-1">{title}</h2>
      <div className="w-12 h-0.5 bg-primary/60 rounded-full" />
    </div>
    {children}
  </section>
);

const ApiDocs = () => {
  const [activeTab, setActiveTab] = useState("guide");

  const curlToken = `curl -X POST http://localhost:8080/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "code=AUTHORIZATION_CODE" \\
  -d "redirect_uri=https://myapp.com/callback" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`;

  const curlUserinfo = `curl http://localhost:8080/oauth/userinfo \\
  -H "Authorization: Bearer ACCESS_TOKEN"`;

  const curlRefresh = `curl -X POST http://localhost:8080/oauth/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=refresh_token" \\
  -d "refresh_token=YOUR_REFRESH_TOKEN" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`;

  const curlRevoke = `curl -X POST http://localhost:8080/oauth/revoke \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "token=ACCESS_OR_REFRESH_TOKEN" \\
  -d "token_hint=access_token" \\
  -d "client_id=app_abc123" \\
  -d "client_secret=secret_xyz"`;

  const jsExample = `// Полный пример авторизации через gomo6
const CONFIG = {
  clientId: 'app_abc123',
  clientSecret: 'secret_xyz',
  redirectUri: 'https://myapp.com/callback',
  authUrl: 'http://localhost:8080/oauth/authorize',
  tokenUrl: 'http://localhost:8080/oauth/token',
  userInfoUrl: 'http://localhost:8080/oauth/userinfo',
};

// 1. Редирект на авторизацию
function login() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CONFIG.clientId,
    redirect_uri: CONFIG.redirectUri,
    scope: 'openid profile email',
    state: crypto.randomUUID(),
  });
  window.location.href = \`\${CONFIG.authUrl}?\${params}\`;
}

// 2. Обработка callback
async function handleCallback() {
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return;

  const res = await fetch(CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONFIG.redirectUri,
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
    }),
  });

  const tokens = await res.json();
  localStorage.setItem('access_token', tokens.access_token);
  localStorage.setItem('refresh_token', tokens.refresh_token);
  return tokens;
}

// 3. Получение информации о пользователе
async function getUserInfo() {
  const res = await fetch(CONFIG.userInfoUrl, {
    headers: { Authorization: \`Bearer \${localStorage.getItem('access_token')}\` },
  });
  return res.json();
}

// 4. Обновление токена
async function refreshToken() {
  const res = await fetch(CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: localStorage.getItem('refresh_token'),
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
    }),
  });
  const tokens = await res.json();
  localStorage.setItem('access_token', tokens.access_token);
  localStorage.setItem('refresh_token', tokens.refresh_token);
}`;

  const pyExample = `import requests

CLIENT_ID = "app_abc123"
CLIENT_SECRET = "secret_xyz"
REDIRECT_URI = "https://myapp.com/callback"
AUTH_URL = "http://localhost:8080/oauth/authorize"
TOKEN_URL = "http://localhost:8080/oauth/token"
USERINFO_URL = "http://localhost:8080/oauth/userinfo"

# 1. Ссылка для входа
import secrets
state = secrets.token_urlsafe(16)
auth_link = (
    f"{AUTH_URL}?response_type=code"
    f"&client_id={CLIENT_ID}"
    f"&redirect_uri={REDIRECT_URI}"
    f"&scope=openid+profile+email"
    f"&state={state}"
)
print(f"Отправьте пользователя: {auth_link}")

# 2. Обмен кода на токены
code = input("Вставьте code из URL callback: ")
response = requests.post(TOKEN_URL, data={
    "grant_type": "authorization_code",
    "code": code,
    "redirect_uri": REDIRECT_URI,
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
})
tokens = response.json()
access_token = tokens["access_token"]

# 3. Получение данных пользователя
user = requests.get(
    USERINFO_URL,
    headers={"Authorization": f"Bearer {access_token}"}
).json()
print(f"User: {user['preferred_username']} ({user['email']})")`;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/developer/apps">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">OAuth 2.0 API</h1>
          <p className="text-muted-foreground mt-1">
            Интеграция "Войти через gomo6" для сторонних сайтов
          </p>
        </div>
      </div>

      {/* OpenID Badge */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4 flex items-center gap-3">
          <Badge variant="outline" className="text-xs">OpenID Connect</Badge>
          <span className="text-sm text-muted-foreground">
            Полностью совместимо с OAuth 2.0 и OpenID Connect
          </span>
          <a
            href="/.well-known/openid-configuration"
            target="_blank"
            className="ml-auto text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            Discovery <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
          <TabsTrigger value="guide" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-4">
            Руководство
          </TabsTrigger>
          <TabsTrigger value="endpoints" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-4">
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="examples" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-4">
            Примеры
          </TabsTrigger>
          <TabsTrigger value="scopes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-4">
            Scopes
          </TabsTrigger>
        </TabsList>

        {/* Guide Tab */}
        <TabsContent value="guide" className="space-y-8">
          <Section title="1. Создайте приложение" id="create-app">
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Зайдите в <Link to="/developer/apps" className="text-primary hover:underline">Dev-панель</Link> → "Создать приложение".
                  Укажите название, redirect URI и тип клиента.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-xs font-semibold mb-1">Confidential client</div>
                    <div className="text-xs text-muted-foreground">Для серверных приложений. Требует client_secret.</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-xs font-semibold mb-1">Public client</div>
                    <div className="text-xs text-muted-foreground">Для SPA/React/мобильных. Использует PKCE.</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  После создания вы получите <code className="bg-muted px-1 rounded text-xs">client_id</code> и <code className="bg-muted px-1 rounded text-xs">client_secret</code>.
                </p>
              </CardContent>
            </Card>
          </Section>

          <Section title="2. Редирект на авторизацию" id="authorize">
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Создайте ссылку "Войти через gomo6" на вашем сайте:
                </p>
                <CodeBlock
                  language="html"
                  code={`<a href="http://localhost:8080/oauth/authorize?response_type=code&client_id=app_abc123&redirect_uri=https://myapp.com/callback&scope=openid+profile+email&state=xyz789">
  Войти через gomo6
</a>`}
                />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p><strong>Параметры:</strong></p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li><code>response_type</code> — всегда <code>code</code></li>
                    <li><code>client_id</code> — ID вашего приложения</li>
                    <li><code>redirect_uri</code> — должен быть в списке разрешённых</li>
                    <li><code>scope</code> — через пробел: <code>openid profile email</code></li>
                    <li><code>state</code> — для CSRF-защиты (рекомендуется)</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section title="3. Обмен кода на токены" id="token">
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  После подтверждения пользователем вы получите code в callback. Обменяйте его на токены:
                </p>
                <CodeBlock language="bash" code={curlToken} />
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-semibold mb-2">Ответ:</p>
                  <pre className="text-xs font-mono">{JSON.stringify({
                    access_token: "eyJhbGciOiJIUzI1NiIs...",
                    token_type: "Bearer",
                    expires_in: 3600,
                    refresh_token: "rt_abc123...",
                    id_token: "eyJhbGciOiJIUzI1NiIs...",
                    scope: "openid profile email"
                  }, null, 2)}</pre>
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section title="4. Получение данных пользователя" id="userinfo">
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Используйте access_token для получения информации о пользователе:
                </p>
                <CodeBlock language="bash" code={curlUserinfo} />
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-semibold mb-2">Ответ:</p>
                  <pre className="text-xs font-mono">{JSON.stringify({
                    sub: "user_uuid",
                    name: "Имя пользователя",
                    preferred_username: "username",
                    email: "user@example.com",
                    email_verified: true,
                    picture: "https://cdn.gomo6.net/avatars/..."
                  }, null, 2)}</pre>
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section title="5. PKCE (для публичных клиентов)" id="pkce">
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Для SPA приложений, которые не могут хранить client_secret, используйте PKCE:
                </p>
                <div className="text-xs space-y-2">
                  <p>1. Сгенерируйте <code className="bg-muted px-1 rounded">code_verifier</code> (случайная строка 43-128 символов)</p>
                  <p>2. Вычислите <code className="bg-muted px-1 rounded">code_challenge</code> = SHA-256(code_verifier) в base64url</p>
                  <p>3. Передайте challenge в authorize + verifier в token</p>
                </div>
                <CodeBlock language="javascript" code={`// Генерация PKCE
async function generatePKCE() {
  const verifier = generateRandomString(64);
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}`} />
              </CardContent>
            </Card>
          </Section>
        </TabsContent>

        {/* Endpoints Tab */}
        <TabsContent value="endpoints" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Endpoint'ы</CardTitle>
              <CardDescription>Все OAuth 2.0 / OpenID Connect endpoint'ы</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <EndpointRow method="GET" path="/oauth/authorize" desc="Авторизация пользователя" auth="Нет" />
              <EndpointRow method="POST" path="/oauth/token" desc="Обмен кода на токены" auth="client_secret" />
              <EndpointRow method="POST" path="/oauth/revoke" desc="Отзыв токена" auth="client_secret" />
              <EndpointRow method="GET" path="/oauth/userinfo" desc="Информация о пользователе" auth="Bearer" />
              <EndpointRow method="GET" path="/oauth/app-info" desc="Информация о приложении" auth="Нет" />
              <EndpointRow method="GET" path="/.well-known/openid-configuration" desc="OpenID Discovery" auth="Нет" />
              <EndpointRow method="GET" path="/.well-known/jwks.json" desc="Публичные ключи JWT" auth="Нет" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Developer API</CardTitle>
              <CardDescription>Управление приложениями (требуется авторизация на сайте)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <EndpointRow method="GET" path="/api/v1/developer/apps" desc="Список приложений" auth="Cookie" />
              <EndpointRow method="POST" path="/api/v1/developer/apps" desc="Создать приложение" auth="Cookie" />
              <EndpointRow method="GET" path="/api/v1/developer/apps/:id" desc="Информация о приложении" auth="Cookie" />
              <EndpointRow method="PUT" path="/api/v1/developer/apps/:id" desc="Обновить приложение" auth="Cookie" />
              <EndpointRow method="DELETE" path="/api/v1/developer/apps/:id" desc="Удалить приложение" auth="Cookie" />
              <EndpointRow method="POST" path="/api/v1/developer/apps/:id/regenerate-secret" desc="Сбросить secret" auth="Cookie" />
              <EndpointRow method="GET" path="/api/v1/developer/apps/:id/tokens" desc="Список токенов" auth="Cookie" />
              <EndpointRow method="POST" path="/api/v1/developer/apps/:id/revoke-user-tokens" desc="Отозвать токены пользователя" auth="Cookie" />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Examples Tab */}
        <TabsContent value="examples" className="space-y-6">
          <Section title="JavaScript" id="example-js">
            <CodeBlock language="javascript" code={jsExample} />
          </Section>
          <Section title="Python" id="example-py">
            <CodeBlock language="python" code={pyExample} />
          </Section>
          <Section title="cURL" id="example-curl">
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold mb-2">Обмен кода на токены</p>
                <CodeBlock language="bash" code={curlToken} />
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Получение userinfo</p>
                <CodeBlock language="bash" code={curlUserinfo} />
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Refresh токена</p>
                <CodeBlock language="bash" code={curlRefresh} />
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Revoke токена</p>
                <CodeBlock language="bash" code={curlRevoke} />
              </div>
            </div>
          </Section>
        </TabsContent>

        {/* Scopes Tab */}
        <TabsContent value="scopes">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scopes и Claims</CardTitle>
              <CardDescription>Какие данные запрашивать и что вы получите</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-semibold">Scope</th>
                      <th className="text-left py-2 px-3 font-semibold">Доступ</th>
                      <th className="text-left py-2 px-3 font-semibold">Claims</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/50">
                      <td className="py-2 px-3"><code className="bg-muted px-1 rounded text-xs">openid</code></td>
                      <td className="py-2 px-3">Базовая авторизация</td>
                      <td className="py-2 px-3"><code className="text-xs">sub</code> (ID пользователя)</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="py-2 px-3"><code className="bg-muted px-1 rounded text-xs">profile</code></td>
                      <td className="py-2 px-3">Профиль пользователя</td>
                      <td className="py-2 px-3"><code className="text-xs">name</code>, <code className="text-xs">preferred_username</code>, <code className="text-xs">picture</code></td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3"><code className="bg-muted px-1 rounded text-xs">email</code></td>
                      <td className="py-2 px-3">Email адрес</td>
                      <td className="py-2 px-3"><code className="text-xs">email</code>, <code className="text-xs">email_verified</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="pt-6 border-t border-border text-center">
        <p className="text-xs text-muted-foreground">
          Полная документация в файле <code className="bg-muted px-1 rounded">OAUTH_API.md</code>
        </p>
      </div>
    </div>
  );
};

const EndpointRow = ({ method, path, desc, auth }: { method: string; path: string; desc: string; auth: string }) => {
  const colorMap: Record<string, string> = {
    GET: "text-green-600 dark:text-green-400",
    POST: "text-blue-600 dark:text-blue-400",
    PUT: "text-orange-600 dark:text-orange-400",
    DELETE: "text-red-600 dark:text-red-400",
  };

  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
      <span className={`text-xs font-mono font-bold w-14 shrink-0 ${colorMap[method] || ""}`}>{method}</span>
      <code className="text-xs flex-1">{path}</code>
      <span className="text-xs text-muted-foreground hidden sm:block flex-1">{desc}</span>
      <Badge variant="outline" className="text-[10px] shrink-0">{auth}</Badge>
    </div>
  );
};

export default ApiDocs;