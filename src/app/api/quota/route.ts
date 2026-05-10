import { getFreeQuotaStatus } from '@/lib/free-quota'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const quota = getFreeQuotaStatus(request.headers.get('cookie'))

    return Response.json(
      {
        free: {
          used: quota.used,
          limit: quota.limit,
          resetAt: quota.resetAt,
        },
      },
      {
        headers: {
          'Set-Cookie': quota.setCookie,
        },
      }
    )
  } catch (err) {
    console.error('[api/quota] free quota is not configured', err)
    return Response.json({ error: 'Free mode is not configured.' }, { status: 500 })
  }
}
