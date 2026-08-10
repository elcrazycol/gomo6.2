import { describe, expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CustomEmojiNode, snapEmojiClick, clickOnLeftHalf } from "./CustomEmojiNode";

const emojiId = "12345678-1234-1234-1234-123456789012";

describe("CustomEmojiNode", () => {
  it("is a non-selectable inline leaf atom: no NodeSelection, no selected highlight", () => {
    const schema = getSchema([StarterKit, CustomEmojiNode]);
    const emoji = schema.nodes.customEmoji.create({ emojiId });
    const paragraph = schema.nodes.paragraph.create(null, [schema.text("A"), emoji, schema.text("B")]);
    const doc = schema.topNodeType.create(null, paragraph);

    // A non-selectable node cannot host a NodeSelection, so clicks can never
    // turn the emoji into a highlighted "selected" block — only text caret
    // positions before/after it remain.
    expect(schema.nodes.customEmoji.spec.selectable).toBe(false);
    expect(doc.child(0).content.child(1).type.name).toBe("customEmoji");
  });

  it("is an inline leaf atom with no document position inside it", () => {
    const spec = CustomEmojiNode.config;
    expect(spec.inline).toBe(true);
    expect(spec.atom).toBe(true);
    expect(spec.group).toBe("inline");
    expect(spec.content).toBeUndefined();
    expect(spec.selectable).toBe(false);

    const schema = getSchema([StarterKit, CustomEmojiNode]);
    const emoji = schema.nodes.customEmoji.create({ emojiId });
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("A"),
      emoji,
      schema.text("B"),
    ]);
    const doc = schema.topNodeType.create(null, paragraph);
    const emojiPosition = 2;

    expect(emoji.nodeSize).toBe(1);
    expect(doc.textBetween(1, 2, undefined, "�")).toBe("A");
    expect(doc.textBetween(2, 3, undefined, "�")).toBe("�");
    expect(doc.textBetween(3, 4, undefined, "�")).toBe("B");
    expect(doc.resolve(emojiPosition).nodeAfter?.type.name).toBe("customEmoji");
    expect(doc.resolve(emojiPosition + emoji.nodeSize).nodeBefore?.type.name).toBe("customEmoji");
  });

  it("places the caret on the clicked half of the emoji box", () => {
    const rect = { left: 100, width: 20 };
    expect(clickOnLeftHalf(rect, 90)).toBe(true); // clearly left
    expect(clickOnLeftHalf(rect, 109)).toBe(true); // left of the midpoint
    expect(clickOnLeftHalf(rect, 110)).toBe(false); // exactly on the midpoint → right
    expect(clickOnLeftHalf(rect, 125)).toBe(false); // clearly right
  });

  it("registers handleClickOn for emoji clicks", () => {
    const plugins = CustomEmojiNode.config.addProseMirrorPlugins?.call({ name: "customEmoji" } as never) ?? [];
    expect(plugins.length).toBeGreaterThan(0);
    const plugin = plugins[0];
    const props = (plugin as { spec: { props?: { handleClickOn?: unknown } } }).spec.props;
    expect(typeof props?.handleClickOn).toBe("function");
  });

  it("snaps a click on the emoji to the correct text boundary", () => {
    const schema = getSchema([StarterKit, CustomEmojiNode]);
    const emoji = schema.nodes.customEmoji.create({ emojiId });
    const paragraph = schema.nodes.paragraph.create(null, [schema.text("A"), emoji, schema.text("B")]);
    const doc = schema.topNodeType.create(null, paragraph);
    const emojiPos = 2; // paragraph(0) A(1) emoji(2) B(3)

    const setSelection = vi.fn((selection: unknown) => ({ setSelection: selection }));
    const dispatch = vi.fn();
    const focus = vi.fn();
    const view = {
      state: { doc, tr: { setSelection } },
      coordsAtPos: (pos: number) => (pos === emojiPos ? { left: 100 } : { right: 140 }),
      dispatch,
      focus,
    } as never;

    // Click on the left half → caret before the emoji (position 2).
    expect(snapEmojiClick(view, emojiPos, emoji.nodeSize, 110)).toBe(true);
    expect(focus).toHaveBeenCalled();
    const leftSelection = setSelection.mock.calls[0][0] as { from: number };
    expect(leftSelection.from).toBe(emojiPos);

    // Click on the right half → caret after the emoji (position 3).
    expect(snapEmojiClick(view, emojiPos, emoji.nodeSize, 130)).toBe(true);
    const rightSelection = setSelection.mock.calls[1][0] as { from: number };
    expect(rightSelection.from).toBe(emojiPos + emoji.nodeSize);

    // Non-emoji nodes are not handled.
    expect(snapEmojiClick(view, 1, 1, 110)).toBe(false);
  });

  it("uses a global paste rule without making the input rule global", () => {
    const inputRules = CustomEmojiNode.config.addInputRules?.call({} as never) ?? [];
    const pasteRules = CustomEmojiNode.config.addPasteRules?.call({} as never) ?? [];
    const inputFind = (inputRules[0] as { find: RegExp }).find;
    const pasteFind = (pasteRules[0] as { find: RegExp }).find;

    expect(inputFind).toBeInstanceOf(RegExp);
    expect(inputFind.global).toBe(false);
    expect(inputFind.exec(`[e:${emojiId}]`)?.[1]).toBe(emojiId);
    expect(pasteFind).toBeInstanceOf(RegExp);
    expect(pasteFind.global).toBe(true);
    expect([...`before [e:${emojiId}] after`.matchAll(pasteFind)].map((match) => match[1])).toEqual([emojiId]);
  });
});
