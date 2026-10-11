import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Pencil,
  Highlighter,
  Eraser,
  Trash2,
  Download,
  Users,
  Wifi,
  WifiOff,
  Palette,
  Undo2,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Hand,
  Edit3,
  Check,
  X,
  Clock,
} from 'lucide-react'
import './global.css'

interface Point {
  x: number
  y: number
}

type ToolMode = 'pen' | 'highlighter' | 'eraser' | 'hand'

interface Stroke {
  id: string
  userId: string
  points: Point[]
  color: string
  size: number
  mode: 'pen' | 'highlighter' | 'eraser'
  timestamp: number
}

interface UserInfo {
  id: string
  name: string
  color: string
  isAfk?: boolean
}

interface RemoteCursor {
  x: number
  y: number
  user: UserInfo
  lastSeen: number
}

// Preset color options
const PALETTE_COLORS = [
  '#0f172a', // Slate black
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
]

export function App() {
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  // Local user state
  const [self, setSelf] = useState<UserInfo | null>(null)
  const [activeUsers, setActiveUsers] = useState<UserInfo[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({})

  // Identity edit state
  const [isEditingName, setIsEditingName] = useState(false)
  const [newNameInput, setNewNameInput] = useState('')

  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1.0)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const panRef = useRef(pan)
  panRef.current = pan

  // Drawing tools state
  const [currentMode, setCurrentMode] = useState<ToolMode>('pen')
  const [currentColor, setCurrentColor] = useState<string>('#3b82f6')
  const [currentSize, setCurrentSize] = useState<number>(4)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Strokes history
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const strokesRef = useRef<Stroke[]>([])
  strokesRef.current = strokes

  // Active interaction tracking
  const isPanningRef = useRef(false)
  const isDrawingRef = useRef(false)
  const [isPanningActive, setIsPanningActive] = useState(false)
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const activePointsRef = useRef<Point[]>([])
  const lastPointRef = useRef<Point | null>(null)
  const lastCursorSendRef = useRef(0)

  // AFK & Activity tracking
  const isAfkRef = useRef(false)
  const lastActivityRef = useRef(Date.now())

  // Send AFK status to server
  const sendAfkStatus = useCallback((isAfk: boolean) => {
    if (isAfkRef.current === isAfk) return
    isAfkRef.current = isAfk
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'afk-status',
          isAfk,
        })
      )
    }
    setSelf((prev) => (prev ? { ...prev, isAfk } : null))
  }, [])

  // Mark local user as active
  const markUserActive = useCallback(() => {
    lastActivityRef.current = Date.now()
    if (isAfkRef.current && document.visibilityState === 'visible') {
      sendAfkStatus(false)
    }
  }, [sendAfkStatus])

  // Redraw the complete canvas from stroke history with current zoom and pan
  const redrawAllStrokes = useCallback(
    (strokeList: Stroke[]) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      const currentZoom = zoomRef.current
      const currentPan = panRef.current

      // Reset transform and clear
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Apply device pixel ratio and viewport transforms
      ctx.scale(dpr, dpr)
      ctx.translate(currentPan.x, currentPan.y)
      ctx.scale(currentZoom, currentZoom)

      // Render each stroke in world space
      for (const stroke of strokeList) {
        if (!stroke.points || stroke.points.length === 0) continue

        ctx.save()
        ctx.beginPath()
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        if (stroke.mode === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out'
          ctx.lineWidth = stroke.size * 3
          ctx.strokeStyle = 'rgba(0,0,0,1)'
        } else if (stroke.mode === 'highlighter') {
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 0.35
          ctx.strokeStyle = stroke.color
          ctx.lineWidth = stroke.size * 2.8
        } else {
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1.0
          ctx.strokeStyle = stroke.color
          ctx.lineWidth = stroke.size
        }

        const pts = stroke.points
        if (pts.length === 1 && pts[0]) {
          ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2)
          ctx.fillStyle = stroke.mode === 'eraser' ? 'black' : stroke.color
          ctx.fill()
        } else if (pts[0]) {
          ctx.moveTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length; i++) {
            const pt = pts[i]
            if (pt) ctx.lineTo(pt.x, pt.y)
          }
          ctx.stroke()
        }

        ctx.restore()
      }

      ctx.restore()
    },
    []
  )

  // Draw a single segment in world coordinates
  const drawSegment = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      from: Point,
      to: Point,
      color: string,
      size: number,
      mode: 'pen' | 'highlighter' | 'eraser'
    ) => {
      const dpr = window.devicePixelRatio || 1
      const currentZoom = zoomRef.current
      const currentPan = panRef.current

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.translate(currentPan.x, currentPan.y)
      ctx.scale(currentZoom, currentZoom)

      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (mode === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.lineWidth = size * 3
        ctx.strokeStyle = 'rgba(0,0,0,1)'
      } else if (mode === 'highlighter') {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 0.35
        ctx.strokeStyle = color
        ctx.lineWidth = size * 2.8
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1.0
        ctx.strokeStyle = color
        ctx.lineWidth = size
      }

      ctx.stroke()
      ctx.restore()
    },
    []
  )

  // Handle canvas sizing
  const setupCanvasSize = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    redrawAllStrokes(strokesRef.current)
  }, [redrawAllStrokes])

  // Window resize listener
  useEffect(() => {
    setupCanvasSize()
    const handleResize = () => setupCanvasSize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [setupCanvasSize])

  // Redraw when zoom or pan changes
  useEffect(() => {
    redrawAllStrokes(strokesRef.current)
  }, [zoom, pan, redrawAllStrokes])

  // WebSocket Connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    let isUnmounted = false
    let reconnectTimeout: ReturnType<typeof setTimeout>

    const connect = () => {
      if (isUnmounted) return
      const ws = new WebSocket(wsUrl)
      socketRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        console.log('[WebSocket] Connected')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          switch (data.type) {
            case 'init': {
              setSelf(data.self)
              if (data.self?.isAfk !== undefined) {
                isAfkRef.current = Boolean(data.self.isAfk)
              }
              setActiveUsers(data.users || [])
              if (Array.isArray(data.history)) {
                setStrokes(data.history)
                redrawAllStrokes(data.history)
              }
              break
            }

            case 'user-joined': {
              if (data.activeUsers) setActiveUsers(data.activeUsers)
              break
            }

            case 'user-left': {
              if (data.activeUsers) setActiveUsers(data.activeUsers)
              if (data.userId) {
                setRemoteCursors((prev) => {
                  const updated = { ...prev }
                  delete updated[data.userId]
                  return updated
                })
              }
              break
            }

            case 'user-updated': {
              if (data.activeUsers) setActiveUsers(data.activeUsers)
              if (data.user) {
                setSelf((prev) => (prev && prev.id === data.user.id ? data.user : prev))
                setRemoteCursors((prev) => {
                  const existing = prev[data.user.id]
                  if (existing) {
                    return {
                      ...prev,
                      [data.user.id]: {
                        ...existing,
                        user: data.user,
                      },
                    }
                  }
                  return prev
                })
              }
              break
            }

            case 'user-afk': {
              if (data.activeUsers) setActiveUsers(data.activeUsers)
              if (data.userId) {
                setSelf((prev) =>
                  prev && prev.id === data.userId ? { ...prev, isAfk: data.isAfk } : prev
                )
                setRemoteCursors((prev) => {
                  const existing = prev[data.userId]
                  if (existing) {
                    return {
                      ...prev,
                      [data.userId]: {
                        ...existing,
                        user: {
                          ...existing.user,
                          isAfk: data.isAfk,
                        },
                      },
                    }
                  }
                  return prev
                })
              }
              break
            }

            case 'draw-segment': {
              const canvas = canvasRef.current
              if (!canvas) break
              const ctx = canvas.getContext('2d')
              if (ctx) {
                drawSegment(ctx, data.from, data.to, data.color, data.size, data.mode)
              }
              break
            }

            case 'stroke-committed': {
              if (data.stroke) {
                setStrokes((prev) => [...prev, data.stroke])
              }
              break
            }

            case 'sync-history': {
              if (Array.isArray(data.history)) {
                setStrokes(data.history)
                redrawAllStrokes(data.history)
              }
              break
            }

            case 'cursor': {
              if (data.userId && data.user) {
                setRemoteCursors((prev) => ({
                  ...prev,
                  [data.userId]: {
                    x: data.x,
                    y: data.y,
                    user: data.user,
                    lastSeen: Date.now(),
                  },
                }))
              }
              break
            }

            case 'clear': {
              setStrokes([])
              const canvas = canvasRef.current
              if (canvas) {
                const ctx = canvas.getContext('2d')
                if (ctx) {
                  ctx.save()
                  ctx.setTransform(1, 0, 0, 1, 0, 0)
                  ctx.clearRect(0, 0, canvas.width, canvas.height)
                  ctx.restore()
                }
              }
              break
            }

            default:
              break
          }
        } catch (e) {
          console.error('[WebSocket] Failed to parse message', e)
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        console.log('[WebSocket] Closed, reconnecting in 2s...')
        reconnectTimeout = setTimeout(connect, 2000)
      }

      ws.onerror = (err) => {
        console.error('[WebSocket] Error encountered', err)
      }
    }

    connect()

    return () => {
      isUnmounted = true
      clearTimeout(reconnectTimeout)
      if (socketRef.current) socketRef.current.close()
    }
  }, [drawSegment, redrawAllStrokes])

  // Track window/tab visibility and user inactivity (1 minute idle) for AFK status
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sendAfkStatus(true)
      } else {
        markUserActive()
      }
    }

    const handleUserInteraction = () => {
      markUserActive()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('mousemove', handleUserInteraction, { passive: true })
    window.addEventListener('mousedown', handleUserInteraction, { passive: true })
    window.addEventListener('keydown', handleUserInteraction, { passive: true })
    window.addEventListener('touchstart', handleUserInteraction, { passive: true })

    // Check idle every 3 seconds for 1-minute timeout
    const idleCheckInterval = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastActivityRef.current >= 60000) {
        if (!isAfkRef.current) {
          sendAfkStatus(true)
        }
      }
    }, 3000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('mousemove', handleUserInteraction)
      window.removeEventListener('mousedown', handleUserInteraction)
      window.removeEventListener('keydown', handleUserInteraction)
      window.removeEventListener('touchstart', handleUserInteraction)
      clearInterval(idleCheckInterval)
    }
  }, [sendAfkStatus, markUserActive])

  // Transform screen coordinate to world coordinate
  const screenToWorld = useCallback((screenX: number, screenY: number): Point => {
    return {
      x: (screenX - panRef.current.x) / zoomRef.current,
      y: (screenY - panRef.current.y) / zoomRef.current,
    }
  }, [])

  // Extract relative screen coordinate
  const getScreenCoordinates = (e: React.MouseEvent | React.TouchEvent): Point | null => {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()

    if ('touches' in e) {
      const touch = e.touches[0]
      if (!touch) return null
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      }
    }

    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  // Broadcast cursor in world coordinates
  const broadcastCursor = (worldPoint: Point) => {
    const now = Date.now()
    if (now - lastCursorSendRef.current > 35 && socketRef.current?.readyState === WebSocket.OPEN) {
      lastCursorSendRef.current = now
      socketRef.current.send(
        JSON.stringify({
          type: 'cursor',
          x: worldPoint.x,
          y: worldPoint.y,
        })
      )
    }
  }

  // Start Interaction (Drawing or Panning)
  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    markUserActive()
    const screenCoord = getScreenCoordinates(e)
    if (!screenCoord) return

    // If Right click (button === 2), Middle click (button === 1), or Hand tool is selected -> PAN
    const isRightClick = 'button' in e && e.button === 2
    const isMiddleClick = 'button' in e && e.button === 1

    if (currentMode === 'hand' || isRightClick || isMiddleClick) {
      isPanningRef.current = true
      isDrawingRef.current = false
      setIsPanningActive(true)
      panStartRef.current = {
        x: screenCoord.x - panRef.current.x,
        y: screenCoord.y - panRef.current.y,
      }
      return
    }

    // Only allow left click (button === 0) for drawing
    if ('button' in e && e.button !== 0) return

    // Start drawing
    isDrawingRef.current = true
    isPanningRef.current = false
    setIsPanningActive(false)

    const worldPoint = screenToWorld(screenCoord.x, screenCoord.y)
    lastPointRef.current = worldPoint
    activePointsRef.current = [worldPoint]

    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        drawSegment(ctx, worldPoint, worldPoint, currentColor, currentSize, currentMode)
      }
    }

    // Send single point start to peers
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'draw-segment',
          from: worldPoint,
          to: worldPoint,
          color: currentColor,
          size: currentSize,
          mode: currentMode,
        })
      )
    }
  }

  // Move Interaction
  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    markUserActive()
    const screenCoord = getScreenCoordinates(e)
    if (!screenCoord) return

    // Panning
    if (isPanningRef.current) {
      setPan({
        x: screenCoord.x - panStartRef.current.x,
        y: screenCoord.y - panStartRef.current.y,
      })
      const worldPoint = screenToWorld(screenCoord.x, screenCoord.y)
      broadcastCursor(worldPoint)
      return
    }

    // World coordinate for cursor & drawing
    const worldPoint = screenToWorld(screenCoord.x, screenCoord.y)
    broadcastCursor(worldPoint)

    if (!isDrawingRef.current || !lastPointRef.current || currentMode === 'hand') return

    const prevPoint = lastPointRef.current
    activePointsRef.current.push(worldPoint)

    // Render locally
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        drawSegment(ctx, prevPoint, worldPoint, currentColor, currentSize, currentMode)
      }
    }

    // Broadcast segment to peers
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'draw-segment',
          from: prevPoint,
          to: worldPoint,
          color: currentColor,
          size: currentSize,
          mode: currentMode,
        })
      )
    }

    lastPointRef.current = worldPoint
  }

  // End Interaction
  const handlePointerUp = () => {
    markUserActive()
    if (isPanningRef.current) {
      isPanningRef.current = false
      setIsPanningActive(false)
      return
    }

    if (!isDrawingRef.current || currentMode === 'hand') return
    isDrawingRef.current = false

    const strokePoints = activePointsRef.current
    if (strokePoints.length > 0 && self) {
      const stroke: Stroke = {
        id: Math.random().toString(36).substring(2, 9),
        userId: self.id,
        points: strokePoints,
        color: currentColor,
        size: currentSize,
        mode: currentMode,
        timestamp: Date.now(),
      }

      setStrokes((prev) => [...prev, stroke])

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'stroke-end',
            stroke,
          })
        )
      }
    }

    activePointsRef.current = []
    lastPointRef.current = null
  }

  // Zoom helpers
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(4.0, +(prev + 0.25).toFixed(2)))
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.25, +(prev - 0.25).toFixed(2)))
  }

  const handleResetZoom = () => {
    setZoom(1.0)
    setPan({ x: 0, y: 0 })
  }

  // Mouse scroll wheel zoom centered at cursor position
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = container.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top

      const currentZoom = zoomRef.current
      const currentPan = panRef.current

      // Calculate world point under cursor before zoom
      const worldX = (cursorX - currentPan.x) / currentZoom
      const worldY = (cursorY - currentPan.y) / currentZoom

      // Calculate new zoom factor
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89
      const newZoom = Math.min(4.0, Math.max(0.25, Number((currentZoom * zoomFactor).toFixed(3))))

      // Adjust pan so the point under cursor stays fixed
      const newPanX = cursorX - worldX * newZoom
      const newPanY = cursorY - worldY * newZoom

      setZoom(newZoom)
      setPan({ x: newPanX, y: newPanY })
    }

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }

    container.addEventListener('wheel', handleNativeWheel, { passive: false })
    container.addEventListener('contextmenu', handleContextMenu)
    return () => {
      container.removeEventListener('wheel', handleNativeWheel)
      container.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [])

  // Undo action
  const handleUndo = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'undo' }))
    }
  }

  // Clear Canvas
  const handleClear = () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'clear' }))
    }
    setShowClearConfirm(false)
  }

  // Save Identity Update
  const handleSaveIdentity = () => {
    const trimmed = newNameInput.trim()
    if (trimmed && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'update-identity',
          name: trimmed,
        })
      )
    }
    setIsEditingName(false)
  }

  // Open Name Edit Popover
  const handleStartEditName = () => {
    setNewNameInput(self?.name || '')
    setIsEditingName(true)
  }

  // Download whiteboard image
  const handleDownload = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = canvas.width
    exportCanvas.height = canvas.height
    const expCtx = exportCanvas.getContext('2d')
    if (!expCtx) return

    // Solid white background
    expCtx.fillStyle = '#ffffff'
    expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height)

    // Render all strokes in exportCanvas at 1:1 scale
    const dpr = window.devicePixelRatio || 1
    expCtx.scale(dpr, dpr)

    for (const stroke of strokesRef.current) {
      if (!stroke.points || stroke.points.length === 0) continue

      expCtx.save()
      expCtx.beginPath()
      expCtx.lineCap = 'round'
      expCtx.lineJoin = 'round'

      if (stroke.mode === 'eraser') {
        expCtx.globalCompositeOperation = 'destination-out'
        expCtx.lineWidth = stroke.size * 3
        expCtx.strokeStyle = 'rgba(0,0,0,1)'
      } else if (stroke.mode === 'highlighter') {
        expCtx.globalCompositeOperation = 'source-over'
        expCtx.globalAlpha = 0.35
        expCtx.strokeStyle = stroke.color
        expCtx.lineWidth = stroke.size * 2.8
      } else {
        expCtx.globalCompositeOperation = 'source-over'
        expCtx.globalAlpha = 1.0
        expCtx.strokeStyle = stroke.color
        expCtx.lineWidth = stroke.size
      }

      const pts = stroke.points
      if (pts.length === 1 && pts[0]) {
        expCtx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2)
        expCtx.fillStyle = stroke.mode === 'eraser' ? 'black' : stroke.color
        expCtx.fill()
      } else if (pts[0]) {
        expCtx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) {
          const pt = pts[i]
          if (pt) expCtx.lineTo(pt.x, pt.y)
        }
        expCtx.stroke()
      }

      expCtx.restore()
    }

    const link = document.createElement('a')
    link.download = `collaborative-canvas-${new Date().toISOString().slice(0, 10)}.png`
    link.href = exportCanvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100 select-none">
      {/* Top Header Bar */}
      <header className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        {/* Left Branding */}
        <div className="glass-panel rounded-2xl px-4 py-2.5 flex items-center gap-3 pointer-events-auto">
          <div className="w-8 h-8 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Pencil className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-white flex items-center gap-2">
              Canvas Collab
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                0.0.0.0 LAN
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">Papan Tulis Kolaboratif Real-Time</p>
          </div>
        </div>

        {/* Right Status & Collaboration Center */}
        <div className="flex items-center gap-2.5 pointer-events-auto">
          {/* Online Users Pill */}
          <div className="glass-panel rounded-2xl px-3.5 py-2 flex items-center gap-2 text-xs font-medium text-slate-300">
            <Users className="w-4 h-4 text-indigo-400" />
            <span>{activeUsers.length} Online</span>

            {/* Avatars preview */}
            <div className="flex -space-x-1.5 items-center ml-1">
              {activeUsers.slice(0, 4).map((user) => (
                <div key={user.id} className="relative">
                  <div
                    className={`w-5 h-5 rounded-full border border-slate-900 flex items-center justify-center text-[9px] font-bold text-white shadow-sm transition-opacity ${
                      user.isAfk ? 'opacity-60' : 'opacity-100'
                    }`}
                    style={{ backgroundColor: user.color }}
                    title={`${user.name}${user.isAfk ? ' (AFK)' : ''}`}
                  >
                    {user.name.slice(0, 1)}
                  </div>
                  {user.isAfk && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 ring-1 ring-slate-900"
                      title={`${user.name} (AFK)`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Connection Status Indicator */}
          <div className="glass-panel rounded-2xl px-3 py-2 flex items-center gap-2 text-xs font-medium">
            {isConnected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-subtle" />
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400 hidden sm:inline">Terhubung</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse-subtle" />
                <WifiOff className="w-4 h-4 text-rose-400" />
                <span className="text-rose-400 hidden sm:inline">Menghubungkan...</span>
              </>
            )}
          </div>

          {/* Self Profile Badge with Inline Name Editing */}
          {self && (
            <div className="relative">
              {!isEditingName ? (
                <button
                  onClick={handleStartEditName}
                  className="glass-panel hover:bg-slate-800/80 rounded-2xl px-3 py-2 flex items-center gap-2 text-xs font-medium cursor-pointer transition"
                  title="Klik untuk mengubah nama identitas Anda"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow-sm"
                    style={{ backgroundColor: self.color }}
                  />
                  <span className="text-slate-200 font-semibold">{self.name}</span>
                  {self.isAfk && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-semibold">
                      <Clock className="w-3 h-3 text-amber-300" />
                      AFK
                    </span>
                  )}
                  <Edit3 className="w-3.5 h-3.5 text-slate-400 hover:text-white" />
                </button>
              ) : (
                <div className="glass-panel rounded-2xl px-2.5 py-1.5 flex items-center gap-1.5 shadow-xl border border-blue-500/40">
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow-sm ml-1"
                    style={{ backgroundColor: self.color }}
                  />
                  <input
                    type="text"
                    value={newNameInput}
                    onChange={(e) => setNewNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveIdentity()
                      if (e.key === 'Escape') setIsEditingName(false)
                    }}
                    autoFocus
                    maxLength={24}
                    placeholder="Nama baru..."
                    className="bg-slate-900/90 text-white text-xs px-2 py-1 rounded-lg border border-slate-700 outline-none w-28 sm:w-36 focus:border-blue-500"
                  />
                  <button
                    onClick={handleSaveIdentity}
                    className="p-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                    title="Simpan nama"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsEditingName(false)}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    title="Batal"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Interactive Canvas Area */}
      <div
        ref={containerRef}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative flex-1 w-full h-full canvas-grid-bg overflow-hidden ${
          isPanningActive
            ? 'cursor-grabbing'
            : currentMode === 'hand'
            ? 'cursor-grab'
            : 'cursor-crosshair'
        }`}
        style={{
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          className="absolute inset-0 block touch-none"
        />

        {/* Multiplayer Live Remote Cursors (Projected to Screen Coordinates) */}
        {Object.entries(remoteCursors).map(([id, cursor]) => {
          const screenX = cursor.x * zoom + pan.x
          const screenY = cursor.y * zoom + pan.y
          const isAfk = Boolean(cursor.user.isAfk)

          return (
            <div
              key={id}
              className={`absolute pointer-events-none z-10 remote-cursor transition-opacity duration-300 ${
                isAfk ? 'opacity-75' : 'opacity-100'
              }`}
              style={{
                transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
              }}
            >
              {/* Cursor Pointer Icon */}
              <MousePointer2
                className={`w-5 h-5 -rotate-90 filter drop-shadow-md transition-all ${
                  isAfk ? 'opacity-60 scale-90' : 'opacity-100 scale-100'
                }`}
                style={{
                  color: cursor.user.color,
                  fill: cursor.user.color,
                }}
              />
              {/* Remote User Label */}
              <div
                className="ml-3 -mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white whitespace-nowrap shadow-lg border border-black/10 flex items-center gap-1.5"
                style={{ backgroundColor: cursor.user.color }}
              >
                <span>{cursor.user.name}</span>
                {isAfk && (
                  <span className="flex items-center gap-0.5 px-1 py-0.2 bg-amber-500 text-slate-950 font-bold rounded text-[9px] leading-tight">
                    <Clock className="w-2.5 h-2.5 text-slate-950" />
                    AFK
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Floating Bottom Toolbar Dock */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
        <div className="glass-panel rounded-3xl p-2 px-3 flex items-center gap-3 shadow-2xl">
          {/* Tool Modes (Pen, Highlighter, Eraser, Hand/Pan) */}
          <div className="flex items-center gap-1 bg-slate-900/60 p-1 rounded-2xl border border-white/5">
            <button
              onClick={() => setCurrentMode('pen')}
              className={`tool-btn p-2.5 rounded-xl cursor-pointer ${
                currentMode === 'pen'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Pena (Pen)"
            >
              <Pencil className="w-4 h-4" />
            </button>

            <button
              onClick={() => setCurrentMode('highlighter')}
              className={`tool-btn p-2.5 rounded-xl cursor-pointer ${
                currentMode === 'highlighter'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Stabilo (Highlighter)"
            >
              <Highlighter className="w-4 h-4" />
            </button>

            <button
              onClick={() => setCurrentMode('eraser')}
              className={`tool-btn p-2.5 rounded-xl cursor-pointer ${
                currentMode === 'eraser'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Penghapus (Eraser)"
            >
              <Eraser className="w-4 h-4" />
            </button>

            <button
              onClick={() => setCurrentMode('hand')}
              className={`tool-btn p-2.5 rounded-xl cursor-pointer ${
                currentMode === 'hand'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Geser Kanvas (Pan / Hand)"
            >
              <Hand className="w-4 h-4" />
            </button>
          </div>

          <div className="w-[1px] h-7 bg-slate-800" />

          {/* Color Palette (disabled during eraser/hand mode) */}
          <div
            className={`flex items-center gap-1.5 transition-opacity ${
              currentMode === 'eraser' || currentMode === 'hand'
                ? 'opacity-30 pointer-events-none'
                : 'opacity-100'
            }`}
          >
            {PALETTE_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setCurrentColor(color)}
                className={`tool-btn w-6 h-6 rounded-full cursor-pointer transition-transform ${
                  currentColor === color && currentMode !== 'eraser' && currentMode !== 'hand'
                    ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-slate-900 shadow-md'
                    : 'hover:scale-110'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}

            {/* Custom Color Picker Input */}
            <label className="relative tool-btn p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 cursor-pointer flex items-center justify-center">
              <Palette className="w-4 h-4" />
              <input
                type="color"
                value={currentColor}
                onChange={(e) => setCurrentColor(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                title="Pilih Warna Kustom"
              />
            </label>
          </div>

          <div className="w-[1px] h-7 bg-slate-800" />

          {/* Brush Size Controls */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-medium text-slate-400">Ukuran</span>
            <input
              type="range"
              min="2"
              max="32"
              value={currentSize}
              onChange={(e) => setCurrentSize(Number(e.target.value))}
              className="w-16 sm:w-20 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
            {/* Visual preview of size */}
            <div className="w-6 h-6 flex items-center justify-center bg-slate-900/60 rounded-lg border border-white/5">
              <div
                className="rounded-full transition-all"
                style={{
                  width: `${Math.min(currentSize, 18)}px`,
                  height: `${Math.min(currentSize, 18)}px`,
                  backgroundColor: currentMode === 'eraser' ? '#cbd5e1' : currentColor,
                }}
              />
            </div>
          </div>

          <div className="w-[1px] h-7 bg-slate-800" />

          {/* Action Utilities (Undo, Clear, Export) */}
          <div className="flex items-center gap-1">
            {/* Undo */}
            <button
              onClick={handleUndo}
              disabled={strokes.length === 0}
              className="tool-btn p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              title="Batalkan goresan terakhir (Undo)"
            >
              <Undo2 className="w-4 h-4" />
            </button>

            {/* Clear Board */}
            <div className="relative">
              <button
                onClick={() => setShowClearConfirm((prev) => !prev)}
                className={`tool-btn p-2.5 rounded-xl cursor-pointer ${
                  showClearConfirm
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/10'
                }`}
                title="Bersihkan Semua Kanvas"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              {/* Confirmation Popover */}
              {showClearConfirm && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 glass-panel p-3 rounded-2xl w-48 text-center shadow-xl border border-rose-500/30 z-30">
                  <p className="text-xs font-medium text-slate-200 mb-2.5">
                    Hapus seluruh goresan kanvas?
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={handleClear}
                      className="px-2.5 py-1 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg cursor-pointer"
                    >
                      Ya, Hapus
                    </button>
                    <button
                      onClick={() => setShowClearConfirm(false)}
                      className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Export / Download Canvas Image */}
            <button
              onClick={handleDownload}
              className="tool-btn p-2.5 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
              title="Unduh Gambar Kanvas (PNG)"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Floating Zoom & Pan Controls (Bottom Right) */}
      <div className="absolute bottom-5 right-5 z-20 pointer-events-auto">
        <div className="glass-panel rounded-2xl p-1.5 flex items-center gap-1 shadow-xl">
          <button
            onClick={handleZoomOut}
            className="tool-btn p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 cursor-pointer"
            title="Perkecil (Zoom Out)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <button
            onClick={handleResetZoom}
            className="px-2 py-1 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-lg cursor-pointer transition min-w-[50px] text-center"
            title="Klik untuk reset zoom (100%)"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            onClick={handleZoomIn}
            className="tool-btn p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 cursor-pointer"
            title="Perbesar (Zoom In)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-5 bg-slate-800 mx-0.5" />

          <button
            onClick={handleResetZoom}
            className="tool-btn p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 cursor-pointer"
            title="Reset Posisi & Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(<App />)
}
