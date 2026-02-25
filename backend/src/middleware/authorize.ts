import { Request, Response, NextFunction } from "express";
import { tokenStorage } from "../routes/auth";

export function authorize(req: Request, res: Response, next: NextFunction) {
  let { token } = req.cookies;
  if (token === undefined || !tokenStorage.hasOwnProperty(token)) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  next();
}

export default authorize;