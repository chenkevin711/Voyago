import express, { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDatabase, getCollection } from "../config/database";
import type { Trip, TripAccess, User } from "../types";
import { getSession } from "../sessionStore";

const router = express.Router();

function requireUserId(req: Request): ObjectId {
  const token = req.cookies?.token;
  if (!token) throw new Error("Not logged in");
  const session = getSession(token);
  if (!session?.userId) throw new Error("Invalid session. Please log in again.");
  return new ObjectId(session.userId);
}

function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new Error("Invalid ObjectId");
  return new ObjectId(id);
}

async function setup() {
  await connectToDatabase();
  return {
    trips: getCollection<Trip>("trips"),
    access: getCollection<TripAccess>("trip_access"),
    users: getCollection<User>("users"),
  };
}

/**
 * Resolve trip ownership and access for a given user.
 * Returns "owner" | "editor" | "viewer" | null (no access).
 */
export async function getTripRole(
  userId: ObjectId,
  tripId: ObjectId
): Promise<"owner" | "editor" | "viewer" | null> {
  const { trips, access } = await setup();
  const trip = await trips.findOne({ _id: tripId });
  if (!trip) return null;
  if (trip.userId.equals(userId)) return "owner";
  const entry = await access.findOne({ tripId, userId });
  return (entry?.role as "editor" | "viewer") ?? null;
}

// ── GET /api/trip-access/:tripId ──────────────────────────────────────────────
// List all access entries for a trip. Owner + editors + viewers can see this.
router.get("/:tripId", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const tripId = toObjectId(String(req.params.tripId));

    const role = await getTripRole(userId, tripId);
    if (!role) return res.status(404).json({ error: "Trip not found or no access" });

    const { trips, access, users } = await setup();
    const trip = await trips.findOne({ _id: tripId });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    // Owner entry (implicit)
    const ownerDoc = await users.findOne({ _id: trip.userId });
    const entries: any[] = [
      {
        userId: trip.userId.toString(),
        username: ownerDoc?.username ?? "Unknown",
        role: "owner",
      },
    ];

    // Fetch all explicit access entries
    const accessRows = await access.find({ tripId }).toArray();
    for (const row of accessRows) {
      const userDoc = await users.findOne({ _id: row.userId });
      entries.push({
        userId: row.userId.toString(),
        username: userDoc?.username ?? "Unknown",
        role: row.role,
        invitedBy: row.invitedBy.toString(),
      });
    }

    return res.json({ success: true, access: entries });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to fetch access" });
  }
});

// ── POST /api/trip-access/:tripId ─────────────────────────────────────────────
// Invite a user to the trip. Only the owner can invite.
// Body: { userId: string, role: "editor" | "viewer" }
router.post("/:tripId", async (req: Request, res: Response) => {
  try {
    const requesterId = requireUserId(req);
    const tripId = toObjectId(String(req.params.tripId));

    const role = await getTripRole(requesterId, tripId);
    if (role !== "owner") return res.status(403).json({ error: "Only the trip owner can invite collaborators" });

    const { userId: targetUserIdStr, role: newRole } = req.body;
    if (!targetUserIdStr || !ObjectId.isValid(targetUserIdStr)) {
      return res.status(400).json({ error: "Valid userId is required" });
    }
    if (newRole !== "editor" && newRole !== "viewer") {
      return res.status(400).json({ error: "role must be 'editor' or 'viewer'" });
    }

    const targetUserId = new ObjectId(targetUserIdStr);

    if (targetUserId.equals(requesterId)) {
      return res.status(400).json({ error: "Cannot invite yourself" });
    }

    const { users, access } = await setup();

    // Verify target user exists
    const targetUser = await users.findOne({ _id: targetUserId });
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    // Upsert access entry
    await access.updateOne(
      { tripId, userId: targetUserId },
      {
        $set: {
          tripId,
          userId: targetUserId,
          role: newRole,
          invitedBy: requesterId,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    return res.json({
      success: true,
      access: {
        userId: targetUserId.toString(),
        username: targetUser.username,
        role: newRole,
      },
    });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to invite user" });
  }
});

// ── PATCH /api/trip-access/:tripId/:userId ────────────────────────────────────
// Change a collaborator's role. Only owner can do this.
// Body: { role: "editor" | "viewer" }
router.patch("/:tripId/:userId", async (req: Request, res: Response) => {
  try {
    const requesterId = requireUserId(req);
    const tripId = toObjectId(String(req.params.tripId));
    const targetUserId = toObjectId(String(req.params.userId));

    const role = await getTripRole(requesterId, tripId);
    if (role !== "owner") return res.status(403).json({ error: "Only the trip owner can change roles" });

    const { role: newRole } = req.body;
    if (newRole !== "editor" && newRole !== "viewer") {
      return res.status(400).json({ error: "role must be 'editor' or 'viewer'" });
    }

    const { access } = await setup();
    const result = await access.updateOne(
      { tripId, userId: targetUserId },
      { $set: { role: newRole } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: "Access entry not found" });

    return res.json({ success: true });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to update role" });
  }
});

// ── DELETE /api/trip-access/:tripId/:userId ───────────────────────────────────
// Remove a collaborator. Only owner can remove others; a user can also remove themselves.
router.delete("/:tripId/:userId", async (req: Request, res: Response) => {
  try {
    const requesterId = requireUserId(req);
    const tripId = toObjectId(String(req.params.tripId));
    const targetUserId = toObjectId(String(req.params.userId));

    const requesterRole = await getTripRole(requesterId, tripId);
    if (!requesterRole) return res.status(404).json({ error: "Trip not found or no access" });

    // Allow owner to remove anyone, or a user to remove themselves
    if (requesterRole !== "owner" && !requesterId.equals(targetUserId)) {
      return res.status(403).json({ error: "Only the trip owner can remove collaborators" });
    }

    const { access } = await setup();
    await access.deleteOne({ tripId, userId: targetUserId });

    return res.json({ success: true });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to remove access" });
  }
});

export default router;
