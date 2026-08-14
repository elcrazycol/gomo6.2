import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/integrations/api/compat';
import { EmojiPackForm } from '@/components/emoji/EmojiPackForm';

export default function EmojiPackCreate() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    api.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        navigate('/auth');
        return;
      }
      setAuthorized(true);
    });
  }, [navigate]);

  if (!authorized) return null;

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-lg mx-auto p-4">
        <h1 className="text-2xl font-bold mb-6">Создать пак эмодзи</h1>
        <EmojiPackForm
          onSuccess={(packId) => {
            // Jump straight into adding emojis — the most common next step
            // after creating a pack. The edit page shows the emoji uploader.
            if (packId) navigate(`/emojis/edit/${packId}`);
            else navigate('/emojis/my');
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  );
}
