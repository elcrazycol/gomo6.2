import { useCallback, useEffect, useRef, useState } from "react"
import {
  OAuthClient,
  OAuthClientConfig,
  OAuthError,
  TokenResponse,
  UserInfoResponse,
} from "@/integrations/api/oauth"

export interface UseOAuthOptions {
  /** OAuth client configuration */
  config: OAuthClientConfig
  /** Automatically try to load stored session on mount */
  autoLoad?: boolean
  /** Callback URL to parse on mount (for redirect-based flows) */
  callbackUrl?: string
  /** PKCE code verifier saved during authorization redirect */
  savedVerifier?: string
  /** State parameter saved during authorization redirect */
  savedState?: string
}

export interface UseOAuthReturn {
  /** OAuth client instance */
  client: OAuthClient

  // Token state
  accessToken: string | null
  refreshToken: string | null
  idToken: string | null
  isExpired: boolean
  isExpiringSoon: boolean

  // User state
  user: UserInfoResponse | null
  isLoading: boolean
  isAuthenticated: boolean
  error: OAuthError | Error | null

  // Actions
  loginWithRedirect: (scope?: string, extraParams?: Record<string, string>) => Promise<URL>
  handleCallback: (callbackUrl?: string) => Promise<void>
  logout: () => void
  getAccessToken: () => Promise<string | null>
  exchangeCode: (code: string, verifier: string) => Promise<TokenResponse>
  refresh: () => Promise<void>
}

export function useOAuth(options: UseOAuthOptions): UseOAuthReturn {
  const { config, autoLoad = true } = options
  const clientRef = useRef<OAuthClient>(new OAuthClient(config))

  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState<string | null>(null)
  const [idToken, setIdToken] = useState<string | null>(null)
  const [user, setUser] = useState<UserInfoResponse | null>(null)
  const [isLoading, setIsLoading] = useState(autoLoad)
  const [error, setError] = useState<OAuthError | Error | null>(null)

  const client = clientRef.current

  const updateFromStore = useCallback(() => {
    const store = client.loadTokens()
    setAccessToken(store?.accessToken ?? null)
    setRefreshToken(store?.refreshToken ?? null)
    setIdToken(store?.idToken ?? null)
  }, [client])

  // Load stored tokens on mount
  useEffect(() => {
    if (!autoLoad) {
      setIsLoading(false)
      return
    }

    const init = async () => {
      try {
        updateFromStore()

        // Check if we have a callback URL to process
        if (options.callbackUrl && options.savedVerifier) {
          const tokens = await client.handleCallback(
            options.callbackUrl,
            options.savedVerifier,
            options.savedState
          )
          client.saveTokens(tokens)
          updateFromStore()

          // Fetch userinfo
          const userInfo = await client.getUserinfo(tokens.accessToken)
          setUser(userInfo)
        } else if (client.hasValidAccessToken()) {
          // Auto-load userinfo from stored token
          const store = client.loadTokens()
          if (store?.accessToken) {
            try {
              const userInfo = await client.getUserinfo(store.accessToken)
              setUser(userInfo)
            } catch {
              // Token might be expired, try refresh
              if (store.refreshToken) {
                try {
                  const newTokens = await client.refreshToken(store.refreshToken)
                  client.saveTokens(newTokens)
                  updateFromStore()
                  const userInfo = await client.getUserinfo(newTokens.accessToken)
                  setUser(userInfo)
                } catch {
                  client.clearTokens()
                  updateFromStore()
                }
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof OAuthError ? err : new Error(String(err)))
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [autoLoad, options.callbackUrl, options.savedVerifier, options.savedState, client, updateFromStore])

  // Derived state
  const isExpired = !!accessToken && !client.hasValidAccessToken()
  const isExpiringSoon = client.isTokenExpiringSoon(120)
  const isAuthenticated = !!accessToken && !isExpired

  // ─── Actions ──────────────────────────────────────────────────────────

  /** Start authorization: generates PKCE, returns the authorize URL */
  const loginWithRedirect = useCallback(
    async (scope = "openid profile email", extraParams?: Record<string, string>): Promise<URL> => {
      const { verifier, challenge } = await client.generatePKCE()

      // Save PKCE verifier and state to sessionStorage for the callback
      const state = crypto.randomUUID()
      sessionStorage.setItem("oauth_pkce_verifier", verifier)
      sessionStorage.setItem("oauth_state", state)

      const url = client.createAuthorizeUrl({
        scope,
        state,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        extraParams,
      })

      return url
    },
    [client]
  )

  /** Handle callback: reads PKCE verifier from sessionStorage, exchanges code */
  const handleCallback = useCallback(
    async (callbackUrl?: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const url = callbackUrl ?? window.location.href
        const savedVerifier = sessionStorage.getItem("oauth_pkce_verifier")
        const savedState = sessionStorage.getItem("oauth_state")

        if (!savedVerifier) {
          throw new OAuthError(
            "missing_verifier",
            "PKCE code verifier not found in session storage. Did you start authorization?"
          )
        }

        const tokens = await client.handleCallback(url, savedVerifier, savedState)

        // Clean up session storage
        sessionStorage.removeItem("oauth_pkce_verifier")
        sessionStorage.removeItem("oauth_state")

        updateFromStore()

        // Fetch userinfo
        const userInfo = await client.getUserinfo(tokens.accessToken)
        setUser(userInfo)
      } catch (err) {
        setError(err instanceof OAuthError ? err : new Error(String(err)))
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    [client, updateFromStore]
  )

  /** Logout: clear tokens and user state */
  const logout = useCallback(() => {
    client.clearTokens()
    setAccessToken(null)
    setRefreshToken(null)
    setIdToken(null)
    setUser(null)
    setError(null)
  }, [client])

  /** Get a valid access token, refreshing if necessary */
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const token = await client.getAccessToken()
    if (token) {
      updateFromStore()
    }
    return token
  }, [client, updateFromStore])

  /** Exchange code for tokens manually */
  const exchangeCodeAction = useCallback(
    async (code: string, verifier: string): Promise<TokenResponse> => {
      const tokens = await client.exchangeCode({ code, codeVerifier: verifier })
      client.saveTokens(tokens)
      updateFromStore()

      const userInfo = await client.getUserinfo(tokens.accessToken)
      setUser(userInfo)
      return tokens
    },
    [client, updateFromStore]
  )

  /** Force refresh the access token */
  const refreshAction = useCallback(async () => {
    const store = client.loadTokens()
    if (!store?.refreshToken) {
      throw new OAuthError("no_refresh_token", "No refresh token available")
    }

    const tokens = await client.refreshToken(store.refreshToken)
    client.saveTokens(tokens)
    updateFromStore()
  }, [client, updateFromStore])

  return {
    client,
    accessToken,
    refreshToken,
    idToken,
    isExpired,
    isExpiringSoon,
    user,
    isLoading,
    isAuthenticated,
    error,
    loginWithRedirect,
    handleCallback,
    logout,
    getAccessToken,
    exchangeCode: exchangeCodeAction,
    refresh: refreshAction,
  }
}

export default useOAuth
