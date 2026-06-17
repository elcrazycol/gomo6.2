import { useState, useEffect } from "react";
import { GiftCard, type UserGiftItem } from "@/components/GiftCard";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Gift } from "lucide-react";

interface GiftsTabProps {
  userId: string;
}

export function GiftsTab({ userId }: GiftsTabProps) {
  const [gifts, setGifts] = useState<UserGiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    setGifts([]);
    setOffset(0);
    setHasMore(true);
    loadGifts(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadGifts = async (currentOffset: number) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/user_gifts?recipient_id=eq.${userId}&limit=${pageSize}&offset=${currentOffset}`
      );
      const result = await res.json();
      const data = result.data || [];

      if (currentOffset === 0) {
        setGifts(data);
      } else {
        setGifts((prev) => [...prev, ...data]);
      }
      setHasMore(data.length === pageSize);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    const nextOffset = offset + pageSize;
    setOffset(nextOffset);
    loadGifts(nextOffset);
  };

  if (loading && gifts.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  if (gifts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Gift className="w-10 h-10 mb-3 opacity-50" />
        <p>Подарков пока нет</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {gifts.map((gift) => (
          <GiftCard key={gift.id} gift={gift} variant="received" />
        ))}
      </div>
      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={loadMore}
            disabled={loading}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {loading ? "Загрузка..." : "Показать ещё"}
          </button>
        </div>
      )}
    </div>
  );
}
