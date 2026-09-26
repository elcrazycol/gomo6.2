package achievements

import "testing"

func TestPercent(t *testing.T) {
	cases := []struct {
		holders, base int
		want          float64
	}{
		{0, 0, 0},   // no base → no division by zero
		{1, 0, 0},   // ditto
		{0, 100, 0}, // nobody owns it
		{1, 100, 1},
		{1, 3, 33.33},
		{2, 3, 66.67},
		{1, 8, 12.5},
		{100, 100, 100},
	}
	for _, c := range cases {
		if got := percent(c.holders, c.base); got != c.want {
			t.Errorf("percent(%d, %d) = %v, want %v", c.holders, c.base, got, c.want)
		}
	}
}
