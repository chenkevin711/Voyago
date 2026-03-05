import express, { Request, Response } from 'express'
import cors from 'cors'
import { connectToDatabase, closeDatabaseConnection } from './config/database'
import authRouter from './routes/auth'
import relationsRouter from './routes/relations'
import usersRouter from './routes/users'
import cookieParser from "cookie-parser";
import tripsRouter from "./routes/trips";
import transportRouter from "./routes/transport";

const app = express()

app.get("/ping", (req, res) => res.status(200).send("pong"));

// Middleware
app.use(cors({
    origin: "http://localhost:5173", // frontend dev server
    credentials: true
}));

app.use(express.json())
app.use(cookieParser());
app.use("/api/trips", tripsRouter);
app.use("/api/transport", transportRouter);
// Mount auth routes
app.use('/api/auth', authRouter)
app.use('/api/relations', relationsRouter)
app.use('/api/users', usersRouter)

// Load environment variables from the .env file
const { loadEnvFile } = require('node:process');
loadEnvFile();

// Test route
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ ok: true, message: 'TypeScript backend is running' })
})

const PORT = process.env.PORT ? Number(process.env.PORT) : 5001

app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`)
})

// Connect to DB
connectToDatabase();

// Graceful Shutdown Handlers
process.on("SIGINT", () => {
    closeDatabaseConnection();
    process.exit(0);
});

process.on("SIGTERM", () => {
    closeDatabaseConnection();
    process.exit(0);
});