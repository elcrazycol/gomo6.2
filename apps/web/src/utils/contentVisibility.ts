import { supabase } from "@/integrations/api/client_simple";

interface VisibilityOptions {
  currentUserId: string | null;
  isAdmin: boolean;
  currentUsername: string;
  postAuthorId?: string | null;
  authorUsername?: string;
}

export interface VisibilityResult {
  processedContent: string;
  isHidden: boolean;
  hasHiddenParts: boolean; // True if some parts were hidden but content is not empty
  hiddenForUsers?: string[]; // User IDs who can't see
  visibleForUsers?: string[]; // User IDs who can see (if restricted)
  hiddenReason?: 'seeusers' | 'nousers' | 'adm';
}

// Parse user identifiers from tag (nickname, ID, or account_number) and return both IDs and usernames
const parseUserIdentifiers = async (identifiers: string[]): Promise<{ userIds: string[]; usernames: string[] }> => {
  const userIds: string[] = [];
  const usernames: string[] = [];

  for (const identifier of identifiers) {
    const trimmed = identifier.trim();
    if (!trimmed) continue;

    // Remove @ if present
    const cleanId = trimmed.startsWith('@') ? trimmed.substring(1) : trimmed;

    // Check if it's a UUID
    if (cleanId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      userIds.push(cleanId);
      // Get username for this ID
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', cleanId)
        .single();
      if (data) {
        usernames.push(data.username);
      }
      continue;
    }

    // Check if it's a number (account_number)
    if (/^\d+$/.test(cleanId)) {
      const { data } = await supabase
        .from('profiles')
        .select('id, username')
        .eq('account_number', parseInt(cleanId))
        .single();
      
      if (data) {
        userIds.push(data.id);
        usernames.push(data.username);
      }
      continue;
    }

    // Otherwise, treat as username
    const { data } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('username', cleanId)
      .single();
    
    if (data) {
      userIds.push(data.id);
      usernames.push(data.username);
    }
  }

  return { userIds, usernames };
};

// Process visibility tags in content
export const processVisibilityTags = async (
  content: string,
  options: VisibilityOptions
): Promise<VisibilityResult> => {
  // If no content or no tags, return as-is
  if (!content || (!content.includes('[seeusers=') && !content.includes('[nousers=') && !content.includes('[adm]') && !content.includes('[dude]') && !content.includes('[me]'))) {
    return {
      processedContent: content,
      isHidden: false,
      hasHiddenParts: false
    };
  }

  let processed = content;
  const originalContent = content;
  let isHidden = false;
  let hasHiddenParts = false;
  const hiddenForUsers: string[] = [];
  let visibleForUsers: string[] = [];
  let hiddenReason: 'seeusers' | 'nousers' | 'adm' | undefined;

  // Process [dude][/dude] first - replace with special marker for current user
  processed = processed.replace(/\[dude\]\[\/dude\]/g, '__DUDE_LINK__');

  // Process [me]...[/me] - replace with special marker for post author
  processed = processed.replace(/\[me\](.*?)\[\/me\]/g, '__ME_LINK__$1__');

  // FIRST: Process all multiline (closed) tags

  // Process [adm]...[/adm] tag (multiline)
  processed = await processMultilineTag(
    processed,
    /\[adm\]/g,
    /\[\/adm\]/g,
    async () => options.isAdmin || options.currentUserId === options.postAuthorId,
    (hidden) => {
      if (hidden && !(options.isAdmin || options.currentUserId === options.postAuthorId)) {
        isHidden = true;
        hiddenReason = 'adm';
      }
    }
  );

  // Process [seeusers=...]...[/seeusers] tag (multiline)
  processed = await processMultilineTag(
    processed,
    /\[seeusers=([^\]]+)\]/g,
    /\[\/seeusers\]/g,
    async (identifiers: string) => {
      const parsed = await parseUserIdentifiers(identifiers.split(','));
      return options.currentUserId ? (
        parsed.userIds.includes(options.currentUserId) ||
        options.currentUserId === options.postAuthorId
      ) : false;
    },
    async (hidden, identifiers: string) => {
      if (hidden) {
        // This callback is called when content between tags is hidden
        // We don't set isHidden=true here because there might be other visible content
        const parsed = await parseUserIdentifiers(identifiers.split(','));
        if (!visibleForUsers.length) {
          visibleForUsers = [...parsed.userIds];
          if (options.postAuthorId) {
            visibleForUsers.push(options.postAuthorId);
          }
        }
        hiddenReason = 'seeusers';
        // Set isHidden only if the entire processed content becomes empty
        // This will be checked after all processing
      }
    }
  );

  // Process [nousers=...]...[/nousers] tag (multiline)
  processed = await processMultilineTag(
    processed,
    /\[nousers=([^\]]+)\]/g,
    /\[\/nousers\]/g,
    async (identifiers: string) => {
      const parsed = await parseUserIdentifiers(identifiers.split(','));
      return options.currentUserId ? !parsed.userIds.includes(options.currentUserId) : true;
    },
    async (hidden, identifiers: string) => {
      if (hidden && options.currentUserId) {
        const parsed = await parseUserIdentifiers(identifiers.split(','));
        hiddenForUsers.push(...parsed.userIds);
        hiddenReason = 'nousers';
      }
    }
  );

  // SECOND: Process unclosed tags (that affect everything after them)

  // Check for unclosed [seeusers] tag - if found, entire message after tag is restricted
  const seeUsersUnclosedRegex = /\[seeusers=([^\]]+)\]/g;
  const allSeeUsersMatches = Array.from(processed.matchAll(seeUsersUnclosedRegex));

  let hasUnclosedSeeUsers = false;
  let unclosedTagIndex = -1;
  let unclosedUserIds: string[] = [];
  let unclosedUsernames: string[] = [];

  for (const match of allSeeUsersMatches) {
    hasUnclosedSeeUsers = true;
    unclosedTagIndex = match.index!;
    const identifiers = match[1];
    const parsed = await parseUserIdentifiers(identifiers.split(','));
    unclosedUserIds = parsed.userIds;
    unclosedUsernames = parsed.usernames;
    break; // Only process the first unclosed tag
  }

  // If unclosed [seeusers] tag exists, everything after it is restricted
  if (hasUnclosedSeeUsers && unclosedTagIndex !== -1) {
    const canSee = options.currentUserId && (
      unclosedUserIds.includes(options.currentUserId) ||
      options.currentUserId === options.postAuthorId
    );

    // Find the tag end position
    const tagMatch = processed.substring(unclosedTagIndex).match(/\[seeusers=[^\]]+\]/);
    const tagEnd = unclosedTagIndex + (tagMatch ? tagMatch[0].length : 0);

    if (!canSee) {
      // Hide everything after the tag (including the tag itself in display)
      const contentBeforeTag = processed.substring(0, unclosedTagIndex);
      processed = contentBeforeTag;
      isHidden = true;
      visibleForUsers = [...unclosedUserIds];
      if (options.postAuthorId) {
        visibleForUsers.push(options.postAuthorId);
      }
      hiddenReason = 'seeusers';
    } else {
      // User can see - remove the tag but keep all content after it
      processed = processed.substring(0, unclosedTagIndex) + processed.substring(tagEnd);
    }
  }

  // Process [adm] message (single line - until space/newline or end)
  const admSingleRegex = /\[adm\]/g;
  let admMatch;
  while ((admMatch = admSingleRegex.exec(processed)) !== null) {
    const tagStart = admMatch.index;
    const tagEnd = tagStart + admMatch[0].length;
    
    if (options.isAdmin) {
      // Remove tag, keep content
      processed = processed.substring(0, tagStart) + processed.substring(tagEnd);
      admSingleRegex.lastIndex = tagStart;
    } else {
      // Remove tag and content until space/newline or end
      const afterTag = processed.substring(tagEnd);
      const nextBreak = Math.min(
        afterTag.indexOf(' ') !== -1 ? afterTag.indexOf(' ') : afterTag.length,
        afterTag.indexOf('\n') !== -1 ? afterTag.indexOf('\n') : afterTag.length
      );
      
      processed = processed.substring(0, tagStart) + processed.substring(tagEnd + nextBreak);
      admSingleRegex.lastIndex = tagStart;
      isHidden = true;
      hiddenReason = 'adm';
    }
  }


  // Determine if content has hidden parts (contains markers)
  hasHiddenParts = processed.includes('__HIDDEN_CONTENT_') && processed.trim() !== '';

  // If processed content is empty, mark as hidden
  const finalIsHidden = isHidden || (!processed || processed.trim() === '');
  return {
    processedContent: processed,
    isHidden: finalIsHidden,
    hasHiddenParts,
    hiddenForUsers: hiddenForUsers.length > 0 ? hiddenForUsers : undefined,
    visibleForUsers: visibleForUsers.length > 0 ? visibleForUsers : undefined,
    hiddenReason
  };
};

// Helper to process multiline tags like [tag=value]...[/tag]
async function processMultilineTag(
  content: string,
  openTagRegex: RegExp,
  closeTagRegex: RegExp,
  checkVisibility: (value: string) => Promise<boolean>,
  onHidden?: (hidden: boolean, value: string) => Promise<void>
): Promise<string> {
  let result = content;

  // Find all opening tags
  const openMatches = Array.from(result.matchAll(openTagRegex));

  // Process from end to start to preserve indices
  for (let i = openMatches.length - 1; i >= 0; i--) {
    const openMatch = openMatches[i];
    const openStart = openMatch.index!;
    const openEnd = openStart + openMatch[0].length;
    const value = openMatch[1] || '';

    // Find closing tag after this opening tag
    const afterOpen = result.substring(openEnd);
    // Find closing tag using the regex source to determine the tag type
    let closeTagText = '';
    let hiddenReason: 'seeusers' | 'nousers' | 'adm' = 'adm';
    if (closeTagRegex.source.includes('adm')) {
      closeTagText = '[/adm]';
      hiddenReason = 'adm';
    } else if (closeTagRegex.source.includes('seeusers')) {
      closeTagText = '[/seeusers]';
      hiddenReason = 'seeusers';
    } else if (closeTagRegex.source.includes('nousers')) {
      closeTagText = '[/nousers]';
      hiddenReason = 'nousers';
    }

    const closeTagIndex = afterOpen.indexOf(closeTagText);

    if (closeTagIndex !== -1) {
      const closeStart = openEnd + closeTagIndex;
      const closeEnd = closeStart + closeTagText.length;

      const shouldShow = await checkVisibility(value);

      if (shouldShow) {
        // Show content - remove both tags but keep content between them
        const contentBetween = result.substring(openEnd, closeStart);
        result = result.substring(0, openStart) + contentBetween + result.substring(closeEnd);
      } else {
        // Hide content - replace with inline marker
        // Get usernames for the marker
        const parsed = await parseUserIdentifiers(value.split(','));
        const usernamesStr = parsed.usernames.join(',');
        const marker = `__HIDDEN_CONTENT_${hiddenReason}_${usernamesStr}__`;
        result = result.substring(0, openStart) + marker + result.substring(closeEnd);
        if (onHidden) {
          await onHidden(true, value);
        }
      }
    }
  }

  return result;
}
