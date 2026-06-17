import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Star, ArrowUpRight, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { Nickname } from '@/services/blockchain';

interface NicknameCardProps {
  nickname: Nickname;
  onSetPrimary?: (name: string) => void;
  compact?: boolean;
}

export function NicknameCard({ nickname, onSetPrimary, compact }: NicknameCardProps) {
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(nickname.contract_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border border-border">
        <span className="font-mono text-sm font-medium">@{nickname.nickname}</span>
        {nickname.is_primary && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            <Star className="w-2.5 h-2.5 mr-0.5" />
            Primary
          </Badge>
        )}
        <a
          href={`https://basescan.org/token/${nickname.contract_address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div className="group relative bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold">@{nickname.nickname}</span>
            {nickname.is_primary && (
              <Badge variant="secondary" className="text-xs">
                <Star className="w-3 h-3 mr-1" />
                Primary
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Minted {new Date(nickname.created_at).toLocaleDateString()}</span>
            <span>·</span>
            <button
              onClick={copyAddress}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <span className="font-mono">{nickname.contract_address.slice(0, 6)}...{nickname.contract_address.slice(-4)}</span>
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>

        <a
          href={`https://basescan.org/token/${nickname.contract_address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>

      {!nickname.is_primary && onSetPrimary && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onSetPrimary(nickname.nickname)}
        >
          <Star className="w-3 h-3 mr-1" />
          Set as Primary
        </Button>
      )}
    </div>
  );
}
