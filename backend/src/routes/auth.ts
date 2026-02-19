import express, {
  Request,
  Response,
  Router,
  CookieOptions
} from "express";
import argon2 from 'argon2';
import crypto from "crypto";
import cookieParser from "cookie-parser";
import { getCollection } from '../config/database';
import { User, LoginRequest, LoginResponse } from '../types';

const router: Router = express.Router();
let tokenStorage: { [key: string]: string } = {};

function getRandomToken() {
  return crypto.randomBytes(32).toString("hex");
}

let publicCookieOptions: CookieOptions = {
  secure: true,
  sameSite: "lax",
};

let privateCookieOptions = { ...publicCookieOptions, httpOnly: true };

/**
 * POST /api/auth/login
 * 
 * Authenticates a user with email and password using Argon2 for password verification
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as LoginRequest;

    // Validate input
    if (!username || !password) {
        res.status(400).json({
            success: false,
            message: 'Username and password are required'
        });
        return;
    }

    // Get users collection
    const usersCollection = getCollection<User>('users');
    
    // Find user by username
    const user = await usersCollection.findOne({ 
        username: username.toLowerCase() 
    });

    if (!user) {
        res.status(401).json({
            success: false,
            message: 'Invalid username or password'
        });
        return;
    }

    // Verify password using Argon2
    const isPasswordValid = await argon2.verify(
        user.password_hash,
        password
    );

    if (!isPasswordValid) {
        res.status(401).json({
            success: false,
            message: 'Invalid username or password'
        });
        return;
    }

    let token = getRandomToken();
    tokenStorage[token] = username;
    res.cookie("token", token, privateCookieOptions);
    res.cookie("loggedIn", "true", publicCookieOptions);
    res.cookie("username", username, publicCookieOptions);

    res.status(200).json({
        success: true,
        message: 'Login successful',
        user: {
            id: user._id!.toString(),
            username: user.username,
            role: user.role || 'user'
        }
    } as LoginResponse);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login'
    } as LoginResponse);
  }
});

router.post('/logout', async(req: Request, res: Response<"">) => {
    let { token } = req.cookies;
    if (token && tokenStorage.hasOwnProperty(token)) {
        delete tokenStorage[token];
    }
    res.clearCookie("token", privateCookieOptions);
    res.clearCookie("loggedIn", publicCookieOptions);
    res.clearCookie("username", publicCookieOptions);
    return res.send();
});

export default router;