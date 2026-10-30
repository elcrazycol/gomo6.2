package achievements

// Default returns the production quest catalog (MVP "геймификация").
//
// Two tracks, everything visible with progress, every level claimable:
//   - first_steps: the onboarding checklist (free order, one_time each) plus
//     the meta quest for completing all 9 (drops + gems + a chest).
//   - main: the progressive ladder (entries, comments, likes, subs, follows).
//
// Drops grow per level; gems only land on top levels and the meta quest.
// No hidden quests, no prestige, no manual awards in this MVP.
func Default() (*Catalog, error) {
	drops := func(amount int) []Reward { return []Reward{{Kind: RewardDrops, Amount: amount}} }
	return NewCatalog([]*Group{
		// ── First steps (onboarding checklist, free order) ───────────────────
		{
			Key: "qs_avatar", TitleKey: "achievements.qs_avatar.title", Category: CategoryProfile,
			Icon: "smile", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 1,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_avatar.1.name", DescriptionKey: "achievements.qs_avatar.1.description", Rewards: drops(20)},
			},
		},
		{
			Key: "qs_bio", TitleKey: "achievements.qs_bio.title", Category: CategoryProfile,
			Icon: "id-card", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 2,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_bio.1.name", DescriptionKey: "achievements.qs_bio.1.description", Rewards: drops(15)},
			},
		},
		{
			Key: "qs_first_thread", TitleKey: "achievements.qs_first_thread.title", Category: CategoryContent,
			Icon: "message-square", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 3,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_first_thread.1.name", DescriptionKey: "achievements.qs_first_thread.1.description", Rewards: drops(20)},
			},
		},
		{
			Key: "qs_first_wall", TitleKey: "achievements.qs_first_wall.title", Category: CategoryContent,
			Icon: "pen-line", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 4,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_first_wall.1.name", DescriptionKey: "achievements.qs_first_wall.1.description", Rewards: drops(20)},
			},
		},
		{
			Key: "qs_first_comment", TitleKey: "achievements.qs_first_comment.title", Category: CategoryContent,
			Icon: "messages-square", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 5,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_first_comment.1.name", DescriptionKey: "achievements.qs_first_comment.1.description", Rewards: drops(10)},
			},
		},
		{
			Key: "qs_like_given", TitleKey: "achievements.qs_like_given.title", Category: CategoryContent,
			Icon: "heart", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 6,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_like_given.1.name", DescriptionKey: "achievements.qs_like_given.1.description", Rewards: drops(10)},
			},
		},
		{
			Key: "qs_sub_join", TitleKey: "achievements.qs_sub_join.title", Category: CategoryCommunity,
			Icon: "users", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 7,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_sub_join.1.name", DescriptionKey: "achievements.qs_sub_join.1.description", Rewards: drops(10)},
			},
		},
		{
			Key: "qs_follow", TitleKey: "achievements.qs_follow.title", Category: CategorySocial,
			Icon: "user-plus", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 8,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_follow.1.name", DescriptionKey: "achievements.qs_follow.1.description", Rewards: drops(10)},
			},
		},
		{
			Key: "qs_style", TitleKey: "achievements.qs_style.title", Category: CategoryProfile,
			Icon: "palette", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 9,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.qs_style.1.name", DescriptionKey: "achievements.qs_style.1.description", Rewards: drops(15)},
			},
		},
		{
			// Meta: all 9 first steps done. Derived from the other quests'
			// levels, so its own threshold is the count (9).
			Key: "qs_complete", TitleKey: "achievements.qs_complete.title", Category: CategoryOnboarding,
			Icon: "trophy", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatDerived, Track: TrackFirstSteps, SortOrder: 10,
			Levels: []Level{
				{Level: 1, Threshold: 9, NameKey: "achievements.qs_complete.1.name", DescriptionKey: "achievements.qs_complete.1.description",
					Rewards: []Reward{{Kind: RewardDrops, Amount: 100}, {Kind: RewardGems, Amount: 5}, {Kind: RewardChest, Mechanic: "rarity_chest"}}},
			},
		},

		// ── Main ladder ──────────────────────────────────────────────────────
		{
			Key: "entries", TitleKey: "achievements.entries.title", Category: CategoryContent,
			Icon: "notebook-pen", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, Track: TrackMain, SortOrder: 20,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.entries.1.name", DescriptionKey: "achievements.entries.1.description", Rewards: drops(10)},
				{Level: 2, Threshold: 10, NameKey: "achievements.entries.2.name", DescriptionKey: "achievements.entries.2.description", Rewards: drops(25)},
				{Level: 3, Threshold: 50, NameKey: "achievements.entries.3.name", DescriptionKey: "achievements.entries.3.description", Rewards: drops(60)},
				{Level: 4, Threshold: 250, NameKey: "achievements.entries.4.name", DescriptionKey: "achievements.entries.4.description", Rewards: drops(150)},
				{Level: 5, Threshold: 1000, NameKey: "achievements.entries.5.name", DescriptionKey: "achievements.entries.5.description",
					Rewards: []Reward{{Kind: RewardDrops, Amount: 400}, {Kind: RewardGems, Amount: 20}}},
			},
		},
		{
			Key: "comments", TitleKey: "achievements.comments.title", Category: CategoryContent,
			Icon: "messages-square", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, Track: TrackMain, SortOrder: 21,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.comments.1.name", DescriptionKey: "achievements.comments.1.description", Rewards: drops(10)},
				{Level: 2, Threshold: 25, NameKey: "achievements.comments.2.name", DescriptionKey: "achievements.comments.2.description", Rewards: drops(30)},
				{Level: 3, Threshold: 150, NameKey: "achievements.comments.3.name", DescriptionKey: "achievements.comments.3.description", Rewards: drops(80)},
				{Level: 4, Threshold: 750, NameKey: "achievements.comments.4.name", DescriptionKey: "achievements.comments.4.description", Rewards: drops(250)},
			},
		},
		{
			Key: "likes_given", TitleKey: "achievements.likes_given.title", Category: CategoryContent,
			Icon: "heart-handshake", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, Track: TrackMain, SortOrder: 22,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.likes_given.1.name", DescriptionKey: "achievements.likes_given.1.description", Rewards: drops(10)},
				{Level: 2, Threshold: 50, NameKey: "achievements.likes_given.2.name", DescriptionKey: "achievements.likes_given.2.description", Rewards: drops(40)},
				{Level: 3, Threshold: 300, NameKey: "achievements.likes_given.3.name", DescriptionKey: "achievements.likes_given.3.description", Rewards: drops(120)},
			},
		},
		{
			Key: "likes_received", TitleKey: "achievements.likes_received.title", Category: CategoryContent,
			Icon: "heart", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, Track: TrackMain, SortOrder: 23,
			Levels: []Level{
				{Level: 1, Threshold: 10, NameKey: "achievements.likes_received.1.name", DescriptionKey: "achievements.likes_received.1.description", Rewards: drops(15)},
				{Level: 2, Threshold: 100, NameKey: "achievements.likes_received.2.name", DescriptionKey: "achievements.likes_received.2.description", Rewards: drops(50)},
				{Level: 3, Threshold: 500, NameKey: "achievements.likes_received.3.name", DescriptionKey: "achievements.likes_received.3.description", Rewards: drops(150)},
				{Level: 4, Threshold: 2000, NameKey: "achievements.likes_received.4.name", DescriptionKey: "achievements.likes_received.4.description",
					Rewards: []Reward{{Kind: RewardDrops, Amount: 500}, {Kind: RewardGems, Amount: 15}}},
			},
		},
		{
			Key: "subs_joined", TitleKey: "achievements.subs_joined.title", Category: CategoryCommunity,
			Icon: "users", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, Track: TrackMain, SortOrder: 24,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.subs_joined.1.name", DescriptionKey: "achievements.subs_joined.1.description", Rewards: drops(10)},
				{Level: 2, Threshold: 5, NameKey: "achievements.subs_joined.2.name", DescriptionKey: "achievements.subs_joined.2.description", Rewards: drops(40)},
			},
		},
		{
			Key: "sub_created", TitleKey: "achievements.sub_created.title", Category: CategoryCommunity,
			Icon: "flag", Kind: KindMilestone, Type: TypeOneTime,
			Stat: StatCounter, Track: TrackMain, SortOrder: 25,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.sub_created.1.name", DescriptionKey: "achievements.sub_created.1.description",
					Rewards: []Reward{{Kind: RewardDrops, Amount: 50}, {Kind: RewardGems, Amount: 5}}},
			},
		},
		{
			Key: "follows", TitleKey: "achievements.follows.title", Category: CategorySocial,
			Icon: "user-plus", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, Track: TrackMain, SortOrder: 26,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "achievements.follows.1.name", DescriptionKey: "achievements.follows.1.description", Rewards: drops(10)},
				{Level: 2, Threshold: 10, NameKey: "achievements.follows.2.name", DescriptionKey: "achievements.follows.2.description", Rewards: drops(30)},
				{Level: 3, Threshold: 50, NameKey: "achievements.follows.3.name", DescriptionKey: "achievements.follows.3.description", Rewards: drops(80)},
			},
		},
	})
}
