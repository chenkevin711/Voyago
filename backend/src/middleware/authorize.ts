import { Request, Response, NextFunction } from "express";
import { getSession } from "../sessionStore";

export function authorize(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const session = getSession(token);
  if (!session?.userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  next();
}