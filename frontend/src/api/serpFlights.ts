export type SerpFlight = {
    airline: string
    route: string
    price: number
    departureTime?: string
    arrivalTime?: string
    source: "serpapi"
}

export async function fetchFlightsSerpApi(params: {
    serpApiKey: string
    departureId: string
    arrivalId: string
    outboundDate: string
    returnDate: string
    currency?: string
}): Promise<SerpFlight[]> {
    const { serpApiKey, departureId, arrivalId, outboundDate, returnDate, currency } = params

    const url = new URL("https://serpapi.com/search.json")
    url.searchParams.set("engine", "google_flights")
    url.searchParams.set("api_key", serpApiKey)
    url.searchParams.set("departure_id", departureId)
    url.searchParams.set("arrival_id", arrivalId)
    url.searchParams.set("outbound_date", outboundDate)
    url.searchParams.set("return_date", returnDate)
    url.searchParams.set("currency", currency ?? "USD")

    const res = await fetch(url.toString())
    if (!res.ok) return []

    const data = (await res.json()) as {
        best_flights?: Array<{
            price?: number
            flights?: Array<{
                airline?: string
                departure_airport?: { id?: string; time?: string }
                arrival_airport?: { id?: string; time?: string }
            }>
        }>
        other_flights?: Array<{
            price?: number
            flights?: Array<{
                airline?: string
                departure_airport?: { id?: string; time?: string }
                arrival_airport?: { id?: string; time?: string }
            }>
        }>
    }

    const raw = [...(data.best_flights ?? []), ...(data.other_flights ?? [])].slice(0, 8)

    return raw.map((item) => {
        const leg = item.flights?.[0]
        const airline = leg?.airline ?? "Unknown Airline"
        const from = leg?.departure_airport?.id ?? departureId
        const to = leg?.arrival_airport?.id ?? arrivalId

        return {
            airline,
            route: `${from} → ${to}`,
            price: item.price ?? 0,
            departureTime: leg?.departure_airport?.time,
            arrivalTime: leg?.arrival_airport?.time,
            source: "serpapi"
        }
    })
}