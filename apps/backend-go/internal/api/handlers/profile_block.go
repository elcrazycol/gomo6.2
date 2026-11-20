package handlers

import (
	"time"

	"github.com/gomo6/backend/internal/models"
)

// blockedLastSeenAge is the fake last-seen served for a profile whose owner
// blocked the viewer. It must stay comfortably above the client's "был(а)
// давно" threshold (7 days), because that phrase is exactly what a blocked
// viewer is supposed to see — the real activity time must never leak.
const blockedLastSeenAge = 30 * 24 * time.Hour

// hideBlockedProfile turns a profile row into the empty shell a viewer sees
// when its owner blocked them.
//
// Kept fields (the bare identity a client needs to render the row): id,
// public_id, username, display_name, created_at, is_remote/is_anonymous/
// is_service. Everything else — avatar, background, theme, bio, nickname
// emoji, counters, garma, email, online state — is stripped. Presence becomes
// a last-seen older than a week so every surface renders «был(а) давно», the
// same phrase used for accounts that have been gone for a long time.
//
// The shape intentionally does not carry a reason: ContentHidden is a neutral
// flag, so a client (or a curious user reading the network tab) learns "this
// profile has no content", never "you are blocked".
func hideBlockedProfile(p *models.User) {
	if p == nil {
		return
	}
	p.AvatarURL = nil
	p.AvatarAnimated = false
	p.BackgroundURL = nil
	p.BackgroundVariant = "banner"
	p.ThemeEnabled = false
	p.ThemeTokens = nil
	p.Bio = nil
	p.BioJSON = nil
	p.Email = nil
	p.NicknameEmojiID = nil
	p.Garma = nil
	p.Drops = nil
	p.PostCount = nil
	p.ThreadCount = nil
	p.WallPostCount = nil
	p.CommentCount = nil
	p.LikesReceivedCount = nil
	p.LikesGivenCount = nil
	p.ViewsReceivedCount = nil
	p.IsOnline = false
	fakeLastSeen := time.Now().UTC().Add(-blockedLastSeenAge)
	p.LastSeen = &fakeLastSeen
	p.ContentHidden = true
}
