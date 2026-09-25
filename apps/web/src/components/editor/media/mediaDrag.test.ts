import { afterEach, describe, expect, it } from "vitest";
import { Editor, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

import { startMediaDrag } from "./mediaDrag";

// A node view is not needed here; only the schema/positions matter. Mirrors the
// real mediaBlock (inline atom) without pulling React NodeViews into jsdom.
const TestMediaNode = Node.create({
  name: "mediaBlock",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { attachmentId: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-media-block]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-media-block": "true" })];
  },
});

const TestGroupNode = Node.create({
  name: "mediaGroup",
  group: "block",
  content: "mediaBlock+",
  addAttributes() {
    return { layout: { default: "grid" } };
  },
  parseHTML() {
    return [{ tag: "div[data-media-group]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-media-group": "true" }, 0];
  },
});

const rect = (top: number, bottom: number, left = 0, right = 400): DOMRect =>
  ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe("startMediaDrag empty-line targeting", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
    document.body.classList.remove("media-dragging");
    document.querySelectorAll("[data-media-drop-caret]").forEach((el) => el.remove());
  });

  it("targets an empty line for any horizontal position and drops there", () => {
    editor = new Editor({
      extensions: [StarterKit, TestMediaNode],
      content: {
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "mediaBlock", attrs: { attachmentId: "m1" } }] },
        ],
      },
    });
    document.body.appendChild(editor.view.dom);
    const view = editor.view;
    // jsdom has no layout: stub the geometry the drag reads.
    const emptyP = view.nodeDOM(0) as HTMLElement;
    const mediaP = view.nodeDOM(view.state.doc.child(0).nodeSize) as HTMLElement;
    emptyP.getBoundingClientRect = () => rect(100, 120);
    mediaP.getBoundingClientRect = () => rect(200, 220);
    (view as unknown as { coordsAtPos: () => unknown }).coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });

    let mediaPos = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "mediaBlock") mediaPos = pos;
      return true;
    });

    // Pointer far to the RIGHT on the empty line (X must be irrelevant).
    startMediaDrag({ editor, sourcePos: mediaPos, clientX: 500, clientY: 110 });

    const caret = document.querySelector("[data-media-drop-caret]") as HTMLElement | null;
    expect(caret).not.toBeNull();
    expect(caret!.style.top).toBe("100px");

    // Release: the media should land inside the empty first paragraph.
    window.dispatchEvent(new Event("pointerup"));
    expect(view.state.doc.child(0).firstChild?.type.name).toBe("mediaBlock");
  });

  it("merges a dragged media into a gallery when dropped onto another media", () => {
    editor = new Editor({
      extensions: [StarterKit, TestMediaNode, TestGroupNode],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "mediaBlock", attrs: { attachmentId: "m1" } }] },
          { type: "paragraph", content: [{ type: "mediaBlock", attrs: { attachmentId: "m2" } }] },
        ],
      },
    });
    document.body.appendChild(editor.view.dom);
    const view = editor.view;
    let sourcePos = 0;
    let targetPos = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === "mediaBlock") {
        if (node.attrs.attachmentId === "m1") sourcePos = pos;
        else targetPos = pos;
      }
      return true;
    });
    const sourceEl = view.nodeDOM(sourcePos) as HTMLElement;
    const targetEl = view.nodeDOM(targetPos) as HTMLElement;
    sourceEl.getBoundingClientRect = () => rect(0, 100, 0, 100);
    targetEl.getBoundingClientRect = () => rect(0, 100, 200, 300);
    // The pointer is over the target (right half → insert after).
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
      () => targetEl;

    startMediaDrag({ editor, sourcePos, clientX: 280, clientY: 50 });
    expect(targetEl.classList.contains("media-merge-target")).toBe(true);

    window.dispatchEvent(new Event("pointerup"));

    const group = view.state.doc.child(1);
    expect(group.type.name).toBe("mediaGroup");
    const ids: string[] = [];
    group.forEach((child) => ids.push(String(child.attrs.attachmentId)));
    expect(ids).toEqual(["m2", "m1"]);
    expect(targetEl.classList.contains("media-merge-target")).toBe(false);
  });
});
