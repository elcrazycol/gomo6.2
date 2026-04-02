// Утилита для управления кэшем обработанных медиафайлов

export const clearMediaCache = () => {
  // Очищаем localStorage с кэшем
  try {
    const keys = Object.keys(localStorage);
    const mediaKeys = keys.filter(key => 
      key.startsWith('gomo-media-') || 
      key.startsWith('ffmpeg-cache-')
    );
    
    mediaKeys.forEach(key => localStorage.removeItem(key));
    console.log(`Cleared ${mediaKeys.length} media cache entries`);
  } catch (error) {
    console.warn('Failed to clear media cache:', error);
  }
};

export const getCacheSize = () => {
  try {
    let totalSize = 0;
    const keys = Object.keys(localStorage);
    
    keys.forEach(key => {
      if (key.startsWith('gomo-media-') || key.startsWith('ffmpeg-cache-')) {
        const value = localStorage.getItem(key);
        if (value) {
          totalSize += new Blob([value]).size;
        }
      }
    });
    
    return (totalSize / 1024 / 1024).toFixed(2); // MB
  } catch {
    return '0';
  }
};
