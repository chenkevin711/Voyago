import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectToDatabase, closeDatabaseConnection } from "./config/database";
import authRouter from "./routes/auth";
import tripsRouter from "./routes/trips";
import transportRouter from "./routes/transport";
import accommodationRouter from "./routes/accommodation";
import relationsRouter from "./routes/relations";
import usersRouter from "./routes/users";
import calendarRouter from "./routes/calendar";

const { loadEnvFile } = require("node:process");
loadEnvFile();

const app = express();

app.get("/ping", (_req, res) => res.status(200).send("pong"));

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/transport", transportRouter);
app.use("/api/relations", relationsRouter);
app.use("/api/users", usersRouter);
app.use("/api/accommodations", accommodationRouter);
app.use("/api/calendar", calendarRouter);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, message: "TypeScript backend is running" });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 5001;

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

connectToDatabase();

process.on("SIGINT", () => {
  closeDatabaseConnection();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDatabaseConnection();
  process.exit(0);
});