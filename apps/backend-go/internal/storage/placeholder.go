package storage

// AvatarPlaceholderSVG is returned when storage is down and the path looks like an avatar.
const AvatarPlaceholderSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="50" fill="#e5e7eb"/>
  <circle cx="50" cy="35" r="15" fill="#9ca3af"/>
  <ellipse cx="50" cy="70" rx="25" ry="15" fill="#9ca3af"/>
</svg>`
