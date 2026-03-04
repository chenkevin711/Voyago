import express, { Request, Response } from "express"

const router = express.Router()

const SERP_API_BASE = "https://serpapi.com/search.json"
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
const OVERPASS_BASE = "https://overpass-api.de/api/interpreter"

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

function isAirportCode(input: string): boolean {
    return /^[A-Za-z]{3}$/.test(input.trim())
}

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
        throw new Error(`Request failed: ${res.status} ${res.statusText} url=${url} body=${snippet}`)
    }

    return (await res.json()) as T
}

async function geocodeCityCandidates(city: string, limit = 5): Promise<Array<{ lat: number; lng: number; displayName: string }>> {
    const url = new URL(`${NOMINATIM_BASE}/search`)
    url.searchParams.set("q", city)
    url.searchParams.set("format", "jsonv2")
    url.searchParams.set("limit", String(limit))

    const data = await fetchJson<Array<{ lat: string; lon: string; display_name: string }>>(url.toString())

    return data
        .map((item) => ({
            lat: Number(item.lat),
            lng: Number(item.lon),
            displayName: item.display_name,
        }))
        .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng))
}

type OverpassElement = {
    type: "node" | "way" | "relation"
    id: number
    lat?: number
    lon?: number
    center?: { lat: number; lon: number }
    tags?: Record<string, string>
}

async function findNearestAirportToPoint(lat: number, lng: number): Promise<AirportResolution["airport"] | null> {
    const query = `
[out:json][timeout:25];
(
  node(around:120000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
  way(around:120000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
  relation(around:120000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
);
out center tags;
`

    const body = new URLSearchParams({ data: query }).toString()
    const data = await fetchJson<{ elements?: OverpassElement[] }>(OVERPASS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    })

    const elements = data.elements ?? []
    if (elements.length === 0) return null

    const withDistance = elements
        .map((el) => {
            const pointLat = el.lat ?? el.center?.lat
            const pointLng = el.lon ?? el.center?.lon
            const code = el.tags?.iata
            if (pointLat == null || pointLng == null || !code) return null
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
    const data = await fetchJson<{ elements?: OverpassElement[] }>(OVERPASS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
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

async function resolveAirport(input: string): Promise<AirportResolution | null> {
    const trimmed = input.trim()
    if (!trimmed) return null

    if (isAirportCode(trimmed)) {
        const airport = await findAirportByCode(trimmed)
        if (!airport) return null
        return { input: trimmed, inputType: "airport_code", airport }
    }

    // Ambiguous cities (e.g., "Paris") can resolve incorrectly if we only take 1 result
    // Try multiple candidates and pick the first one that has a nearby airport
    const candidates = await geocodeCityCandidates(trimmed, 5)
    if (candidates.length === 0) return null

    for (const c of candidates) {
        const airport = await findNearestAirportToPoint(c.lat, c.lng)
        if (airport) {
            return {
                input: trimmed,
                inputType: "city",
                cityName: c.displayName,
                airport,
            }
        }
    }

    return null
}

function toMinutes(duration: string): number | undefined {
    const m = /([0-9]+) min/.exec(duration)
    const h = /([0-9]+) hr/.exec(duration)
    if (!m && !h) return undefined
    return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0)
}

function toLatLngString(lat: number, lng: number) {
    return `${lat},${lng}`
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

router.post("/resolve-airport", async (req: Request, res: Response) => {
    try {
        const input = String(req.body?.input ?? "").trim()
        if (!input) return res.status(400).json({ error: "input is required" })

        const resolved = await resolveAirport(input)
        if (!resolved) return res.status(404).json({ error: "Could not resolve airport" })

        return res.json(resolved)
    } catch (error) {
        return res.status(500).json({ error: "Failed to resolve airport" })
    }
})

router.post("/plan", async (req: Request, res: Response) => {
    const startedAt = Date.now()
    const reqId = Math.random().toString(16).slice(2, 10)
    const log = (...args: any[]) => console.log(`[plan:${reqId}]`, ...args)
    const redactUrl = (u: string) => u.replace(/api_key=[^&]+/i, "api_key=REDACTED")

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

        const apiKey = process.env.SERP_API_KEY
        log("SERP_API_KEY present:", Boolean(apiKey))
        if (!apiKey) return res.status(500).json({ error: "SERP_API_KEY is not configured" })

        log("resolving airports...")
        const [originResolved, destinationResolved] = await Promise.all([resolveAirport(origin), resolveAirport(destination)])

        log("originResolved:", originResolved ? {
            input: originResolved.input,
            inputType: originResolved.inputType,
            cityName: originResolved.cityName,
            airport: originResolved.airport,
        } : null)

        log("destinationResolved:", destinationResolved ? {
            input: destinationResolved.input,
            inputType: destinationResolved.inputType,
            cityName: destinationResolved.cityName,
            airport: destinationResolved.airport,
        } : null)

        if (!originResolved || !destinationResolved) {
            return res.status(404).json({ error: "Could not resolve one or both locations to airports" })
        }

        // Flights (IATA codes are correct for google_flights)
        const flightsUrl = new URL(SERP_API_BASE)
        flightsUrl.searchParams.set("engine", "google_flights")
        flightsUrl.searchParams.set("api_key", apiKey)
        flightsUrl.searchParams.set("departure_id", originResolved.airport.code)
        flightsUrl.searchParams.set("arrival_id", destinationResolved.airport.code)
        flightsUrl.searchParams.set("outbound_date", outboundDate)
        flightsUrl.searchParams.set("return_date", returnDate)
        flightsUrl.searchParams.set("currency", "USD")

        // Google Maps directions: use coordinates, not IATA
        const originLatLng = toLatLngString(originResolved.airport.lat, originResolved.airport.lng)
        const destLatLng = toLatLngString(destinationResolved.airport.lat, destinationResolved.airport.lng)

        const km = haversineKm(
            { lat: originResolved.airport.lat, lng: originResolved.airport.lng },
            { lat: destinationResolved.airport.lat, lng: destinationResolved.airport.lng }
        )

        // Heuristic to avoid calling directions for impossible long routes (transoceanic, etc.)
        const ENABLE_GROUND_MODES_MAX_KM = 800

        let mapsTrainUrl: URL | null = null
        let mapsCarUrl: URL | null = null

        if (km <= ENABLE_GROUND_MODES_MAX_KM) {
            mapsTrainUrl = new URL(SERP_API_BASE)
            mapsTrainUrl.searchParams.set("engine", "google_maps_directions")
            mapsTrainUrl.searchParams.set("api_key", apiKey)
            mapsTrainUrl.searchParams.set("origin", originLatLng)
            mapsTrainUrl.searchParams.set("destination", destLatLng)
            mapsTrainUrl.searchParams.set("mode", "transit")

            mapsCarUrl = new URL(SERP_API_BASE)
            mapsCarUrl.searchParams.set("engine", "google_maps_directions")
            mapsCarUrl.searchParams.set("api_key", apiKey)
            mapsCarUrl.searchParams.set("origin", originLatLng)
            mapsCarUrl.searchParams.set("destination", destLatLng)
            mapsCarUrl.searchParams.set("mode", "driving")
        } else {
            log(`skipping maps directions, distance too large: ${Math.round(km)} km`)
        }

        log("SerpApi URLs:", {
            flights: redactUrl(flightsUrl.toString()),
            train: mapsTrainUrl ? redactUrl(mapsTrainUrl.toString()) : null,
            car: mapsCarUrl ? redactUrl(mapsCarUrl.toString()) : null,
        })

        const safeFetch = async (label: string, url: string) => {
            log(`fetch start: ${label}`)
            const data = await fetchJson<any>(url)
            log(`fetch ok: ${label}`, {
                hasError: Boolean(data?.error),
                flightsState: data?.search_information?.flights_results_state,
                bestFlights: Array.isArray(data?.best_flights) ? data.best_flights.length : undefined,
                otherFlights: Array.isArray(data?.other_flights) ? data.other_flights.length : undefined,
                routes: Array.isArray(data?.routes) ? data.routes.length : undefined,
            })
            if (data?.error) log(`api returned error field: ${label}`, data.error)
            return data
        }

        const flightPromise = safeFetch("flights", flightsUrl.toString())
        const trainPromise = mapsTrainUrl ? safeFetch("train", mapsTrainUrl.toString()) : Promise.resolve(null)
        const carPromise = mapsCarUrl ? safeFetch("car", mapsCarUrl.toString()) : Promise.resolve(null)

        const [flightData, trainData, carData] = await Promise.all([flightPromise, trainPromise, carPromise])

        const bestFlight = [...(flightData.best_flights ?? []), ...(flightData.other_flights ?? [])][0]
        const flightPrice = bestFlight?.price ? Number(bestFlight.price) : undefined
        const flightLegDuration = bestFlight?.total_duration ? Number(bestFlight.total_duration) : undefined

        const trainLeg = trainData?.routes?.[0]?.legs?.[0]
        const carLeg = carData?.routes?.[0]?.legs?.[0]

        const trainDuration = typeof trainLeg?.duration === "string" ? toMinutes(trainLeg.duration) : undefined
        const carDuration = typeof carLeg?.duration === "string" ? toMinutes(carLeg.duration) : undefined

        const options: PlanOption[] = []

        if (flightLegDuration || flightPrice) {
            const carToCityMinutes = 45
            const totalFlightMinutes = (flightLegDuration ?? 0) + carToCityMinutes
            const totalFlightPrice = (flightPrice ?? 0) + 35
            options.push({
                title: "Flight + airport transfer",
                totalDurationMinutes: totalFlightMinutes,
                totalPriceUsd: totalFlightPrice,
                score: totalFlightMinutes + totalFlightPrice * 0.35,
                segments: [
                    {
                        mode: "flight",
                        summary: `${originResolved.airport.code} (${originResolved.airport.name}) → ${destinationResolved.airport.code} (${destinationResolved.airport.name})`,
                        durationMinutes: flightLegDuration,
                        priceUsd: flightPrice,
                    },
                    {
                        mode: "car",
                        summary: `${destinationResolved.airport.code} → ${destination}`,
                        durationMinutes: carToCityMinutes,
                        priceUsd: 35,
                    },
                ],
            })
        } else {
            log("no flight option constructed (missing duration and price)")
        }

        if (trainDuration) {
            options.push({
                title: "Train",
                totalDurationMinutes: trainDuration,
                totalPriceUsd: 40,
                score: trainDuration + 40 * 0.35,
                segments: [
                    {
                        mode: "train",
                        summary: `${origin} → ${destination}`,
                        durationMinutes: trainDuration,
                        priceUsd: 40,
                    },
                ],
            })
        } else if (mapsTrainUrl) {
            log("no train option constructed (no trainDuration)")
        }

        if (carDuration) {
            const carPrice = Math.max(20, Math.round((carDuration / 60) * 12))
            options.push({
                title: "Drive",
                totalDurationMinutes: carDuration,
                totalPriceUsd: carPrice,
                score: carDuration + carPrice * 0.35,
                segments: [
                    {
                        mode: "car",
                        summary: `${origin} → ${destination}`,
                        durationMinutes: carDuration,
                        priceUsd: carPrice,
                    },
                ],
            })
        } else if (mapsCarUrl) {
            log("no car option constructed (no carDuration)")
        }

        const ranked = options.sort((a, b) => a.score - b.score)

        log("ranked options:", ranked.map((o) => ({
            title: o.title,
            totalDurationMinutes: o.totalDurationMinutes,
            totalPriceUsd: o.totalPriceUsd,
            score: o.score,
        })))

        log("done in ms:", Date.now() - startedAt)

        return res.json({
            origin: originResolved,
            destination: destinationResolved,
            recommendations: ranked,
            best: ranked[0] ?? null,
            debug: {
                km: Math.round(km),
                skippedGroundModes: km > ENABLE_GROUND_MODES_MAX_KM,
            },
        })
    } catch (error: any) {
        console.error(`[plan:${reqId}] UNCAUGHT ERROR`, {
            message: error?.message,
            stack: error?.stack,
        })
        return res.status(500).json({
            error: "Failed to build transportation plan",
            debug: process.env.NODE_ENV === "development" ? { message: error?.message } : undefined,
        })
    }
})

export default router