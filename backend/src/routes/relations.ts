import express, { Request, Response, Router } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../config/database";
import { authorize } from "../middleware/authorize";
import { getSession } from "../sessionStore";
import { User, Relation, RelationStatus, RelationsResponse, RelationActionResponse } from "../types";

const router: Router = express.Router();

// All relation routes require authentication
router.use(authorize);

/**
 * Safely parse a route param into an ObjectId. Returns null if invalid.
 */
function parseId(param: string | string[]): ObjectId | null {
  const id = String(param);
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

/**
 * Helper: resolve the current user's ObjectId directly from their session token.
 * No DB round-trip needed — userId is stored in the session at login.
 */
function getCurrentUserId(req: Request): ObjectId | null {
  const token = req.cookies?.token;
  if (!token) return null;
  const session = getSession(token);
  if (!session?.userId) return null;
  return parseId(session.userId);
}

/**
 * POST /api/relations/request/:targetUserId
 *
 * Send a friend request to another user.
 * Creates a relation document with status "pending".
 */
router.post("/request/:targetUserId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const targetId = parseId(req.params.targetUserId);
    if (!targetId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    if (currentUserId.equals(targetId)) {
      res.status(400).json({ success: false, message: "Cannot send a friend request to yourself" });
      return;
    }

    const usersCollection = getCollection<User>("users");
    const targetUser = await usersCollection.findOne({ _id: targetId });
    if (!targetUser) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    // Check if any relation already exists between these two users
    const existing = await relationsCollection.findOne({
      $or: [
        { user1_id: currentUserId, user2_id: targetId },
        { user1_id: targetId, user2_id: currentUserId },
      ],
    });

    if (existing) {
      const msg: Record<RelationStatus, string> = {
        pending: "Friend request already sent",
        accepted: "You are already friends",
        blocked: "Unable to send friend request",
      };
      res.status(409).json({ success: false, message: msg[existing.status] });
      return;
    }

    await relationsCollection.insertOne({
      user1_id: currentUserId,
      user2_id: targetId,
      status: "pending",
      created_at: new Date(),
      updated_at: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "Friend request sent",
    } as RelationActionResponse);
  } catch (error) {
    console.error("Send friend request error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * POST /api/relations/accept/:requesterId
 *
 * Accept a pending friend request from requesterId.
 * The requester is user1_id, the current user is user2_id.
 */
router.post("/accept/:requesterId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const requesterId = parseId(req.params.requesterId);
    if (!requesterId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    const relation = await relationsCollection.findOne({
      user1_id: requesterId,
      user2_id: currentUserId,
      status: "pending",
    });

    if (!relation) {
      res.status(404).json({ success: false, message: "No pending friend request found" });
      return;
    }

    await relationsCollection.updateOne(
      { _id: relation._id },
      { $set: { status: "accepted", updated_at: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: "Friend request accepted",
    } as RelationActionResponse);
  } catch (error) {
    console.error("Accept friend request error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * POST /api/relations/decline/:requesterId
 *
 * Decline (delete) a pending friend request from requesterId.
 */
router.post("/decline/:requesterId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const requesterId = parseId(req.params.requesterId);
    if (!requesterId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    const result = await relationsCollection.deleteOne({
      user1_id: requesterId,
      user2_id: currentUserId,
      status: "pending",
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, message: "No pending friend request found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Friend request declined",
    } as RelationActionResponse);
  } catch (error) {
    console.error("Decline friend request error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * DELETE /api/relations/cancel/:targetUserId
 *
 * Cancel a pending friend request that the current user sent.
 */
router.delete("/cancel/:targetUserId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const targetId = parseId(req.params.targetUserId);
    if (!targetId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    const result = await relationsCollection.deleteOne({
      user1_id: currentUserId,
      user2_id: targetId,
      status: "pending",
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, message: "No sent request found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Friend request cancelled",
    } as RelationActionResponse);
  } catch (error) {
    console.error("Cancel friend request error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * DELETE /api/relations/unfriend/:friendId
 *
 * Remove an accepted friendship between current user and friendId.
 */
router.delete("/unfriend/:friendId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const friendId = parseId(req.params.friendId);
    if (!friendId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    const result = await relationsCollection.deleteOne({
      $or: [
        { user1_id: currentUserId, user2_id: friendId },
        { user1_id: friendId, user2_id: currentUserId },
      ],
      status: "accepted",
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, message: "Friendship not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Unfriended successfully",
    } as RelationActionResponse);
  } catch (error) {
    console.error("Unfriend error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * POST /api/relations/block/:targetUserId
 *
 * Block a user. Overwrites any existing relation.
 * The blocking user is always stored as user1_id.
 */
router.post("/block/:targetUserId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const targetId = parseId(req.params.targetUserId);
    if (!targetId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    if (currentUserId.equals(targetId)) {
      res.status(400).json({ success: false, message: "Cannot block yourself" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    // Remove any existing relation first, then insert a block owned by the blocker
    await relationsCollection.deleteOne({
      $or: [
        { user1_id: currentUserId, user2_id: targetId },
        { user1_id: targetId, user2_id: currentUserId },
      ],
    });

    await relationsCollection.insertOne({
      user1_id: currentUserId,
      user2_id: targetId,
      status: "blocked",
      created_at: new Date(),
      updated_at: new Date(),
    });

    res.status(200).json({
      success: true,
      message: "User blocked",
    } as RelationActionResponse);
  } catch (error) {
    console.error("Block user error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * DELETE /api/relations/block/:targetUserId
 *
 * Unblock a previously blocked user.
 */
router.delete("/block/:targetUserId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const targetId = parseId(req.params.targetUserId);
    if (!targetId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    const result = await relationsCollection.deleteOne({
      user1_id: currentUserId,
      user2_id: targetId,
      status: "blocked",
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ success: false, message: "Block not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "User unblocked",
    } as RelationActionResponse);
  } catch (error) {
    console.error("Unblock user error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * GET /api/relations/friends
 *
 * Get the current user's accepted friends list.
 */
router.get("/friends", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");
    const usersCollection = getCollection<User>("users");

    const relations = await relationsCollection
      .find({
        $or: [
          { user1_id: currentUserId },
          { user2_id: currentUserId },
        ],
        status: "accepted",
      })
      .toArray();

    const friendIds = relations.map((r) =>
      r.user1_id.equals(currentUserId) ? r.user2_id : r.user1_id
    );

    const friends = await usersCollection
      .find({ _id: { $in: friendIds } })
      .project({ password_hash: 0 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Friends retrieved",
      users: friends.map((u) => ({
        id: u._id!.toString(),
        username: u.username,
        profile_picture_url: u.profile_picture_url,
      })),
    } as RelationsResponse);
  } catch (error) {
    console.error("Get friends error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * GET /api/relations/pending
 *
 * Get all pending friend requests received by the current user.
 */
router.get("/pending", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");
    const usersCollection = getCollection<User>("users");

    const pending = await relationsCollection
      .find({ user2_id: currentUserId, status: "pending" })
      .toArray();

    const requesterIds = pending.map((r) => r.user1_id);

    const requesters = await usersCollection
      .find({ _id: { $in: requesterIds } })
      .project({ password_hash: 0 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Pending requests retrieved",
      users: requesters.map((u) => ({
        id: u._id!.toString(),
        username: u.username,
        profile_picture_url: u.profile_picture_url,
      })),
    } as RelationsResponse);
  } catch (error) {
    console.error("Get pending requests error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * GET /api/relations/sent
 *
 * Get all pending friend requests sent by the current user (awaiting response).
 */
router.get("/sent", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");
    const usersCollection = getCollection<User>("users");

    const sent = await relationsCollection
      .find({ user1_id: currentUserId, status: "pending" })
      .toArray();

    const recipientIds = sent.map((r) => r.user2_id);

    const recipients = await usersCollection
      .find({ _id: { $in: recipientIds } })
      .project({ password_hash: 0 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Sent requests retrieved",
      users: recipients.map((u) => ({
        id: u._id!.toString(),
        username: u.username,
        profile_picture_url: u.profile_picture_url,
      })),
    } as RelationsResponse);
  } catch (error) {
    console.error("Get sent requests error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * GET /api/relations/blocked
 *
 * Get the list of users blocked by the current user.
 */
router.get("/blocked", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");
    const usersCollection = getCollection<User>("users");

    const blocked = await relationsCollection
      .find({ user1_id: currentUserId, status: "blocked" })
      .toArray();

    const blockedIds = blocked.map((r) => r.user2_id);

    const blockedUsers = await usersCollection
      .find({ _id: { $in: blockedIds } })
      .project({ password_hash: 0 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Blocked users retrieved",
      users: blockedUsers.map((u) => ({
        id: u._id!.toString(),
        username: u.username,
        profile_picture_url: u.profile_picture_url,
      })),
    } as RelationsResponse);
  } catch (error) {
    console.error("Get blocked users error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

export default router;