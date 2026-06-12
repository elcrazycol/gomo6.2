// OAuth 2.0 + OpenID Connect Client Library
// Browser-native — uses Web Crypto API (no external dependencies)
// Compatible with gomo6 OAuth server and any standard OAuth 2.0 provider

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OAuthClientConfig {
  /** OAuth client_id (required) */
  clientId: string
  /** Client secret for confidential clients (optional for public clients) */
  clientSecret?: string
  /** Redirect URI registered with the OAuth server */
  redirectUri: string
  /** Base URL of the authorization server. Defaults to current origin */
  authorizationBaseUrl?: string
  /** Token storage key prefix for localStorage. Default "gomo6_oauth" */
  storageKey?: string
}

export interface TokenResponse {
  accessToken: string
  tokenType: string
  expiresIn: number
  idToken?: string
  refreshToken?: string
  scope?: string
}

export interface UserInfoResponse {
  sub: string
  name?: string
  preferredUsername?: string
  email?: string
  emailVerified?: boolean
  picture?: string
}

export interface IntrospectResponse {
  active: boolean
  scope?: string
  clientId?: string
  userId?: string
  tokenId?: string
  tokenType?: string
  exp?: number
  iat?: number
  sub?: string
  username?: string
  aud?: string[]
  iss?: string
}

export interface OpenIDConfiguration {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  userinfoEndpoint: string
  revocationEndpoint: string
  introspectionEndpoint?: string
  jwksUri: string
  scopesSupported: string[]
  responseTypesSupported: string[]
  grantTypesSupported: string[]
  tokenEndpointAuthMethodsSupported: string[]
  claimsSupported: string[]
  subjectTypesSupported: string[]
  idTokenSigningAlgValuesSupported: string[]
  codeChallengeMethodsSupported: string[]
}

export interface JWK {
  kty: string
  use?: string
  kid?: string
  alg?: string
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
}

export interface JWKS {
  keys: JWK[]
}

export interface TokenStore {
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  expiresAt: number | null
  scope: string | null
}

export interface AuthorizeUrlParams {
  /** Space-separated list of scopes (e.g., "openid profile email") */
  scope: string
  /** State parameter for CSRF protection */
  state?: string
  /** PKCE code challenge (required for S256 or plain) */
  codeChallenge: string
  /** PKCE code challenge method. Default "S256" */
  codeChallengeMethod?: "S256" | "plain"
  /** Nonce parameter for ID token replay protection */
  nonce?: string
  /** Additional query parameters to include */
  extraParams?: Record<string, string>
}

export interface ExchangeCodeParams {
  /** The authorization code from the redirect */
  code: string
  /** PKCE code verifier */
  codeVerifier: string
  /** Override redirect URI (defaults to config.redirectUri) */
  redirectUri?: string
}

export interface RevokeParams {
  /** Token to revoke */
  token: string
  /** Hint about token type */
  tokenTypeHint?: "access_token" | "refresh_token"
}

export interface IntrospectParams {
  /** Token to introspect */
  token: string
  /** Hint about token type */
  tokenTypeHint?: "access_token" | "refresh_token"
}

// ─── PKCE Utilities ──────────────────────────────────────────────────────────

/** Generate a cryptographically random code verifier (RFC 7636 §4.1) */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(48) // 48 bytes → 64 chars base64url
  crypto.getRandomValues(array)
  return base64URLEncode(array)
}

/** Generate a S256 PKCE code challenge from a verifier (RFC 7636 §4.2) */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return base64URLEncode(new Uint8Array(hash))
}

/** Base64url encode (RFC 4648 §5) without padding */
function base64URLEncode(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** Base64url decode */
function base64URLDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/")
  while (str.length % 4) str += "="
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0))
}

// ─── JWT Utilities ───────────────────────────────────────────────────────────

/** Decode a JWT without verifying the signature. Returns the payload as an object.
 *  Throws if the token is malformed or the payload is not valid JSON. */
export function decodeJWT<T = Record<string, unknown>>(token: string): T | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payload = parts[1]
    // Add padding to make base64url string valid for atob
    const decoded = decodeURIComponent(
      Array.from(base64URLDecode(payload))
        .map((b) => "%" + b.toString(16).padStart(2, "0"))
        .join("")
    )
    return JSON.parse(decoded) as T
  } catch {
    return null
  }
}

/** Check if a JWT is expired (uses the `exp` claim) */
export function isJWTExpired(token: string, leewaySeconds = 30): boolean {
  const payload = decodeJWT<{ exp?: number }>(token)
  if (!payload?.exp) return true
  const now = Math.floor(Date.now() / 1000)
  return now > payload.exp - leewaySeconds
}

/** Extract the JWT ID (jti claim) from a token */
export function getJWTId(token: string): string | null {
  const payload = decodeJWT<{ jti?: string }>(token)
  return payload?.jti ?? null
}

// ─── Token Storage ───────────────────────────────────────────────────────────

const DEFAULT_STORAGE_KEY = "gomo6_oauth"

function getStorageKey(customPrefix?: string): string {
  return `${customPrefix ?? DEFAULT_STORAGE_KEY}_tokens`
}

function saveTokens(store: TokenStore, storageKey?: string): void {
  try {
    localStorage.setItem(getStorageKey(storageKey), JSON.stringify(store))
  } catch {
    // localStorage may be blocked (e.g., in iframes without 3rd-party cookies)
  }
}

function loadTokens(storageKey?: string): TokenStore | null {
  try {
    const raw = localStorage.getItem(getStorageKey(storageKey))
    if (!raw) return null
    return JSON.parse(raw) as TokenStore
  } catch {
    return null
  }
}

function clearTokens(storageKey?: string): void {
  try {
    localStorage.removeItem(getStorageKey(storageKey))
  } catch {
    // ignore
  }
}

// ─── OAuth Error ─────────────────────────────────────────────────────────────

export class OAuthError extends Error {
  public readonly error: string
  public readonly errorDescription?: string
  public readonly state?: string
  public readonly httpStatus?: number

  constructor(
    error: string,
    errorDescription?: string,
    state?: string,
    httpStatus?: number
  ) {
    super(errorDescription || error)
    this.name = "OAuthError"
    this.error = error
    this.errorDescription = errorDescription
    this.state = state
    this.httpStatus = httpStatus
  }
}

// ─── OAuth Client ────────────────────────────────────────────────────────────

export class OAuthClient {
  private config: Required<OAuthClientConfig>
  private openidConfigCache: OpenIDConfiguration | null = null
  private openidConfigPromise: Promise<OpenIDConfiguration> | null = null

  constructor(config: OAuthClientConfig) {
    this.config = {
      clientId: config.clientId,
      clientSecret: config.clientSecret ?? "",
      redirectUri: config.redirectUri,
      authorizationBaseUrl:
        config.authorizationBaseUrl ?? window.location.origin,
      storageKey: config.storageKey ?? DEFAULT_STORAGE_KEY,
    }
  }

  /** Get the base URL for API calls */
  private get baseURL(): string {
    return this.config.authorizationBaseUrl
  }

  /** Generate a full PKCE pair (verifier + challenge) in one call */
  async generatePKCE(): Promise<{ verifier: string; challenge: string }> {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    return { verifier, challenge }
  }

  /** Build the authorization URL for redirect-based login */
  createAuthorizeUrl(params: AuthorizeUrlParams): URL {
    const url = new URL(
      `${this.baseURL}/oauth/authorize`
    )
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", this.config.clientId)
    url.searchParams.set("redirect_uri", this.config.redirectUri)
    url.searchParams.set("scope", params.scope)
    url.searchParams.set("code_challenge", params.codeChallenge)
    url.searchParams.set(
      "code_challenge_method",
      params.codeChallengeMethod ?? "S256"
    )

    if (params.state) url.searchParams.set("state", params.state)
    if (params.nonce) url.searchParams.set("nonce", params.nonce)

    if (params.extraParams) {
      for (const [key, value] of Object.entries(params.extraParams)) {
        url.searchParams.set(key, value)
      }
    }

    return url
  }

  /** Exchange an authorization code for tokens */
  async exchangeCode(params: ExchangeCodeParams): Promise<TokenResponse> {
    const body = new URLSearchParams()
    body.set("grant_type", "authorization_code")
    body.set("code", params.code)
    body.set("redirect_uri", params.redirectUri ?? this.config.redirectUri)
    body.set("client_id", this.config.clientId)
    body.set("code_verifier", params.codeVerifier)

    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret)
    }

    return this.requestToken(body)
  }

  /** Refresh an access token using a refresh token */
  async refreshToken(refreshToken: string, scopes?: string): Promise<TokenResponse> {
    const body = new URLSearchParams()
    body.set("grant_type", "refresh_token")
    body.set("refresh_token", refreshToken)
    body.set("client_id", this.config.clientId)

    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret)
    }

    if (scopes) {
      body.set("scope", scopes)
    }

    return this.requestToken(body)
  }

  /** Revoke a token */
  async revokeToken(params: RevokeParams): Promise<void> {
    const body = new URLSearchParams()
    body.set("token", params.token)
    body.set("client_id", this.config.clientId)

    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret)
    }

    if (params.tokenTypeHint) {
      body.set("token_type_hint", params.tokenTypeHint)
    }

    const response = await fetch(`${this.baseURL}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    if (!response.ok) {
      throw new OAuthError(
        "revocation_failed",
        `Token revocation failed with HTTP ${response.status}`,
        undefined,
        response.status
      )
    }
  }

  /** Introspect a token (RFC 7662) */
  async introspectToken(
    params: IntrospectParams,
    accessToken?: string
  ): Promise<IntrospectResponse> {
    const body = new URLSearchParams()
    body.set("token", params.token)
    body.set("client_id", this.config.clientId)

    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret)
    }

    if (params.tokenTypeHint) {
      body.set("token_type_hint", params.tokenTypeHint)
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    }

    // If we have an access token, authenticate as the resource server
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`
    }

    const response = await fetch(`${this.baseURL}/oauth/introspect`, {
      method: "POST",
      headers,
      body,
    })

    if (!response.ok) {
      throw new OAuthError(
        "introspection_failed",
        `Token introspection failed with HTTP ${response.status}`,
        undefined,
        response.status
      )
    }

    return response.json() as Promise<IntrospectResponse>
  }

  /** Fetch userinfo from the /userinfo endpoint */
  async getUserinfo(accessToken: string): Promise<UserInfoResponse> {
    const response = await fetch(`${this.baseURL}/oauth/userinfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new OAuthError(
        "userinfo_failed",
        `Userinfo request failed with HTTP ${response.status}`,
        undefined,
        response.status
      )
    }

    return response.json() as Promise<UserInfoResponse>
  }

  /** Fetch OpenID Connect discovery configuration */
  async fetchOpenIDConfig(): Promise<OpenIDConfiguration> {
    // Return cached config if available
    if (this.openidConfigCache) {
      return this.openidConfigCache
    }

    // Deduplicate concurrent requests
    if (this.openidConfigPromise) {
      return this.openidConfigPromise
    }

    this.openidConfigPromise = this._fetchOpenIDConfig()
    try {
      const config = await this.openidConfigPromise
      this.openidConfigCache = config
      return config
    } finally {
      this.openidConfigPromise = null
    }
  }

  private async _fetchOpenIDConfig(): Promise<OpenIDConfiguration> {
    const response = await fetch(
      `${this.baseURL}/.well-known/openid-configuration`
    )

    if (!response.ok) {
      throw new OAuthError(
        "discovery_failed",
        `OpenID discovery failed with HTTP ${response.status}`,
        undefined,
        response.status
      )
    }

    const raw = await response.json() as Record<string, unknown>

    // Map snake_case from backend to camelCase
    return {
      issuer: raw.issuer as string,
      authorizationEndpoint: raw.authorization_endpoint as string,
      tokenEndpoint: raw.token_endpoint as string,
      userinfoEndpoint: raw.userinfo_endpoint as string,
      revocationEndpoint: raw.revocation_endpoint as string,
      introspectionEndpoint: raw.introspection_endpoint as string | undefined,
      jwksUri: raw.jwks_uri as string,
      scopesSupported: (raw.scopes_supported as string[]) || [],
      responseTypesSupported: (raw.response_types_supported as string[]) || [],
      grantTypesSupported: (raw.grant_types_supported as string[]) || [],
      tokenEndpointAuthMethodsSupported:
        (raw.token_endpoint_auth_methods_supported as string[]) || [],
      claimsSupported: (raw.claims_supported as string[]) || [],
      subjectTypesSupported: (raw.subject_types_supported as string[]) || [],
      idTokenSigningAlgValuesSupported:
        (raw.id_token_signing_alg_values_supported as string[]) || [],
      codeChallengeMethodsSupported: (raw.code_challenge_methods_supported as string[]) || [],
    }
  }

  /** Fetch JWKS (JSON Web Key Set) for ID token verification */
  async fetchJWKS(): Promise<JWKS> {
    const response = await fetch(`${this.baseURL}/.well-known/jwks.json`)

    if (!response.ok) {
      throw new OAuthError(
        "jwks_failed",
        `JWKS request failed with HTTP ${response.status}`,
        undefined,
        response.status
      )
    }

    return response.json() as Promise<JWKS>
  }

  /** Fetch app info (for consent screen) */
  async fetchAppInfo(): Promise<{
    clientId: string
    name: string
    description: string
    logoUrl: string
    homepageUrl: string
    allowedScopes: string[]
    scopeDescriptions: Record<string, string>
    scopeLabels: Record<string, string>
  }> {
    const response = await fetch(
      `${this.baseURL}/oauth/app-info?client_id=${encodeURIComponent(this.config.clientId)}`
    )

    if (!response.ok) {
      throw new OAuthError(
        "app_info_failed",
        `App info request failed with HTTP ${response.status}`,
        undefined,
        response.status
      )
    }

    const raw = await response.json() as Record<string, unknown>

    return {
      clientId: raw.client_id as string,
      name: raw.name as string,
      description: raw.description as string,
      logoUrl: raw.logo_url as string,
      homepageUrl: raw.homepage_url as string,
      allowedScopes: (raw.allowed_scopes as string[]) || [],
      scopeDescriptions: (raw.scope_descriptions as Record<string, string>) || {},
      scopeLabels: (raw.scope_labels as Record<string, string>) || {},
    }
  }

  // ─── Internal: token request helper ────────────────────────────────────

  private async requestToken(body: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch(`${this.baseURL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    const rawData = await response.json().catch(() => {
      throw new OAuthError(
        "server_error",
        `Token endpoint returned HTTP ${response.status} with non-JSON body`,
        undefined,
        response.status
      )
    }) as Record<string, unknown>

    if (!response.ok) {
      throw new OAuthError(
        (rawData.error as string) || "token_request_failed",
        (rawData.error_description as string) || `Token request failed with HTTP ${response.status}`,
        rawData.state as string | undefined,
        response.status
      )
    }

    return {
      accessToken: rawData.access_token as string,
      tokenType: (rawData.token_type as string) || "Bearer",
      expiresIn: (rawData.expires_in as number) || 3600,
      idToken: rawData.id_token as string | undefined,
      refreshToken: rawData.refresh_token as string | undefined,
      scope: rawData.scope as string | undefined,
    }
  }

  // ─── Token Store Management ────────────────────────────────────────────

  /** Save tokens to localStorage */
  saveTokens(tokens: TokenResponse): void {
    const store: TokenStore = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      idToken: tokens.idToken ?? null,
      expiresAt: Date.now() + (tokens.expiresIn || 3600) * 1000,
      scope: tokens.scope ?? null,
    }
    saveTokens(store, this.config.storageKey)
  }

  /** Load tokens from localStorage */
  loadTokens(): TokenStore | null {
    return loadTokens(this.config.storageKey)
  }

  /** Clear stored tokens */
  clearTokens(): void {
    clearTokens(this.config.storageKey)
  }

  /** Check if stored access token is still valid (not expired) */
  hasValidAccessToken(leewaySeconds = 30): boolean {
    const store = this.loadTokens()
    if (!store?.accessToken || !store.expiresAt) return false
    return Date.now() < store.expiresAt - leewaySeconds * 1000
  }

  /** Get a valid access token, auto-refreshing if needed */
  async getAccessToken(): Promise<string | null> {
    const store = this.loadTokens()
    if (!store?.accessToken) return null

    // If the token is still valid, return it
    if (this.hasValidAccessToken()) {
      return store.accessToken
    }

    // Try to refresh
    if (store.refreshToken) {
      try {
        const newTokens = await this.refreshToken(store.refreshToken)
        this.saveTokens(newTokens)
        return newTokens.accessToken
      } catch {
        // Refresh failed — clear tokens and return null
        this.clearTokens()
        return null
      }
    }

    return null
  }

  /** Extract user info from an ID token (without verification) */
  getUserFromIDToken(): { sub?: string; name?: string; email?: string; picture?: string } | null {
    const store = this.loadTokens()
    if (!store?.idToken) return null
    return decodeJWT<{
      sub?: string
      name?: string
      email?: string
      picture?: string
    }>(store.idToken)
  }

  /** Check if a stored token is about to expire (within the given seconds) */
  isTokenExpiringSoon(withinSeconds = 60): boolean {
    const store = this.loadTokens()
    if (!store?.expiresAt) return true
    return Date.now() > store.expiresAt - withinSeconds * 1000
  }

  /** Create a complete authorize URL with auto-generated PKCE.
   *  Returns the URL and the code verifier (must be saved to exchange the code). */
  async startAuthorization(params: {
    scope?: string
    state?: string
    nonce?: string
  }): Promise<{ url: URL; verifier: string }> {
    const { verifier, challenge } = await this.generatePKCE()
    const url = this.createAuthorizeUrl({
      scope: params.scope ?? "openid profile email",
      state: params.state ?? crypto.randomUUID(),
      nonce: params.nonce ?? crypto.randomUUID(),
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
    })
    return { url, verifier }
  }

  /** Handle the OAuth callback from the redirect URL.
   *  Extracts the code, validates state, exchanges for tokens, and saves them.
   *  Returns the token response on success. */
  async handleCallback(
    callbackUrl: string,
    savedVerifier: string,
    savedState?: string
  ): Promise<TokenResponse> {
    const url = new URL(callbackUrl)
    const error = url.searchParams.get("error")
    if (error) {
      throw new OAuthError(
        error,
        url.searchParams.get("error_description") ?? undefined,
        url.searchParams.get("state") ?? undefined
      )
    }

    const code = url.searchParams.get("code")
    if (!code) {
      throw new OAuthError(
        "invalid_callback",
        "No authorization code found in the callback URL"
      )
    }

    // Validate state if provided
    const state = url.searchParams.get("state")
    if (savedState && state !== savedState) {
      throw new OAuthError(
        "state_mismatch",
        "State parameter mismatch — possible CSRF attack"
      )
    }

    const tokens = await this.exchangeCode({
      code,
      codeVerifier: savedVerifier,
    })

    this.saveTokens(tokens)
    return tokens
  }
}

// ─── Singleton Factory ───────────────────────────────────────────────────────

let defaultClient: OAuthClient | null = null

/** Create or get the default OAuth client instance.
 *  Useful for simple setups with a single OAuth provider. */
export function createOAuthClient(config: OAuthClientConfig): OAuthClient {
  defaultClient = new OAuthClient(config)
  return defaultClient
}

/** Get the default OAuth client instance. Throws if not created yet. */
export function getOAuthClient(): OAuthClient {
  if (!defaultClient) {
    throw new OAuthError("not_initialized", "OAuth client not initialized. Call createOAuthClient() first.")
  }
  return defaultClient
}

export default OAuthClient
