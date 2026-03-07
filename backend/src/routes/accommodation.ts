/**
 * GET /api/accommodations?destination=Paris&pageSize=5
 *
 * Searches Google Places (New) Text Search API filtered to lodging types
 * and returns a list of StayOption-compatible objects.
 */

import { Router, type Request, type Response } from "express"
import { GooglePlace, GooglePlacesTextSearchResponse, AccommodationResult } from "../types"

const router = Router()

//  Price-level → nightly rate heuristic 

const PRICE_LEVEL_RATES: Record<string, number> = {
    PRICE_LEVEL_FREE:           50,
    PRICE_LEVEL_INEXPENSIVE:    80,
    PRICE_LEVEL_MODERATE:      150,
    PRICE_LEVEL_EXPENSIVE:     280,
    PRICE_LEVEL_VERY_EXPENSIVE: 500,
}

function estimateNightlyRate(priceLevel?: string): number {
    if (!priceLevel) return 120               // sensible default
    return PRICE_LEVEL_RATES[priceLevel] ?? 120
}

//  Route handler 

router.get("/", async (req: Request, res: Response) => {
    const { destination, pageSize = "5" } = req.query as Record<string, string>

    if (!destination?.trim()) {
        return res.status(400).json({ error: "destination query param is required" })
    }

    const apiKey = process.env.VITE_GOOGLE_API_KEY
    if (!apiKey) {
        return res.status(500).json({ error: "GOOGLE_API_KEY is not configured on the server" })
    }

    const limit = Math.min(Math.max(Number(pageSize) || 5, 1), 20)

    try {
        const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": apiKey,
                // Request only the fields we actually use to keep the payload small
                // and avoid unnecessary billing charges for unrequested field masks.
                "X-Goog-FieldMask": [
                    "places.id",
                    "places.displayName",
                    "places.formattedAddress",
                    "places.priceLevel",
                    "places.rating",
                    "places.userRatingCount",
                    "places.location",
                    "places.reviews",
                ].join(","),
            },
            body: JSON.stringify({
                textQuery: `hotels and lodging in ${destination}`,
                // includedType filters results to the lodging category.
                includedType: "lodging",
                pageSize: limit,
                languageCode: "en",
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error("[accommodations] Google Places error:", response.status, errorText)
            return res.status(502).json({ error: "Google Places API request failed", detail: errorText })
        }

        const data = (await response.json()) as GooglePlacesTextSearchResponse

        const results: AccommodationResult[] = (data.places ?? []).map((place) => ({
            name: place.displayName?.text ?? "Unknown Hotel",
            location: place.formattedAddress ?? destination,
            nightlyRate: estimateNightlyRate(place.priceLevel),
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            placeId: place.id,
            reviews: (place.reviews ?? []).map((r) => ({
                author: r.authorAttribution?.displayName ?? "Anonymous",
                authorPhotoUri: r.authorAttribution?.photoUri,
                rating: r.rating ?? 0,
                text: r.text?.text ?? "",
                relativeTime: r.relativePublishTimeDescription ?? "",
            })),
            source: "google_places",
        }))

        return res.json({ destination, results })
    } catch (err) {
        console.error("[accommodations] Unexpected error:", err)
        return res.status(500).json({ error: "Internal server error" })
    }
})

export default router