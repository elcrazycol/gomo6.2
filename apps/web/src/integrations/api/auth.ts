// Auth module — extracted from client_simple.ts
// Provides api.auth compatibility layer backed by Go backend
import { apiClient, getDeviceToken } from './client';
import { useNotificationStore } from '@/stores/notificationStore';

export const apiAuth = {
  signUp: async ({ username, password, options, turnstileToken }: { username: string; password: string; options?: { data?: { display_name?: string } }; turnstileToken?: string }) => {
    try {
      const result = await apiClient.register(
        username,
        password,
        options?.data?.display_name,
        turnstileToken
      );
      return { data: { user: result.user, session: { access_token: result.token } }, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  signInWithPassword: async ({ username, password, turnstileToken }: { username: string; password: string; turnstileToken?: string }) => {
    try {
      const deviceToken = getDeviceToken();
      const result = await apiClient.login(username, password, deviceToken, turnstileToken);
      
      if (result.needs_2fa) {
        return { 
          data: { user: result.user, session: { access_token: result.token, needs_2fa: true } }, 
          error: null 
        };
      }
      
      return { data: { user: result.user, session: { access_token: result.token } }, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  signOut: async () => {
    useNotificationStore.getState().cleanup();
    await apiClient.logout();
    return { error: null };
  },
  getUser: async () => {
    try {
      const user = await apiClient.getCurrentUser();
      return { data: { user }, error: null };
    } catch (_e) {
      return { data: { user: null }, error: null };
    }
  },
  getSession: async () => {
    try {
      const user = await apiClient.getCurrentUser();
      // After a page reload the in-memory token is empty, but the browser
      // session still lives in HttpOnly cookies. Refresh once so Bearer-style
      // raw fetches (which read access_token from the session) keep working.
      // tryRefreshToken no-ops when no session hint (CSRF cookie) exists.
      let token = apiClient.getToken();
      if (user && !token && apiClient.getCSRFToken()) {
        token = await apiClient.tryRefreshToken();
      }
      return { data: { session: user ? { user, access_token: token } : null }, error: null };
    } catch (_e) {
      return { data: { session: null }, error: null };
    }
  },
  onAuthStateChange: (callback: (event: string, session: { user: Awaited<ReturnType<typeof apiClient.getCurrentUser>> } | null) => void) => {
    const checkAuth = async () => {
      const user = await apiClient.getCurrentUser();
      callback('SIGNED_IN', user ? { user } : null);
    };
    
    checkAuth();
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
  verify2FA: async (partialToken: string, code: string, trustDevice?: boolean) => {
    try {
      const deviceToken = getDeviceToken();
      const result = await apiClient.verify2FA(partialToken, code, deviceToken, trustDevice);
      // H2 (security audit): persist the server-issued opaque device token so
      // future logins from this browser can skip 2FA. The backend only ever
      // accepts tokens it minted itself, never a client-chosen id.
      if (trustDevice && result.device_token) {
        try {
          localStorage.setItem('device_token', result.device_token);
        } catch {
          // localStorage unavailable — 2FA will simply be asked again next time
        }
      }
      return { data: { session: { access_token: result.token } }, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  setupTOTP: async (password: string) => {
    try {
      const result = await apiClient.setupTOTP(password);
      return { data: result, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  verifyAndEnableTOTP: async (code: string) => {
    try {
      const result = await apiClient.verifyAndEnableTOTP(code);
      return { data: result, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  disableTOTP: async (code: string) => {
    try {
      await apiClient.disableTOTP(code);
      return { data: { ok: true }, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  get2FAStatus: async () => {
    try {
      const result = await apiClient.get2FAStatus();
      return { data: result, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  updateUser: async (attrs: { password?: string; current_password?: string }) => {
    try {
      if (attrs?.password) {
        await apiClient.updatePassword(attrs.password, attrs.current_password);
        const user = await apiClient.getCurrentUser();
        return { data: { user }, error: null };
      }
      return { data: { user: null }, error: { message: 'Поддерживается только смена пароля (password)' } };
    } catch (error) {
      return { data: { user: null }, error: { message: (error as Error).message } };
    }
  },
};
