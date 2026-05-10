import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

export type Mode = 'free' | 'byok'
export type Provider = 'openai' | 'anthropic' | 'google'

const MODEL_IDS: Record<Provider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.5-flash',
}

type GetModelParams =
  | {
      mode: 'free'
      provider?: Provider
      apiKey?: string
    }
  | {
      mode: 'byok'
      provider: Provider
      apiKey: string
    }

export function getModel(params: GetModelParams): LanguageModel {
  if (params.mode === 'free') {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      throw new Error('Missing GOOGLE_GENERATIVE_AI_API_KEY for free mode')
    }

    const google = createGoogleGenerativeAI({ apiKey })
    return google(MODEL_IDS.google)
  }

  const apiKey = params.apiKey
  if (!apiKey) throw new Error('Missing BYOK apiKey')

  if (params.provider === 'openai') {
    const openai = createOpenAI({ apiKey })
    return openai(MODEL_IDS.openai)
  }

  if (params.provider === 'anthropic') {
    const anthropic = createAnthropic({ apiKey })
    return anthropic(MODEL_IDS.anthropic)
  }

  const google = createGoogleGenerativeAI({ apiKey })
  return google(MODEL_IDS.google)
}
