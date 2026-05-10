import { Playground } from '@/components/playground'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#6b7de3] via-[#7467c8] to-[#7c4eaa]">
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="overflow-hidden rounded-2xl border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <header className="bg-gradient-to-r from-[#6b7de3] to-[#7c4eaa] px-6 py-8 text-white">
            <h1 className="text-3xl font-semibold tracking-tight">ConvALab Prompt Playground</h1>
            <p className="mt-2 text-white/80">
              Test how a system prompt shapes your agent&apos;s behavior.
            </p>
          </header>

          <main className="px-6 py-6">
            <Playground />

            <footer className="mt-8 text-sm text-foreground">
              Free mode uses Google&apos;s Gemini API. Messages may be used by Google to improve their
              models. Bring your own key for privacy.
            </footer>
          </main>
        </div>
      </div>
    </div>
  )
}
