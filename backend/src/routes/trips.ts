import express, { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDatabase, getCollection } from "../config/database";
import type { Trip, Budget, Itinerary, TripAccess } from "../types";
import { getSession } from "../sessionStore";

const router = express.Router();



function getParam(req: Request, name: string): string {
  const v = req.params?.[name];
  if (typeof v !== "string" || v.length === 0) throw new Error(`Missing route param: ${name}`);
  return v;
}

function toObjectId(id: string) {
  if (!ObjectId.isValid(id)) throw new Error("Invalid ObjectId");
  return new ObjectId(id);
}

function requireUserId(req: Request): ObjectId {
  const token = req.cookies?.token;
  if (!token) throw new Error("Not logged in");

  const session = getSession(token);
  if (!session?.userId) throw new Error("Invalid session. Please log in again.");

  return toObjectId(session.userId);
}

function daysBetweenInclusive(startISO: string, endISO: string) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(days, 1);
}

/**
 * Your frontend sometimes sends budget as a NUMBER (simple target),
 * but your backend types model budget as a structured Budget object.
 *
 * This normalizes:
 *  - number -> Budget(method="total", totalBudget=number)
 *  - object -> Budget
 *  - undefined/null -> undefined
 */
function normalizeBudgetInput(input: any): Budget | undefined {
  if (input == null) return undefined;

  // number budget target
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) throw new Error("budget must be a non-negative number");
    const now = new Date().toISOString();
    return {
      currency: "USD",
      method: "total",
      totalBudget: input,
      expenses: [],
      updatedAt: now,
    };
  }

  // structured budget
  if (typeof input === "object") {
    // very light validation; deeper validation can be added later
    if (typeof input.method !== "string") throw new Error("budget.method is required");
    return input as Budget;
  }

  throw new Error("Invalid budget payload");
}

function recalcBudget(startDate: string, endDate: string, budget?: Budget): Budget | undefined {
  if (!budget) return undefined;

  const tripDays = daysBetweenInclusive(startDate, endDate);

  const plannedTotal =
    budget.method === "categories"
      ? (budget.categories ?? []).reduce((s, c) => s + (Number(c.planned) || 0), 0)
      : budget.method === "perDay"
      ? (Number(budget.dailyBudget) || 0) * tripDays
      : Number(budget.totalBudget) || 0;

  const actualTotal = (budget.expenses ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const computed = {
    plannedTotal,
    actualTotal,
    remaining: plannedTotal - actualTotal,
    tripDays,
    perDayPlanned: plannedTotal / tripDays,
  };

  return { ...budget, computed, updatedAt: new Date().toISOString() };
}

async function tripsCol() {
  await connectToDatabase();
  return getCollection<Trip>("trips");
}

async function accessCol() {
  await connectToDatabase();
  return getCollection<TripAccess>("trip_access");
}

/**
 * Returns the current user's role for a given trip:
 * "owner" | "editor" | "viewer" | null (no access).
 */
async function getTripRole(
  userId: ObjectId,
  tripId: ObjectId
): Promise<"owner" | "editor" | "viewer" | null> {
  const col = await tripsCol();
  const trip = await col.findOne({ _id: tripId });
  if (!trip) return null;
  if (trip.userId.equals(userId)) return "owner";

  const acol = await accessCol();
  const entry = await acol.findOne({ tripId, userId });
  return (entry?.role as "editor" | "viewer") ?? null;
}

// CREATE trip
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);

    const { title, destination, destinations, startDate, endDate, notes } = req.body;

    const destList = Array.isArray(destinations) ? destinations.filter(Boolean) : [];
    const primaryDestination = (typeof destination === "string" && destination.trim().length > 0)
      ? destination.trim()
      : (destList[0] ?? "");

    if (!title || !primaryDestination || !startDate || !endDate) {
      return res.status(400).json({ error: "title, destination(s), startDate, endDate required" });
    }

    const now = new Date().toISOString();

    // normalize + compute budget (supports number OR object OR undefined)
    const incomingBudget = normalizeBudgetInput(req.body?.budget);
    const computedBudget = recalcBudget(startDate, endDate, incomingBudget);

    const trip: Trip = {
      userId,
      title,
      destination: primaryDestination,
      destinations: destList.length ? destList : [primaryDestination],
      startDate,
      endDate,
      notes,
      budget: computedBudget,
      itinerary: req.body.itinerary ? ({ ...req.body.itinerary, updatedAt: now } as Itinerary) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const col = await tripsCol();
    const result = await col.insertOne(trip as any);
    const saved = await col.findOne({ _id: result.insertedId, userId });

    return res.status(201).json(saved);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to create trip" });
  }
});

// LIST trips — returns owned trips + trips shared with the user, each with a `userRole` field
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const col = await tripsCol();
    const acol = await accessCol();

    // Owned trips
    const ownedTrips = await col.find({ userId }).sort({ createdAt: -1 }).toArray();

    // Trips shared with this user
    const sharedEntries = await acol.find({ userId }).toArray();
    const sharedTripIds = sharedEntries.map((e) => e.tripId);

    const sharedTrips = sharedTripIds.length
      ? await col.find({ _id: { $in: sharedTripIds } }).sort({ createdAt: -1 }).toArray()
      : [];

    // Count how many trip_access entries exist per trip (each entry = 1 collaborator beyond owner)
    const allTrips = [...ownedTrips, ...sharedTrips];
    const allTripIds = allTrips.map((t) => t._id!);

    const accessCounts = allTripIds.length
      ? await acol
          .aggregate<{ _id: ObjectId; count: number }>([
            { $match: { tripId: { $in: allTripIds } } },
            { $group: { _id: "$tripId", count: { $sum: 1 } } },
          ])
          .toArray()
      : [];

    const countMap = new Map(accessCounts.map((c) => [c._id.toString(), c.count]));

    // membersCount = 1 (owner) + number of explicit access entries for that trip
    const result = [
      ...ownedTrips.map((t) => ({
        ...t,
        userRole: "owner" as const,
        membersCount: 1 + (countMap.get(t._id!.toString()) ?? 0),
      })),
      ...sharedTrips.map((t) => {
        const entry = sharedEntries.find((e) => e.tripId.equals(t._id!));
        return {
          ...t,
          userRole: (entry?.role ?? "viewer") as "editor" | "viewer",
          membersCount: 1 + (countMap.get(t._id!.toString()) ?? 0),
        };
      }),
    ];

    return res.json(result);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to list trips" });
  }
});

// GET trip by id — accessible to owner, editors, and viewers
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const role = await getTripRole(userId, _id);
    if (!role) return res.status(404).json({ error: "Trip not found" });

    const col = await tripsCol();
    const trip = await col.findOne({ _id });

    if (!trip) return res.status(404).json({ error: "Trip not found" });
    return res.json({ ...trip, userRole: role });
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to fetch trip" });
  }
});

/**
 * PATCH /api/trips/:id
 * Supports updating:
 *  - title, destination, destinations, startDate, endDate, notes
 *  - budget (number OR Budget object)
 *
 * Requires owner or editor role.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const role = await getTripRole(userId, _id);
    if (!role) return res.status(404).json({ error: "Trip not found" });
    if (role === "viewer") return res.status(403).json({ error: "Viewers cannot edit trips" });

    const col = await tripsCol();
    const existing = await col.findOne({ _id });
    if (!existing) return res.status(404).json({ error: "Trip not found" });

    const patch: any = {};

    const allowed = ["title", "destination", "startDate", "endDate", "notes"] as const;
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    }

    // destinations support
    if (req.body?.destinations !== undefined) {
      if (!Array.isArray(req.body.destinations)) {
        return res.status(400).json({ error: "destinations must be an array of strings" });
      }
      const destList = req.body.destinations.filter(Boolean);
      patch.destinations = destList;

      // keep destination consistent if they didn't explicitly set it
      if (patch.destination === undefined && destList.length > 0) {
        patch.destination = destList[0];
      }
    }

    // budget supports number OR object
    if (req.body?.budget !== undefined) {
      const normalized = normalizeBudgetInput(req.body.budget);
      patch.budget = normalized; // store as structured Budget
    }

    const nextStart = patch.startDate ?? existing.startDate;
    const nextEnd = patch.endDate ?? existing.endDate;

    // if we have a structured budget, keep computed fields consistent when dates or budget changed
    let nextBudget: any = patch.budget ?? existing.budget;
    if (nextBudget && typeof nextBudget === "object" && (patch.startDate || patch.endDate || patch.budget)) {
      nextBudget = recalcBudget(nextStart, nextEnd, nextBudget as Budget);
    }

    await col.updateOne(
      { _id },
      { $set: { ...patch, budget: nextBudget, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id });
    return res.json({ ...(fresh as any), userRole: role });
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to update trip" });
  }
});

// PATCH itinerary (supports flat or nested) — requires owner or editor
router.patch("/:id/itinerary", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const role = await getTripRole(userId, _id);
    if (!role) return res.status(404).json({ error: "Trip not found" });
    if (role === "viewer") return res.status(403).json({ error: "Viewers cannot edit the itinerary" });

    const col = await tripsCol();
    const trip = await col.findOne({ _id });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const patch = (req.body as any)?.itinerary ?? req.body;

    const prev: Itinerary =
      trip.itinerary ?? ({ selectedAttractions: [], events: [], updatedAt: new Date().toISOString() } as any);

    if (patch?.events !== undefined && !Array.isArray(patch.events)) {
      return res.status(400).json({ error: "itinerary.events must be an array" });
    }

    const next: Itinerary = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await col.updateOne(
      { _id },
      { $set: { itinerary: next, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id });
    return res.json({ ...(fresh as any), userRole: role });
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to update itinerary" });
  }
});

// DELETE trip — owner only
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const role = await getTripRole(userId, _id);
    if (!role) return res.status(404).json({ error: "Trip not found" });
    if (role !== "owner") return res.status(403).json({ error: "Only the trip owner can delete it" });

    const col = await tripsCol();
    const result = await col.deleteOne({ _id });

    if (result.deletedCount === 0) return res.status(404).json({ error: "Trip not found" });

    // Clean up all access entries for this trip
    const acol = await accessCol();
    await acol.deleteMany({ tripId: _id });

    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to delete trip" });
  }
});

export default router;
