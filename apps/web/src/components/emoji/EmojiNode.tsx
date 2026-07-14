import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { DecoratorNode } from 'lexical';
import React from 'react';

export type SerializedEmojiNode = Spread<
  {
    type: 'emoji';
    version: 1;
    emojiId: string;
    packId: string;
    url: string;
    name: string;
  },
  SerializedLexicalNode
>;

function EmojiComponent({ emojiId, url, name }: { emojiId: string; url: string; name: string }) {
  return (
    <img
      src={url}
      alt={name}
      className="inline-block h-[1.2em] w-auto align-middle mx-0.5 cursor-default"
      title={`:${name}:`}
      draggable={false}
    />
  );
}

export class EmojiNode extends DecoratorNode<React.ReactNode> {
  __emojiId: string;
  __packId: string;
  __url: string;
  __name: string;

  static getType(): string {
    return 'emoji';
  }

  static clone(node: EmojiNode): EmojiNode {
    return new EmojiNode(node.__emojiId, node.__packId, node.__url, node.__name, node.__key);
  }

  constructor(emojiId: string, packId: string, url: string, name: string, key?: NodeKey) {
    super(key);
    this.__emojiId = emojiId;
    this.__packId = packId;
    this.__url = url;
    this.__name = name;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.className = 'inline-flex items-center';
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactNode {
    return (
      <EmojiComponent
        emojiId={this.__emojiId}
        url={this.__url}
        name={this.__name}
      />
    );
  }

  exportJSON(): SerializedEmojiNode {
    return {
      type: 'emoji',
      version: 1,
      emojiId: this.__emojiId,
      packId: this.__packId,
      url: this.__url,
      name: this.__name,
    };
  }

  static importJSON(serializedNode: SerializedEmojiNode): EmojiNode {
    const { emojiId, packId, url, name } = serializedNode;
    return new EmojiNode(emojiId, packId, url, name);
  }

  getTextContent(): string {
    return `[e:${this.__emojiId}]`;
  }

  isInline(): boolean {
    return true;
  }

  isIsolated(): boolean {
    return true;
  }
}

export function $createEmojiNode(data: { emojiId: string; packId: string; url: string; name: string }): EmojiNode {
  return new EmojiNode(data.emojiId, data.packId, data.url, data.name);
}

export function $isEmojiNode(node: LexicalNode | null | undefined): node is EmojiNode {
  return node instanceof EmojiNode;
}
