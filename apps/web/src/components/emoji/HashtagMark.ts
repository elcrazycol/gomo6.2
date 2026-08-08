import { Mark, mergeAttributes, markInputRule, markPasteRule } from '@tiptap/core';

// Latin, digits, underscore + full Cyrillic block (covers RU/UA/BY letters)
// Built fresh per rule so `lastIndex` state of the `g` flag never leaks between them.
const HASHTAG_PATTERN = '#[a-zA-Z0-9_\\u0400-\\u04FF]+';

export const HashtagMark = Mark.create({
  name: 'hashtag',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-hashtag]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-hashtag': '',
        class: 'text-primary font-semibold',
      }),
    ];
  },

  addInputRules() {
    return [
      markInputRule({
        find: new RegExp(`(?:^|\\s)(${HASHTAG_PATTERN})$`, 'g'),
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        // Require a start-of-text / whitespace boundary so "site.com/#news" or
        // "foo#bar" don't get marked as hashtags. markPasteRule skips the leading
        // whitespace via the capture group, so only "#tag" itself gets the mark.
        find: new RegExp(`(?:^|\\s)(${HASHTAG_PATTERN})`, 'g'),
        type: this.type,
      }),
    ];
  },
});
