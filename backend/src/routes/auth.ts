import express, { Request, Response, Router, CookieOptions } from "express";
import argon2 from "argon2";
import crypto from "crypto";
import { getCollection } from "../config/database";
import {
  User,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
} from "../types";

const router: Router = express.Router();

// NOTE: in-memory token storage (dev only). For production use JWT or DB/Redis sessions.
let tokenStorage: { [token: string]: string } = {};

function getRandomToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ✅ Cookies must NOT be secure on localhost (http). Secure should only be true in production (https).
const isProd = process.env.NODE_ENV === "production";

const publicCookieOptions: CookieOptions = {
  secure: isProd,
  sameSite: "lax",
};

const privateCookieOptions: CookieOptions = {
  ...publicCookieOptions,
  httpOnly: true,
};

/**
 * POST /api/auth/login
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as LoginRequest;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: "Email and password are required",
      } as LoginResponse);
      return;
    }

    const usersCollection = getCollection<User>("users");

    const normalizedEmail = email.toLowerCase().trim();

    const user = await usersCollection.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
      } as LoginResponse);
      return;
    }

    const isPasswordValid = await argon2.verify(user.password_hash, password);

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
      } as LoginResponse);
      return;
    }

    const token = getRandomToken();
    tokenStorage[token] = user.username;

    res.cookie("token", token, privateCookieOptions);
    res.cookie("loggedIn", "true", publicCookieOptions);
    res.cookie("username", user.username, publicCookieOptions);

    res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        id: user._id!.toString(),
        username: user.username,
        role: user.role || "user",
      },
    } as LoginResponse);
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred during login",
    } as LoginResponse);
  }
});

/**
 * POST /api/auth/register
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body as RegisterRequest;

    if (!username || !email || !password) {
      res.status(400).json({
        success: false,
        message: "Please fill out all fields",
      } as RegisterResponse);
      return;
    }

    const usersCollection = getCollection<User>("users");

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await usersCollection.findOne({ email: normalizedEmail });
    if (existingUser) {
      res.status(400).json({
        success: false,
        message: "Email already exists",
      } as RegisterResponse);
      return;
    }

    const hashed_password = await argon2.hash(password);

    const result = await usersCollection.insertOne({
      email: normalizedEmail,
      username,
      password_hash: hashed_password,
      role: "user",
    });

    // ✅ Optional: log them in immediately after signup (sets cookies + returns user id)
    const token = getRandomToken();
    tokenStorage[token] = username;

    res.cookie("token", token, privateCookieOptions);
    res.cookie("loggedIn", "true", publicCookieOptions);
    res.cookie("username", username, publicCookieOptions);

    res.status(200).json({
      success: true,
      message: "Account creation successful",
      user: {
        id: result.insertedId.toString(),
        email: normalizedEmail,
        username,
        role: "user",
      },
    } as RegisterResponse);
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred during register",
    } as RegisterResponse);
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", (req: Request, res: Response) => {
  const token = req.cookies?.token;

  if (token && tokenStorage[token]) {
    delete tokenStorage[token];
  }

  res.clearCookie("token", privateCookieOptions);
  res.clearCookie("loggedIn", publicCookieOptions);
  res.clearCookie("username", publicCookieOptions);

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

export default router;