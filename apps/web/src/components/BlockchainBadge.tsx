import { Shield } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface BlockchainBadgeProps {
  size?: 'sm' | 'md';
}

export function BlockchainBadge({ size = 'sm' }: BlockchainBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-primary/80">
          <Shield className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
          {size === 'md' && (
            <span className="text-[10px] font-medium uppercase tracking-wider">Verified on Base</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">This identity is verified on Base blockchain</p>
      </TooltipContent>
    </Tooltip>
  );
}
