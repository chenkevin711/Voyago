export type ResolvedPlace = {
    name: string
    placeId?: string
    formattedAddress?: string
    location: { lat: number; lng: number }
}

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

export async function resolvePlaceText(params: {
    apiKey: string
    query: string
}): Promise<ResolvedPlace | null> {
    const { apiKey, query } = params

    const res = await fetch(PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            // FieldMask is required for Places API (New)
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location"
        },
        body: JSON.stringify({
            textQuery: query,
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
        name: p?.displayName?.text ?? query,
        placeId: p?.id,
        formattedAddress: p?.formattedAddress,
        location: { lat, lng }
    }
}