import express, { Request, Response, Router } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../config/database";
import { authorize } from "../middleware/authorize";
import { tokenStorage } from "../routes/auth";
import { User, Relation } from "../types";

const router: Router = express.Router();

/**
 * Safely parse a route param into an ObjectId. Returns null if invalid.
 */
function parseId(param: string | string[]): ObjectId | null {
  const id = String(param);
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

/**
 * Helper: resolve username from token cookie to a User document
 */
async function getUserFromReq(req: Request): Promise<User | null> {
  const token = req.cookies?.token;
  const username = tokenStorage[token];
  if (!username) return null;
  const usersCollection = getCollection<User>("users");
  return usersCollection.findOne({ username });
}

/**
 * GET /api/users/search?q=<query>&limit=<n>
 *
 * Search users by username (case-insensitive prefix/substring match).
 * Requires authentication.
 * Excludes the current user and users who have blocked them (or vice versa).
 * Returns up to `limit` results (default 20, max 50).
 */
router.get("/search", authorize, async (req: Request, res: Response) => {
  try {
    const currentUser = await getUserFromReq(req);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.status(400).json({ success: false, message: "Query parameter 'q' is required" });
      return;
    }

    const rawLimit = parseInt(String(req.query.limit ?? "20"), 10);
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 20 : rawLimit, 50);

    const usersCollection = getCollection<User>("users");
    const relationsCollection = getCollection<Relation>("relations");

    // Collect IDs of users who have a block relation with the current user
    const blockRelations = await relationsCollection
      .find({
        status: "blocked",
        $or: [
          { user1_id: currentUser._id },
          { user2_id: currentUser._id },
        ],
      })
      .toArray();

    const hiddenIds = blockRelations.map((r) =>
      r.user1_id.equals(currentUser._id!) ? r.user2_id : r.user1_id
    );

    // Search by username — case-insensitive, partial match
    const users = await usersCollection
      .find({
        username: { $regex: q, $options: "i" },
        _id: {
          $nin: [currentUser._id!, ...hiddenIds],
        },
      })
      .project({ password_hash: 0 })
      .limit(limit)
      .toArray();

    res.status(200).json({
      success: true,
      message: "Users found",
      users: users.map((u) => ({
        id: u._id!.toString(),
        username: u.username,
        profile_picture_url: u.profile_picture_url ?? null,
      })),
    });
  } catch (error) {
    console.error("User search error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * GET /api/users/:userId
 *
 * Get a public profile for any user by ID.
 * Requires authentication.
 * Returns 404 if the target has blocked the requester (or vice versa).
 */
router.get("/:userId", authorize, async (req: Request, res: Response) => {
  try {
    const currentUser = await getUserFromReq(req);
    if (!currentUser) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const targetId = parseId(req.params.userId);
    if (!targetId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    const relationsCollection = getCollection<Relation>("relations");

    // Check for any block between the two users
    const block = await relationsCollection.findOne({
      status: "blocked",
      $or: [
        { user1_id: currentUser._id, user2_id: targetId },
        { user1_id: targetId, user2_id: currentUser._id },
      ],
    });

    if (block) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const usersCollection = getCollection<User>("users");
    const user = await usersCollection.findOne(
      { _id: targetId },
      { projection: { password_hash: 0 } }
    );

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    // Determine relation status between the two
    const relation = await relationsCollection.findOne({
      $or: [
        { user1_id: currentUser._id, user2_id: targetId },
        { user1_id: targetId, user2_id: currentUser._id },
      ],
    });

    let relationStatus: "none" | "pending_sent" | "pending_received" | "accepted" = "none";
    if (relation) {
      if (relation.status === "accepted") {
        relationStatus = "accepted";
      } else if (relation.status === "pending") {
        relationStatus = relation.user1_id.equals(currentUser._id!)
          ? "pending_sent"
          : "pending_received";
      }
    }

    res.status(200).json({
      success: true,
      message: "User found",
      user: {
        id: user._id!.toString(),
        username: user.username,
        profile_picture_url: user.profile_picture_url ?? null,
        relationStatus,
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

export default router;