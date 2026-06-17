import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { blockchainApi, type CheckAvailabilityResponse } from '@/services/blockchain';
import { toast } from 'sonner';
import { Check, X, Loader2, Sparkles } from 'lucide-react';

interface NicknameRegistrationProps {
  onRegistered: (nickname: string) => void;
  onSkip?: () => void;
}

export function NicknameRegistration({ onRegistered, onSkip }: NicknameRegistrationProps) {
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckAvailabilityResponse | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);

  const checkAvailability = useCallback(async (value: string) => {
    if (value.length < 3) {
      setResult(null);
      return;
    }
    setChecking(true);
    try {
      const res = await blockchainApi.checkAvailability(value);
      setResult(res);
    } catch {
      setResult(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    setName(value);
    setResult(null);
    const timeout = setTimeout(() => checkAvailability(value), 300);
    return () => clearTimeout(timeout);
  }, [checkAvailability]);

  const handleRegister = useCallback(async () => {
    if (!result?.available || !name) return;
    setRegistering(true);
    try {
      await blockchainApi.registerNickname(name);
      setRegistered(true);
      toast.success(`@${name} registered on Base!`);
      setTimeout(() => onRegistered(name), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  }, [name, result, onRegistered]);

  if (registered) {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30">
          <Sparkles className="w-8 h-8 text-green-500" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Welcome to Web3!</h3>
          <p className="text-muted-foreground mt-1">
            <span className="font-mono text-primary">@{name}</span> is now yours on Base
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 border border-primary/30 mb-3">
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-lg font-bold">Choose Your Blockchain Nickname</h3>
        <p className="text-sm text-muted-foreground mt-1">
          This will be minted as an NFT on Base. You own it forever.
        </p>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">@</span>
          <Input
            value={name}
            onChange={handleInputChange}
            placeholder="yourname"
            className="pl-8 font-mono text-lg"
            maxLength={32}
            autoFocus
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {checking && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {!checking && result?.available && <Check className="w-4 h-4 text-green-500" />}
            {!checking && result && !result.available && <X className="w-4 h-4 text-red-500" />}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          3-32 characters. Letters, numbers, hyphens, underscores only.
        </div>

        {result && !result.available && result.suggestions?.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Try these:</p>
            <div className="flex flex-wrap gap-2">
              {result.suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => { setName(s); checkAvailability(s); }}
                  className="px-3 py-1 text-sm font-mono bg-muted rounded-md hover:bg-muted/80 transition-colors"
                >
                  @{s}
                </button>
              ))}
            </div>
          </div>
        )}

        <Button
          onClick={handleRegister}
          disabled={!result?.available || registering}
          className="w-full"
          size="lg"
        >
          {registering ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Minting on Base...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Register @{name || '...'}
            </>
          )}
        </Button>

        {onSkip && (
          <button
            onClick={onSkip}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
