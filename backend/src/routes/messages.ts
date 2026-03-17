import express, { Request, Response, Router } from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "../config/database";
import { authorize } from "../middleware/authorize";
import { getSession } from "../sessionStore";
import { Message, Relation, ConversationSummary, User } from "../types";

const router: Router = express.Router();
router.use(authorize);

function parseId(param: string): ObjectId | null {
  if (!ObjectId.isValid(param)) return null;
  return new ObjectId(param);
}

function getCurrentUserId(req: Request): ObjectId | null {
  const token = req.cookies?.token;
  if (!token) return null;
  const session = getSession(token);
  if (!session?.userId) return null;
  return parseId(session.userId);
}

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
 * GET /api/messages/conversations
 *
 * Returns a summary of every conversation the current user participates in,
 * ordered by most recent message. Each entry includes the unread count.
 */
router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const messagesCol = getCollection<Message>("messages");
    const usersCol = getCollection<User>("users");

    // Aggregate: group by the "other" user, pick latest message + unread count
    const rows = await messagesCol
      .aggregate<{
        _id: ObjectId;
        lastMessage: string;
        lastMessageAt: Date;
        unreadCount: number;
      }>([
        {
          $match: {
            $or: [{ from_id: currentUserId }, { to_id: currentUserId }],
          },
        },
        {
          $sort: { created_at: -1 },
        },
        {
          $group: {
            _id: {
              $cond: [
                { $eq: ["$from_id", currentUserId] },
                "$to_id",
                "$from_id",
              ],
            },
            lastMessage: { $first: "$content" },
            lastMessageAt: { $first: "$created_at" },
            unreadCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$to_id", currentUserId] },
                      { $eq: ["$read", false] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { lastMessageAt: -1 } },
      ])
      .toArray();

    const partnerIds = rows.map((r) => r._id);
    const partners = await usersCol
      .find({ _id: { $in: partnerIds } })
      .project({ password_hash: 0 })
      .toArray();

    const partnerMap = new Map(partners.map((p) => [p._id!.toString(), p]));

    const conversations: ConversationSummary[] = rows
      .map((r) => {
        const partner = partnerMap.get(r._id.toString());
        if (!partner) return null;
        return {
          userId: partner._id!.toString(),
          username: partner.username,
          profile_picture_url: partner.profile_picture_url,
          lastMessage: r.lastMessage,
          lastMessageAt: r.lastMessageAt.toISOString(),
          unreadCount: r.unreadCount,
        } satisfies ConversationSummary;
      })
      .filter(Boolean) as ConversationSummary[];

    res.status(200).json({ success: true, conversations });
  } catch (err) {
    console.error("conversations error:", err);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * GET /api/messages/unread-count
 *
 * Returns the total number of unread messages for the current user across
 * all conversations. Used by the Navbar badge.
 */
router.get("/unread-count", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const col = getCollection<Message>("messages");
    const count = await col.countDocuments({
      to_id: currentUserId,
      read: false,
    });

    res.status(200).json({ success: true, count });
  } catch (err) {
    console.error("unread-count error:", err);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

/**
 * GET /api/messages/:partnerId?before=<ISO>&limit=<n>
 *
 * Fetch paginated message history with one other user (must be friends).
 * Returns messages in ascending chronological order.
 */
router.get("/:partnerId", async (req: Request, res: Response) => {
  try {
    const currentUserId = getCurrentUserId(req);
    if (!currentUserId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const partnerId = parseId(String(req.params.partnerId));
    if (!partnerId) {
      res.status(400).json({ success: false, message: "Invalid user id" });
      return;
    }

    if (!(await areFriends(currentUserId, partnerId))) {
      res.status(403).json({ success: false, message: "Not friends" });
      return;
    }

    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 50 : rawLimit, 100);

    const col = getCollection<Message>("messages");

    const filter: Record<string, unknown> = {
      $or: [
        { from_id: currentUserId, to_id: partnerId },
        { from_id: partnerId, to_id: currentUserId },
      ],
    };

    if (req.query.before) {
      const before = new Date(String(req.query.before));
      if (!isNaN(before.getTime())) filter.created_at = { $lt: before };
    }

    const messages = await col
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    messages.reverse();

    res.status(200).json({
      success: true,
      messages: messages.map((m) => ({
        id: m._id!.toString(),
        fromId: m.from_id.toString(),
        toId: m.to_id.toString(),
        content: m.content,
        read: m.read,
        createdAt: m.created_at.toISOString(),
      })),
    });
  } catch (err) {
    console.error("messages history error:", err);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
});

export default router;
