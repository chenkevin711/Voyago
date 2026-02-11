import express, { Request, Response } from 'express'
import cors from 'cors'
import { connectToDatabase, closeDatabaseConnection } from './config/database'
import authRouter from './routes/auth'

const app = express()

// Middleware
app.use(cors())
app.use(express.json())

// Mount auth routes
app.use('/api/auth', authRouter)

// Load environment variables from the .env file
const { loadEnvFile } = require('node:process');
loadEnvFile();


// Test route
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ ok: true, message: 'TypeScript backend is running' })
})

const PORT = process.env.PORT ? Number(process.env.PORT) : 5000

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