package handlers

import (
	"database/sql"
)

// PrivacySettings holds the private profile fields from privacy_settings table.
type PrivacySettings struct {
	PrivateProfile     bool
	PrivateHideAvatar  bool
	PrivateHideWall    bool
	PrivateHideThreads bool
	PrivateHideStats   bool
	PrivateHideFriends bool
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
		       COALESCE(private_hide_friends, true)
		FROM privacy_settings WHERE user_id = $1
	`, userID).Scan(
		&ps.PrivateProfile, &ps.PrivateHideAvatar, &ps.PrivateHideWall,
		&ps.PrivateHideThreads, &ps.PrivateHideStats, &ps.PrivateHideFriends,
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
// and the viewer is not the owner and not a mutual friend.
func ShouldFilterPrivateProfile(db *sql.DB, viewerID, targetID string) (bool, *PrivacySettings, error) {
	ps, err := GetPrivacySettings(db, targetID)
	if err != nil {
		return false, nil, err
	}
	if !ps.PrivateProfile {
		return false, ps, nil
	}
	if viewerID == "" || viewerID == targetID {
		return false, ps, nil
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
