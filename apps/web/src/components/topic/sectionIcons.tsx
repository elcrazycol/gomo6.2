// Section icon registry.
//
// `thread_sections.icon` stores a stable icon *key* (a lucide name), not an
// emoji — the catalog is rendered as vector icons everywhere (picker, topic
// header, feed/thread chips). Unknown keys fall back to a neutral hash so a
// future section added without an icon still renders cleanly.

import type { LucideIcon } from "lucide-react";
import {
  Cpu,
  Flame,
  Gamepad2,
  Hash,
  Laugh,
  LifeBuoy,
  MessagesSquare,
  Newspaper,
  Palette,
} from "lucide-react";

const SECTION_ICONS: Record<string, LucideIcon> = {
  hash: Hash,
  "messages-square": MessagesSquare,
  laugh: Laugh,
  "gamepad-2": Gamepad2,
  cpu: Cpu,
  palette: Palette,
  newspaper: Newspaper,
  "life-buoy": LifeBuoy,
  flame: Flame,
};

const getSectionIcon = (name?: string | null): LucideIcon =>
  (name && SECTION_ICONS[name]) || Hash;

export const SectionIcon = ({ name, className }: { name?: string | null; className?: string }) => {
  const Icon = getSectionIcon(name);
  return <Icon className={className} aria-hidden="true" />;
};
