import { useState, useEffect, useCallback } from 'react';
import { blockchainApi, type Nickname, type WalletInfo } from '@/services/blockchain';

export function useBlockchain() {
  const [nicknames, setNicknames] = useState<Nickname[]>([]);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [nickRes, walletRes] = await Promise.all([
        blockchainApi.getUserNicknames(),
        blockchainApi.getWalletInfo(),
      ]);
      setNicknames(nickRes.nicknames || []);
      setWallet(walletRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const register = useCallback(async (name: string) => {
    const result = await blockchainApi.registerNickname(name);
    await load();
    return result;
  }, [load]);

  const setPrimary = useCallback(async (name: string) => {
    await blockchainApi.setPrimaryNickname(name);
    await load();
  }, [load]);

  const transfer = useCallback(async (name: string, toUserId: string) => {
    await blockchainApi.transferNickname(name, toUserId);
    await load();
  }, [load]);

  return { nicknames, wallet, loading, error, register, setPrimary, transfer, refresh: load };
}
