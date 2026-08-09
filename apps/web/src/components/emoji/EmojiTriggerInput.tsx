import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { normalizeEmojiTriggers } from '@/utils/emojiGraphemes';

interface EmojiTriggerInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

export function EmojiTriggerInput({ value, onChange, disabled }: EmojiTriggerInputProps) {
  const [draft, setDraft] = useState('');
  const addDraft = () => {
    const next = normalizeEmojiTriggers(draft).filter((trigger) => !value.includes(trigger));
    if (next.length > 0) onChange([...value, ...next].slice(0, 3));
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-9">
        {value.map((trigger) => (
          <span key={trigger} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-lg leading-none">
            {trigger}
            <button type="button" disabled={disabled} onClick={() => onChange(value.filter((item) => item !== trigger))} className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Удалить триггер ${trigger}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length === 0 && <span className="text-xs text-muted-foreground py-2">Добавьте 1–3 обычных эмодзи, например 🔥 или 😂</span>}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          disabled={disabled || value.length >= 3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDraft(); } }}
          placeholder="Вставьте 1–3 эмодзи"
          className="text-lg"
          inputMode="text"
          aria-label="Стандартные эмодзи-триггеры"
        />
        <Button type="button" variant="outline" disabled={disabled || !draft.trim() || value.length >= 3} onClick={addDraft}>Добавить</Button>
      </div>
      <p className="text-xs text-muted-foreground">При вводе этих эмодзи в редакторе появится подсказка вашего кастомного варианта. Никаких :имён:.</p>
    </div>
  );
}
