// Auth module — extracted from client_simple.ts
// Provides api.auth compatibility layer backed by Go backend
import { apiClient, getDeviceId } from './client';

export const apiAuth = {
  signUp: async ({ email, password, options, ...captcha }: any) => {
    try {
      const result = await apiClient.register(
        email,
        options?.data?.username || email.split('@')[0],
        password,
        {
          challenge_id: captcha.challenge_id,
          solution: captcha.solution,
          captcha_token: captcha.captcha_token,
        }
      );
      return { data: { user: result.user, session: { access_token: result.token } }, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  signInWithPassword: async ({ email, password, ...captcha }: any) => {
    try {
      const deviceId = getDeviceId();
      const result = await apiClient.login(email, password, deviceId, {
        challenge_id: captcha.challenge_id,
        solution: captcha.solution,
        captcha_token: captcha.captcha_token,
      });
      
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
    apiClient.logout();
    return { error: null };
  },
  getUser: async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        return { data: { user: null }, error: null };
      }
      const user = await apiClient.getCurrentUser();
      return { data: { user }, error: null };
    } catch (error) {
      return { data: { user: null }, error: null };
    }
  },
  getSession: async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        return { data: { session: null }, error: null };
      }
      const user = await apiClient.getCurrentUser();
      return { data: { session: user ? { user, access_token: token } : null }, error: null };
    } catch (error) {
      return { data: { session: null }, error: null };
    }
  },
  onAuthStateChange: (callback: any) => {
    const checkAuth = async () => {
      const user = await apiClient.getCurrentUser();
      callback('SIGNED_IN', user ? { user } : null);
    };
    
    checkAuth();
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
  verify2FA: async (partialToken: string, code: string, trustDevice?: boolean) => {
    try {
      const deviceId = getDeviceId();
      const result = await apiClient.verify2FA(partialToken, code, deviceId, trustDevice);
      return { data: { session: { access_token: result.token } }, error: null };
    } catch (error) {
      return { data: null, error: { message: (error as Error).message } };
    }
  },
  setupTOTP: async () => {
    try {
      const result = await apiClient.setupTOTP();
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
  disableTOTP: async () => {
    try {
      await apiClient.disableTOTP();
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
  updateUser: async (attrs: { password?: string }) => {
    try {
      if (attrs?.password) {
        await apiClient.updatePassword(attrs.password);
        const user = await apiClient.getCurrentUser();
        return { data: { user }, error: null };
      }
      return { data: { user: null }, error: { message: 'Поддерживается только смена пароля (password)' } };
    } catch (error) {
      return { data: { user: null }, error: { message: (error as Error).message } };
    }
  },
};
