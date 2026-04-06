import { Music, Clock, User, Disc } from "lucide-react";
import { AttachmentMeta } from "@/types/forum";
import { MediaPlayer } from "./MediaPlayer";
import { storageUrl } from "@/utils/storage";

interface AudioAttachmentProps {
  attachment: AttachmentMeta;
  className?: string;
  playlistId?: string;
  playlistIndex?: number;
  showPlayer?: boolean; // для превью без плеера
}

export const AudioAttachment = ({ 
  attachment, 
  className = "",
  playlistId,
  playlistIndex,
  showPlayer = true
}: AudioAttachmentProps) => {
  const formatDuration = (seconds?: number) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const displayName = attachment.title || (attachment.name ? attachment.name.replace(/\.[^/.]+$/, "") : "Аудиофайл");
  const displayArtist = attachment.artist || (attachment.name ? "Неизвестный исполнитель" : null);
  const displayAlbum = attachment.album;
  const coverUrl = attachment.coverArt;

  // Компактная версия для превью (без плеера)
  if (!showPlayer) {
    return (
      <div className={`border border-border bg-card rounded-lg p-3 max-w-xs ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
            <Music className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">
              {displayName}
            </p>
            {(displayArtist) && (
              <p className="text-muted-foreground text-xs truncate">
                {displayArtist}
              </p>
            )}
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              {attachment.duration && (
                <span>{formatDuration(attachment.duration)}</span>
              )}
              {attachment.duration && attachment.size && <span>•</span>}
              {attachment.size && (
                <span>{(attachment.size / 1024 / 1024).toFixed(1)} MB</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Полная версия с плеером
  return (
    <div className={`border border-border bg-card rounded-lg shadow-sm ${className}`}>
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Обложка */}
          {coverUrl ? (
            <div className="w-16 h-16 flex-shrink-0 rounded-md overflow-hidden bg-muted">
              <img
                src={coverUrl}
                alt={`${displayName} обложка`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
              <div className="hidden w-full h-full flex items-center justify-center">
                <Music className="w-6 h-6 text-muted-foreground" />
              </div>
            </div>
          ) : (
            <div className="w-16 h-16 flex-shrink-0 rounded-md bg-muted flex items-center justify-center">
              <Music className="w-6 h-6 text-muted-foreground" />
            </div>
          )}

          {/* Информация */}
          <div className="flex-1 min-w-0">
            <div className="space-y-1">
              {/* Название трека */}
              <h4 className="font-medium text-sm leading-tight truncate" title={displayName}>
                {displayName}
              </h4>

              {/* Исполнитель */}
              {displayArtist && (
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  <User className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate" title={displayArtist}>
                    {displayArtist}
                  </span>
                </div>
              )}

              {/* Альбом (если есть) */}
              {displayAlbum && (
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  <Disc className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate" title={displayAlbum}>
                    {displayAlbum}
                  </span>
                </div>
              )}

              {/* Длительность */}
              {attachment.duration && (
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  <span>{formatDuration(attachment.duration)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Плеер */}
        <div className="mt-3">
          <MediaPlayer
            kind="audio"
            sources={[{ 
              src: storageUrl("content", attachment.url) || attachment.url,
              type: attachment.mime || "audio/ogg"
            }]}
            playerId={attachment.url}
            title={displayName}
            playlistId={playlistId}
            playlistIndex={playlistIndex}
            className="border-0 bg-transparent"
          />
        </div>
      </div>
    </div>
  );
};
