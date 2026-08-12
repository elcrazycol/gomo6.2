import { useSyncExternalStore } from "react";
import {
  getMobileKeyboardState,
  subscribeMobileKeyboard,
} from "@/lib/mobileKeyboard";

/**
 * Reactive access to the global mobile-keyboard state (visual viewport size,
 * keyboard inset). Re-renders the consumer whenever the keyboard opens/closes
 * or the URL bar changes the visible height. Desktop returns stable values.
 */
export function useMobileKeyboard() {
  return useSyncExternalStore(
    subscribeMobileKeyboard,
    getMobileKeyboardState,
    getMobileKeyboardState,
  );
}
