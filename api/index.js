import { getSharedRoomEngine } from './_roomServer.js'

export default function handler(req, res) {
  // On Vercel, long-lived SSE sockets time out on serverless lambdas; client automatically polls HTTP every 500-800ms.
  const engine = getSharedRoomEngine({ enableSse: false })

  // Support either original /api/... req.url OR rewritten query ?path=...
  const url = String(req.url || '/')
  if (!url.startsWith('/api/')) {
    const qIdx = url.indexOf('?')
    const sp = new URLSearchParams(qIdx === -1 ? '' : url.slice(qIdx + 1))
    const forwarded = sp.get('__path') || sp.get('path') || ''
    if (forwarded) {
      sp.delete('__path')
      sp.delete('path')
      const qs = sp.toString()
      req.url = `/api/${forwarded.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`
    }
  }

  return engine.handleApiRequest(req, res)
}
