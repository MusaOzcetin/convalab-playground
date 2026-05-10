import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

type LimitResult = { ok: true } | { ok: false; reason: 'ip' }

const IP_LIMIT = 20
const WINDOW_SECONDS = 60 * 60 * 24
const WINDOW_MS = WINDOW_SECONDS * 1000

let warnedMissingUpstash = false

function logMissingUpstashOnce() {
  if (warnedMissingUpstash) return
  warnedMissingUpstash = true
  console.warn(
    '[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN missing; using in-memory rate limits (dev only).'
  )
}

type SlidingWindowCounter = { hits: number[] }
const memoryIp = new Map<string, SlidingWindowCounter>()

function memoryCheckSliding(map: Map<string, SlidingWindowCounter>, key: string, limit: number): boolean {
  const now = Date.now()
  const cutoff = now - WINDOW_MS

  const existing = map.get(key)
  if (!existing) {
    map.set(key, { hits: [now] })
    return true
  }

  const recent = existing.hits.filter((t) => t > cutoff)
  if (recent.length >= limit) {
    existing.hits = recent
    return false
  }

  existing.hits = [...recent, now]
  return true
}

function getUpstash() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  const redis = new Redis({ url, token })

  const ipLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(IP_LIMIT, `${WINDOW_SECONDS} s`),
    analytics: true,
    prefix: 'convalab:ip',
  })

  return { ipLimiter }
}

const upstash = getUpstash()

export async function checkIpLimit(ip: string): Promise<LimitResult> {
  if (upstash) {
    const ipRes = await upstash.ipLimiter.limit(ip)

    if (!ipRes.success) return { ok: false, reason: 'ip' }
    return { ok: true }
  }

  logMissingUpstashOnce()

  const okIp = memoryCheckSliding(memoryIp, ip, IP_LIMIT)
  if (!okIp) return { ok: false, reason: 'ip' }

  return { ok: true }
}
