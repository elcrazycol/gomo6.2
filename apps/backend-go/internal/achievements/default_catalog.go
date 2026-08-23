package achievements

// Default returns the production catalog. It is validated at construction;
// a bad definition fails fast on startup instead of silently misbehaving.
func Default() (*Catalog, error) {
	return NewCatalog([]*Group{
		// ── Content (unified model: threads + wall posts, comments, likes) ──
		{
			Key: "entries", TitleKey: "achievements.entries.title", Category: CategoryContent,
			Icon: "message-square", Type: TypeProgressive, Stat: StatCounter, SortOrder: 1,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.entries.1.name", DescriptionKey: "achievements.entries.1.description", Rarity: "common", RewardType: "garma", RewardValue: "10"},
				{Level: 2, Threshold: 50, NameKey: "achievements.entries.2.name", DescriptionKey: "achievements.entries.2.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "50"},
				{Level: 3, Threshold: 500, NameKey: "achievements.entries.3.name", DescriptionKey: "achievements.entries.3.description", Rarity: "rare", RewardType: "garma", RewardValue: "200"},
				{Level: 4, Threshold: 2500, NameKey: "achievements.entries.4.name", DescriptionKey: "achievements.entries.4.description", Rarity: "epic", RewardType: "garma", RewardValue: "1000"},
				{Level: 5, Threshold: 10000, NameKey: "achievements.entries.5.name", DescriptionKey: "achievements.entries.5.description", Rarity: "legendary", RewardType: "garma", RewardValue: "5000"},
			},
		},
		{
			Key: "comments", TitleKey: "achievements.comments.title", Category: CategoryContent,
			Icon: "message-circle", Type: TypeProgressive, Stat: StatCounter, SortOrder: 2,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.comments.1.name", DescriptionKey: "achievements.comments.1.description", Rarity: "common", RewardType: "garma", RewardValue: "5"},
				{Level: 2, Threshold: 100, NameKey: "achievements.comments.2.name", DescriptionKey: "achievements.comments.2.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "50"},
				{Level: 3, Threshold: 1000, NameKey: "achievements.comments.3.name", DescriptionKey: "achievements.comments.3.description", Rarity: "rare", RewardType: "garma", RewardValue: "500"},
				{Level: 4, Threshold: 5000, NameKey: "achievements.comments.4.name", DescriptionKey: "achievements.comments.4.description", Rarity: "epic", RewardType: "garma", RewardValue: "2500"},
			},
		},
		{
			Key: "likes_received", TitleKey: "achievements.likes_received.title", Category: CategoryContent,
			Icon: "heart", Type: TypeProgressive, Stat: StatCounter, SortOrder: 3,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.likes_received.1.name", DescriptionKey: "achievements.likes_received.1.description", Rarity: "common", RewardType: "garma", RewardValue: "15"},
				{Level: 2, Threshold: 100, NameKey: "achievements.likes_received.2.name", DescriptionKey: "achievements.likes_received.2.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "150"},
				{Level: 3, Threshold: 1000, NameKey: "achievements.likes_received.3.name", DescriptionKey: "achievements.likes_received.3.description", Rarity: "rare", RewardType: "garma", RewardValue: "1000"},
				{Level: 4, Threshold: 10000, NameKey: "achievements.likes_received.4.name", DescriptionKey: "achievements.likes_received.4.description", Rarity: "legendary", RewardType: "garma", RewardValue: "10000"},
			},
		},
		{
			Key: "likes_given", TitleKey: "achievements.likes_given.title", Category: CategoryContent,
			Icon: "thumbs-up", Type: TypeProgressive, Stat: StatCounter, SortOrder: 4,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.likes_given.1.name", DescriptionKey: "achievements.likes_given.1.description", Rarity: "common", RewardType: "garma", RewardValue: "5"},
				{Level: 2, Threshold: 100, NameKey: "achievements.likes_given.2.name", DescriptionKey: "achievements.likes_given.2.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "50"},
				{Level: 3, Threshold: 1000, NameKey: "achievements.likes_given.3.name", DescriptionKey: "achievements.likes_given.3.description", Rarity: "rare", RewardType: "garma", RewardValue: "500"},
			},
		},
		{
			Key: "images", TitleKey: "achievements.images.title", Category: CategoryContent,
			Icon: "image", Type: TypeProgressive, Stat: StatCounter, SortOrder: 5,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.images.1.name", DescriptionKey: "achievements.images.1.description", Rarity: "common", RewardType: "garma", RewardValue: "10"},
				{Level: 2, Threshold: 100, NameKey: "achievements.images.2.name", DescriptionKey: "achievements.images.2.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "100"},
				{Level: 3, Threshold: 1000, NameKey: "achievements.images.3.name", DescriptionKey: "achievements.images.3.description", Rarity: "rare", RewardType: "garma", RewardValue: "1000"},
			},
		},
		{
			Key: "reposts", TitleKey: "achievements.reposts.title", Category: CategoryContent,
			Icon: "repeat", Type: TypeOneTime, Stat: StatCounter, SortOrder: 6,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.reposts.1.name", DescriptionKey: "achievements.reposts.1.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "30"},
			},
		},

		// ── Community actions ──
		{
			Key: "sub_join", TitleKey: "achievements.sub_join.title", Category: CategoryCommunity,
			Icon: "users", Type: TypeOneTime, Stat: StatCounter, SortOrder: 7,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.sub_join.1.name", DescriptionKey: "achievements.sub_join.1.description", Rarity: "common", RewardType: "garma", RewardValue: "10"},
			},
		},
		{
			Key: "sub_rules", TitleKey: "achievements.sub_rules.title", Category: CategoryCommunity,
			Icon: "scroll-text", Type: TypeOneTime, Stat: StatCounter, SortOrder: 8,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.sub_rules.1.name", DescriptionKey: "achievements.sub_rules.1.description", Rarity: "common", RewardType: "garma", RewardValue: "10"},
			},
		},
		{
			Key: "sub_create", TitleKey: "achievements.sub_create.title", Category: CategoryCommunity,
			Icon: "flag", Type: TypeOneTime, Stat: StatCounter, SortOrder: 9,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.sub_create.1.name", DescriptionKey: "achievements.sub_create.1.description", Rarity: "rare", RewardType: "garma", RewardValue: "100"},
			},
		},

		// ── Retention (derived from live data) ──
		{
			Key: "daily_streak", TitleKey: "achievements.daily_streak.title", Category: CategoryRetention,
			Icon: "calendar-check", Type: TypeProgressive, Stat: StatDerived, SortOrder: 10,
			Levels: []Level{
				{Level: 1, Threshold: 3, NameKey: "achievements.daily_streak.1.name", DescriptionKey: "achievements.daily_streak.1.description", Rarity: "common", RewardType: "garma", RewardValue: "10"},
				{Level: 2, Threshold: 7, NameKey: "achievements.daily_streak.2.name", DescriptionKey: "achievements.daily_streak.2.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "50"},
				{Level: 3, Threshold: 30, NameKey: "achievements.daily_streak.3.name", DescriptionKey: "achievements.daily_streak.3.description", Rarity: "rare", RewardType: "garma", RewardValue: "300"},
				{Level: 4, Threshold: 100, NameKey: "achievements.daily_streak.4.name", DescriptionKey: "achievements.daily_streak.4.description", Rarity: "epic", RewardType: "garma", RewardValue: "2000"},
				{Level: 5, Threshold: 365, NameKey: "achievements.daily_streak.5.name", DescriptionKey: "achievements.daily_streak.5.description", Rarity: "legendary", RewardType: "garma", RewardValue: "10000"},
			},
		},
		{
			Key: "session_time", TitleKey: "achievements.session_time.title", Category: CategoryRetention,
			Icon: "clock", Type: TypeProgressive, Stat: StatDerived, SortOrder: 11,
			Levels: []Level{
				{Level: 1, Threshold: 60, NameKey: "achievements.session_time.1.name", DescriptionKey: "achievements.session_time.1.description", Rarity: "common", RewardType: "garma", RewardValue: "10"},
				{Level: 2, Threshold: 600, NameKey: "achievements.session_time.2.name", DescriptionKey: "achievements.session_time.2.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "100"},
				{Level: 3, Threshold: 6000, NameKey: "achievements.session_time.3.name", DescriptionKey: "achievements.session_time.3.description", Rarity: "rare", RewardType: "garma", RewardValue: "1000"},
				{Level: 4, Threshold: 30000, NameKey: "achievements.session_time.4.name", DescriptionKey: "achievements.session_time.4.description", Rarity: "epic", RewardType: "garma", RewardValue: "5000"},
			},
		},

		// ── Profile ──
		{
			Key: "avatar", TitleKey: "achievements.avatar.title", Category: CategoryProfile,
			Icon: "camera", Type: TypeOneTime, Stat: StatCounter, SortOrder: 12,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.avatar.1.name", DescriptionKey: "achievements.avatar.1.description", Rarity: "common", RewardType: "garma", RewardValue: "20"},
			},
		},
		{
			Key: "bio", TitleKey: "achievements.bio.title", Category: CategoryProfile,
			Icon: "file-text", Type: TypeOneTime, Stat: StatCounter, SortOrder: 13,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.bio.1.name", DescriptionKey: "achievements.bio.1.description", Rarity: "common", RewardType: "garma", RewardValue: "15"},
			},
		},
		{
			Key: "profile_style", TitleKey: "achievements.profile_style.title", Category: CategoryProfile,
			Icon: "palette", Type: TypeOneTime, Stat: StatCounter, SortOrder: 14,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.profile_style.1.name", DescriptionKey: "achievements.profile_style.1.description", Rarity: "rare", RewardType: "garma", RewardValue: "50"},
			},
		},

		// ── Integrations ──
		{
			Key: "spotify", TitleKey: "achievements.spotify.title", Category: CategoryIntegrations,
			Icon: "music", Type: TypeOneTime, Stat: StatCounter, SortOrder: 15,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.spotify.1.name", DescriptionKey: "achievements.spotify.1.description", Rarity: "rare", RewardType: "garma", RewardValue: "50"},
			},
		},

		// ── Gifts ──
		{
			Key: "gift_sent", TitleKey: "achievements.gift_sent.title", Category: CategoryGifts,
			Icon: "gift", Type: TypeOneTime, Stat: StatCounter, SortOrder: 16,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.gift_sent.1.name", DescriptionKey: "achievements.gift_sent.1.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "25"},
			},
		},
		{
			Key: "gift_received", TitleKey: "achievements.gift_received.title", Category: CategoryGifts,
			Icon: "package-open", Type: TypeOneTime, Stat: StatCounter, SortOrder: 17,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.gift_received.1.name", DescriptionKey: "achievements.gift_received.1.description", Rarity: "uncommon", RewardType: "garma", RewardValue: "25"},
			},
		},

		// ── Secrets (hidden, revealed after unlock) ──
		{
			Key: "secret_owl", TitleKey: "achievements.secret_owl.title", Category: CategorySecret,
			Icon: "moon-star", Type: TypeOneTime, Stat: StatDerived, SortOrder: 18, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 10, NameKey: "achievements.secret_owl.1.name", DescriptionKey: "achievements.secret_owl.1.description", Rarity: "rare", RewardType: "garma", RewardValue: "300"},
			},
		},
		{
			Key: "secret_shower", TitleKey: "achievements.secret_shower.title", Category: CategorySecret,
			Icon: "shower-head", Type: TypeOneTime, Stat: StatDerived, SortOrder: 19, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 720, NameKey: "achievements.secret_shower.1.name", DescriptionKey: "achievements.secret_shower.1.description", Rarity: "epic", RewardType: "garma", RewardValue: "1000"},
			},
		},
		{
			Key: "secret_lurk", TitleKey: "achievements.secret_lurk.title", Category: CategorySecret,
			Icon: "ghost", Type: TypeOneTime, Stat: StatDerived, SortOrder: 20, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 30, NameKey: "achievements.secret_lurk.1.name", DescriptionKey: "achievements.secret_lurk.1.description", Rarity: "epic", RewardType: "garma", RewardValue: "1000"},
			},
		},
		{
			Key: "secret_allrounder", TitleKey: "achievements.secret_allrounder.title", Category: CategorySecret,
			Icon: "sparkles", Type: TypeOneTime, Stat: StatDerived, SortOrder: 21, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 5, NameKey: "achievements.secret_allrounder.1.name", DescriptionKey: "achievements.secret_allrounder.1.description", Rarity: "rare", RewardType: "garma", RewardValue: "500"},
			},
		},
	})
}
