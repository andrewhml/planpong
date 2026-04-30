# Add per-user rate limiting to the public API

**Status:** Draft

## Context

The public REST API (`/api/v1/*`) has no request-rate enforcement. A handful of abusive clients have caused production incidents this quarter by spraying uncached reads at peak traffic. We want a per-user rate limit that (a) is cheap enough to run on every request, (b) degrades to allow traffic rather than reject if the enforcement layer itself fails, and (c) is operator-visible so we can retune without a deploy.

The API is a Node/Express service behind a shared Redis cluster. Users authenticate with a bearer token that maps to a stable `user_id`. All traffic already passes through an auth middleware that sets `req.user_id`.

## Steps

- [ ] Design the limit algorithm
  - Choose a token-bucket algorithm with a per-user key in Redis
  - Configurable capacity + refill rate per tier (free / paid / internal)
  - Default: 60 req/min for free, 600 req/min for paid, unlimited for internal
- [ ] Implement the middleware
  - New file `src/middleware/rate-limit.ts`
  - On each request, read `req.user_id` and `req.user_tier`, look up config
  - Atomically decrement the bucket via a single Lua script on Redis (avoids round-trips)
  - On deny, respond with `429 Too Many Requests` + `Retry-After` header
  - On Redis error, log and **allow** the request (fail-open)
- [ ] Wire the middleware into the app
  - Mount after auth, before route handlers
  - Exclude `/healthz` and `/metrics` from rate limiting
- [ ] Add operator controls
  - Config reloadable without restart (watch `config/rate-limit.yaml` or use a config service)
  - Per-user override endpoint for on-call to temporarily raise/lower a limit
- [ ] Emit metrics
  - Counter: `rate_limit_checks_total{tier, outcome}` where outcome ∈ {allowed, denied, error}
  - Gauge: `rate_limit_current_tokens{tier}` (sampled, not per-request)
- [ ] Tests
  - Unit tests for the bucket algorithm with a fake Redis client
  - Integration test: hit the middleware at 2× the limit, assert the correct number of denies
  - Chaos test: simulate Redis timeout, assert requests pass through (fail-open)

## File References

| File | Change |
|---|---|
| `src/middleware/rate-limit.ts` | Create — token-bucket middleware |
| `src/middleware/rate-limit.test.ts` | Create — unit + integration tests |
| `src/app.ts` | Mount middleware after auth |
| `config/rate-limit.yaml` | Create — default per-tier limits |
| `docs/runbooks/rate-limit.md` | Create — on-call override procedure |

## Verification Criteria

- A free-tier user making 120 requests in 60 seconds receives ~60 `200`s and ~60 `429`s with `Retry-After` set
- A paid-tier user making 120 requests in 60 seconds receives all `200`s
- When Redis is unreachable, every request succeeds and `rate_limit_checks_total{outcome="error"}` increments
- `/healthz` and `/metrics` are never rate-limited
- An operator can hit `POST /internal/rate-limit/override` and see the new limit applied on the next request without a deploy

## Key Decisions

- **Token bucket over fixed window.** Fixed windows allow 2× burst at window boundaries; token bucket smooths traffic. Cost is the same: one Redis op per request.
- **Redis over in-memory.** Multiple API instances must share state. In-memory limits would drift per instance.
- **Fail-open on Redis errors.** A rate limiter that takes the API down when Redis blips is worse than the abuse it prevents. We accept that an outage of the limiter = temporary unlimited access, and we'd detect that through the error counter.
- **Tiers from the auth middleware, not the URL.** Limits follow the user, not the endpoint. Per-endpoint quotas are a later concern.
