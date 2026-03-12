import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { ObjectId } from "mongodb";
import { parse as parseCookie } from "cookie";
import { getSession } from "./sessionStore";
import { getCollection } from "./config/database";
import { Message, Relation, SocketMessage } from "./types";

/**
 * Maps userId → Set of socket IDs so we can deliver messages to all
 * browser tabs / devices the recipient currently has open.
 */
const onlineUsers = new Map<string, Set<string>>();

function addSocket(userId: string, socketId: string) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId)!.add(socketId);
}

function removeSocket(userId: string, socketId: string) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) onlineUsers.delete(userId);
}

/**
 * Verify that two users are friends (accepted relation exists).
 */
async function areFriends(a: ObjectId, b: ObjectId): Promise<boolean> {
  const col = getCollection<Relation>("relations");
  const rel = await col.findOne({
    status: "accepted",
    $or: [
      { user1_id: a, user2_id: b },
      { user1_id: b, user2_id: a },
    ],
  });
  return rel !== null;
}

/**
 * Attach Socket.IO to an existing HTTP server and return the io instance.
 */
export function attachSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "http://localhost:5173",
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const rawCookie = socket.handshake.headers.cookie ?? "";
    const cookies = parseCookie(rawCookie);
    const token = cookies.token;

    if (!token) return next(new Error("Unauthorized"));

    const session = getSession(token);
    if (!session?.userId) return next(new Error("Unauthorized"));

    (socket as AuthSocket).userId = session.userId;
    (socket as AuthSocket).username = session.username;
    next();
  });

  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthSocket;
    const { userId, username } = socket;

    addSocket(userId, socket.id);

    socket.on( "send_message", async (payload: { toId: string; content: string }, ack) => {
        try {
          const content = (payload.content ?? "").trim();
          if (!content) return ack?.({ success: false, error: "Empty message" });

          if (!ObjectId.isValid(payload.toId))
            return ack?.({ success: false, error: "Invalid recipient" });

          const fromOid = new ObjectId(userId);
          const toOid = new ObjectId(payload.toId);

          if (fromOid.equals(toOid))
            return ack?.({ success: false, error: "Cannot message yourself" });

          if (!(await areFriends(fromOid, toOid)))
            return ack?.({ success: false, error: "Not friends" });

          const col = getCollection<Message>("messages");
          const now = new Date();

          const { insertedId } = await col.insertOne({
            from_id: fromOid,
            to_id: toOid,
            content,
            read: false,
            created_at: now,
          });

          const outbound: SocketMessage = {
            id: insertedId.toString(),
            fromId: userId,
            toId: payload.toId,
            fromUsername: username,
            content,
            createdAt: now.toISOString(),
          };

          // Deliver to all recipient sockets
          const recipientSockets = onlineUsers.get(payload.toId);
          if (recipientSockets) {
            for (const sid of recipientSockets) {
              io.to(sid).emit("new_message", outbound);
            }
          }

          // Echo back to any other tabs the sender has open
          for (const sid of onlineUsers.get(userId) ?? []) {
            if (sid !== socket.id) io.to(sid).emit("new_message", outbound);
          }

          ack?.({ success: true, message: outbound });
        } catch (err) {
          console.error("send_message error:", err);
          ack?.({ success: false, error: "Server error" });
        }
      }
    );

    socket.on("mark_read", async (payload: { fromId: string }) => {
      try {
        if (!ObjectId.isValid(payload.fromId)) return;

        const col = getCollection<Message>("messages");
        await col.updateMany(
          {
            from_id: new ObjectId(payload.fromId),
            to_id: new ObjectId(userId),
            read: false,
          },
          { $set: { read: true } }
        );
      } catch (err) {
        console.error("mark_read error:", err);
      }
    });

    socket.on("disconnect", () => {
      removeSocket(userId, socket.id);
    });
  });

  return io;
}

/** Socket extended with session data after auth middleware runs. */
interface AuthSocket extends Socket {
  userId: string;
  username: string;
}