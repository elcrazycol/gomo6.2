import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/api/client_simple';

interface EmojiInlineProps {
  code: string;
  className?: string;
}

export const EmojiInline = ({ code, className = "" }: EmojiInlineProps) => {
  const [emoji, setEmoji] = useState<{ image_url: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEmoji();
  }, [code]);

  const loadEmoji = async () => {
    try {
      const { data, error } = await supabase
        .from('emojis')
        .select('image_url, name')
        .eq('code', code)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setEmoji(data);
      }
    } catch (error) {
      console.error('Error loading emoji:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <span className={`inline-block w-4 h-4 bg-muted/30 rounded ${className}`}></span>;
  }

  if (!emoji) {
    // If emoji not found, show the code
    return <span className={`text-muted-foreground ${className}`}>:{code}:</span>;
  }

  return (
    <img
      src={emoji.image_url}
      alt={emoji.name}
      className={`inline-block w-5 h-5 object-contain align-middle ${className}`}
      title={`:${code}:`}
    />
  );
};