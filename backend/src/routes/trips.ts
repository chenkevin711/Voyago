import express, { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDatabase, getCollection } from "../config/database";
import type { Trip, Budget, Expense } from "../types";

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

// Helper: get trips collection
async function tripsCol() {
  await connectToDatabase();
  return getCollection<Trip>("trips");
}

/**
 * IMPORTANT (auth):
 * For now, we read userId from:
 *  - req.query.userId (GET)
 *  - req.body.userId  (POST/PATCH)
 * Replace this with req.user.id once you have auth middleware.
 */
function getFirstString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return undefined;
}

function getUserIdFromReq(req: Request): ObjectId {
  const q = req.query.userId;
  const b = (req.body as any)?.userId;

  const rawQ = Array.isArray(q) ? q[0] : q;
  const rawB = Array.isArray(b) ? b[0] : b;

  const raw = rawQ ?? rawB;

  if (typeof raw !== "string") {
    throw new Error("Missing userId");
  }

  return toObjectId(raw);
}
// CREATE trip
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromReq(req);
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
      createdAt: now,
      updatedAt: now,
    };

    const col = await tripsCol();
    const result = await col.insertOne(trip as any);

    const saved = await col.findOne({ _id: result.insertedId });
    return res.status(201).json(saved);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to create trip" });
  }
});

// GET trip by id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromReq(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const trip = await col.findOne({ _id, userId });

    if (!trip) return res.status(404).json({ error: "Trip not found" });
    return res.json(trip);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to fetch trip" });
  }
});

// PATCH trip details (title/destination/dates/notes)
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromReq(req);
    const _id = toObjectId(getParam(req, "id"));
    const col = await tripsCol();
    const existing = await col.findOne({ _id, userId });
    if (!existing) return res.status(404).json({ error: "Trip not found" });

    const allowed = ["title", "destination", "startDate", "endDate", "notes"] as const;
    const patch: any = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

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
    return res.status(400).json({ error: e.message ?? "Failed to update trip" });
  }
});

// PATCH budget settings/categories
// PATCH budget settings/categories
router.patch("/:id/budget", async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromReq(req);
    const _id = toObjectId(getParam(req, "id"));

    const col = await tripsCol();
    const trip = await col.findOne({ _id, userId });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const prevBudget: Budget = trip.budget ?? {
      currency: "USD",
      method: "total",
      updatedAt: new Date().toISOString(),
    };

    // 🚀 FIX HERE
    const { userId: _ignore, ...budgetPatch } = req.body;

    const merged: Budget = {
      ...prevBudget,
      ...budgetPatch,
      updatedAt: new Date().toISOString(),
    };

    const nextBudget = recalcBudget(trip.startDate, trip.endDate, merged);

    await col.updateOne(
      { _id, userId },
      { $set: { budget: nextBudget, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id, userId });
    return res.json(fresh);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to update budget" });
  }
});

// POST add expense
router.post("/:id/expenses", async (req: Request, res: Response) => {
  try {
    const userId = getUserIdFromReq(req);
    const _id = toObjectId(getParam(req, "id"));

    const { name, amount, category, date, notes } = req.body;
    if (!name || amount === undefined) {
      return res.status(400).json({ error: "name and amount required" });
    }

    const col = await tripsCol();
    const trip = await col.findOne({ _id, userId });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const expense: Expense = {
      _id: new ObjectId(),
      name,
      category,
      amount: Number(amount),
      date: date ?? new Date().toISOString(),
      notes,
    };

    const budget: Budget = trip.budget ?? {
      currency: "USD",
      method: "total",
      updatedAt: new Date().toISOString(),
    };

    const nextBudget = recalcBudget(trip.startDate, trip.endDate, {
      ...budget,
      expenses: [...(budget.expenses ?? []), expense],
    });

    await col.updateOne(
      { _id, userId },
      { $set: { budget: nextBudget, updatedAt: new Date().toISOString() } }
    );

    const fresh = await col.findOne({ _id, userId });
    return res.status(201).json(fresh);
  } catch (e: any) {
    return res.status(400).json({ error: e.message ?? "Failed to add expense" });
  }
});

export default router;