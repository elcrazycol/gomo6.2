import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { EditorState } from "@tiptap/pm/state";

import { MediaBlockNode } from "./MediaBlockNode";
import { UploadPlaceholderNode } from "./UploadPlaceholderNode";
import {
  findNodePos,
  moveNodeToPos,
  moveTransaction,
  removePlaceholderTransaction,
  replacePlaceholderTransaction,
  resolveDropPosition,
  updatePlaceholderTransaction,
} from "./mediaCommands";
import { DEFAULT_MEDIA_BLOCK_ATTRS, MEDIA_BLOCK_NODE } from "./mediaSchema";

const schema = getSchema([Document, Paragraph, Text, MediaBlockNode, UploadPlaceholderNode]);

type JSONNode = Record<string, unknown>;
const text = (value: string): JSONNode => ({ type: "text", text: value });
const paragraphWith = (...inline: JSONNode[]): JSONNode => ({ type: "paragraph", content: inline });
const media = (attachmentId: string): JSONNode => ({ type: "mediaBlock", attrs: { attachmentId } });
const placeholder = (uploadId: string): JSONNode => ({ type: "uploadPlaceholder", attrs: { uploadId } });

const makeState = (content: JSONNode[]): EditorState =>
  EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }) });

/** ["paragraph1 inline...", "paragraph2 inline..."] as readable strings. */
const snapshot = (state: EditorState): string[][] => {
  const out: string[][] = [];
  state.doc.forEach((block) => {
    const inner: string[] = [];
    block.forEach((node) => {
      inner.push(node.type.name === MEDIA_BLOCK_NODE ? `media:${node.attrs.attachmentId}` : node.type.name);
    });
    out.push(inner);
  });
  return out;
};

const mediaAttrs = (attachmentId: string) => ({ ...DEFAULT_MEDIA_BLOCK_ATTRS, attachmentId });

describe("mediaCommands", () => {
  it("finds an inline media node by attachment id", () => {
    const state = makeState([paragraphWith(text("a"), media("m1"), media("m2"))]);
    const pos = findNodePos(state.doc, MEDIA_BLOCK_NODE, (node) => node.attrs.attachmentId === "m2");
    expect(pos).not.toBeNull();
    expect(state.doc.nodeAt(pos as number)?.attrs.attachmentId).toBe("m2");
  });

  it("swaps two media nodes inside a paragraph (horizontal move)", () => {
    const state = makeState([paragraphWith(media("m1"), media("m2"))]);
    const pos = findNodePos(state.doc, MEDIA_BLOCK_NODE, (n) => n.attrs.attachmentId === "m1") as number;
    const tr = moveTransaction(state, pos, "down");
    expect(tr).not.toBeNull();
    expect(snapshot(state.apply(tr!))).toEqual([["media:m2", "media:m1"]]);
  });

  it("swaps a media node with surrounding text", () => {
    const state = makeState([paragraphWith(text("hi"), media("m1"))]);
    const pos = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    const tr = moveTransaction(state, pos, "up");
    expect(snapshot(state.apply(tr!))).toEqual([["media:m1", "text"]]);
  });

  it("hops to the end of the previous block at the paragraph edge", () => {
    const state = makeState([paragraphWith(text("a")), paragraphWith(media("m1"))]);
    const pos = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    const tr = moveTransaction(state, pos, "up");
    expect(tr).not.toBeNull();
    expect(snapshot(state.apply(tr!))).toEqual([["text", "media:m1"], []]);
  });

  it("refuses to move when there is nowhere to go", () => {
    const state = makeState([paragraphWith(media("m1"))]);
    const pos = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    expect(moveTransaction(state, pos, "up")).toBeNull();
    expect(moveTransaction(state, pos, "down")).toBeNull();
  });

  it("replaces a placeholder with a real media node (not in history)", () => {
    const state = makeState([paragraphWith(text("a"), placeholder("u1"))]);
    const tr = replacePlaceholderTransaction(state, "u1", mediaAttrs("att_9"));
    expect(tr).not.toBeNull();
    expect(tr!.getMeta("addToHistory")).toBe(false);
    expect(snapshot(state.apply(tr!))).toEqual([["text", "media:att_9"]]);
  });

  it("returns null when replacing an unknown placeholder", () => {
    const state = makeState([paragraphWith(text("a"))]);
    expect(replacePlaceholderTransaction(state, "nope", mediaAttrs("x"))).toBeNull();
  });

  it("updates placeholder progress attributes", () => {
    const state = makeState([paragraphWith(placeholder("u1"))]);
    const tr = updatePlaceholderTransaction(state, "u1", { percent: 42, phase: "processing" });
    const next = state.apply(tr!);
    expect(next.doc.firstChild?.firstChild?.attrs.percent).toBe(42);
    expect(next.doc.firstChild?.firstChild?.attrs.phase).toBe("processing");
  });

  it("removes a placeholder", () => {
    const state = makeState([paragraphWith(text("a"), placeholder("u1"))]);
    const tr = removePlaceholderTransaction(state, "u1");
    expect(snapshot(state.apply(tr!))).toEqual([["text"]]);
  });

  it("drops a media node inline when the target is inside a line", () => {
    const state = makeState([paragraphWith(text("hello")), paragraphWith(media("m1"))]);
    const source = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    // Offset 2 inside "hello" (content starts at position 1).
    const target = 3;
    const tr = moveNodeToPos(state, source, target);
    expect(tr).not.toBeNull();
    expect(snapshot(state.apply(tr!))).toEqual([["text", "media:m1", "text"], []]);
  });

  it("drops a media node on its own line when the target is a block gap", () => {
    const state = makeState([paragraphWith(text("a"), media("m1")), paragraphWith(text("b"))]);
    const source = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    // Boundary between the two paragraphs (end of the first block).
    const boundary = state.doc.child(0).nodeSize;
    const tr = moveNodeToPos(state, source, boundary);
    expect(tr).not.toBeNull();
    expect(snapshot(state.apply(tr!))).toEqual([["text"], ["media:m1"], ["text"]]);
  });

  it("drops a media node on its own line when released at the end of a text line", () => {
    const state = makeState([paragraphWith(media("m1")), paragraphWith(text("hi"))]);
    const source = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    // End of the "hi" line (content starts at 4, length 2).
    const endOfLine = 6;
    const tr = moveNodeToPos(state, source, endOfLine);
    expect(tr).not.toBeNull();
    expect(snapshot(state.apply(tr!))).toEqual([[], ["text"], ["media:m1"]]);
  });

  it("refuses to drop a media node onto itself", () => {
    const state = makeState([paragraphWith(media("m1"))]);
    const source = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    expect(moveNodeToPos(state, source, source)).toBeNull();
  });

  it("resolves an empty line to that very line (not the boundary below)", () => {
    const doc = makeState([paragraphWith(), paragraphWith(text("x"))]).doc;
    // Position at the start of the empty first paragraph.
    expect(resolveDropPosition(doc, 1)).toEqual({ pos: 1, ownParagraph: false });
    // A boundary right after the empty paragraph also lands inside it.
    expect(resolveDropPosition(doc, 2)).toEqual({ pos: 1, ownParagraph: false });
  });

  it("moves a media node into an empty line", () => {
    const state = makeState([paragraphWith(), paragraphWith(media("m1"))]);
    const source = findNodePos(state.doc, MEDIA_BLOCK_NODE) as number;
    const tr = moveNodeToPos(state, source, 1);
    expect(tr).not.toBeNull();
    expect(snapshot(state.apply(tr!))).toEqual([["media:m1"], []]);
  });
});
