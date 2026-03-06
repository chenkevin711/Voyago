<<<<<<< HEAD
import express, { Request, Response } from 'express'
import cors from 'cors'
import { connectToDatabase, closeDatabaseConnection } from './config/database'
import authRouter from './routes/auth'
import relationsRouter from './routes/relations'
import usersRouter from './routes/users'
=======
import express, { Request, Response } from "express";
import cors from "cors";
>>>>>>> a67dfc2 (Add trip calendar month and week views and budget feature addition)
import cookieParser from "cookie-parser";
import { connectToDatabase, closeDatabaseConnection } from "./config/database";
import authRouter from "./routes/auth";
import tripsRouter from "./routes/trips";
<<<<<<< HEAD
import transportRouter from "./routes/transport";
import accommodationRouter from "./routes/accommodation"
=======
import calendarRouter from "./routes/calendar";
>>>>>>> a67dfc2 (Add trip calendar month and week views and budget feature addition)

const { loadEnvFile } = require("node:process");
loadEnvFile();

const app = express();

app.get("/ping", (req, res) => res.status(200).send("pong"));

// Middleware
<<<<<<< HEAD
app.use(cors({
    origin: "http://localhost:5173", // frontend dev server
    credentials: true
}));
=======
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
>>>>>>> a67dfc2 (Add trip calendar month and week views and budget feature addition)

app.use(express.json());
app.use(cookieParser());
<<<<<<< HEAD
app.use("/api/trips", tripsRouter);
app.use("/api/transport", transportRouter);
app.use('/api/auth', authRouter)
app.use('/api/relations', relationsRouter)
app.use('/api/users', usersRouter)
app.use('/api/accommodations', accommodationRouter)
=======
>>>>>>> a67dfc2 (Add trip calendar month and week views and budget feature addition)

// Routes (mount AFTER middleware)
app.use("/api/auth", authRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/calendar", calendarRouter);

// Test route
app.get("/api/health", (req: Request, res: Response) => {
  res.json({ ok: true, message: "TypeScript backend is running" });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 5001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

// Connect to DB
connectToDatabase();

// Graceful Shutdown
process.on("SIGINT", () => {
  closeDatabaseConnection();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDatabaseConnection();
  process.exit(0);
});