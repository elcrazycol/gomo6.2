# 🔧 Отладка метаданных аудио

## Что проверить в консоли браузера:

При загрузке аудиофайла должны появиться логи:

```
Extracting metadata from: filename.mp3 audio/mpeg 12345678
Music-metadata parsed successfully
Parsed metadata: {
  title: "Название трека",
  artist: "Исполнитель", 
  album: "Альбом",
  duration: 245.5,
  hasPicture: true,
  genre: "Pop",
  year: 2023
}
Picture data: {
  format: "image/jpeg",
  type: "Cover (front)",
  size: 45678
}
Extracted cover art: image/jpeg
Final metadata result: {
  title: "Название трека",
  artist: "Исполнитель",
  album: "Альбом", 
  duration: 245.5,
  coverArt: "blob:http://localhost:3000/abc-123"
}
Extracted metadata before transcoding: {...}
```

## Если метаданные не извлекаются:

### 1. Проверьте формат файла
- Должен быть: MP3, FLAC, OGG, WAV, M4A, AAC
- Проверьте MIME тип в логах

### 2. Проверьте наличие ID3 тегов
Используйте инструмент вроде `mp3info` или `exiftool`:
```bash
mp3info your-file.mp3
exiftool your-file.mp3
```

### 3. Попробуйте другой файл
Возможно файл не содержит метаданных или поврежден.

### 4. Проверьте ошибки в консоли
Должны быть видны любые ошибки music-metadata или HTML5 Audio.

## Тестовые файлы:

Создайте MP3 файл с известными метаданными или скачайте с сайта музыканта.

## Альтернативные решения:

Если music-metadata не работает в браузере:
1. Можно добавить серверное извлечение метаданных
2. Использовать WebAssembly версию библиотеки
3. Добавить ручной ввод метаданных
