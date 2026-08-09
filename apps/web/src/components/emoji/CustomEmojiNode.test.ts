import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CustomEmojiNode } from "./CustomEmojiNode";

const emojiId = "12345678-1234-1234-1234-123456789012";

describe("CustomEmojiNode", () => {
  it("is an inline leaf atom with no document position inside it", () => {
    const spec = CustomEmojiNode.config;
    expect(spec.inline).toBe(true);
    expect(spec.atom).toBe(true);
    expect(spec.group).toBe("inline");
    expect(spec.content).toBeUndefined();

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
