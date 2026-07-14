import { Extension } from '@tiptap/core';

const TAB_SPACES = '    ';

export const CustomTabExtension = Extension.create({
  name: 'customTab',

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        editor.commands.insertContent(TAB_SPACES);
        return true;
      },
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;

        if (!$from.parent || !editor.isActive('paragraph')) {
          return false;
        }

        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
        if (textBefore.endsWith(TAB_SPACES) && $from.parentOffset >= TAB_SPACES.length) {
          const from = $from.pos - TAB_SPACES.length;
          const to = $from.pos;
          editor.chain().focus().deleteRange({ from, to }).run();
          return true;
        }

        return false;
      },
    };
  },
});
