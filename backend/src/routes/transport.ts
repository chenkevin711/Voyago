import express, { Request, Response } from "express"
import fs from "fs"
import path from "path"

const router = express.Router()

// SerpApi + OpenStreetMap endpoints
const SERP_API_BASE = "https://serpapi.com/search.json"
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
const OVERPASS_BASE = "https://overpass-api.de/api/interpreter"

// -------------------------
// Types
// -------------------------
type AirportResolution = {
    input: string
    inputType: "city" | "airport_code"
    cityName?: string
    airport: {
        code: string
        name: string
        lat: number
        lng: number
    }
}

type Segment = {
    // Train and car are still in the type so the frontend stays compatible,
    // but we will not generate those modes for now.
    mode: "flight" | "train" | "car"
    summary: string
    durationMinutes?: number
    priceUsd?: number
}

type PlanOption = {
    title: string
    totalDurationMinutes?: number
    totalPriceUsd?: number
    score: number
    segments: Segment[]
}

type OverpassElement = {
    type: "node" | "way" | "relation"
    id: number
    lat?: number
    lon?: number
    center?: { lat: number; lon: number }
    tags?: Record<string, string>
}

// -------------------------
// Small utilities
// -------------------------
function isAirportCode(input: string): boolean {
    return /^[A-Za-z]{3}$/.test(input.trim())
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const toRad = (x: number) => (x * Math.PI) / 180
    const R = 6371

    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)

    const lat1 = toRad(a.lat)
    const lat2 = toRad(b.lat)

    const h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)

    return 2 * R * Math.asin(Math.sqrt(h))
}

function toMinutes(duration: string): number | undefined {
    // Supports strings like "2 hr 15 min" or "55 min"
    const m = /([0-9]+)\s*min/.exec(duration)
    const h = /([0-9]+)\s*hr/.exec(duration)
    if (!m && !h) return undefined
    return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0)
}

function parsePriceUsd(value: any): number | undefined {
    // SerpApi price can appear as:
    // - 312
    // - "$312"
    // - { amount: 312, currency: "USD" }
    // - { raw: "$312" }
    if (value == null) return undefined

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined
    }

    if (typeof value === "object") {
        const amount = (value as any).amount
        if (typeof amount === "number" && Number.isFinite(amount)) return amount
        return parsePriceUsd((value as any).raw)
    }

    if (typeof value === "string") {
        const cleaned = value.replace(/[^0-9.]/g, "")
        if (!cleaned) return undefined
        const n = Number(cleaned)
        return Number.isFinite(n) ? n : undefined
    }

    return undefined
}

function parseDurationMinutes(value: any): number | undefined {
    // SerpApi total_duration can be a number (minutes) or a string like "2 hr 15 min"
    if (value == null) return undefined
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined
    if (typeof value === "string") return toMinutes(value)
    return undefined
}

function isIsoDate(dateStr: string) {
    // SerpApi expects YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
    const [y, m, d] = dateStr.split("-").map((x) => Number(x))
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false
    if (m < 1 || m > 12) return false
    if (d < 1 || d > 31) return false
    return true
}

function redactApiKeyInUrl(u: string) {
    // Never log raw SerpApi keys
    return u.replace(/api_key=[^&]+/i, "api_key=REDACTED")
}

// -------------------------
// Fetch with readable errors + retry/backoff
// -------------------------
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: {
            "User-Agent": "Voyago/1.0",
            ...(init?.headers ?? {}),
        },
    })

    if (!res.ok) {
        const text = await res.text().catch(() => "")
        const snippet = text.slice(0, 700)
        const safeUrl = redactApiKeyInUrl(url)
        throw new Error(`Request failed: ${res.status} ${res.statusText} url=${safeUrl} body=${snippet}`)
    }

    return (await res.json()) as T
}

function getStatusCodeFromErrorMessage(message?: string) {
    if (!message) return undefined
    const m = /Request failed:\s+(\d{3})\s+/i.exec(message)
    return m ? Number(m[1]) : undefined
}

async function fetchJsonWithRetry<T>(
    url: string,
    init: RequestInit | undefined,
    label: string,
    retries = 3
): Promise<T> {
    let attempt = 0

    while (true) {
        try {
            return await fetchJson<T>(url, init)
        } catch (e: any) {
            attempt += 1
            const msg = String(e?.message ?? "")
            const code = getStatusCodeFromErrorMessage(msg)

            // Retry rate limits and common transient upstream failures
            const retryable = code === 429 || code === 502 || code === 503 || code === 504
            if (!retryable || attempt > retries) throw e

            const base = 500 * Math.pow(2, attempt - 1)
            const jitter = Math.floor(Math.random() * 200)
            const waitMs = base + jitter

            console.log(`[retry] ${label} attempt ${attempt}/${retries} failed (${code}), waiting ${waitMs}ms`)
            await sleep(waitMs)
        }
    }
}

// -------------------------
// Overpass throttle (1 at a time) to reduce 429 risk
// -------------------------
let overpassInFlight = Promise.resolve()

function enqueueOverpass<T>(task: () => Promise<T>): Promise<T> {
    const run = overpassInFlight.then(task, task)
    overpassInFlight = run.then(
        () => undefined,
        () => undefined
    )
    return run
}

// -------------------------
// Airport resolution cache (in-memory)
// -------------------------
type CacheEntry = { value: AirportResolution | null; expiresAt: number }
const airportCache = new Map<string, CacheEntry>()
const AIRPORT_CACHE_TTL_MS = 1000 * 60 * 60 * 6

function cacheKey(input: string) {
    return input.trim().toLowerCase()
}

function cacheGet(input: string): AirportResolution | null | undefined {
    const key = cacheKey(input)
    const entry = airportCache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
        airportCache.delete(key)
        return undefined
    }
    return entry.value
}

function cacheSet(input: string, value: AirportResolution | null) {
    const key = cacheKey(input)
    airportCache.set(key, { value, expiresAt: Date.now() + AIRPORT_CACHE_TTL_MS })
}

// -------------------------
// airports.csv (OurAirports) commercial airport lookup
// Assumes airports.csv is located next to the compiled routes output:
//   src/airports.csv  -> runtime path: path.join(__dirname, "..", "airports.csv")
// -------------------------
type CommercialAirport = {
    code: string
    name: string
    lat: number
    lng: number
    type?: string
    scheduledService?: string
    municipality?: string
}

let airportsLoaded = false
let commercialAirports: CommercialAirport[] = []
let airportByIata = new Map<string, CommercialAirport>()

function parseCsvLine(line: string) {
    const out: string[] = []
    let cur = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
        const ch = line[i]

        if (ch === '"') {
            const next = line[i + 1]
            if (inQuotes && next === '"') {
                cur += '"'
                i += 1
            } else {
                inQuotes = !inQuotes
            }
            continue
        }

        if (ch === "," && !inQuotes) {
            out.push(cur)
            cur = ""
            continue
        }

        cur += ch
    }

    out.push(cur)
    return out
}

function loadAirportsCsvOnce() {
    if (airportsLoaded) return
    airportsLoaded = true

    const csvPath = path.join(__dirname, "..", "airports.csv")

    if (!fs.existsSync(csvPath)) {
        console.warn(`[airports.csv] not found at ${csvPath}`)
        return
    }

    const raw = fs.readFileSync(csvPath, "utf8")
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length < 2) return

    const header = parseCsvLine(lines[0]).map((h) => h.trim())
    const idx = (name: string) => header.indexOf(name)

    const iataIdx = idx("iata_code")
    const nameIdx = idx("name")
    const latIdx = idx("latitude_deg")
    const lngIdx = idx("longitude_deg")
    const typeIdx = idx("type")
    const schedIdx = idx("scheduled_service")
    const munIdx = idx("municipality")

    if (iataIdx < 0 || nameIdx < 0 || latIdx < 0 || lngIdx < 0 || schedIdx < 0) {
        console.warn(
            "[airports.csv] missing required columns (need iata_code, name, latitude_deg, longitude_deg, scheduled_service)"
        )
        return
    }

    const allCommercial: CommercialAirport[] = []
    const byIata = new Map<string, CommercialAirport>()

    const rankType = (t?: string) => {
        const tt = (t ?? "").toLowerCase()
        if (tt === "large_airport") return 3
        if (tt === "medium_airport") return 2
        if (tt === "small_airport") return 1
        return 0
    }

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i])

        const code = (cols[iataIdx] ?? "").trim().toUpperCase()
        if (!code) continue

        const scheduled = (cols[schedIdx] ?? "").trim().toLowerCase()
        if (scheduled !== "yes") continue

        const lat = Number(cols[latIdx])
        const lng = Number(cols[lngIdx])
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

        const airport: CommercialAirport = {
            code,
            name: (cols[nameIdx] ?? "").trim() || `${code} Airport`,
            lat,
            lng,
            type: typeIdx >= 0 ? (cols[typeIdx] ?? "").trim() : undefined,
            scheduledService: scheduled,
            municipality: munIdx >= 0 ? (cols[munIdx] ?? "").trim() : undefined,
        }

        const existing = byIata.get(code)
        if (!existing) {
            byIata.set(code, airport)
            allCommercial.push(airport)
            continue
        }

        // Prefer higher type if duplicates exist
        if (rankType(airport.type) > rankType(existing.type)) {
            byIata.set(code, airport)
            const idxList = allCommercial.findIndex((a) => a.code === code)
            if (idxList >= 0) allCommercial[idxList] = airport
        }
    }

    commercialAirports = allCommercial
    airportByIata = byIata

    console.log(`[airports.csv] loaded commercial airports: ${commercialAirports.length}`)
}

function findAirportByCodeFromCsv(code: string) {
    loadAirportsCsvOnce()
    return airportByIata.get(code.trim().toUpperCase()) ?? null
}

function airportTypeBonusKm(type?: string) {
    // Big bonuses so CDG/LHR beat “closer” business airports
    const t = (type ?? "").toLowerCase()
    if (t === "large_airport") return -120
    if (t === "medium_airport") return -40
    if (t === "small_airport") return -10
    return 0
}

function nameBonusKm(name: string) {
    const n = name.toLowerCase()
    let bonus = 0
    if (n.includes("international")) bonus -= 15
    if (n.includes("municipal")) bonus += 10
    if (n.includes("executive")) bonus += 10
    return bonus
}

function findNearestCommercialAirportFromCsv(lat: number, lng: number) {
    loadAirportsCsvOnce()
    if (commercialAirports.length === 0) return null

    let best: CommercialAirport | null = null
    let bestScore = Infinity

    for (const a of commercialAirports) {
        const km = haversineKm({ lat, lng }, { lat: a.lat, lng: a.lng })
        const score = km + airportTypeBonusKm(a.type) + nameBonusKm(a.name)

        if (score < bestScore) {
            bestScore = score
            best = a
        }
    }

    return best
}

// -------------------------
// Nominatim + Overpass helpers
// -------------------------
async function geocodeCityCandidates(city: string, limit = 5): Promise<Array<{ lat: number; lng: number; displayName: string }>> {
    const url = new URL(`${NOMINATIM_BASE}/search`)
    url.searchParams.set("q", city)
    url.searchParams.set("format", "jsonv2")
    url.searchParams.set("limit", String(limit))

    const data = await fetchJsonWithRetry<Array<{ lat: string; lon: string; display_name: string }>>(
        url.toString(),
        undefined,
        "nominatim",
        3
    )

    return data
        .map((item) => ({
            lat: Number(item.lat),
            lng: Number(item.lon),
            displayName: item.display_name,
        }))
        .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng))
}

async function findNearestAirportToPointOverpass(lat: number, lng: number): Promise<AirportResolution["airport"] | null> {
    const query = `
[out:json][timeout:25];
(
  node(around:160000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
  way(around:160000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
  relation(around:160000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
);
out center tags;
`

    const body = new URLSearchParams({ data: query }).toString()

    const data = await enqueueOverpass(async () => {
        return fetchJsonWithRetry<{ elements?: OverpassElement[] }>(
            OVERPASS_BASE,
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
            },
            "overpass-nearest",
            3
        )
    })

    const elements = data.elements ?? []
    if (elements.length === 0) return null

    const withDistance = elements
        .map((el) => {
            const pointLat = el.lat ?? el.center?.lat
            const pointLng = el.lon ?? el.center?.lon
            const code = el.tags?.iata
            if (pointLat == null || pointLng == null || !code) return null

            // For ranking "closest", squared distance is fine (no sqrt)
            const dx = pointLat - lat
            const dy = pointLng - lng
            const distance = dx * dx + dy * dy

            return {
                code: code.toUpperCase(),
                name: el.tags?.name ?? `${code.toUpperCase()} Airport`,
                lat: pointLat,
                lng: pointLng,
                distance,
            }
        })
        .filter((x): x is { code: string; name: string; lat: number; lng: number; distance: number } => Boolean(x))
        .sort((a, b) => a.distance - b.distance)

    const first = withDistance[0]
    if (!first) return null

    return { code: first.code, name: first.name, lat: first.lat, lng: first.lng }
}

async function findAirportByCode(code: string): Promise<AirportResolution["airport"] | null> {
    // Prefer local CSV first (fast + avoids Overpass limits)
    const fromCsv = findAirportByCodeFromCsv(code)
    if (fromCsv) {
        return {
            code: fromCsv.code,
            name: fromCsv.name,
            lat: fromCsv.lat,
            lng: fromCsv.lng,
        }
    }

    const c = code.toUpperCase()
    const query = `
[out:json][timeout:25];
(
  node["iata"="${c}"]["aeroway"="aerodrome"];
  way["iata"="${c}"]["aeroway"="aerodrome"];
  relation["iata"="${c}"]["aeroway"="aerodrome"];
);
out center tags;
`

    const body = new URLSearchParams({ data: query }).toString()

    const data = await enqueueOverpass(async () => {
        return fetchJsonWithRetry<{ elements?: OverpassElement[] }>(
            OVERPASS_BASE,
            {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body,
            },
            "overpass-bycode",
            3
        )
    })

    const airport = (data.elements ?? []).find((el) => {
        const lat = el.lat ?? el.center?.lat
        const lng = el.lon ?? el.center?.lon
        return lat != null && lng != null
    })

    if (!airport) return null

    const lat = airport.lat ?? airport.center?.lat
    const lng = airport.lon ?? airport.center?.lon
    if (lat == null || lng == null) return null

    return {
        code: c,
        name: airport.tags?.name ?? `${c} Airport`,
        lat,
        lng,
    }
}

function preferredAirportsForCity(input: string, displayName?: string) {
    const s = `${input} ${displayName ?? ""}`.toLowerCase()

    // Keep this intentionally small and high-signal
    if (s.includes("paris")) return ["CDG", "ORY"]
    if (s.includes("london")) return ["LHR", "LGW", "STN", "LTN", "LCY"]
    if (s.includes("new york") || s.includes("nyc") || s.includes("manhattan") || s.includes("brooklyn")) return ["JFK", "LGA", "EWR"]
    if (s.includes("los angeles") || s.includes("la,") || s.includes("l.a.")) return ["LAX", "BUR", "LGB", "SNA"]
    if (s.includes("san francisco") || s.includes("sf,") || s.includes("s.f.")) return ["SFO", "OAK", "SJC"]
    if (s.includes("chicago")) return ["ORD", "MDW"]
    if (s.includes("washington") || s.includes("dc") || s.includes("d.c.")) return ["DCA", "IAD", "BWI"]
    if (s.includes("boston")) return ["BOS"]
    if (s.includes("miami")) return ["MIA", "FLL"]
    if (s.includes("seattle")) return ["SEA", "PAE"]

    return []
}

function pickPreferredAirport(preferredCodes: string[]) {
    for (const code of preferredCodes) {
        const a = findAirportByCodeFromCsv(code)
        if (a) {
            return {
                code: a.code,
                name: a.name,
                lat: a.lat,
                lng: a.lng,
            }
        }
    }
    return null
}

async function resolveAirport(input: string): Promise<AirportResolution | null> {
    const trimmed = input.trim()
    if (!trimmed) return null

    // Cache protects you from repeatedly calling Nominatim/Overpass
    const cached = cacheGet(trimmed)
    if (cached !== undefined) return cached

    let resolved: AirportResolution | null = null

    // If user provided "PHL", "JFK", etc.
    if (isAirportCode(trimmed)) {
        const airport = await findAirportByCode(trimmed)
        resolved = airport ? { input: trimmed, inputType: "airport_code", airport } : null
        cacheSet(trimmed, resolved)
        return resolved
    }

    // Otherwise interpret as city, geocode candidates, then pick best airport
    const candidates = await geocodeCityCandidates(trimmed, 5)
    if (candidates.length === 0) {
        cacheSet(trimmed, null)
        return null
    }

    for (const c of candidates) {
        // 1) Metro override: if city looks like Paris/London/etc, force major airports first
        const preferred = preferredAirportsForCity(trimmed, c.displayName)
        if (preferred.length > 0) {
            const chosen = pickPreferredAirport(preferred)
            if (chosen) {
                resolved = {
                    input: trimmed,
                    inputType: "city",
                    cityName: c.displayName,
                    airport: chosen,
                }
                break
            }
        }

        // 2) Default: nearest commercial airport from CSV
        const bestCommercial = findNearestCommercialAirportFromCsv(c.lat, c.lng)
        if (bestCommercial) {
            resolved = {
                input: trimmed,
                inputType: "city",
                cityName: c.displayName,
                airport: {
                    code: bestCommercial.code,
                    name: bestCommercial.name,
                    lat: bestCommercial.lat,
                    lng: bestCommercial.lng,
                },
            }
            break
        }

        // 3) Fallback: Overpass search if CSV fails
        const fallback = await findNearestAirportToPointOverpass(c.lat, c.lng)
        if (fallback) {
            resolved = {
                input: trimmed,
                inputType: "city",
                cityName: c.displayName,
                airport: fallback,
            }
            break
        }
    }

    cacheSet(trimmed, resolved)
    return resolved
}

// -------------------------
// Routes
// -------------------------
router.post("/resolve-airport", async (req: Request, res: Response) => {
    try {
        const input = String(req.body?.input ?? "").trim()
        if (!input) return res.status(400).json({ error: "input is required" })

        const resolved = await resolveAirport(input)
        if (!resolved) return res.status(404).json({ error: "Could not resolve airport" })

        return res.json(resolved)
    } catch {
        return res.status(500).json({ error: "Failed to resolve airport" })
    }
})

router.post("/plan", async (req: Request, res: Response) => {
    const startedAt = Date.now()
    const reqId = Math.random().toString(16).slice(2, 10)
    const log = (...args: any[]) => console.log(`[plan:${reqId}]`, ...args)

    try {
        const { origin, destination, outboundDate, returnDate } = req.body as {
            origin?: string
            destination?: string
            outboundDate?: string
            returnDate?: string
        }

        log("incoming body:", { origin, destination, outboundDate, returnDate })

        if (!origin || !destination || !outboundDate || !returnDate) {
            return res.status(400).json({ error: "origin, destination, outboundDate, returnDate are required" })
        }

        if (!isIsoDate(outboundDate) || !isIsoDate(returnDate)) {
            return res.status(400).json({
                error: "outboundDate and returnDate must be in YYYY-MM-DD format",
                debug: { outboundDate, returnDate },
            })
        }

        const apiKey = process.env.SERP_API_KEY
        log("SERP_API_KEY present:", Boolean(apiKey))
        if (!apiKey) return res.status(500).json({ error: "SERP_API_KEY is not configured" })

        log("resolving airports...")
        const [originResolved, destinationResolved] = await Promise.all([resolveAirport(origin), resolveAirport(destination)])

        log("originResolved:", originResolved)
        log("destinationResolved:", destinationResolved)

        if (!originResolved || !destinationResolved) {
            return res.status(404).json({ error: "Could not resolve one or both locations to airports" })
        }

        // -------------------------
        // Flights only (train + driving disabled for now)
        // -------------------------
        const flightsUrl = new URL(SERP_API_BASE)
        flightsUrl.searchParams.set("engine", "google_flights")
        flightsUrl.searchParams.set("api_key", apiKey)
        flightsUrl.searchParams.set("departure_id", originResolved.airport.code)
        flightsUrl.searchParams.set("arrival_id", destinationResolved.airport.code)
        flightsUrl.searchParams.set("outbound_date", outboundDate)
        flightsUrl.searchParams.set("return_date", returnDate)
        flightsUrl.searchParams.set("currency", "USD")

        log("SerpApi URL:", { flights: redactApiKeyInUrl(flightsUrl.toString()) })

        const safeFetch = async (label: string, url: string) => {
            log(`fetch start: ${label}`)
            const data = await fetchJsonWithRetry<any>(url, undefined, label, 3)
            log(`fetch ok: ${label}`, {
                hasError: Boolean(data?.error),
                flightsState: data?.search_information?.flights_results_state,
                bestFlights: Array.isArray(data?.best_flights) ? data.best_flights.length : undefined,
                otherFlights: Array.isArray(data?.other_flights) ? data.other_flights.length : undefined,
            })
            if (data?.error) log(`api returned error field: ${label}`, data.error)
            return data
        }

        const flightData = await safeFetch("flights", flightsUrl.toString())

        const flightList = [...(flightData.best_flights ?? []), ...(flightData.other_flights ?? [])]
        const bestFlight = flightList[0]
        const flightsState = flightData?.search_information?.flights_results_state

        // If SerpApi returns Fully empty (or just no flights arrays), return a clean response
        if (!bestFlight) {
            log("no flight results returned", {
                flightsState,
                bestFlights: Array.isArray(flightData?.best_flights) ? flightData.best_flights.length : 0,
                otherFlights: Array.isArray(flightData?.other_flights) ? flightData.other_flights.length : 0,
                hasError: Boolean(flightData?.error),
            })

            log("done in ms:", Date.now() - startedAt)

            return res.json({
                origin: originResolved,
                destination: destinationResolved,
                recommendations: [],
                best: null,
                debug: {
                    flightsState,
                    cacheSize: airportCache.size,
                    airportsCsvLoaded: airportsLoaded,
                    commercialAirportsCount: commercialAirports.length,
                    trainDisabled: true,
                    drivingDisabled: true,
                    notes: "No flights were returned by SerpApi (google_flights).",
                },
            })
        }

        // Price and duration parsing is defensive (SerpApi changes shapes sometimes)
        const flightPrice = parsePriceUsd(bestFlight?.price)
        const flightLegDuration = parseDurationMinutes(bestFlight?.total_duration)

        log("bestFlight:", { flightPrice, flightLegDuration, flightsState })

        const options: PlanOption[] = []

        // Even if one is missing, still create an option so the UI can show partial info
        options.push({
            title: "Flight",
            totalDurationMinutes: flightLegDuration,
            totalPriceUsd: flightPrice,
            score: (flightLegDuration ?? 0) + (flightPrice ?? 0) * 0.35,
            segments: [
                {
                    mode: "flight",
                    summary: `${originResolved.airport.code} (${originResolved.airport.name}) → ${destinationResolved.airport.code} (${destinationResolved.airport.name})`,
                    durationMinutes: flightLegDuration,
                    priceUsd: flightPrice,
                },
            ],
        })

        const ranked = options.sort((a, b) => a.score - b.score)

        log(
            "ranked options:",
            ranked.map((o) => ({
                title: o.title,
                totalDurationMinutes: o.totalDurationMinutes,
                totalPriceUsd: o.totalPriceUsd,
                score: o.score,
            }))
        )

        log("done in ms:", Date.now() - startedAt)

        return res.json({
            origin: originResolved,
            destination: destinationResolved,
            recommendations: ranked,
            best: ranked[0] ?? null,
            debug: {
                flightsState,
                cacheSize: airportCache.size,
                airportsCsvLoaded: airportsLoaded,
                commercialAirportsCount: commercialAirports.length,
                trainDisabled: true,
                drivingDisabled: true,
            },
        })
    } catch (error: any) {
        console.error(`[plan:${reqId}] UNCAUGHT ERROR`, { message: error?.message, stack: error?.stack })
        return res.status(500).json({
            error: "Failed to build transportation plan",
            debug: process.env.NODE_ENV === "development" ? { message: error?.message } : undefined,
        })
    }
})

export default router