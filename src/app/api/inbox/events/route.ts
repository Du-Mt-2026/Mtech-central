import { NextRequest } from 'next/server'

/**
 * GET /api/inbox/events
 * Server-Sent Events (SSE) endpoint for real-time inbox updates.
 *
 * This replaces the 3-second polling with instant push notifications
 * for: new messages, message status changes (delivered/read), reactions, etc.
 *
 * Usage:
 *   const es = new EventSource('/api/inbox/events?chipId=xxx')
 *   es.addEventListener('message', (e) => { ... })
 *   es.addEventListener('status_update', (e) => { ... })
 *   es.addEventListener('new_message', (e) => { ... })
 *
 * Chatwoot uses ActionCable (WebSocket) for this — we use SSE
 * because it's simpler, works with Next.js API routes, and doesn't
 * require any additional packages.
 */

// Global registry of active SSE connections
// Key: chipId, Value: Set of controllers
const clients = new Map<string, Set<ReadableStreamDefaultController>>()

// Register a new client
function addClient(chipId: string, controller: ReadableStreamDefaultController) {
  if (!clients.has(chipId)) {
    clients.set(chipId, new Set())
  }
  clients.get(chipId)!.add(controller)
}

// Remove a client
function removeClient(chipId: string, controller: ReadableStreamDefaultController) {
  clients.get(chipId)?.delete(controller)
  if (clients.get(chipId)?.size === 0) {
    clients.delete(chipId)
  }
}

// Broadcast an event to all clients subscribed to a chipId
export function broadcastToChip(chipId: string, event: string, data: unknown) {
  const chipClients = clients.get(chipId)
  if (!chipClients || chipClients.size === 0) return

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const controller of chipClients) {
    try {
      controller.enqueue(new TextEncoder().encode(payload))
    } catch {
      // Client disconnected — remove from registry
      removeClient(chipId, controller)
    }
  }
}

// Broadcast to all connected clients
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
      // Register this client
      addClient(chipId, controller)

      // Send initial connection event
      const connectMsg = `event: connected\ndata: ${JSON.stringify({ chipId, timestamp: Date.now() })}\n\n`
      controller.enqueue(new TextEncoder().encode(connectMsg))

      // Keep-alive: send a comment every 30 seconds to prevent timeout
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'))
        } catch {
          clearInterval(keepAlive)
          removeClient(chipId, controller)
        }
      }, 30000)

      // Cleanup on abort
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
      'X-Accel-Buffering': 'no',  // Disable nginx buffering
    },
  })
}
