import React from 'react';
import { render } from '@bbob/react';
import presetReact from '@bbob/preset-react';
import { getUniqAttr } from '@bbob/plugin-helper';
import { CensorBlur } from '@/components/CensorBlur';
import { BbCodeSpoiler } from '@/components/BbCodeSpoiler';
import { EmojiInline } from '@/components/EmojiInline';
import { MentionLink } from '@/components/MentionLink';
import { LinkButton } from '@/components/LinkButton';

// Process text for emojis, mentions, URLs, and markdown
const processTextContent = (text: string, keyPrefix: string = 'bb'): React.ReactNode[] => {
  if (!text) return [];
  
  const elements: React.ReactNode[] = [];
  let key = 0;
  
  // Split by emojis, mentions, URLs, markdown formatting
  const regex = /(\*\*.*?\*\*|\*[^*].*?\*|:[^:\s]+:|@[^\s]+|https?:\/\/[^\s]+)/g;
  const parts = text.split(regex);
  
  for (const part of parts) {
    if (!part) continue;
    
    // Markdown bold **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      elements.push(
        <strong key={`${keyPrefix}-md-bold-${key++}`} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Markdown italic *text* (but not **text**)
    else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**') && part.length > 2) {
      elements.push(
        <em key={`${keyPrefix}-md-italic-${key++}`} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    // Emoji :code:
    else if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
      const emojiCode = part.slice(1, -1);
      elements.push(
        <EmojiInline key={`${keyPrefix}-emoji-${key++}`} code={emojiCode} />
      );
    }
    // Mention @username
    else if (part.startsWith('@')) {
      const username = part.substring(1);
      elements.push(
        <MentionLink key={`${keyPrefix}-mention-${key++}`} username={username} />
      );
    }
    // URL
    else if (part.match(/^https?:\/\/[^\s]+$/)) {
      elements.push(
        <LinkButton key={`${keyPrefix}-link-${key++}`} url={part} />
      );
    }
    // Regular text
    else {
      elements.push(<React.Fragment key={`${keyPrefix}-text-${key++}`}>{part}</React.Fragment>);
    }
  }
  
  return elements;
};

// Recursively process React nodes to handle text content
const processReactNodes = (node: React.ReactNode, keyPrefix: string, index: number = 0): React.ReactNode => {
  if (node === null || node === undefined) {
    return null;
  }
  
  if (typeof node === 'string') {
    const processed = processTextContent(node, `${keyPrefix}-${index}`);
    if (processed.length === 0) return null;
    if (processed.length === 1) return processed[0];
    return <React.Fragment key={`${keyPrefix}-frag-${index}`}>{processed}</React.Fragment>;
  }
  
  if (typeof node === 'number' || typeof node === 'boolean') {
    return node;
  }
  
  if (Array.isArray(node)) {
    return node.map((item, idx) => {
      const processed = processReactNodes(item, `${keyPrefix}-arr`, idx);
      return processed !== null ? processed : null;
    }).filter(item => item !== null);
  }
  
  if (React.isValidElement(node)) {
    const { children, ...props } = node.props;
    const baseProps = { ...props, key: node.key || `${keyPrefix}-el-${index}` } as Record<string, unknown> & { key: React.Key };
    
    // For BbCodeSpoiler and CensorBlur, process children but keep component structure
    if (node.type === BbCodeSpoiler || node.type === CensorBlur) {
      if (children === undefined || children === null) {
        return React.cloneElement(node, baseProps);
      }
      
      const processedChildren = Array.isArray(children)
        ? children.map((child, idx) => processReactNodes(child, `${keyPrefix}-child`, idx)).filter(item => item !== null)
        : processReactNodes(children, `${keyPrefix}-child`, 0);
      
      return React.cloneElement(
        node,
        baseProps,
        processedChildren
      );
    }
    
    if (children === undefined || children === null) {
      return React.cloneElement(node, baseProps);
    }
    
    const processedChildren = Array.isArray(children)
      ? children.map((child, idx) => processReactNodes(child, `${keyPrefix}-child`, idx)).filter(item => item !== null)
      : processReactNodes(children, `${keyPrefix}-child`, 0);
    
    return React.cloneElement(
      node,
      baseProps,
      processedChildren
    );
  }
  
  return node;
};

// Create custom preset with all BB tags
export const createCustomBbPreset = (options?: {
  currentUserId?: string | null;
  currentUsername?: string;
  currentUserColor?: string;
  postAuthorId?: string | null;
  authorUsername?: string;
  authorColor?: string;
  keyPrefix?: string;
}) => {
  const {
    currentUserId,
    currentUsername,
    currentUserColor,
    postAuthorId,
    authorUsername,
    authorColor,
    keyPrefix = 'bb'
  } = options || {};

  return presetReact.extend((tags) => ({
    ...tags,
    // Bold - case insensitive
    b: (node) => ({
      tag: 'strong',
      attrs: { className: 'font-bold' },
      content: node.content
    }),
    // Italic - case insensitive
    i: (node) => ({
      tag: 'em',
      attrs: { className: 'italic' },
      content: node.content
    }),
    // Underline - case insensitive
    u: (node) => ({
      tag: 'u',
      content: node.content
    }),
    // Strikethrough - case insensitive
    s: (node) => ({
      tag: 's',
      content: node.content
    }),
    // Color [col=#color] or [col=color]
    col: (node) => {
      let color = '';
      if (node.attrs && typeof node.attrs === 'object') {
        const attrs = node.attrs as Record<string, unknown>;
        color = String(attrs.col || attrs.color || attrs.value || '');
        if (!color) {
          color = String(getUniqAttr(node.attrs) || '');
        }
      }
      color = String(color || '').trim();
      return {
        tag: 'span',
        attrs: { style: { color: color || 'inherit' } },
        content: node.content
      };
    },
    // Size [size=1-7]
    size: (node) => {
      let sizeValue = '';
      if (node.attrs && typeof node.attrs === 'object') {
        const attrs = node.attrs as Record<string, unknown>;
        sizeValue = String(attrs.size || attrs.value || '');
        if (!sizeValue) {
          sizeValue = String(getUniqAttr(node.attrs) || '3');
        }
      }
      const raw = parseInt(String(sizeValue || '3').trim(), 10);
      const clamped = Number.isFinite(raw) ? Math.min(7, Math.max(1, raw)) : 3;
      const sizeEm = 0.75 + (clamped - 1) * 0.175;
      return {
        tag: 'span',
        attrs: { style: { fontSize: `${sizeEm}em` } },
        content: node.content
      };
    },
    // Blur (CensorBlur)
    blur: (node) => ({
      tag: CensorBlur,
      content: node.content
    }),
    // Spoiler [SPOILER] or [SPOILER=title] - case insensitive
    spoiler: (node) => {
      let title = '';
      if (node.attrs && typeof node.attrs === 'object') {
        const attrs = node.attrs as Record<string, unknown>;
        title = String(attrs.spoiler || attrs.title || attrs.value || '');
        if (!title) {
          title = String(getUniqAttr(node.attrs) || '');
        }
      }
      title = String(title || '').trim() || null;
      
      // @bbob/react will call React.createElement(tag, attrs, children)
      // So we pass the component directly and attrs with title
      return {
        tag: BbCodeSpoiler,
        attrs: title ? { title } : {},
        content: node.content
      };
    },
    // Line break [br]
    br: () => ({
      tag: 'br'
    }),
    // [me] tag - highlight for post author
    me: (node) => {
      const colorClasses: Record<string, string> = {
        purple: 'text-purple-500 font-bold',
        gold: 'text-yellow-500 font-bold',
        orange: 'text-orange-500 font-bold',
        red: 'text-red-500 font-bold',
        blue: 'text-blue-500 font-bold',
        green: 'text-green-500 font-bold',
        yellow: 'text-yellow-400 font-bold',
        cyan: 'text-cyan-500 font-bold',
      };
      
      const colorClass = authorColor ? colorClasses[authorColor] : 'text-quote font-bold';
      
      return {
        tag: 'span',
        attrs: { 
          className: colorClass,
          style: postAuthorId ? { cursor: 'pointer' } : undefined
        },
        content: node.content
      };
    },
    // [dude] tag - highlight for current user
    dude: (node) => {
      const colorClasses: Record<string, string> = {
        purple: 'text-purple-500 font-bold',
        gold: 'text-yellow-500 font-bold',
        orange: 'text-orange-500 font-bold',
        red: 'text-red-500 font-bold',
        blue: 'text-blue-500 font-bold',
        green: 'text-green-500 font-bold',
        yellow: 'text-yellow-400 font-bold',
        cyan: 'text-cyan-500 font-bold',
      };
      
      const colorClass = currentUserColor ? colorClasses[currentUserColor] : 'text-quote font-bold';
      
      return {
        tag: 'span',
        attrs: { 
          className: colorClass,
          style: currentUserId ? { cursor: 'pointer' } : undefined
        },
        content: node.content
      };
    },
  }));
};

// Main function to render BB code with all processing
export const renderBbCode = (text: string, options?: {
  currentUserId?: string | null;
  currentUsername?: string;
  currentUserColor?: string;
  postAuthorId?: string | null;
  authorUsername?: string;
  authorColor?: string;
  keyPrefix?: string;
}): React.ReactNode => {
  if (!text) return null;

  // Process line breaks - replace \n with [br] tag for BB code processing
  const processedText = text.replace(/\n/g, '[br]');

  const presetFactory = createCustomBbPreset(options);
  const preset = presetFactory();

  // Render BB code using @bbob/react render function (returns array)
  const renderedArray = render(processedText, preset, { caseFreeTags: true });
  
  if (!renderedArray || renderedArray.length === 0) {
    return null;
  }
  
  // Process each node in the array
  const processed = renderedArray.map((node, idx) => 
    processReactNodes(node, options?.keyPrefix || 'bb', idx)
  ).filter(item => item !== null);
  
  if (processed.length === 0) {
    return null;
  }
  
  if (processed.length === 1) {
    return processed[0];
  }
  
  return <React.Fragment>{processed}</React.Fragment>;
};
