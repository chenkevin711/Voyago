import express, { Request, Response } from 'express'
import cors from 'cors'

const app = express()

// Middleware
app.use(cors())
app.use(express.json())

// Test route
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ ok: true, message: 'TypeScript backend is running' })
})

const PORT = process.env.PORT ? Number(process.env.PORT) : 5000

app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`)
})
