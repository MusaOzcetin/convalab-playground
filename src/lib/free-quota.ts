import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const FREE_QUOTA_LIMIT = 5
const FREE_QUOTA_WINDOW_SECONDS = 60 * 60 * 24
const FREE_QUOTA_COOKIE = 'convalab_free_quota'

type FreeQuotaState = {
  id: string
  used: number
  resetAt: number
}

type FreeQuotaResult =
  | {
      ok: true
      state: FreeQuotaState
      setCookie: string
      usedAfterIncrement: number
    }
  | {
      ok: false
      state: FreeQuotaState
      setCookie: string
    }

type FreeQuotaStatus = {
  used: number
  limit: number
  resetAt: number
  setCookie: string
}

function getSecret(): string {
  const secret = process.env.FREE_QUOTA_COOKIE_SECRET || process.env.NEXTAUTH_SECRET
  if (secret) return secret

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Missing FREE_QUOTA_COOKIE_SECRET')
  }

  return 'dev-only-free-quota-secret'
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function fromBase64url(input: string): string | null {
  try {
    return Buffer.from(input, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

function isValidSignature(payload: string, signature: string): boolean {
  const expected = sign(payload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.byteLength !== expectedBuffer.byteLength) return false
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

function serialize(state: FreeQuotaState): string {
  const payload = base64url(JSON.stringify(state))
  return `${payload}.${sign(payload)}`
}

function parseCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=')
    if (name === FREE_QUOTA_COOKIE) {
      return valueParts.join('=')
    }
  }

  return null
}

function createEmptyState(now: number): FreeQuotaState {
  return {
    id: randomBytes(16).toString('hex'),
    used: 0,
    resetAt: now + FREE_QUOTA_WINDOW_SECONDS * 1000,
  }
}

function parseState(cookieHeader: string | null, now: number): FreeQuotaState {
  const cookie = parseCookieHeader(cookieHeader)
  if (!cookie) return createEmptyState(now)

  const [payload, signature] = cookie.split('.')
  if (!payload || !signature || !isValidSignature(payload, signature)) {
    return createEmptyState(now)
  }

  const raw = fromBase64url(payload)
  if (!raw) return createEmptyState(now)

  try {
    const parsed = JSON.parse(raw) as Partial<FreeQuotaState>
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.used !== 'number' ||
      typeof parsed.resetAt !== 'number'
    ) {
      return createEmptyState(now)
    }

    if (parsed.resetAt <= now) return createEmptyState(now)

    return {
      id: parsed.id,
      used: Math.max(0, Math.min(FREE_QUOTA_LIMIT, Math.floor(parsed.used))),
      resetAt: parsed.resetAt,
    }
  } catch {
    return createEmptyState(now)
  }
}

function buildSetCookie(state: FreeQuotaState): string {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure' : ''
  return [
    `${FREE_QUOTA_COOKIE}=${serialize(state)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${FREE_QUOTA_WINDOW_SECONDS}`,
    secure.trim(),
  ]
    .filter(Boolean)
    .join('; ')
}

export function claimFreePrompt(cookieHeader: string | null): FreeQuotaResult {
  const now = Date.now()
  const state = parseState(cookieHeader, now)

  if (state.used >= FREE_QUOTA_LIMIT) {
    return {
      ok: false,
      state,
      setCookie: buildSetCookie(state),
    }
  }

  const nextState = {
    ...state,
    used: state.used + 1,
  }

  return {
    ok: true,
    state: nextState,
    usedAfterIncrement: nextState.used,
    setCookie: buildSetCookie(nextState),
  }
}

export function getFreeQuotaStatus(cookieHeader: string | null): FreeQuotaStatus {
  const state = parseState(cookieHeader, Date.now())

  return {
    used: state.used,
    limit: FREE_QUOTA_LIMIT,
    resetAt: state.resetAt,
    setCookie: buildSetCookie(state),
  }
}

export { FREE_QUOTA_LIMIT }
