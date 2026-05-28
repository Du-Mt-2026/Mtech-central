import { NextRequest } from 'next/server'

/**
 * GET /api/inbox/events
 * Server-Sent Events (SSE) endpoint for real-time inbox updates.
 *
 * ⚠️ IMPORTANT: This endpoint does NOT work on Vercel serverless.
 * On serverless, each request runs in an isolated container, so the
 * in-memory `clients` Map is empty for every new invocation.
 * broadcastToChip() becomes a no-op.
 *
 * The frontend uses polling as a fallback (every 5s) when SSE fails.
 * SSE works only in self-hosted (docker/VM) deployments where the
 * Node.js process stays alive between requests.
 *
 * We keep this endpoint for self-hosted deployments and as a
 * health-check endpoint. The webhook still calls broadcastToChip()
 * safely — it just does nothing on serverless.
 */

export const maxDuration = 60 // 60s max — longest Vercel allows

// Global registry of active SSE connections (only works in long-running Node.js)
const clients = new Map<string, Set<ReadableStreamDefaultController>>()

function addClient(chipId: string, controller: ReadableStreamDefaultController) {
  if (!clients.has(chipId)) {
    clients.set(chipId, new Set())
  }
  clients.get(chipId)!.add(controller)
}

function removeClient(chipId: string, controller: ReadableStreamDefaultController) {
  clients.get(chipId)?.delete(controller)
  if (clients.get(chipId)?.size === 0) {
    clients.delete(chipId)
  }
}

/** Broadcast an event to all SSE clients subscribed to a chipId. No-op on serverless. */
export function broadcastToChip(chipId: string, event: string, data: unknown) {
  const chipClients = clients.get(chipId)
  if (!chipClients || chipClients.size === 0) return // No-op on serverless

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const controller of chipClients) {
    try {
      controller.enqueue(new TextEncoder().encode(payload))
    } catch {
      removeClient(chipId, controller)
    }
  }
}

/** Broadcast to all connected clients. No-op on serverless. */
export function broadcastAll(event: string, data: unknown) {
  for (const [chipId] of clients) {
    broadcastToChip(chipId, event, data)
  }
}

export async function GET(request: NextRequest) {
  const chipId = request.nextUrl.searchParams.get('chipId')
  if (!chipId) {
    return new Response('chipId is required', { status: 400 })
  }

  const stream = new ReadableStream({
    start(controller) {
      addClient(chipId, controller)

      const connectMsg = `event: connected\ndata: ${JSON.stringify({ chipId, timestamp: Date.now() })}\n\n`
      controller.enqueue(new TextEncoder().encode(connectMsg))

      // Keep-alive every 25s (Vercel times out at 30s for pro, 10s for hobby)
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'))
        } catch {
          clearInterval(keepAlive)
          removeClient(chipId, controller)
        }
      }, 25000)

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        removeClient(chipId, controller)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
