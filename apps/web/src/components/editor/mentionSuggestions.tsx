import { ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionOptions } from "@tiptap/suggestion";
import { MentionList, type MentionListHandle } from "./MentionList";
import { searchProfiles, type ProfileSearchResult } from "@/utils/searchProfiles";

// Position is applied inline by the suggestion plugin's mount() (Floating UI),
// so no `position:` utility is needed here.
const POPUP_CLASS =
  "z-[9999] w-[calc(100vw-20px)] max-h-64 overflow-y-auto rounded-xl border border-border bg-background/95 shadow-xl backdrop-blur-sm animate-in fade-in-0 zoom-in-95 duration-200 sm:w-auto sm:min-w-[280px] sm:max-w-[320px]";

// The editor's Enter-to-submit listener must not fire while the mention popup
// is open (Enter selects a user there). The suggestion plugin's preventDefault
// does not stop DOM bubbling to the wrapper div, so we gate on this flag.
let isPopupActive = false;
export const isMentionPopupActive = () => isPopupActive;

/**
 * Tiptap v3 suggestion config for @-mentions. Positioning is handled by the
 * plugin's `props.mount()` (anchors to the caret, repositions on scroll),
 * so no tippy.js is needed.
 */
export const mentionSuggestion: Omit<
  SuggestionOptions<ProfileSearchResult, ProfileSearchResult>,
  "editor"
> = {
  items: ({ query }) => searchProfiles(query),

  command: ({ editor, range, props }) => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .insertContentAt(range, [
        {
          type: "mention",
          attrs: { id: props.id, label: props.username },
        },
      ])
      .run();
  },

  render: () => {
    let component: ReactRenderer<MentionListHandle, object> | null = null;
    let unmount: (() => void) | null = null;

    return {
      onStart: (props) => {
        isPopupActive = true;
        component = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
          className: POPUP_CLASS,
        });
        unmount = props.mount(component.element);
      },
      onUpdate: (props) => {
        component?.updateProps(props);
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        isPopupActive = false;
        unmount?.();
        component?.destroy();
      },
    };
  },
};
