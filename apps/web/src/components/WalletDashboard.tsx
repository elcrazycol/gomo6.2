import { useState } from 'react';
import { useBlockchain } from '@/hooks/useBlockchain';
import { NicknameCard } from '@/components/NicknameCard';
import { NicknameRegistration } from '@/components/NicknameRegistration';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Wallet, Plus, ArrowUpRight, Copy, Check, Sparkles } from 'lucide-react';

export function WalletDashboard() {
  const { nicknames, wallet, loading, error, setPrimary, refresh } = useBlockchain();
  const [showRegistration, setShowRegistration] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (wallet?.wallet_address) {
      navigator.clipboard.writeText(wallet.wallet_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSetPrimary = async (name: string) => {
    try {
      await setPrimary(name);
      toast.success(`${name} is now your primary nickname`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Failed to load wallet info</p>
        <Button variant="outline" onClick={refresh} className="mt-2">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Wallet Header */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold">Base Wallet</h2>
            <p className="text-xs text-muted-foreground">Chain ID: {wallet?.chain_id || 8453}</p>
          </div>
        </div>

        {wallet?.wallet_address && (
          <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
            <span className="font-mono text-sm flex-1 truncate">{wallet.wallet_address}</span>
            <button
              onClick={copyAddress}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
            <a
              href={`https://basescan.org/address/${wallet.wallet_address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mt-4 text-center">
          <div>
            <div className="text-2xl font-bold">{wallet?.nickname_count || 0}</div>
            <div className="text-xs text-muted-foreground">Nicknames</div>
          </div>
          <div>
            <div className="text-2xl font-bold font-mono text-sm">
              {wallet?.primary ? `@${wallet.primary}` : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Primary</div>
          </div>
          <div>
            <div className="text-2xl font-bold font-mono text-xs">
              {wallet?.balance ? `${Number(wallet.balance) / 1e18} ETH` : '0'}
            </div>
            <div className="text-xs text-muted-foreground">Balance</div>
          </div>
        </div>
      </div>

      {/* Nicknames Collection */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Your Collection
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRegistration(true)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Mint New
          </Button>
        </div>

        {showRegistration && (
          <div className="mb-6 p-4 bg-card border border-border rounded-xl">
            <NicknameRegistration
              onRegistered={() => {
                setShowRegistration(false);
                refresh();
              }}
              onSkip={() => setShowRegistration(false)}
            />
          </div>
        )}

        {nicknames.length === 0 && !showRegistration ? (
          <div className="text-center py-12 bg-card border border-border rounded-xl">
            <Sparkles className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No nicknames yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">Mint your first blockchain nickname!</p>
            <Button
              onClick={() => setShowRegistration(true)}
              className="mt-4"
            >
              <Plus className="w-4 h-4 mr-2" />
              Mint Nickname
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {nicknames.map((n) => (
              <NicknameCard
                key={n.id}
                nickname={n}
                onSetPrimary={handleSetPrimary}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
