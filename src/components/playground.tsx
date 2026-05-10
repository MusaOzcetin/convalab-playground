'use client'

import * as React from 'react'
import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport, type UIMessage } from 'ai'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const DEFAULT_SYSTEM_PROMPT =
  'You are a customer support agent for an e-commerce company. Be helpful, concise, and friendly. Avoid sounding robotic — use natural conversational language.'

type Mode = 'free' | 'byok'
type Provider = 'openai' | 'anthropic' | 'google'

type ByokConfig = {
  provider: Provider
  apiKey: string
}

type PromptPreferences = {
  humour: number
  creativity: number
  detail: number
}

const BYOK_STORAGE_KEY = 'convalab.byok'
const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
}
const DEFAULT_PROMPT_PREFERENCES: PromptPreferences = {
  humour: 4,
  creativity: 5,
  detail: 5,
}

const PREFERENCE_META: Array<{
  key: keyof PromptPreferences
  label: string
  low: string
  high: string
}> = [
  {
    key: 'humour',
    label: 'Humour',
    low: 'Dry',
    high: 'Fun',
  },
  {
    key: 'creativity',
    label: 'Creativity',
    low: 'Direct',
    high: 'Novel',
  },
  {
    key: 'detail',
    label: 'Detail',
    low: 'Brief',
    high: 'Deep',
  },
]

function getLevelLabel(value: number): string {
  if (value <= 3) return 'Low'
  if (value >= 8) return 'High'
  return 'Medium'
}

function buildSystemPromptFromPreferences(preferences: PromptPreferences): string {
  return [
    'You are a customer support agent for an e-commerce company.',
    'Be helpful, accurate, and natural. Avoid sounding robotic.',
    '',
    'Style preferences:',
    `- Humour: ${getLevelLabel(preferences.humour)} (${preferences.humour}/10). Use light humour only when it feels natural and never at the cost of clarity.`,
    `- Creativity: ${getLevelLabel(preferences.creativity)} (${preferences.creativity}/10). Adapt phrasing and examples to the user while staying grounded in the available information.`,
    `- Detail: ${getLevelLabel(preferences.detail)} (${preferences.detail}/10). Match answer length to the user's need and avoid unnecessary explanation.`,
    '',
    'When a user asks for help, answer directly, ask a clarifying question only when needed, and keep the conversation easy to continue.',
  ].join('\n')
}

function safeParseByok(value: string | null): ByokConfig | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('provider' in parsed) ||
      !('apiKey' in parsed)
    ) {
      return null
    }

    const provider = (parsed as { provider?: unknown }).provider
    const apiKey = (parsed as { apiKey?: unknown }).apiKey

    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google') return null
    if (typeof apiKey !== 'string') return null

    return { provider, apiKey }
  } catch {
    return null
  }
}

function extract429Reason(error: unknown): 'session' | 'ip' | null {
  if (!error || typeof error !== 'object') return null
  const maybe = error as { status?: number; message?: string; data?: unknown }
  const status = typeof maybe.status === 'number' ? maybe.status : null

  if (status === 429 && maybe.data && typeof maybe.data === 'object') {
    const reason = (maybe.data as { reason?: unknown }).reason
    if (reason === 'session' || reason === 'ip') return reason
  }

  const msg = maybe.message || ''
  if (msg.includes('"reason":"session"')) return 'session'
  if (msg.includes('"reason":"ip"')) return 'ip'
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function getMessageText(message: UIMessage): string {
  const texts: string[] = []
  for (const part of message.parts) {
    if (!part || typeof part !== 'object') continue
    const maybe = part as { type?: unknown; text?: unknown }
    if (maybe.type === 'text' && typeof maybe.text === 'string') {
      texts.push(maybe.text)
    }
  }
  return texts.join('')
}

function getFriendlyErrorText(error: Error | undefined): string | null {
  if (!error) return null
  const trimmed = error.message?.trim()
  if (!trimmed) return 'Request failed.'
  const parsed = safeJsonParse(trimmed)
  if (parsed && typeof parsed === 'object') {
    const msg = (parsed as { error?: unknown }).error
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return trimmed
}

function readQuotaUsed(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const free = (data as { free?: unknown }).free
  if (!free || typeof free !== 'object') return null

  const used = (free as { used?: unknown }).used
  return typeof used === 'number' ? used : null
}

function PreferenceSlider({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string
  low: string
  high: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="space-y-2">
        <Label>{label}</Label>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-foreground/10">
          <span>{getLevelLabel(value)}</span>
          <span className="h-3 w-px bg-border" aria-hidden="true" />
          <span>{value}/10</span>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer accent-[#6b7de3]"
        aria-label={label}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="max-w-[45%] truncate">{low}</span>
        <span className="max-w-[45%] truncate text-right">{high}</span>
      </div>
    </div>
  )
}

export function Playground() {
  const [systemPrompt, setSystemPrompt] = React.useState(DEFAULT_SYSTEM_PROMPT)
  const [promptPreferences, setPromptPreferences] = React.useState<PromptPreferences>(
    DEFAULT_PROMPT_PREFERENCES
  )

  const [mode, setMode] = React.useState<Mode>('free')
  const [byok, setByok] = React.useState<ByokConfig | null>(() => {
    if (typeof window === 'undefined') return null
    return safeParseByok(sessionStorage.getItem(BYOK_STORAGE_KEY))
  })

  const [byokDialogOpen, setByokDialogOpen] = React.useState(false)
  const [draftProvider, setDraftProvider] = React.useState<Provider>(() => byok?.provider ?? 'openai')
  const [draftApiKey, setDraftApiKey] = React.useState(() => byok?.apiKey ?? '')

  const [freeUsed, setFreeUsed] = React.useState(0)
  const [limitReason, setLimitReason] = React.useState<'session' | 'ip' | null>(null)

  const [input, setInput] = React.useState('')

  const transport = React.useMemo(() => {
    return new TextStreamChatTransport({
      api: '/api/chat',
      fetch: async (api, init) => {
        const res = await fetch(api, init)

        // We use the outgoing request body to determine mode + trigger.
        let req: unknown = null
        if (typeof init?.body === 'string') {
          req = safeJsonParse(init.body)
        }

        const trigger = isRecord(req) ? req.trigger : undefined
        const requestMode = isRecord(req) ? req.mode : undefined

        if (res.ok) {
          if (trigger === 'submit-message' && requestMode === 'free') {
            const used = Number(res.headers.get('x-free-prompts-used'))
            setFreeUsed((x) => (Number.isFinite(used) ? Math.min(5, used) : Math.min(5, x + 1)))
          }
          setLimitReason(null)
          return res
        }

        const status = res.status
        const rawText = await res.text().catch(() => '')

        const data = rawText ? safeJsonParse(rawText) : null

        if (status === 429 && data && typeof data === 'object') {
          const reason = (data as { reason?: unknown }).reason
          if (reason === 'session' || reason === 'ip') {
            setLimitReason(reason)
            const used = (data as { used?: unknown }).used
            if (typeof used === 'number') setFreeUsed(Math.min(5, used))
          }
        }

        const err = new Error(rawText || `Request failed with status ${status}.`) as Error & {
          status?: number
          data?: unknown
        }
        err.status = status
        err.data = data
        throw err
      },
    })
  }, [])

  const { messages, sendMessage, status, setMessages, clearError, error } = useChat({
    transport,
    onError: (err) => {
      const reason = extract429Reason(err)
      if (reason) setLimitReason(reason)
    },
  })

  React.useEffect(() => {
    let cancelled = false

    async function loadQuota() {
      const res = await fetch('/api/quota').catch(() => null)
      if (!res?.ok) return

      const data = await res.json().catch(() => null)
      const used = readQuotaUsed(data)
      if (!cancelled && used !== null) {
        setFreeUsed(Math.min(5, used))
      }
    }

    loadQuota()

    return () => {
      cancelled = true
    }
  }, [])

  const isLoading = status === 'submitted' || status === 'streaming'

  const requestBody = React.useMemo(() => {
    return {
      systemPrompt,
      mode,
      ...(mode === 'byok' && byok
        ? {
            byok: {
              provider: byok.provider,
              apiKey: byok.apiKey,
            },
          }
        : {}),
    }
  }, [systemPrompt, mode, byok])

  const handleSubmit = React.useCallback(
    async (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.()

      if (mode === 'byok' && (!byok || !byok.apiKey.trim())) {
        setByokDialogOpen(true)
        return
      }

      const text = input.trim()
      if (!text) return

      const original = input
      setInput('')
      clearError()

      try {
        await sendMessage(
          { text },
          {
            body: requestBody,
          }
        )
      } catch {
        // Restore input if the request fails quickly (e.g., 429/400).
        setInput(original)
      }
    },
    [byok, clearError, input, mode, requestBody, sendMessage]
  )

  const onResetConversation = React.useCallback(() => {
    setMessages([])
    setInput('')
    setLimitReason(null)
    clearError()
  }, [clearError, setMessages])

  const openByokDialog = React.useCallback(() => {
    setByokDialogOpen(true)
  }, [])

  const setFreeMode = React.useCallback(() => {
    setMode('free')
    setLimitReason(null)
  }, [])

  const chooseByokMode = React.useCallback(() => {
    // If they already have a key saved, switch immediately. Otherwise prompt.
    const stored = safeParseByok(sessionStorage.getItem(BYOK_STORAGE_KEY))
    if (stored && stored.apiKey.trim()) {
      setByok(stored)
      setMode('byok')
      setLimitReason(null)
      return
    }
    openByokDialog()
  }, [openByokDialog])

  const saveByok = React.useCallback(() => {
    const trimmed = draftApiKey.trim()
    if (!trimmed) return

    const config: ByokConfig = { provider: draftProvider, apiKey: trimmed }
    sessionStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify(config))
    setByok(config)
    setMode('byok')
    setLimitReason(null)
    setByokDialogOpen(false)
  }, [draftApiKey, draftProvider])

  const clearByok = React.useCallback(() => {
    sessionStorage.removeItem(BYOK_STORAGE_KEY)
    setByok(null)
    setDraftApiKey('')
    setDraftProvider('openai')
    setMode('free')
    setLimitReason(null)
  }, [])

  const onResetSystemPrompt = React.useCallback(() => {
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT)
  }, [])

  const updatePromptPreference = React.useCallback(
    (key: keyof PromptPreferences, value: number) => {
      setPromptPreferences((current) => ({
        ...current,
        [key]: value,
      }))
    },
    []
  )

  const onRegenerateSystemPrompt = React.useCallback(() => {
    setSystemPrompt(buildSystemPromptFromPreferences(promptPreferences))
  }, [promptPreferences])

  const onKeyDownInput = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter') return
      if (e.shiftKey) return
      e.preventDefault()

      const form = e.currentTarget.form
      if (!form) return
      form.requestSubmit()
    },
    []
  )

  const showLimitAlert = limitReason === 'session' || limitReason === 'ip'
  const errorText = getFriendlyErrorText(error)
  const showErrorAlert = Boolean(errorText) && !showLimitAlert

  const uiMessages = React.useMemo(
    () => messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    [messages]
  )

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {/* Left: System prompt */}
      <Card className="p-4">
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Prompt preferences</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tune the prompt style before regenerating it.
                </p>
              </div>
              <Button type="button" onClick={onRegenerateSystemPrompt}>
                Regenerate system prompt
              </Button>
            </div>

            <div className="grid gap-3 xl:grid-cols-3">
              {PREFERENCE_META.map((item) => (
                <PreferenceSlider
                  key={item.key}
                  label={item.label}
                  low={item.low}
                  high={item.high}
                  value={promptPreferences[item.key]}
                  onChange={(value) => updatePromptPreference(item.key, value)}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="system-prompt">System prompt</Label>
            <Button variant="secondary" size="sm" type="button" onClick={onResetSystemPrompt}>
              Reset to default
            </Button>
          </div>
          <Textarea
            id="system-prompt"
            className="min-h-[400px] font-mono"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            This prompt is sent as the system instruction.
          </p>
        </div>
      </Card>

      {/* Right: Chat */}
      <Card className="flex min-h-[560px] flex-col overflow-hidden p-0">
        <div className="bg-gradient-to-r from-[#6b7de3] to-[#7c4eaa] p-4 text-white">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg bg-white/10 p-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={setFreeMode}
                className={
                  mode === 'free'
                    ? 'bg-white text-[#4c3f99] hover:bg-white hover:text-[#4c3f99]'
                    : 'text-white/90 hover:bg-white/15 hover:text-white'
                }
              >
                Free
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={chooseByokMode}
                className={
                  mode === 'byok'
                    ? 'bg-white text-[#4c3f99] hover:bg-white hover:text-[#4c3f99]'
                    : 'text-white/90 hover:bg-white/15 hover:text-white'
                }
              >
                Use my API key
              </Button>
            </div>

            {mode === 'byok' && byok ? (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">BYOK: {PROVIDER_LABELS[byok.provider]}</Badge>
                <Button type="button" size="sm" variant="link" onClick={clearByok}>
                  Clear
                </Button>
              </div>
            ) : null}

            <div className="ml-auto">
              <Button variant="secondary" type="button" onClick={onResetConversation}>
                Reset conversation
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/80">
            Write a message below and stream the assistant response.
          </p>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          <ScrollArea className="h-full rounded-md border bg-background">
            <div className="space-y-3 p-4">
              {uiMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Send a message below to start the conversation.
                </p>
              ) : null}
              {uiMessages.map((m) => (
                <div key={m.id} className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {m.role === 'user' ? 'You' : 'Assistant'}
                  </div>
                  <div
                    className={
                      m.role === 'user'
                        ? 'rounded-lg border bg-muted/60 p-3 text-sm leading-relaxed'
                        : 'rounded-lg border bg-background p-3 text-sm leading-relaxed'
                    }
                  >
                    <div className="whitespace-pre-wrap">{getMessageText(m)}</div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="space-y-3 border-t bg-background p-4">
          {showLimitAlert ? (
            <Alert variant="destructive">
              <AlertTitle>Free limit reached</AlertTitle>
              <AlertDescription>
                <div className="space-y-3">
                  <p>
                    {limitReason === 'session'
                      ? "You've used your 5 free messages this session. Add your own API key to keep testing."
                      : 'Daily free limit reached. Add your own API key to keep testing.'}
                  </p>
                  <Button type="button" onClick={openByokDialog}>
                    Use your own API key
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {showErrorAlert ? (
            <Alert variant="destructive">
              <AlertTitle>Request failed</AlertTitle>
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded-xl border bg-muted/30 p-3">
            <form onSubmit={handleSubmit} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Your message</Label>
                <span className="text-xs text-muted-foreground">
                  Enter to send • Shift+Enter for new line
                </span>
              </div>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDownInput}
                placeholder="Type your message..."
                className="min-h-[120px] bg-background"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  Free messages used: {mode === 'free' ? freeUsed : 0} / 5
                </div>
                <Button
                  type="submit"
                  disabled={isLoading || (input ?? '').trim().length === 0}
                  className="h-12 rounded-xl bg-gradient-to-r from-[#6b7de3] to-[#7c4eaa] px-8 text-white hover:from-[#7b8beb] hover:to-[#8a5bb6]"
                >
                  {isLoading ? 'Sending…' : 'Send →'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </Card>

      <Dialog open={byokDialogOpen} onOpenChange={setByokDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use your own API key</DialogTitle>
            <DialogDescription>
              Your key is stored only in this browser tab via sessionStorage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={draftProvider} onValueChange={(v) => setDraftProvider(v as Provider)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider">
                    {PROVIDER_LABELS[draftProvider]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key">API key</Label>
              <Input
                id="api-key"
                type="password"
                value={draftApiKey}
                onChange={(e) => setDraftApiKey(e.target.value)}
                placeholder="Paste your API key"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" onClick={saveByok} disabled={draftApiKey.trim().length === 0}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
