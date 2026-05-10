import { streamText } from 'ai'
import { z } from 'zod'

import { claimFreePrompt, FREE_QUOTA_LIMIT } from '@/lib/free-quota'
import { checkIpLimit } from '@/lib/ratelimit'
import { getModel } from '@/lib/providers'

export const runtime = 'nodejs'

const MAX_SYSTEM_PROMPT_CHARS = 8_000
const MAX_MESSAGE_CHARS = 12_000
const MAX_MESSAGES = 40
const MAX_BYOK_KEY_CHARS = 500
const MAX_OUTPUT_TOKENS = 800
const REQUEST_TIMEOUT_MS = 30_000

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_MESSAGE_CHARS),
})

const uiTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(MAX_MESSAGE_CHARS),
})

const uiMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    parts: z.array(z.union([uiTextPartSchema, z.record(z.string(), z.unknown())])),
  })
  .passthrough()

const bodySchema = z
  .object({
    messages: z.array(z.unknown()).max(MAX_MESSAGES),
    systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_CHARS),
    mode: z.enum(['free', 'byok']),
    byok: z
      .object({
        provider: z.enum(['openai', 'anthropic', 'google']),
        apiKey: z.string().max(MAX_BYOK_KEY_CHARS),
      })
      .optional(),
    })
  .passthrough()

function coerceMessages(raw: unknown[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (const item of raw) {
    const legacy = messageSchema.safeParse(item)
    if (legacy.success) {
      out.push(legacy.data)
      continue
    }

    const ui = uiMessageSchema.safeParse(item)
    if (!ui.success) continue
    if (ui.data.role !== 'user' && ui.data.role !== 'assistant') continue

    const text = ui.data.parts
      .map((p) => {
        if (!p || typeof p !== 'object') return ''
        const parsed = uiTextPartSchema.safeParse(p)
        return parsed.success ? parsed.data.text : ''
      })
      .join('')

    out.push({ role: ui.data.role, content: text })
  }

  return out
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim()
  return ip || '0.0.0.0'
}

function createSafeTextStreamResponse(
  stream: AsyncIterable<{ type: string; text?: string; error?: unknown }>,
  init: ResponseInit,
  errorMessage: string
): Response {
  const textStream = new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const part of stream) {
          if (part.type === 'text-delta' && typeof part.text === 'string') {
            controller.enqueue(part.text)
          }

          if (part.type === 'error') {
            console.error('[api/chat] stream failed', part.error)
            controller.enqueue(errorMessage)
          }
        }
      } catch (err) {
        console.error('[api/chat] stream failed', err)
        controller.enqueue(errorMessage)
      } finally {
        controller.close()
      }
    },
  })

  const headers = new Headers(init.headers)
  headers.set('content-type', 'text/plain; charset=utf-8')

  return new Response(textStream.pipeThrough(new TextEncoderStream()), {
    ...init,
    headers,
  })
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { systemPrompt, mode, byok } = parsed.data
  const messages = coerceMessages(parsed.data.messages)
  if (messages.length === 0 || messages[messages.length - 1]?.role !== 'user') {
    return Response.json({ error: 'A user message is required' }, { status: 400 })
  }

  let freeQuota: ReturnType<typeof claimFreePrompt> | null = null

  if (mode === 'free') {
    const ip = getClientIp(request)
    const limit = await checkIpLimit(ip)
    if (!limit.ok) {
      return Response.json(
        {
          error: 'Daily free limit reached.',
          reason: 'ip',
        },
        { status: 429 }
      )
    }

    try {
      freeQuota = claimFreePrompt(request.headers.get('cookie'))
    } catch (err) {
      console.error('[api/chat] free quota is not configured', err)
      return Response.json({ error: 'Free mode is not configured.' }, { status: 500 })
    }

    if (!freeQuota.ok) {
      return Response.json(
        {
          error: `Free limit reached. You can send ${FREE_QUOTA_LIMIT} free prompts per day.`,
          reason: 'session',
          used: freeQuota.state.used,
        },
        {
          status: 429,
          headers: {
            'Set-Cookie': freeQuota.setCookie,
            'X-Free-Prompts-Used': String(freeQuota.state.used),
          },
        }
      )
    }
  } else {
    if (!byok || !byok.apiKey.trim()) {
      return Response.json({ error: 'Missing BYOK apiKey' }, { status: 400 })
    }
  }

  try {
    const model =
      mode === 'free'
        ? getModel({ mode: 'free' })
        : getModel({ mode: 'byok', provider: byok!.provider, apiKey: byok!.apiKey })

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeout: { totalMs: REQUEST_TIMEOUT_MS },
    })

    const headers = new Headers()
    if (freeQuota?.ok) {
      headers.set('Set-Cookie', freeQuota.setCookie)
      headers.set('X-Free-Prompts-Used', String(freeQuota.usedAfterIncrement))
    }

    return createSafeTextStreamResponse(
      result.fullStream,
      { headers },
      mode === 'byok'
        ? 'Request failed. Check your API key and provider, then try again.'
        : 'Request failed. Please try again.'
    )
  } catch (err) {
    console.error('[api/chat] request failed', err)
    return Response.json({ error: 'Request failed. Please try again.' }, { status: 500 })
  }
}
