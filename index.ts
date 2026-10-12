import { Elysia } from "elysia";
import { staticPlugin } from "@elysia/static";

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  userId: string;
  points: Point[];
  color: string;
  size: number;
  mode: "pen" | "highlighter" | "eraser";
  timestamp: number;
}

export interface UserInfo {
  id: string;
  name: string;
  color: string;
  isAfk?: boolean;
}

// Preset vibrant avatar colors
const AVATAR_COLORS = [
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#14b8a6", // Teal
];

// In-memory server state
const wsUserMap = new Map<string, UserInfo>();
const activeUsers = new Map<string, UserInfo>();
const strokeHistory: Stroke[] = [];
const MAX_HISTORY = 10000;

import os from "node:os";

function getRandomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
}

function generateUserName(): string {
  const hex = Math.random().toString(16).substring(2, 6).toUpperCase();
  return `Artist-${hex}`;
}

function getLocalIP(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

const PORT = Number(process.env.PORT) || 3000;
const HOSTNAME = "0.0.0.0";

export const app = new Elysia()
  // Health check API
  .get("/api/status", () => ({
    status: "online",
    activeUsersCount: activeUsers.size,
    totalStrokes: strokeHistory.length,
    timestamp: Date.now(),
  }))
  // Real-time WebSocket endpoint
  .ws("/ws", {
    open(ws) {
      const userId = ws.id || Math.random().toString(36).substring(2, 10);
      const userInfo: UserInfo = {
        id: userId,
        name: generateUserName(),
        color: getRandomColor(),
        isAfk: false,
      };

      // Store in memory mappings by connection ID
      wsUserMap.set(ws.id, userInfo);
      activeUsers.set(userId, userInfo);

      // Join the canvas broadcast channel
      ws.subscribe("canvas-room");

      // Send initial state to the newly connected client
      ws.send({
        type: "init",
        self: userInfo,
        users: Array.from(activeUsers.values()),
        history: strokeHistory,
      });

      // Notify all other clients that a new user joined
      ws.publish("canvas-room", {
        type: "user-joined",
        user: userInfo,
        activeUsers: Array.from(activeUsers.values()),
      });

      console.log(
        `[WS] User joined: ${userInfo.name} (${userId}) | Active: ${activeUsers.size}`,
      );
    },
    message(ws, rawMessage) {
      try {
        const sender = wsUserMap.get(ws.id);
        if (!sender) return;

        const message =
          typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
        if (!message || typeof message !== "object") return;

        switch (message.type) {
          case "draw-segment": {
            if (sender.isAfk) {
              sender.isAfk = false;
              activeUsers.set(sender.id, sender);
              wsUserMap.set(ws.id, sender);
              const afkPayload = {
                type: "user-afk",
                userId: sender.id,
                isAfk: false,
                user: sender,
                activeUsers: Array.from(activeUsers.values()),
              };
              ws.send(afkPayload);
              ws.publish("canvas-room", afkPayload);
            }

            // Broadcast line segment immediately to other clients for real-time rendering
            ws.publish("canvas-room", {
              type: "draw-segment",
              userId: sender.id,
              from: message.from,
              to: message.to,
              color: message.color,
              size: message.size,
              mode: message.mode,
            });
            break;
          }

          case "stroke-end": {
            if (sender.isAfk) {
              sender.isAfk = false;
              activeUsers.set(sender.id, sender);
              wsUserMap.set(ws.id, sender);
              const afkPayload = {
                type: "user-afk",
                userId: sender.id,
                isAfk: false,
                user: sender,
                activeUsers: Array.from(activeUsers.values()),
              };
              ws.send(afkPayload);
              ws.publish("canvas-room", afkPayload);
            }

            // Commit full stroke to history buffer
            if (message.stroke && Array.isArray(message.stroke.points)) {
              const fullStroke: Stroke = {
                id:
                  message.stroke.id ||
                  Math.random().toString(36).substring(2, 9),
                userId: sender.id,
                points: message.stroke.points,
                color: message.stroke.color,
                size: message.stroke.size,
                mode: message.stroke.mode || "pen",
                timestamp: Date.now(),
              };

              strokeHistory.push(fullStroke);
              if (strokeHistory.length > MAX_HISTORY) {
                strokeHistory.shift();
              }

              // Notify peers about committed stroke
              ws.publish("canvas-room", {
                type: "stroke-committed",
                stroke: fullStroke,
              });
            }
            break;
          }

          case "cursor": {
            if (sender.isAfk) {
              sender.isAfk = false;
              activeUsers.set(sender.id, sender);
              wsUserMap.set(ws.id, sender);
              const afkPayload = {
                type: "user-afk",
                userId: sender.id,
                isAfk: false,
                user: sender,
                activeUsers: Array.from(activeUsers.values()),
              };
              ws.send(afkPayload);
              ws.publish("canvas-room", afkPayload);
            }

            // Broadcast mouse pointer coordinate
            ws.publish("canvas-room", {
              type: "cursor",
              userId: sender.id,
              x: message.x,
              y: message.y,
              user: sender,
            });
            break;
          }

          case "afk-status": {
            const isAfk = Boolean(message.isAfk);
            sender.isAfk = isAfk;
            activeUsers.set(sender.id, sender);
            wsUserMap.set(ws.id, sender);

            const afkPayload = {
              type: "user-afk",
              userId: sender.id,
              isAfk,
              user: sender,
              activeUsers: Array.from(activeUsers.values()),
            };
            ws.send(afkPayload);
            ws.publish("canvas-room", afkPayload);
            console.log(
              `[WS] User ${sender.name} (${sender.id}) AFK status: ${isAfk}`,
            );
            break;
          }

          case "undo": {
            // Find and remove the latest stroke from this user
            const lastIndex = strokeHistory.findLastIndex(
              (s) => s.userId === sender.id,
            );
            if (lastIndex !== -1) {
              strokeHistory.splice(lastIndex, 1);

              // Broadcast synchronized history update to all clients including sender
              const updateMsg = {
                type: "sync-history",
                history: strokeHistory,
              };
              ws.send(updateMsg);
              ws.publish("canvas-room", updateMsg);
            }
            break;
          }

          case "update-identity": {
            const newName = String(message.name || "")
              .trim()
              .slice(0, 24);
            if (newName) {
              sender.name = newName;
              activeUsers.set(sender.id, sender);
              wsUserMap.set(ws.id, sender);

              const updatePayload = {
                type: "user-updated",
                user: sender,
                activeUsers: Array.from(activeUsers.values()),
              };
              ws.send(updatePayload);
              ws.publish("canvas-room", updatePayload);
              console.log(`[WS] User ${sender.id} updated name to: ${newName}`);
            }
            break;
          }

          case "clear": {
            // Clear entire canvas history
            strokeHistory.length = 0;

            const clearMsg = { type: "clear" };
            ws.send(clearMsg);
            ws.publish("canvas-room", clearMsg);
            console.log(`[WS] Canvas cleared by ${sender.name}`);
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error("[WS Error] Message parsing error:", err);
      }
    },
    close(ws) {
      const sender = wsUserMap.get(ws.id);
      if (sender) {
        wsUserMap.delete(ws.id);
        activeUsers.delete(sender.id);
        ws.publish("canvas-room", {
          type: "user-left",
          userId: sender.id,
          activeUsers: Array.from(activeUsers.values()),
        });
        console.log(
          `[WS] User left: ${sender.name} (${sender.id}) | Remaining: ${activeUsers.size}`,
        );
      }
    },
  })
  // Serve React fullstack client from public directory with Bun bundling & HMR
  .use(await staticPlugin({ prefix: "/", bunFullstack: true }))
  .listen({ port: PORT, hostname: HOSTNAME, development: false });

console.log(`Canvas Collab server running:`);
console.log(`Local:   http://localhost:${PORT}`);
console.log(`WiFi/LAN: http://${getLocalIP()}:${PORT}`);
console.log(`Bind:    http://${HOSTNAME}:${PORT}`);
