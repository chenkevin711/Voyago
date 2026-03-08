import type { FlightOption } from "../tripPlanning"
import type { TransportPlanResponse } from "../api/transport"

export type TransportationMode = "flight" | "train" | "road"

export type DestinationStop = {
    name: string
    days: number
}

export type LegFlightPlan = {
    id: string
    origin: string
    destination: string
    departDate: string
    stayDays: number
    options: FlightOption[]
    error?: string
}

export type ResolvedPlace = {
    name: string
    placeId?: string
    formattedAddress?: string
    location: { lat: number; lng: number }
}

export type RouteAlt = {
    distanceMeters: number
    duration: string
    encodedPolyline: string
}

export type RouteOption = {
    mode: "driving" | "transit" | "walking"
    label: string
    duration: string
    distanceMeters: number
    estimatedCost: number
    mapsUrl: string
    source: "google_routes" | "mock"
    encodedPolyline?: string
}

export type LegRoutes = {
    origin: string
    destination: string
    routes: RouteAlt[]
}

export function toCurrency(amount: number): string {
    return `$${amount.toLocaleString()}`
}

export function formatTime(totalMinutes: number): string {
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
    const minutes = totalMinutes % 60
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`
}

export function addDays(date: string, days: number): string {
    const d = new Date(date)
    if (Number.isNaN(d.valueOf())) return date
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
}

export function modeToTravelMode(mode: "driving" | "transit" | "walking"): "DRIVE" | "TRANSIT" | "WALK" {
    if (mode === "transit") return "TRANSIT"
    if (mode === "walking") return "WALK"
    return "DRIVE"
}

export function modeLabel(mode: "driving" | "transit" | "walking"): string {
    if (mode === "transit") return "Transit"
    if (mode === "walking") return "Walking"
    return "Driving"
}

function metersToMiles(meters: number): number {
    return meters / 1609.344
}

function parseDurationSeconds(duration: string): number {
    const clean = duration.replace(/s$/, "")
    const h = /([0-9]+)h/.exec(clean)
    const m = /([0-9]+)m/.exec(clean)
    const s = /([0-9]+)$/.exec(clean)
    return (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (s ? Number(s[1]) : 0)
}

export function estimateCost(params: { mode: "driving" | "transit" | "walking"; distanceMeters: number; duration: string }): number {
    if (params.mode === "walking") return 0
    const miles = metersToMiles(params.distanceMeters)
    if (params.mode === "driving") return Math.max(4, Number((miles * 0.58).toFixed(2)))
    const minutes = parseDurationSeconds(params.duration) / 60
    return Math.max(3, Number((2.5 + minutes * 0.2).toFixed(2)))
}

export function decodePolyline(encoded: string): Array<[number, number]> {
    let index = 0
    const coordinates: Array<[number, number]> = []
    let lat = 0
    let lng = 0

    while (index < encoded.length) {
        let shift = 0
        let result = 0
        let byte: number

        do {
            byte = encoded.charCodeAt(index++) - 63
            result |= (byte & 0x1f) << shift
            shift += 5
        } while (byte >= 0x20)

        const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1)
        lat += deltaLat

        shift = 0
        result = 0

        do {
            byte = encoded.charCodeAt(index++) - 63
            result |= (byte & 0x1f) << shift
            shift += 5
        } while (byte >= 0x20)

        const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1)
        lng += deltaLng

        coordinates.push([lat / 1e5, lng / 1e5])
    }

    return coordinates
}

export function hashToPoint(value: string): { lat: number; lng: number } {
    const normalized = value.trim().toLowerCase()
    let hash = 0
    for (let i = 0; i < normalized.length; i += 1) {
        hash = (hash << 5) - hash + normalized.charCodeAt(i)
        hash |= 0
    }
    const lat = 25 + (Math.abs(hash) % 5000) / 100
    const lng = -125 + (Math.abs(hash * 7) % 6000) / 100
    return { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) }
}

export async function resolvePlaceText(params: {
    apiKey: string
    query: string
}): Promise<ResolvedPlace | null> {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": params.apiKey,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location"
        },
        body: JSON.stringify({
            textQuery: params.query,
            pageSize: 1
        })
    })

    if (!res.ok) return null

    const data = (await res.json()) as {
        places?: Array<{
            id?: string
            displayName?: { text?: string }
            formattedAddress?: string
            location?: { latitude?: number; longitude?: number }
        }>
    }

    const p = data.places?.[0]
    const lat = p?.location?.latitude
    const lng = p?.location?.longitude

    if (lat == null || lng == null) return null

    return {
        name: p?.displayName?.text ?? params.query,
        placeId: p?.id,
        formattedAddress: p?.formattedAddress,
        location: { lat, lng }
    }
}

export async function computeLegRoutes(params: {
    apiKey: string
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
    travelMode: "DRIVE" | "TRANSIT" | "WALK"
    alternatives: number
}): Promise<RouteAlt[]> {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": params.apiKey,
            "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
        },
        body: JSON.stringify({
            origin: {
                location: {
                    latLng: { latitude: params.origin.lat, longitude: params.origin.lng }
                }
            },
            destination: {
                location: {
                    latLng: { latitude: params.destination.lat, longitude: params.destination.lng }
                }
            },
            travelMode: params.travelMode,
            computeAlternativeRoutes: params.alternatives > 0,
            routingPreference: params.travelMode === "TRANSIT" ? undefined : "TRAFFIC_AWARE",
            languageCode: "en-US",
            units: "IMPERIAL"
        })
    })

    if (!res.ok) return []

    const data = (await res.json()) as {
        routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }>
    }

    return (data.routes ?? [])
        .filter((r) => r.distanceMeters != null && r.duration && r.polyline?.encodedPolyline)
        .map((r) => ({
            distanceMeters: r.distanceMeters as number,
            duration: r.duration as string,
            encodedPolyline: r.polyline?.encodedPolyline as string
        }))
}

export function buildLegFlightOptions(params: { plan: TransportPlanResponse; departDate: string; origin: string; destination: string; stayDays: number }): FlightOption[] {
    const primary = params.plan.recommendations.slice(0, 3)
    const guaranteedThree = Array.from({ length: 3 }, (_, idx) => primary[idx] ?? primary[0]).filter(Boolean)

    return guaranteedThree.map((option, idx) => {
        const firstSegment = option?.segments[0]
        const durationMinutes = option?.totalDurationMinutes ?? 120 + idx * 85
        const departMinutes = 6 * 60 + idx * 240
        const arrivalMinutes = departMinutes + durationMinutes
        return {
            airline: option?.title ?? `Option ${idx + 1}`,
            route: firstSegment?.summary ?? `${params.plan.origin.airport.code} → ${params.plan.destination.airport.code}`,
            price: option?.totalPriceUsd ?? 0,
            source: "serpapi",
            departureDate: params.departDate,
            departureTime: formatTime(departMinutes),
            arrivalTime: formatTime(arrivalMinutes),
            details: `${params.origin} → ${params.destination} • Stay ${params.stayDays} day${params.stayDays === 1 ? "" : "s"}`
        }
    })
}

export function withFallbackPlace(name: string): ResolvedPlace {
    return {
        name,
        formattedAddress: name,
        location: hashToPoint(name)
    }
}