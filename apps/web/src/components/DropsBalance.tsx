import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Droplets } from "lucide-react";
import { api } from "@/integrations/api/compat";

interface DropsBalanceProps {
  className?: string;
}

export function DropsBalance({ className = "" }: DropsBalanceProps) {
  const [drops, setDrops] = useState<number | null>(null);

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const session = await api.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) return;

        const res = await fetch("/api/v1/user/drops", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
          setDrops(data.data.drops);
        }
      } catch {
        // silent
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  if (drops === null) return null;

  return (
    <Link
      to="/wallet"
      className={`flex items-center gap-1.5 hover:opacity-80 transition-opacity ${className}`}
    >
      <Droplets className="w-4 h-4 text-blue-400" />
      <span className="text-sm font-medium">{drops}</span>
    </Link>
  );
}
