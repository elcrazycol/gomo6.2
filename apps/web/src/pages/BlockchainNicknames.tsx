import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/integrations/api/compat';
import { WalletDashboard } from '@/components/WalletDashboard';
import { PentagramLoader } from '@/components/PentagramLoader';
import { Button } from '@/components/ui/button';

export default function BlockchainNicknames() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const getUser = async () => {
      try {
        const { data: { user } } = await api.auth.getUser();
        setUser(user);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    getUser();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-bold">Sign in required</h2>
          <p className="text-muted-foreground">You need to be signed in to manage blockchain nicknames.</p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Blockchain Nicknames</h1>
        <p className="text-muted-foreground mt-1">
          Your unique identities on Base
        </p>
      </div>

      <WalletDashboard />

      <div className="text-center">
        <Link to="/settings/account" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Settings
        </Link>
      </div>
    </div>
  );
}
