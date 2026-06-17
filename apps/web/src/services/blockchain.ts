const API_BASE = '/api/v1/blockchain';

export interface Nickname {
  id: string;
  user_id: string;
  nickname: string;
  token_id: string;
  contract_address: string;
  is_primary: boolean;
  created_at: string;
}

export interface WalletInfo {
  wallet_address: string;
  balance: string;
  primary: string;
  nickname_count: number;
  chain_id: number;
}

export interface CheckAvailabilityResponse {
  available: boolean;
  suggestions: string[];
}

export interface NicknameInfo {
  nickname: string;
  token_id: string;
  contract_address: string;
  is_primary: boolean;
  created_at: string;
  wallet_address: string;
  basescan_url: string;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const sessionStr = localStorage.getItem('session');
  if (!sessionStr) return {};
  try {
    const session = JSON.parse(sessionStr);
    const token = session?.access_token;
    if (token) {
      return { 'Authorization': `Bearer ${token}` };
    }
  } catch (_e) {
    // invalid session data
  }
  return {};
}

export const blockchainApi = {
  async checkAvailability(name: string): Promise<CheckAvailabilityResponse> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/nickname/check`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Check failed');
    return res.json();
  },

  async registerNickname(name: string): Promise<{ nickname: Nickname; message: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/nickname/register`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Registration failed');
    return res.json();
  },

  async getUserNicknames(): Promise<{ nicknames: Nickname[] }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/nicknames`, { headers });
    if (!res.ok) throw new Error('Failed to fetch nicknames');
    return res.json();
  },

  async setPrimaryNickname(nickname: string): Promise<{ message: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/nickname/primary`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to set primary');
    return res.json();
  },

  async getWalletInfo(): Promise<WalletInfo> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/wallet`, { headers });
    if (!res.ok) throw new Error('Failed to fetch wallet info');
    return res.json();
  },

  async getNicknameInfo(name: string): Promise<NicknameInfo> {
    const res = await fetch(`${API_BASE}/nickname/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error('Nickname not found');
    return res.json();
  },

  async transferNickname(name: string, toUserId: string): Promise<{ message: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/nickname/transfer`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, to_user_id: toUserId }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Transfer failed');
    return res.json();
  },
};
