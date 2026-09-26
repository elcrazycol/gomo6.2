package achievements

// Default returns the production catalog. It is validated at construction;
// a bad definition fails fast on startup instead of silently misbehaving.
//
// The catalog is deliberately small and prestige-oriented ("мало и метко"):
// four auto milestones plus six starter hand-granted awards. There are no
// trivial levels and no garma rewards — see docs/achievements-awards.md.
func Default() (*Catalog, error) {
	return NewCatalog([]*Group{
		// ── Auto milestones ──────────────────────────────────────────────────
		{
			Key: "entries", TitleKey: "achievements.entries.title", Category: CategoryContent,
			Icon: "message-square", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, SortOrder: 1,
			Levels: []Level{
				{Level: 1, Threshold: 25, NameKey: "achievements.entries.1.name", DescriptionKey: "achievements.entries.1.description"},
				{Level: 2, Threshold: 100, NameKey: "achievements.entries.2.name", DescriptionKey: "achievements.entries.2.description"},
				{Level: 3, Threshold: 500, NameKey: "achievements.entries.3.name", DescriptionKey: "achievements.entries.3.description"},
			},
		},
		{
			Key: "likes_received", TitleKey: "achievements.likes_received.title", Category: CategoryContent,
			Icon: "heart", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatCounter, SortOrder: 2,
			Levels: []Level{
				{Level: 1, Threshold: 50, NameKey: "achievements.likes_received.1.name", DescriptionKey: "achievements.likes_received.1.description"},
				{Level: 2, Threshold: 250, NameKey: "achievements.likes_received.2.name", DescriptionKey: "achievements.likes_received.2.description"},
				{Level: 3, Threshold: 1000, NameKey: "achievements.likes_received.3.name", DescriptionKey: "achievements.likes_received.3.description"},
			},
		},
		{
			// Resonance: the best single piece of content by unique engagement.
			// Score = uniq-likes + 3·uniq-commenters + 5·uniq-reposters; counted
			// over distinct people so it cannot be farmed by one account.
			Key: "resonance", TitleKey: "achievements.resonance.title", Category: CategoryContent,
			Icon: "flame", Kind: KindMilestone, Type: TypeProgressive,
			Stat: StatDerived, SortOrder: 3,
			Levels: []Level{
				{Level: 1, Threshold: 100, NameKey: "achievements.resonance.1.name", DescriptionKey: "achievements.resonance.1.description"},
				{Level: 2, Threshold: 500, NameKey: "achievements.resonance.2.name", DescriptionKey: "achievements.resonance.2.description"},
				{Level: 3, Threshold: 2000, NameKey: "achievements.resonance.3.name", DescriptionKey: "achievements.resonance.3.description"},
			},
		},
		{
			// Tenure: a dynamic series — one level per 0.5/1/2/3… years, with no
			// upper bound and no fixed levels (the frontend formats the term).
			Key: "tenure", TitleKey: "achievements.tenure.title", Category: CategoryRetention,
			Icon: "calendar-check", Kind: KindMilestone, Stat: StatTenure, SortOrder: 4,
		},

		// ── Starter hand-granted awards ──────────────────────────────────────
		{
			Key: "award_ktitor", TitleKey: "achievements.award_ktitor.title",
			DescriptionKey: "achievements.award_ktitor.description",
			Category:       CategoryAwards, Icon: "gem", Kind: KindAward, SortOrder: 10,
		},
		{
			Key: "award_bughunter", TitleKey: "achievements.award_bughunter.title",
			DescriptionKey: "achievements.award_bughunter.description",
			Category:       CategoryAwards, Icon: "bug", Kind: KindAward, SortOrder: 11,
		},
		{
			Key: "award_zodchiy", TitleKey: "achievements.award_zodchiy.title",
			DescriptionKey: "achievements.award_zodchiy.description",
			Category:       CategoryAwards, Icon: "palette", Kind: KindAward, SortOrder: 12,
		},
		{
			Key: "award_keeper", TitleKey: "achievements.award_keeper.title",
			DescriptionKey: "achievements.award_keeper.description",
			Category:       CategoryAwards, Icon: "shield", Kind: KindAward, SortOrder: 13,
		},
		{
			Key: "award_patriarch", TitleKey: "achievements.award_patriarch.title",
			DescriptionKey: "achievements.award_patriarch.description",
			Category:       CategoryAwards, Icon: "crown", Kind: KindAward, SortOrder: 14,
		},
		{
			Key: "award_triumph", TitleKey: "achievements.award_triumph.title",
			DescriptionKey: "achievements.award_triumph.description",
			Category:       CategoryAwards, Icon: "trophy", Kind: KindAward, SortOrder: 15,
		},
	})
}
