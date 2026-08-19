package middleware

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// incrWithTTL atomically increments a fixed-window counter and sets its TTL.
//
// The INCR and EXPIRE run inside one Lua script so a crash or Redis error
// between the two calls can never leave a counter key without a TTL. A key
// that loses its TTL grows forever: once it crosses the budget the user is
// locked out permanently (Redis survives backend restarts, so deploying does
// not help). The script also self-heals stale keys — if a key somehow already
// lacks a TTL (e.g. from an older buggy run), it re-arms the window instead of
// letting the counter run away.
func incrWithTTL(ctx context.Context, rdb *redis.Client, key string, window time.Duration) (int64, error) {
	script := redis.NewScript(`
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`)
	return script.Run(ctx, rdb, []string{key}, int64(window.Seconds())).Int64()
}
