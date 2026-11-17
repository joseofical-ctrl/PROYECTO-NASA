import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  CLEANUP_INTERVAL_MS,
  createRoomEngine,
  type NodeLikeReq,
  type NodeLikeRes,
} from './api/_roomServer.js'

function squadronMultiplayerPlugin(): Plugin {
  const engine = createRoomEngine({ enableSse: true })

  return {
    name: 'squadron-roles-sync',
    configureServer(server) {
      const cleanupTimer = setInterval(() => {
        engine.cleanupRooms(Date.now())
      }, CLEANUP_INTERVAL_MS)
      server.httpServer?.once('close', () => {
        clearInterval(cleanupTimer)
      })

      server.middlewares.use('/api/rooms', (rawReq, rawRes, next) => {
        const req = rawReq as unknown as NodeLikeReq
        const res = rawRes as unknown as NodeLikeRes
        if (!engine.handleRoomsRoute(req, res, req.url ?? '/')) {
          next()
        }
      })

      server.middlewares.use('/api/lobby', (rawReq, rawRes, next) => {
        const req = rawReq as unknown as NodeLikeReq
        const res = rawRes as unknown as NodeLikeRes
        if (!engine.handleLobbyRoute(req, res, req.url ?? '/')) {
          next()
        }
      })

      server.middlewares.use('/api/roles-sync', (rawReq, rawRes, next) => {
        const req = rawReq as unknown as NodeLikeReq
        const res = rawRes as unknown as NodeLikeRes
        if (!engine.handleRolesSyncRoute(req, res, req.url ?? '/')) {
          next()
        }
      })

      server.middlewares.use('/api/station-sync', (rawReq, rawRes, next) => {
        const req = rawReq as unknown as NodeLikeReq
        const res = rawRes as unknown as NodeLikeRes
        if (!engine.handleStationSyncRoute(req, res, req.url ?? '/')) {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), squadronMultiplayerPlugin()],
  server: {
    host: true,
  },
})
