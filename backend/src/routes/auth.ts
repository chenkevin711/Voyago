import express, {
  Request,
  Response,
  Router,
  CookieOptions
} from "express";
import argon2 from 'argon2';
import crypto from "crypto";
import { getCollection } from '../config/database';
import { User, LoginRequest, LoginResponse, RegisterRequest, RegisterResponse } from '../types';

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
    const { email, password } = req.body as LoginRequest;

    // Validate input
    if (!email || !password) {
        res.status(400).json({
            success: false,
            message: 'Email and password are required'
        });
        return;
    }

    // Get users collection
    const usersCollection = getCollection<User>('users');
    
    // Find user by username
    const user = await usersCollection.findOne({ 
        email: email.toLowerCase() 
    });

    if (!user) {
        res.status(401).json({
            success: false,
            message: 'Invalid email or password'
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
            message: 'Invalid email or password'
        });
        return;
    }

    let token = getRandomToken();
    tokenStorage[token] = user.username;
    res.cookie("token", token, privateCookieOptions);
    res.cookie("loggedIn", "true", publicCookieOptions);
    res.cookie("username", user.username, publicCookieOptions);

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

/*
 * POST /api/auth/register
 * 
 * Validates request and creates account
*/
router.post('/register', async (req: Request, res: Response) => {
    try {
        const { username, email, password } = req.body as RegisterRequest;
        // Validate input
        if(!username || !email || !password) {
            res.status(400).json({
                success: false,
                message: 'Please fill out all fields'
            });
            return;
        }
        // Get users collection
        const usersCollection = getCollection<User>('users');
        
        // Find any existing user with email
        const existingUser = await usersCollection.findOne({ email: email });
        if(existingUser) {
            res.status(400).json({
                success: false,
                message: 'Email already exist'
            });
            return;
        }
        // Hash password with Argon2
        const hashed_password = await argon2.hash(password);
        await usersCollection.insertOne({
                email: email,
                username: username,
                password_hash: hashed_password,
                role: 'user',
        });
        res.status(200).json({
            success: true,
            message: 'Account creation successful',
        } as LoginResponse);
    } catch(error) {
        console.error('Register error:', error);
        res.status(500).json({
        success: false,
        message: 'An error occurred during register'
        } as RegisterResponse);
    }
});

/**
 * POST /api/auth/logout
 * 
 * Logs out user by clearing cookie
 */
router.post('/logout', (req: Request, res: Response) => {
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