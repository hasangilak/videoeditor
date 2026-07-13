// Mock backend: a real tus server that only stores bytes on disk. No processing.
import { Server } from '@tus/server'
import { FileStore } from '@tus/file-store'

export const dynamic = 'force-dynamic'

const server = new Server({
  path: '/api/tus',
  datastore: new FileStore({ directory: process.env.UPLOADS_DIR ?? './uploads' }),
})

const handler = (req: Request) => server.handleWeb(req)

export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as DELETE,
  handler as OPTIONS,
  handler as HEAD,
}
