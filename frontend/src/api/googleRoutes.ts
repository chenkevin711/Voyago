export type RouteAlt = {
    distanceMeters: number
    duration: string
    encodedPolyline: string
}

export type LegRoutes = {
    origin: string
    destination: string
    routes: RouteAlt[]
}

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

type TravelMode = "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT"

export async function computeLegRoutes(params: {
    apiKey: string
    origin: { lat: number; lng: number }
    destination: { lat: number; lng: number }
    travelMode: TravelMode
    alternatives: number
}): Promise<RouteAlt[]> {
    const { apiKey, origin, destination, travelMode, alternatives } = params

    const res = await fetch(ROUTES_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            // Field mask keeps the payload small and fast
            "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
        },
        body: JSON.stringify({
            origin: {
                location: { latLng: { latitude: origin.lat, longitude: origin.lng } }
            },
            destination: {
                location: { latLng: { latitude: destination.lat, longitude: destination.lng } }
            },
            travelMode,
            computeAlternativeRoutes: alternatives > 0,
            languageCode: "en-US",
            units: "IMPERIAL"
        })
    })

    if (!res.ok) return []

    const data = (await res.json()) as {
        routes?: Array<{
            distanceMeters?: number
            duration?: string
            polyline?: { encodedPolyline?: string }
        }>
    }

    return (data.routes ?? [])
        .slice(0, Math.max(1, alternatives + 1))
        .flatMap((r) => {
            const encoded = r.polyline?.encodedPolyline
            if (!encoded) return []
            return [
                {
                    distanceMeters: r.distanceMeters ?? 0,
                    duration: r.duration ?? "",
                    encodedPolyline: encoded
                }
            ]
        })
}