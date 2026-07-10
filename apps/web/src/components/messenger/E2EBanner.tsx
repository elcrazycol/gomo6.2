import { Lock } from "lucide-react";

interface E2EBannerProps {
  isInitializing?: boolean;
}

export function E2EBanner({ isInitializing = false }: E2EBannerProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border-b border-green-500/20 text-green-600 text-xs">
      <Lock className="w-3.5 h-3.5 flex-shrink-0" />
      {isInitializing ? (
        <span>Установка зашифрованного соединения...</span>
      ) : (
        <span>Сообщения зашифрованы E2E. Сервер не имеет доступа к содержимому.</span>
      )}
    </div>
  );
}
