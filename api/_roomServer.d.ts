export interface NodeLikeReq {
  method?: string
  url?: string
  originalUrl?: string
  body?: unknown
  readableEnded?: boolean
  setEncoding?: (enc: string) => void
  on: (event: string, listener: (arg?: unknown) => void) => void
}

export interface NodeLikeRes {
  statusCode: number
  setHeader: (name: string, value: string) => void
  writeHead: (statusCode: number, headers?: Record<string, string>) => void
  write: (chunk: string) => void
  end: (data?: string) => void
}

export interface RoomEngine {
  cleanupRooms: (now?: number) => void
  handleRoomsRoute: (req: NodeLikeReq, res: NodeLikeRes, subUrl: string) => boolean
  handleLobbyRoute: (req: NodeLikeReq, res: NodeLikeRes, subUrl: string) => boolean
  handleRolesSyncRoute: (req: NodeLikeReq, res: NodeLikeRes, subUrl: string) => boolean
  handleStationSyncRoute: (req: NodeLikeReq, res: NodeLikeRes, subUrl: string) => boolean
  handleApiRequest: (req: NodeLikeReq, res: NodeLikeRes, fallbackNext?: () => void) => boolean
}

export const CLEANUP_INTERVAL_MS: number
export function createRoomEngine(options?: { enableSse?: boolean }): RoomEngine
export function getSharedRoomEngine(options?: { enableSse?: boolean }): RoomEngine
