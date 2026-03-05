import express, { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDatabase, getCollection } from "../config/database";
import type { Trip, Budget, Itinerary } from "../types";
import { getSession } from "../sessionStore";

const router = express.Router();

function getParam(req: Request, name: string): string {
  const v = req.params?.[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing route param: ${name}`);
  }
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

// CREATE trip (this is the "save" endpoint)
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const { title, destination, startDate, endDate, notes, budget } = req.body;

    if (!title || !destination || !startDate || !endDate) {
      return res.status(400).json({ error: "title, destination, startDate, endDate required" });
    }

    const now = new Date().toISOString();

    const trip: Trip = {
      userId,
      title,
      destination,
      startDate,
      endDate,
      notes,
      budget: recalcBudget(startDate, endDate, budget),
      itinerary: req.body.itinerary ? ({ ...req.body.itinerary, updatedAt: now } as Itinerary) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const col = await tripsCol();
    const result = await col.insertOne(trip as any);
    const saved = await col.findOne({ _id: result.insertedId, userId });

    return res.status(201).json(saved);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to create trip" });
  }
});

// LIST trips
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const col = await tripsCol();

    const trips = await col.find({ userId }).sort({ createdAt: -1 }).toArray();
    return res.json(trips);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to list trips" });
  }
});

// GET trip by id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const trip = await col.findOne({ _id, userId });

    if (!trip) return res.status(404).json({ error: "Trip not found" });
    return res.json(trip);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to fetch trip" });
  }
});
// PATCH /api/trips/:id  (update budget, etc.)
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const id = toObjectId(getParam(req, "id"));

    const { budget } = req.body ?? {};
    if (budget !== undefined && (typeof budget !== "number" || budget < 0)) {
      return res.status(400).json({ error: "budget must be a non-negative number" });
    }

    const trips = getCollection("trips");

    const update: any = {};
    if (budget !== undefined) update.budget = budget;

    const result = await trips.updateOne(
      { _id: id, userId }, // enforce ownership
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Trip not found" });
    }

    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Failed to update trip" });
  }
});
// PATCH trip (core fields)
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const existing = await col.findOne({ _id, userId });
    if (!existing) return res.status(404).json({ error: "Trip not found" });

    const allowed = ["title", "destination", "startDate", "endDate", "notes"] as const;
    const patch: any = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];

    const nextStart = patch.startDate ?? existing.startDate;
    const nextEnd = patch.endDate ?? existing.endDate;
    const nextBudget = recalcBudget(nextStart, nextEnd, existing.budget);

    await col.updateOne(
      { _id, userId },
      { $set: { ...patch, budget: nextBudget, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id, userId });
    return res.json(fresh);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to update trip" });
  }
});

// PATCH itinerary
// Supports BOTH payload shapes:
//  A) { flights, selectedFlight, ... }  (flat)
//  B) { itinerary: { flights, selectedFlight, ... } }  (nested)
router.patch("/:id/itinerary", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const trip = await col.findOne({ _id, userId });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const patch = (req.body as any)?.itinerary ?? req.body;

    const prev: Itinerary =
      trip.itinerary ?? ({ selectedAttractions: [], events: [], updatedAt: new Date().toISOString() } as any);

    // Minimal guard: if events exists, ensure it's an array
    if (patch?.events !== undefined && !Array.isArray(patch.events)) {
      return res.status(400).json({ error: "itinerary.events must be an array" });
    }

    const next: Itinerary = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await col.updateOne(
      { _id, userId },
      { $set: { itinerary: next, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id, userId });
    return res.json(fresh);
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to update itinerary" });
  }
});

// DELETE trip
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const result = await col.deleteOne({ _id, userId });

    if (result.deletedCount === 0) return res.status(404).json({ error: "Trip not found" });
    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(401).json({ error: e.message ?? "Failed to delete trip" });
  }
});

export default router;