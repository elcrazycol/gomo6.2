// The extension pack the wall composer (P1) adds on top of GomoRichEditor.
// Kept separate from the generic editor so messaging/threads never see it.

import type { Extensions } from "@tiptap/core";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { LinkCardNode } from "../link/LinkCardNode";
import { MediaBlockNode } from "./MediaBlockNode";
import { MediaGroupNode } from "./MediaGroupNode";
import { UploadPlaceholderNode } from "./UploadPlaceholderNode";

export const mediaExtensions: Extensions = [
  MediaBlockNode,
  MediaGroupNode,
  UploadPlaceholderNode,
  LinkCardNode,
  // Enabled for the wall composer (the generic editor keeps it off) so the
  // slash menu can insert a divider.
  HorizontalRule,
];
