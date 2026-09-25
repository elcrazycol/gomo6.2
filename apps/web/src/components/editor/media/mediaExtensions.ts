// The extension pack the wall composer (P1) adds on top of GomoRichEditor.
// Kept separate from the generic editor so messaging/threads never see it.

import type { Extensions } from "@tiptap/core";
import { MediaBlockNode } from "./MediaBlockNode";
import { UploadPlaceholderNode } from "./UploadPlaceholderNode";

export const mediaExtensions: Extensions = [MediaBlockNode, UploadPlaceholderNode];
