import express, { Request, Response, Router, CookieOptions } from "express";
import argon2 from "argon2";
import crypto from "crypto";
import { getCollection } from "../config/database";
import { setSession, deleteSession } from "../sessionStore";
import { User, LoginRequest, LoginResponse, RegisterRequest, RegisterResponse } from "../types";

const router: Router = express.Router();

function getRandomToken() {
  return crypto.randomBytes(32).toString("hex");
}

const isProd = process.env.NODE_ENV === "production";

const publicCookieOptions: CookieOptions = {
  secure: isProd,
  sameSite: "lax",
};

const privateCookieOptions: CookieOptions = {
  ...publicCookieOptions,
  httpOnly: true,
};

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as LoginRequest;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" } as LoginResponse);
    }

    const usersCollection = getCollection<User>("users");
    const normalizedEmail = email.toLowerCase().trim();

    const user = await usersCollection.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" } as LoginResponse);
    }

    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid email or password" } as LoginResponse);
    }

    const token = getRandomToken();
    setSession(token, { userId: user._id!.toString(), username: user.username });

    res.cookie("token", token, privateCookieOptions);
    res.cookie("loggedIn", "true", publicCookieOptions);
    res.cookie("username", user.username, publicCookieOptions);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: { id: user._id!.toString(), username: user.username, role: user.role || "user" },
    } as LoginResponse);
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).json({ success: false, message: "An error occurred during login" } as LoginResponse);
  }
});

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body as RegisterRequest;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Please fill out all fields" } as RegisterResponse);
    }

    const usersCollection = getCollection<User>("users");
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await usersCollection.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already exists" } as RegisterResponse);
    }

    const password_hash = await argon2.hash(password);
    const result = await usersCollection.insertOne({
      email: normalizedEmail,
      username,
      password_hash,
      role: "user",
    });

    const token = getRandomToken();
    setSession(token, { userId: result.insertedId.toString(), username });

    res.cookie("token", token, privateCookieOptions);
    res.cookie("loggedIn", "true", publicCookieOptions);
    res.cookie("username", username, publicCookieOptions);

    return res.status(200).json({
      success: true,
      message: "Account creation successful",
      user: { id: result.insertedId.toString(), email: normalizedEmail, username, role: "user" },
    } as RegisterResponse);
  } catch (e) {
    console.error("Register error:", e);
    return res.status(500).json({ success: false, message: "An error occurred during register" } as RegisterResponse);
  }
});

router.post("/logout", (req: Request, res: Response) => {
  const token = req.cookies?.token;
  if (token) deleteSession(token);

  res.clearCookie("token", privateCookieOptions);
  res.clearCookie("loggedIn", publicCookieOptions);
  res.clearCookie("username", publicCookieOptions);

  return res.status(200).json({ success: true, message: "Logged out successfully" });
});

export default router;