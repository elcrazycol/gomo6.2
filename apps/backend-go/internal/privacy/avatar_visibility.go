package privacy

import (
	"database/sql"
)

// HiddenAvatarIDs resolves, in at most two queries, the subset of targetIDs
// whose avatar_url must not be served to viewerID.
//
// The author's private_hide_avatar applies on public AND private profiles
// alike: the avatar is visible only to the author themselves and to mutual
// friends. Everyone else — including guests — must not receive it, on any
// surface (profiles, feeds, walls, likes, search, previews, member lists).
//
// Callers pass the author ids of rows that actually carry an avatar (rows
// without one need no lookup — an empty list issues no queries) and nil out
// the avatar URL for every returned id.
//
// Fail-closed: a resolution error is returned and the caller must abort
// rather than serve unfiltered rows (same contract as the profile list
// endpoints, which 500 when the visibility load fails).
func HiddenAvatarIDs(db *sql.DB, viewerID string, targetIDs []string) (map[string]bool, error) {
	vis, err := ResolveProfileVisibilityBatch(db, viewerID, targetIDs)
	if err != nil {
		return nil, err
	}
	hidden := make(map[string]bool, len(targetIDs))
	for id, v := range vis {
		if v.HideAvatar {
			hidden[id] = true
		}
	}
	return hidden, nil
}

// StripHiddenAvatars nils out the entries of avatars (parallel to userIDs)
// hidden from viewerID — private_hide_avatar on a public or private profile,
// with the author and mutual friends exempt. Only ids that actually carry an
// avatar trigger the visibility lookup, so an all-avatarless page issues no
// extra queries. Fail-closed: a resolution error is returned and the caller
// must abort rather than serve unfiltered rows.
func StripHiddenAvatars(db *sql.DB, viewerID string, userIDs []string, avatars []*string) error {
	var ids []string
	seen := make(map[string]struct{}, len(userIDs))
	for i, id := range userIDs {
		if i >= len(avatars) || avatars[i] == nil {
			continue
		}
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	hidden, err := HiddenAvatarIDs(db, viewerID, ids)
	if err != nil {
		return err
	}
	for i, id := range userIDs {
		if i < len(avatars) && hidden[id] {
			avatars[i] = nil
		}
	}
	return nil
}
