/**
 * Mention parsing (A9).
 *
 * A mention is @ followed by a member's name with the spaces removed, matched
 * case-insensitively: "@AliKhan" refers to Ali Khan. Anything that matches nobody is
 * ignored rather than reported, because people write @ in prose.
 */

export interface MentionCandidate {
  userId: string;
  name: string;
}

const MENTION_PATTERN = /@([\p{L}\p{N}_-]+)/gu;

/** Returns the ids of members named in the text, without duplicates. */
export function findMentionedUserIds(body: string, members: MentionCandidate[]): string[] {
  const byHandle = new Map<string, string>();

  for (const member of members) {
    byHandle.set(toHandle(member.name), member.userId);
  }

  const mentioned = new Set<string>();

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const handle = match[1];
    if (!handle) continue;

    const userId = byHandle.get(handle.toLowerCase());
    if (userId) mentioned.add(userId);
  }

  return [...mentioned];
}

function toHandle(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}
