package handlers

import (
	"database/sql"
)

// PrivacySettings holds the private profile fields from privacy_settings table.
type PrivacySettings struct {
	PrivateProfile          bool
	PrivateHideAvatar       bool
	PrivateHideWall         bool
	PrivateHideThreads      bool
	PrivateHideStats        bool
	PrivateHideFriends      bool
	PrivateHideGifts        bool
	PrivateHideAchievements bool
}

// GetPrivacySettings loads private profile settings for a user.
func GetPrivacySettings(db *sql.DB, userID string) (*PrivacySettings, error) {
	var ps PrivacySettings
	err := db.QueryRow(`
		SELECT COALESCE(private_profile, false),
		       COALESCE(private_hide_avatar, true),
		       COALESCE(private_hide_wall, true),
		       COALESCE(private_hide_threads, true),
		       COALESCE(private_hide_stats, true),
		       COALESCE(private_hide_friends, true),
		       COALESCE(private_hide_gifts, true),
		       COALESCE(private_hide_achievements, true)
		FROM privacy_settings WHERE user_id = $1
	`, userID).Scan(
		&ps.PrivateProfile, &ps.PrivateHideAvatar, &ps.PrivateHideWall,
		&ps.PrivateHideThreads, &ps.PrivateHideStats, &ps.PrivateHideFriends,
		&ps.PrivateHideGifts, &ps.PrivateHideAchievements,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return &PrivacySettings{}, nil
		}
		return nil, err
	}
	return &ps, nil
}

// IsMutualFriend checks if viewerID and targetID are mutual friends.
func IsMutualFriend(db *sql.DB, viewerID, targetID string) (bool, error) {
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE (user1_id = $1 AND user2_id = $2)
			   OR (user1_id = $2 AND user2_id = $1)
		)
	`, viewerID, targetID).Scan(&exists)
	return exists, err
}

// ShouldFilterPrivateProfile returns true if the target user has private_profile enabled
// and the viewer is not the owner and not a mutual friend. Anonymous visitors
// (viewerID == "") are never the owner or a friend, so they must be filtered:
// previously an empty viewer was treated as "no filtering", which let anonymous
// clients read the bio/garma/last_seen of private profiles in full.
func ShouldFilterPrivateProfile(db *sql.DB, viewerID, targetID string) (bool, *PrivacySettings, error) {
	ps, err := GetPrivacySettings(db, targetID)
	if err != nil {
		return false, nil, err
	}
	if !ps.PrivateProfile {
		return false, ps, nil
	}
	// Only the profile owner may view it in full; an empty viewer (anonymous)
	// or any non-friend is filtered.
	if viewerID != "" && viewerID == targetID {
		return false, ps, nil
	}
	if viewerID == "" {
		return true, ps, nil
	}
	isFriend, err := IsMutualFriend(db, viewerID, targetID)
	if err != nil {
		return false, ps, err
	}
	if isFriend {
		return false, ps, nil
	}
	return true, ps, nil
}

// CanViewUserContent returns true if the viewer can see the target user's content.
// Returns true if: profile is not private, viewer is empty/owner, or viewer is mutual friend.
func CanViewUserContent(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	shouldFilter, _, err := ShouldFilterPrivateProfile(db, viewerID, targetUserID)
	if err != nil {
		return false, err
	}
	return !shouldFilter, nil
}

// CanViewUserAchievements applies both profile visibility and the dedicated
// private_hide_achievements setting. A visible profile does not implicitly
// make the user's achievement history public.
func CanViewUserAchievements(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	settings, err := GetPrivacySettings(db, targetUserID)
	if err != nil {
		return false, err
	}
	if viewerID == targetUserID {
		return true, nil
	}
	if settings.PrivateHideAchievements {
		return false, nil
	}
	if !settings.PrivateProfile {
		return true, nil
	}
	if viewerID == "" {
		return false, nil
	}
	return IsMutualFriend(db, viewerID, targetUserID)
}

// CanViewUserGifts applies both profile visibility and the dedicated
// private_hide_gifts setting, mirroring CanViewUserAchievements. A public
// profile that hides gifts must still keep them from non-friends.
func CanViewUserGifts(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	settings, err := GetPrivacySettings(db, targetUserID)
	if err != nil {
		return false, err
	}
	if viewerID == targetUserID {
		return true, nil
	}
	if settings.PrivateHideGifts {
		return false, nil
	}
	if !settings.PrivateProfile {
		return true, nil
	}
	if viewerID == "" {
		return false, nil
	}
	return IsMutualFriend(db, viewerID, targetUserID)
}
