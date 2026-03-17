import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { ObjectId } from "mongodb";
import { parse as parseCookie } from "cookie";
import { getSession } from "./sessionStore";
import { getCollection } from "./config/database";
import { Message, Relation, SocketMessage, TripUpdatePayload, TripPresenceUser } from "./types";
import { getTripRole } from "./routes/tripAccess";

/**
 * Maps userId → Set of socket IDs so we can deliver messages to all
 * browser tabs / devices the recipient currently has open.
 */
const onlineUsers = new Map<string, Set<string>>();

/**
 * Trip presence: tripId → Map<userId → { username, socketIds }>
 * Tracks who is currently viewing each trip.
 */
const tripPresence = new Map<string, Map<string, { username: string; socketIds: Set<string> }>>();

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

function addToTripPresence(tripId: string, userId: string, username: string, socketId: string) {
  if (!tripPresence.has(tripId)) tripPresence.set(tripId, new Map());
  const room = tripPresence.get(tripId)!;
  if (!room.has(userId)) room.set(userId, { username, socketIds: new Set() });
  room.get(userId)!.socketIds.add(socketId);
}

function removeFromTripPresence(tripId: string, userId: string, socketId: string): boolean {
  const room = tripPresence.get(tripId);
  if (!room) return false;
  const entry = room.get(userId);
  if (!entry) return false;
  entry.socketIds.delete(socketId);
  if (entry.socketIds.size === 0) room.delete(userId);
  if (room.size === 0) tripPresence.delete(tripId);
  return true;
}

function getPresenceList(tripId: string): TripPresenceUser[] {
  const room = tripPresence.get(tripId);
  if (!room) return [];
  return Array.from(room.entries()).map(([userId, { username }]) => ({ userId, username }));
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
      origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
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

    // ── Messaging ─────────────────────────────────────────────────────────────

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

    // ── Trip Collaboration ────────────────────────────────────────────────────

    /**
     * join_trip: User opens a trip page. Join the Socket.IO room and update presence.
     * Payload: { tripId: string }
     */
    socket.on("join_trip", async (payload: { tripId: string }, ack?: Function) => {
      try {
        if (!ObjectId.isValid(payload.tripId)) {
          return ack?.({ success: false, error: "Invalid tripId" });
        }

        const tripOid = new ObjectId(payload.tripId);
        const userOid = new ObjectId(userId);

        const role = await getTripRole(userOid, tripOid);
        if (!role) {
          return ack?.({ success: false, error: "No access to this trip" });
        }

        const room = `trip:${payload.tripId}`;
        socket.join(room);
        addToTripPresence(payload.tripId, userId, username, socket.id);

        // Broadcast updated presence to the whole room
        const presence = getPresenceList(payload.tripId);
        io.to(room).emit("presence_update", { tripId: payload.tripId, users: presence });

        ack?.({ success: true, role });
      } catch (err) {
        console.error("join_trip error:", err);
        ack?.({ success: false, error: "Server error" });
      }
    });

    /**
     * leave_trip: User navigates away from a trip page.
     * Payload: { tripId: string }
     */
    socket.on("leave_trip", (payload: { tripId: string }) => {
      try {
        const room = `trip:${payload.tripId}`;
        socket.leave(room);
        removeFromTripPresence(payload.tripId, userId, socket.id);

        const presence = getPresenceList(payload.tripId);
        io.to(room).emit("presence_update", { tripId: payload.tripId, users: presence });
      } catch (err) {
        console.error("leave_trip error:", err);
      }
    });

    /**
     * trip_update: Broadcast a trip section change to all other collaborators in the room.
     * Requires editor or owner role.
     * Payload: { tripId, section, data }
     */
    socket.on(
      "trip_update",
      async (payload: { tripId: string; section: string; data: any }, ack?: Function) => {
        try {
          if (!ObjectId.isValid(payload.tripId)) {
            return ack?.({ success: false, error: "Invalid tripId" });
          }

          const tripOid = new ObjectId(payload.tripId);
          const userOid = new ObjectId(userId);
          const role = await getTripRole(userOid, tripOid);

          if (!role || role === "viewer") {
            return ack?.({ success: false, error: "No edit access to this trip" });
          }

          const outbound: TripUpdatePayload = {
            tripId: payload.tripId,
            section: payload.section as any,
            data: payload.data,
            updatedBy: { userId, username },
          };

          // Broadcast to everyone in the room EXCEPT the sender
          socket.to(`trip:${payload.tripId}`).emit("trip_updated", outbound);

          ack?.({ success: true });
        } catch (err) {
          console.error("trip_update error:", err);
          ack?.({ success: false, error: "Server error" });
        }
      }
    );

    // ── Disconnect ────────────────────────────────────────────────────────────

    socket.on("disconnect", () => {
      removeSocket(userId, socket.id);

      // Clean up presence for all trip rooms this socket was in
      for (const [tripId] of tripPresence) {
        const room = tripPresence.get(tripId);
        if (!room) continue;
        const entry = room.get(userId);
        if (!entry || !entry.socketIds.has(socket.id)) continue;

        removeFromTripPresence(tripId, userId, socket.id);
        const presence = getPresenceList(tripId);
        io.to(`trip:${tripId}`).emit("presence_update", { tripId, users: presence });
      }
    });
  });

  return io;
}

/** Socket extended with session data after auth middleware runs. */
interface AuthSocket extends Socket {
  userId: string;
  username: string;
}
