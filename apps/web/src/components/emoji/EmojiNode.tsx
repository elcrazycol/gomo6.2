import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread, ElementFormatType } from 'lexical';
import { ElementNode } from 'lexical';

export type SerializedEmojiNode = Spread<
  {
    type: 'emoji';
    version: 1;
    emojiId: string;
    packId: string;
    url: string;
    name: string;
    children: SerializedLexicalNode[];
    direction: 'ltr' | 'rtl';
    format: ElementFormatType;
    indent: number;
  },
  SerializedLexicalNode
>;

export class EmojiNode extends ElementNode {
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

  createDOM(_config: EditorConfig): HTMLElement {
    const img = document.createElement('img');
    img.src = this.__url;
    img.alt = this.__name;
    img.className = 'inline-block align-middle mx-0.5 cursor-default';
    img.style.height = '1.2em';
    img.style.width = 'auto';
    img.style.verticalAlign = 'middle';
    img.draggable = false;
    return img;
  }

  updateDOM(prevNode: this, dom: HTMLElement): boolean {
    if (prevNode.__url !== this.__url) {
      (dom as HTMLImageElement).src = this.__url;
    }
    if (prevNode.__name !== this.__name) {
      (dom as HTMLImageElement).alt = this.__name;
    }
    return false;
  }

  exportJSON(): SerializedEmojiNode {
    return {
      type: 'emoji',
      version: 1,
      emojiId: this.__emojiId,
      packId: this.__packId,
      url: this.__url,
      name: this.__name,
      children: [],
      direction: 'ltr',
      format: '' as ElementFormatType,
      indent: 0,
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
    return false;
  }
}

export function $createEmojiNode(data: { emojiId: string; packId: string; url: string; name: string }): EmojiNode {
  return new EmojiNode(data.emojiId, data.packId, data.url, data.name);
}

export function $isEmojiNode(node: LexicalNode | null | undefined): node is EmojiNode {
  return node instanceof EmojiNode;
}
