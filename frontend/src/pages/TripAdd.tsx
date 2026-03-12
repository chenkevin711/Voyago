// TripAdd.tsx

import { useMemo, useRef, useEffect, useState } from "react"
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    MenuItem,
    Paper,
    Stack,
    Step,
    StepLabel,
    Stepper,
    TextField,
    Typography,
    ToggleButton,
    ToggleButtonGroup
} from "@mui/material"
import { useNavigate } from "react-router-dom"
import AppLayout from "../components/AppLayout"
import Page from "../components/Page"
import {
    type AttractionOption,
    type FlightOption,
    type NavigationPlan,
    type PlannedTrip,
    type StayOption,
    formatDateRange,
    savePlannedTrip,
    tripNights
} from "../tripPlanning"

import {
    APIProvider,
    AdvancedMarker,
    InfoWindow,
    Map,
    Pin,
    useMap
} from "@vis.gl/react-google-maps"

const stepTitles = [
    "Name + Dates",
    "Destinations",
    "Budget",
    "Transportation",
    "Living Accommodations",
    "Attractions",
]

const fakeStays: StayOption[] = [
    { name: "Harbor Light Suites", location: "City Center", nightlyRate: 180 },
    { name: "Maple Boutique Stay", location: "Old Town", nightlyRate: 135 },
    { name: "Voyager Residence", location: "Waterfront", nightlyRate: 220 }
]

type TransportationMode = "flight" | "train" | "road"
type TripType = "domestic" | "international"
type TravelStyle = "budget" | "mid" | "luxury"

type GooglePlaceReview = {
    authorAttribution?: {
        displayName?: string
    }
    rating?: number
    text?: {
        text?: string
    }
    publishTime?: string
}

type ResolvedPlace = {
    name: string
    placeId?: string
    formattedAddress?: string
    location: { lat: number; lng: number }
}

type RouteAlt = {
    distanceMeters: number
    duration: string
    encodedPolyline: string
}

type RouteOption = {
    mode: "driving" | "transit" | "walking"
    label: string
    duration: string
    distanceMeters: number
    estimatedCost: number
    mapsUrl: string
    source: "google_routes" | "mock"
    encodedPolyline?: string
}

type LegRoutes = {
    origin: string
    destination: string
    routes: RouteAlt[]
}

function toCurrency(amount: number): string {
    return `$${Number(amount || 0).toLocaleString()}`
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

function estimateCost(params: { mode: "driving" | "transit" | "walking"; distanceMeters: number; duration: string }): number {
    if (params.mode === "walking") return 0
    const miles = metersToMiles(params.distanceMeters)
    if (params.mode === "driving") return Math.max(4, Number((miles * 0.58).toFixed(2)))
    const minutes = parseDurationSeconds(params.duration) / 60
    return Math.max(3, Number((2.5 + minutes * 0.2).toFixed(2)))
}

function modeToTravelMode(mode: "driving" | "transit" | "walking"): "DRIVE" | "TRANSIT" | "WALK" {
    if (mode === "transit") return "TRANSIT"
    if (mode === "walking") return "WALK"
    return "DRIVE"
}

function modeLabel(mode: "driving" | "transit" | "walking"): string {
    if (mode === "transit") return "Transit"
    if (mode === "walking") return "Walking"
    return "Driving"
}

function decodePolyline(encoded: string): Array<[number, number]> {
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

/**
 * Budget suggestion — NO API.
 * Uses: nights + tripType + travelStyle + buffer, rounded to $50.
 */
function suggestStarterBudget(params: { nights: number; tripType: TripType; style: TravelStyle }) {
    const nights = Math.max(1, params.nights)
    const days = nights + 1

    const styleRates: Record<TravelStyle, { stayPerNight: number; foodPerDay: number; activitiesPerDay: number; localTransitPerDay: number }> = {
        budget: { stayPerNight: 120, foodPerDay: 55, activitiesPerDay: 25, localTransitPerDay: 15 },
        mid: { stayPerNight: 185, foodPerDay: 85, activitiesPerDay: 45, localTransitPerDay: 25 },
        luxury: { stayPerNight: 320, foodPerDay: 140, activitiesPerDay: 85, localTransitPerDay: 45 }
    }

    const baseFlight = params.tripType === "international" ? 1100 : 450
    const flightBuffer = params.tripType === "international" ? 1.15 : 1.05
    const rates = styleRates[params.style]

    const stay = rates.stayPerNight * nights
    const food = rates.foodPerDay * days
    const activities = rates.activitiesPerDay * days
    const localTransit = rates.localTransitPerDay * days

    const base = (baseFlight * flightBuffer) + stay + food + activities + localTransit
    const bufferPct = params.tripType === "international" ? 0.22 : 0.15
    const raw = base * (1 + bufferPct)

    const suggested = Math.round(raw / 50) * 50
    return { suggested, bufferPct, base }
}

/**
 * Places API (New) Text Search
 */
async function resolvePlaceText(params: {
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

async function fetchPlaceReviews(params: {
    apiKey: string
    placeId: string
}): Promise<Pick<AttractionOption, "rating" | "reviews">> {
    const res = await fetch(`https://places.googleapis.com/v1/places/${params.placeId}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": params.apiKey,
            "X-Goog-FieldMask": "rating,reviews"
        }
    })

    if (!res.ok) {
        return { rating: undefined, reviews: [] }
    }

    const data = (await res.json()) as {
        rating?: number
        reviews?: GooglePlaceReview[]
    }

    return {
        rating: data.rating,
        reviews: (data.reviews ?? []).map((review) => ({
            authorName: review.authorAttribution?.displayName ?? "Anonymous",
            rating: review.rating ?? 0,
            text: review.text?.text ?? "",
            publishTime: review.publishTime
        }))
    }
}

/**
 * Routes API computeRoutes
 */
async function computeLegRoutes(params: {
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
        .slice(0, Math.max(1, params.alternatives + 1))
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

/**
 * SerpApi Google Flights
 */
async function fetchFlightsSerpApi(params: {
    serpApiKey: string
    departureId: string
    arrivalId: string
    outboundDate: string
    returnDate: string
}): Promise<FlightOption[]> {
    const url = new URL("https://serpapi.com/search.json")
    url.searchParams.set("engine", "google_flights")
    url.searchParams.set("api_key", params.serpApiKey)
    url.searchParams.set("departure_id", params.departureId)
    url.searchParams.set("arrival_id", params.arrivalId)
    url.searchParams.set("outbound_date", params.outboundDate)
    url.searchParams.set("return_date", params.returnDate)
    url.searchParams.set("currency", "USD")

    const res = await fetch(url.toString())
    if (!res.ok) return []

    const data = (await res.json()) as any
    const raw = [...(data.best_flights ?? []), ...(data.other_flights ?? [])].slice(0, 8)

    return raw.map((item: any) => {
        const leg = item.flights?.[0]
        const airline = leg?.airline ?? "Unknown Airline"
        const from = leg?.departure_airport?.id ?? params.departureId
        const to = leg?.arrival_airport?.id ?? params.arrivalId

        return {
            airline,
            route: `${from} → ${to}`,
            price: item.price ?? 0,
            source: "serpapi" as const
        }
    })
}

function RouteOverlay(props: {
    legs: LegRoutes[]
    selectedRouteByLeg: Record<number, number>
}) {
    const map = useMap()
    const polylinesRef = useRef<Array<{ setMap: (map: object | null) => void }>>([])

    useEffect(() => {
        if (!map) return
        if (!window.google?.maps) return

        polylinesRef.current.forEach((p) => p.setMap(null))
        polylinesRef.current = []

        props.legs.forEach((leg, legIndex) => {
            const choice = props.selectedRouteByLeg[legIndex] ?? 0
            const route = leg.routes[choice]
            if (!route) return

            const decoded = decodePolyline(route.encodedPolyline)
            const path = decoded.map(([lat, lng]) => ({ lat, lng }))

            const line = new window.google.maps.Polyline({
                path,
                clickable: false,
                geodesic: true,
                strokeOpacity: 0.9,
                strokeWeight: 5
            })

            line.setMap(map)
            polylinesRef.current.push(line)
        })

        return () => {
            polylinesRef.current.forEach((p) => p.setMap(null))
            polylinesRef.current = []
        }
    }, [map, props.legs, props.selectedRouteByLeg])

    return null
}

function TripRouteMap(props: {
    loading: boolean
    places: ResolvedPlace[]
    legs: LegRoutes[]
    selectedRouteByLeg: Record<number, number>
    mapId?: string
}) {
    const [selectedPlace, setSelectedPlace] = useState<ResolvedPlace | null>(null)
    const center = useMemo(() => {
        if (props.places.length > 0) return props.places[0].location
        return { lat: 46.5, lng: 8.4 }
    }, [props.places])

    return (
        <Box
            sx={{
                position: "relative",
                height: { xs: 320, md: 420 },
                borderRadius: 4,
                overflow: "hidden",
                border: "1px solid rgba(47,65,86,0.12)"
            }}
        >
            {props.loading && (
                <Box
                    sx={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: "rgba(255,255,255,0.75)",
                        zIndex: 2
                    }}
                >
                    <Typography sx={{ mr: 2, color: "text.secondary" }}>Loading route options…</Typography>
                </Box>
            )}

            <Map
                defaultCenter={center}
                defaultZoom={5}
                mapId={props.mapId}
                style={{ width: "100%", height: "100%" }}
                mapTypeControl={false}
                streetViewControl={false}
                fullscreenControl={false}
            >
                {props.places.map((p) => (
                    <AdvancedMarker
                        key={p.placeId ?? p.name}
                        position={p.location}
                        title={p.name}
                        onClick={() => setSelectedPlace(p)}
                    >
                        <Pin />
                    </AdvancedMarker>
                ))}

                {selectedPlace && (
                    <InfoWindow position={selectedPlace.location} onCloseClick={() => setSelectedPlace(null)}>
                        <Box>
                            <Typography sx={{ fontWeight: 700 }}>{selectedPlace.name}</Typography>
                            {selectedPlace.formattedAddress && (
                                <Typography variant="body2" color="text.secondary">
                                    {selectedPlace.formattedAddress}
                                </Typography>
                            )}
                        </Box>
                    </InfoWindow>
                )}

                <RouteOverlay legs={props.legs} selectedRouteByLeg={props.selectedRouteByLeg} />
            </Map>
        </Box>
    )
}

function isValidISODate(d: string) {
    if (!d) return false
    const dt = new Date(d)
    return !Number.isNaN(dt.valueOf())
}

function startOfToday() {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

export default function TripAdd() {
    const navigate = useNavigate()

    const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
    const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined
    const serpApiKey = import.meta.env.VITE_SERPAPI_KEY as string | undefined

    const [activeStep, setActiveStep] = useState(0)
    const [tripName, setTripName] = useState("")
    const [startDate, setStartDate] = useState("")
    const [endDate, setEndDate] = useState("")
    const [budgetInput, setBudgetInput] = useState("")
    const [destinationInput, setDestinationInput] = useState("")
    const [destinations, setDestinations] = useState<string[]>([])
    const [transportMode, setTransportMode] = useState<TransportationMode>("flight")
    const [transportationNotes, setTransportationNotes] = useState("")

    const [tripType, setTripType] = useState<TripType>("domestic")
    const [travelStyle, setTravelStyle] = useState<TravelStyle>("mid")
    const [budgetTouched, setBudgetTouched] = useState(false)

    const [flights, setFlights] = useState<FlightOption[]>([])
    const [selectedFlight, setSelectedFlight] = useState<FlightOption | undefined>(undefined)
    const [flightLoading, setFlightLoading] = useState(false)

    const [accommodations] = useState<StayOption[]>(fakeStays)
    const [selectedAccommodation, setSelectedAccommodation] = useState<StayOption | undefined>(undefined)

    const [attractions, setAttractions] = useState<AttractionOption[]>([])
    const [selectedAttractions, setSelectedAttractions] = useState<AttractionOption[]>([])
    const [attractionsLoading, setAttractionsLoading] = useState(false)

    const [navigationPlans, setNavigationPlans] = useState<NavigationPlan[]>([])
    const [navigationLoading, setNavigationLoading] = useState(false)
    const [routeOptionsByLeg, setRouteOptionsByLeg] = useState<Record<number, RouteOption[]>>({})

    const [resolvedPlaces, setResolvedPlaces] = useState<ResolvedPlace[]>([])
    const [routesByLeg, setRoutesByLeg] = useState<LegRoutes[]>([])
    const [routesLoading, setRoutesLoading] = useState(false)
    const [selectedRouteByLeg, setSelectedRouteByLeg] = useState<Record<number, number>>({})
    const [attractionPlaces, setAttractionPlaces] = useState<ResolvedPlace[]>([])

    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    const dateError = useMemo(() => {
        if (!startDate || !endDate) return null
        if (!isValidISODate(startDate) || !isValidISODate(endDate)) return "Please enter valid dates."
        const s = new Date(startDate)
        const e = new Date(endDate)
        if (e < s) return "End date must be on or after the start date."
        if (s < startOfToday()) return "Start date cannot be in the past."
        return null
    }, [startDate, endDate])

    const nights = tripNights(startDate, endDate)
    const budget = Number(budgetInput)

    const flightCost = selectedFlight?.price ?? 0
    const stayCost = selectedAccommodation ? selectedAccommodation.nightlyRate * nights : 0
    const attractionCost = selectedAttractions.reduce((sum, a) => sum + a.price, 0)
    const estimatedTotal = flightCost + stayCost + attractionCost

    const budgetDifference = budget - estimatedTotal
    const overBudget = budgetDifference < 0

    const tripDates = formatDateRange(startDate, endDate)

    function getCountryFromFormattedAddress(addr?: string): string | null {
        if (!addr) return null
        const parts = addr.split(",").map((s) => s.trim()).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : null
    }

    const inferredCountry = useMemo(() => {
        const first = resolvedPlaces[0]
        return getCountryFromFormattedAddress(first?.formattedAddress)
    }, [resolvedPlaces])

    const isInternational = useMemo(() => {
        if (!inferredCountry) return false
        return inferredCountry.toLowerCase() !== "united states"
    }, [inferredCountry])

    useEffect(() => {
        if (!inferredCountry) return
        setTripType(isInternational ? "international" : "domestic")
    }, [inferredCountry, isInternational])

    const starterSuggestion = useMemo(() => {
        if (!startDate || !endDate || !!dateError) return null
        if (destinations.length === 0) return null

        return suggestStarterBudget({
            nights,
            tripType,
            style: travelStyle,
        })
    }, [startDate, endDate, dateError, destinations.length, nights, tripType, travelStyle])

    useEffect(() => {
        if (!starterSuggestion) return
        if (budgetTouched) return
        if (budgetInput.trim().length > 0) return
        setBudgetInput(String(starterSuggestion.suggested))
    }, [starterSuggestion, budgetTouched, budgetInput])

    const canContinue = useMemo(() => {
        if (activeStep === 0) return tripName.trim().length > 1 && Boolean(startDate) && Boolean(endDate) && !dateError
        if (activeStep === 1) return destinations.length > 0
        if (activeStep === 2) return budgetInput.trim().length > 0 && budget > 0
        return true
    }, [activeStep, tripName, startDate, endDate, dateError, destinations.length, budgetInput, budget])

    useEffect(() => {
        if (!mapsApiKey || destinations.length === 0) {
            setResolvedPlaces([])
            return
        }

        let cancelled = false
            ; (async () => {
                const results = await Promise.all(
                    destinations.map((d) => resolvePlaceText({ apiKey: mapsApiKey, query: d }))
                )
                if (cancelled) return
                setResolvedPlaces(results.flatMap((item) => (item ? [item] : [])))
            })()

        return () => {
            cancelled = true
        }
    }, [destinations, mapsApiKey])

    useEffect(() => {
        if (Object.keys(routeOptionsByLeg).length === 0) return

        const plans: NavigationPlan[] = Object.entries(routeOptionsByLeg).flatMap(([legIdx, options]) => {
            const leg = routesByLeg[Number(legIdx)]
            const selectedOption = options[selectedRouteByLeg[Number(legIdx)] ?? 0]
            if (!leg || !selectedOption) return []
            return [{
                origin: leg.origin,
                destination: leg.destination,
                method: selectedOption.mode,
                estimatedCost: selectedOption.estimatedCost,
                estimatedDuration: selectedOption.duration,
                mapsUrl: selectedOption.mapsUrl,
                source: selectedOption.source === "google_routes" ? "google_places" : "mock"
            }]
        })

        setNavigationPlans(plans)
    }, [routeOptionsByLeg, routesByLeg, selectedRouteByLeg])

    function addDestination() {
        const value = destinationInput.trim()
        if (!value) return

        if (destinations.includes(value)) {
            setDestinationInput("")
            return
        }

        setDestinations((prev) => [...prev, value])
        setDestinationInput("")
    }

    function removeDestination(city: string) {
        setDestinations((prev) => prev.filter((d) => d !== city))
    }

    async function fetchFlights() {
        if (!startDate || !endDate || destinations.length === 0) return

        setFlightLoading(true)
        try {
            if (!serpApiKey) {
                setFlights([
                    { airline: "Sample Air", route: `NYC → ${destinations[0]}`, price: tripType === "international" ? 980 : 640, source: "mock" },
                    { airline: "Skyline", route: `NYC → ${destinations[0]}`, price: tripType === "international" ? 1250 : 780, source: "mock" }
                ])
                return
            }

            const results = await fetchFlightsSerpApi({
                serpApiKey,
                departureId: "NYC",
                arrivalId: destinations[0],
                outboundDate: startDate,
                returnDate: endDate
            })

            if (results.length === 0) {
                setFlights([{ airline: "Fallback Flights", route: `NYC → ${destinations[0]}`, price: 690, source: "mock" }])
                return
            }

            setFlights(results)
        } catch {
            setFlights([{ airline: "Fallback Flights", route: `NYC → ${destinations[0]}`, price: 690, source: "mock" }])
        } finally {
            setFlightLoading(false)
        }
    }

    async function buildRoutes() {
        if (!mapsApiKey) return
        if (destinations.length < 2) return

        setRoutesLoading(true)
        try {
            const placeResults = await Promise.all(
                destinations.map((d) => resolvePlaceText({ apiKey: mapsApiKey, query: d }))
            )

            const places = placeResults.flatMap((p) => (p ? [p] : []))
            setResolvedPlaces(places)

            if (places.length < 2) {
                setRoutesByLeg([])
                setSelectedRouteByLeg({})
                setRouteOptionsByLeg({})
                return
            }

            const drivingTransitMode = transportMode === "train" ? "transit" : "driving"

            const legsWithOptions = await Promise.all(
                places.slice(0, -1).map(async (origin, idx) => {
                    const destination = places[idx + 1]
                    const baseUrl = new URL("https://www.google.com/maps/dir/")
                    baseUrl.searchParams.set("api", "1")
                    baseUrl.searchParams.set("origin", origin.name)
                    baseUrl.searchParams.set("destination", destination.name)
                    if (origin.placeId) baseUrl.searchParams.set("origin_place_id", origin.placeId)
                    if (destination.placeId) baseUrl.searchParams.set("destination_place_id", destination.placeId)

                    const modeOrder: Array<"driving" | "transit" | "walking"> = [
                        drivingTransitMode,
                        "walking",
                        drivingTransitMode === "driving" ? "transit" : "driving"
                    ]
                    const options: RouteOption[] = []

                    for (const mode of modeOrder) {
                        const result = await computeLegRoutes({
                            apiKey: mapsApiKey,
                            origin: origin.location,
                            destination: destination.location,
                            travelMode: modeToTravelMode(mode),
                            alternatives: 0
                        })
                        const route = result[0]
                        if (!route) continue

                        const url = new URL(baseUrl)
                        url.searchParams.set("travelmode", mode)

                        options.push({
                            mode,
                            label: modeLabel(mode),
                            duration: route.duration,
                            distanceMeters: route.distanceMeters,
                            estimatedCost: estimateCost({ mode, distanceMeters: route.distanceMeters, duration: route.duration }),
                            mapsUrl: url.toString(),
                            source: "google_routes",
                            encodedPolyline: route.encodedPolyline
                        })
                    }

                    if (options.length === 0) {
                        const fallbackUrl = new URL(baseUrl)
                        fallbackUrl.searchParams.set("travelmode", "driving")
                        options.push({
                            mode: "driving",
                            label: "Driving",
                            duration: "Unknown",
                            distanceMeters: 0,
                            estimatedCost: 0,
                            mapsUrl: fallbackUrl.toString(),
                            source: "mock"
                        })
                    }

                    const primaryRoute = options[0]

                    return {
                        leg: {
                            origin: origin.name,
                            destination: destination.name,
                            routes: primaryRoute.encodedPolyline
                                ? [{
                                    distanceMeters: primaryRoute.distanceMeters,
                                    duration: primaryRoute.duration,
                                    encodedPolyline: primaryRoute.encodedPolyline
                                }]
                                : []
                        },
                        options
                    }
                })
            )

            const legs = legsWithOptions.map((item) => item.leg)
            setRoutesByLeg(legs)

            const defaults: Record<number, number> = {}
            const routeOptionsLookup: Record<number, RouteOption[]> = {}
            legsWithOptions.forEach((item, idx) => {
                defaults[idx] = 0
                routeOptionsLookup[idx] = item.options.slice(0, 3)
            })
            setSelectedRouteByLeg(defaults)
            setRouteOptionsByLeg(routeOptionsLookup)

            const plans: NavigationPlan[] = legsWithOptions.flatMap((item) => {
                const option = item.options[0]
                if (!option) return []
                return [{
                    origin: item.leg.origin,
                    destination: item.leg.destination,
                    method: option.mode,
                    estimatedCost: option.estimatedCost,
                    estimatedDuration: option.duration,
                    mapsUrl: option.mapsUrl,
                    source: option.source === "google_routes" ? "google_places" : "mock"
                }]
            })
            setNavigationPlans(plans)
        } finally {
            setRoutesLoading(false)
        }
    }

    async function buildNavigationPlans() {
        if (destinations.length < 2) return
        if (Object.keys(routeOptionsByLeg).length > 0) {
            const plans: NavigationPlan[] = Object.entries(routeOptionsByLeg).flatMap(([legIdx, options]) => {
                const leg = routesByLeg[Number(legIdx)]
                const selectedOption = options[selectedRouteByLeg[Number(legIdx)] ?? 0]
                if (!leg || !selectedOption) return []
                return [{
                    origin: leg.origin,
                    destination: leg.destination,
                    method: selectedOption.mode,
                    estimatedCost: selectedOption.estimatedCost,
                    estimatedDuration: selectedOption.duration,
                    mapsUrl: selectedOption.mapsUrl,
                    source: selectedOption.source === "google_routes" ? "google_places" : "mock"
                }]
            })
            setNavigationPlans(plans)
            return
        }

        setNavigationLoading(true)
        try {
            const fallbackPlans: NavigationPlan[] = destinations.slice(0, -1).map((origin, index) => {
                const destination = destinations[index + 1]
                const mode: "driving" | "transit" = transportMode === "train" ? "transit" : "driving"
                return {
                    origin,
                    destination,
                    method: mode,
                    estimatedCost: mode === "driving" ? 18 : 9,
                    estimatedDuration: "Unknown",
                    mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${mode}`,
                    source: "mock" as const
                }
            })

            setNavigationPlans(fallbackPlans)
        } finally {
            setNavigationLoading(false)
        }
    }

    async function fetchAttractions() {
        if (destinations.length === 0) return

        setAttractionsLoading(true)
        try {
            if (!mapsApiKey) {
                setAttractions([
                    { name: "City Walking Tour", location: destinations[0], price: 35, source: "mock" },
                    { name: "Museum Pass", location: destinations[0], price: 55, source: "mock" },
                    { name: "Food Market Crawl", location: destinations[0], price: 40, source: "mock" }
                ])
                return
            }

            const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": mapsApiKey,
                    "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress"
                },
                body: JSON.stringify({
                    textQuery: `Top attractions in ${destinations[0]}`,
                    pageSize: 5
                })
            })

            const data = (await response.json()) as {
                places?: Array<{
                    id?: string
                    displayName?: { text?: string }
                    formattedAddress?: string
                }>
            }

            const options: AttractionOption[] = (data.places ?? []).map((place, index) => ({
                name: place.displayName?.text ?? `Attraction ${index + 1}`,
                location: place.formattedAddress ?? destinations[0],
                price: 20 + index * 12,
                source: "google_places",
                placeId: place.id
            }))

            const nextAttractions: AttractionOption[] = options.length > 0
                ? options
                : [{ name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" }]

            const withReviews = await Promise.all(
                nextAttractions.map(async (item) => {
                    if (!mapsApiKey || item.source !== "google_places" || !item.placeId) {
                        return item
                    }

                    try {
                        const details = await fetchPlaceReviews({
                            apiKey: mapsApiKey,
                            placeId: item.placeId
                        })

                        return {
                            ...item,
                            rating: details.rating,
                            reviews: details.reviews
                        }
                    } catch {
                        return item
                    }
                })
            )

            setAttractions(withReviews)

            const placeResults = await Promise.all(
                withReviews.map((item) => resolvePlaceText({ apiKey: mapsApiKey, query: `${item.name} ${item.location}` }))
            )
            setAttractionPlaces(placeResults.flatMap((p) => (p ? [p] : [])))
        } catch {
            setAttractions([
                { name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" },
                { name: "Riverside Biking", location: destinations[0], price: 30, source: "mock" }
            ])
            setAttractionPlaces([])
        } finally {
            setAttractionsLoading(false)
        }
    }

    function toggleAttraction(option: AttractionOption) {
        setSelectedAttractions((prev) =>
            prev.some((item) => item.name === option.name)
                ? prev.filter((item) => item.name !== option.name)
                : [...prev, option]
        )
    }

    function goNext() {
        setActiveStep((prev) => Math.min(prev + 1, stepTitles.length - 1))
    }

    function goBack() {
        setActiveStep((prev) => Math.max(prev - 1, 0))
    }

    async function saveTrip() {
        if (saving) return
        setSaving(true)
        setSaveError(null)

        try {
            const plannedTrip: PlannedTrip = {
                id: "",
                name: tripName,
                startDate,
                endDate,
                budget,
                destinations,
                flights,
                selectedFlight,
                transportationNotes,
                navigationPlans,
                accommodations,
                selectedAccommodation,
                attractions,
                selectedAttractions,
                estimatedTotal,
                members: 1,
                createdAt: new Date().toISOString()
            }

            const saved = await savePlannedTrip(plannedTrip)
            navigate(`/trips/${saved.id}`)
        } catch (e: any) {
            setSaveError(e?.response?.data?.error ?? e?.message ?? "Failed to save trip. Are you logged in?")
        } finally {
            setSaving(false)
        }
    }

    return (
        <AppLayout>
            <Page title="Create a Trip" subtitle="Plan step-by-step and save to your account.">
                <Box sx={{ display: "grid", gap: 3 }}>
                    <Stepper activeStep={activeStep} alternativeLabel>
                        {stepTitles.map((title) => (
                            <Step key={title}>
                                <StepLabel>{title}</StepLabel>
                            </Step>
                        ))}
                    </Stepper>

                    {saveError && <Alert severity="error">{saveError}</Alert>}

                    <Paper elevation={0} sx={{ p: 3, borderRadius: 3 }}>
                        {activeStep === 0 && (
                            <Stack spacing={2}>
                                <TextField
                                    label="Trip name"
                                    value={tripName}
                                    onChange={(e) => setTripName(e.target.value)}
                                    fullWidth
                                />

                                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                                    <TextField
                                        label="Start date"
                                        type="date"
                                        InputLabelProps={{ shrink: true }}
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        error={!!dateError}
                                        fullWidth
                                    />
                                    <TextField
                                        label="End date"
                                        type="date"
                                        InputLabelProps={{ shrink: true }}
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        error={!!dateError}
                                        helperText={dateError ?? " "}
                                        fullWidth
                                    />
                                </Stack>

                                <Typography color="text.secondary">Trip window: {tripDates}</Typography>
                            </Stack>
                        )}

                        {activeStep === 2 && (
                            <Stack spacing={2}>
                                <Paper
                                    elevation={0}
                                    sx={{
                                        p: 2,
                                        borderRadius: 3,
                                        border: "1px solid rgba(47,65,86,0.12)"
                                    }}
                                >
                                    <Stack spacing={1.5}>
                                        <Stack
                                            direction={{ xs: "column", sm: "row" }}
                                            spacing={1.5}
                                            alignItems={{ xs: "flex-start", sm: "center" }}
                                            justifyContent="space-between"
                                        >
                                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                <Typography sx={{ fontWeight: 800 }}>Starter budget</Typography>

                                                {destinations.length > 0 && (
                                                    <Chip
                                                        size="small"
                                                        label={isInternational ? "International trip" : "Domestic trip"}
                                                        variant="outlined"
                                                        sx={{ borderRadius: 999, fontWeight: 700 }}
                                                    />
                                                )}
                                            </Stack>

                                            <Stack direction="row" spacing={1} alignItems="center">
                                                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                                                    Travel style
                                                </Typography>

                                                <ToggleButtonGroup
                                                    exclusive
                                                    value={travelStyle}
                                                    onChange={(_, v) => v && setTravelStyle(v)}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: "action.hover",
                                                        p: 0.5,
                                                        borderRadius: 999,
                                                        "& .MuiToggleButton-root": {
                                                            border: 0,
                                                            borderRadius: 999,
                                                            px: 2,
                                                            textTransform: "none",
                                                            fontWeight: 800
                                                        }
                                                    }}
                                                >
                                                    <ToggleButton value="budget">Budget</ToggleButton>
                                                    <ToggleButton value="mid">Mid</ToggleButton>
                                                    <ToggleButton value="luxury">Luxury</ToggleButton>
                                                </ToggleButtonGroup>
                                            </Stack>
                                        </Stack>

                                        {!starterSuggestion ? (
                                            <Alert severity="info" sx={{ mb: 0 }}>
                                                Add dates in Step 1 and at least one destination to get a suggested budget.
                                            </Alert>
                                        ) : (
                                            <Alert severity="info" sx={{ mb: 0 }}>
                                                Suggested budget: <b>{toCurrency(starterSuggestion.suggested)}</b>{" "}
                                                <span style={{ opacity: 0.85 }}>
                                                    (includes ~{Math.round(starterSuggestion.bufferPct * 100)}% buffer)
                                                </span>
                                                <br />
                                                <span style={{ opacity: 0.85 }}>
                                                    Based on {nights} night{nights === 1 ? "" : "s"} and your travel style.
                                                </span>
                                            </Alert>
                                        )}
                                    </Stack>
                                </Paper>

                                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
                                    <TextField
                                        label="Total budget (USD)"
                                        type="number"
                                        value={budgetInput}
                                        onChange={(e) => {
                                            setBudgetTouched(true)
                                            setBudgetInput(e.target.value)
                                        }}
                                        placeholder="Enter your total budget"
                                        inputProps={{ min: 0, step: 50 }}
                                        sx={{ maxWidth: 280 }}
                                    />

                                    <Button
                                        variant="outlined"
                                        onClick={() => {
                                            if (!starterSuggestion) return
                                            setBudgetTouched(true)
                                            setBudgetInput(String(starterSuggestion.suggested))
                                        }}
                                        disabled={!starterSuggestion}
                                        sx={{ height: 40 }}
                                    >
                                        Use suggested
                                    </Button>
                                </Stack>

                                <Typography variant="body2" color="text.secondary">
                                    This is a starting target. We’ll show warning-only guidance as you pick flights, stays, and attractions.
                                </Typography>
                            </Stack>
                        )}

                        {activeStep === 1 && (
                            <Stack spacing={2}>
                                <Stack direction="row" spacing={1}>
                                    <TextField
                                        label="Add destination"
                                        placeholder="Paris or PAR"
                                        value={destinationInput}
                                        onChange={(e) => setDestinationInput(e.target.value)}
                                        fullWidth
                                    />
                                    <Button variant="contained" onClick={addDestination}>Add</Button>
                                </Stack>

                                <Stack direction="row" spacing={1} flexWrap="wrap">
                                    {destinations.map((destination) => (
                                        <Chip
                                            key={destination}
                                            label={destination}
                                            onDelete={() => removeDestination(destination)}
                                            sx={{ mb: 1 }}
                                        />
                                    ))}
                                </Stack>

                                <Alert severity="info">
                                    Tip: Flights results are best when destinations are IATA metro/airport codes (ex: PAR, ROM, BCN).
                                    Routes/Places will work fine with city names.
                                </Alert>

                                {mapsApiKey && destinations.length > 0 && (
                                    <APIProvider apiKey={mapsApiKey}>
                                        <TripRouteMap
                                            loading={false}
                                            places={resolvedPlaces}
                                            legs={[]}
                                            selectedRouteByLeg={{}}
                                            mapId={mapId}
                                        />
                                    </APIProvider>
                                )}
                            </Stack>
                        )}

                        {activeStep === 3 && (
                            <Stack spacing={2}>
                                <TextField
                                    select
                                    label="Transportation mode"
                                    value={transportMode}
                                    onChange={(e) => setTransportMode(e.target.value as TransportationMode)}
                                >
                                    <MenuItem value="flight">Flight</MenuItem>
                                    <MenuItem value="train">Train (transit routes)</MenuItem>
                                    <MenuItem value="road">Road trip / car</MenuItem>
                                </TextField>

                                <TextField
                                    label="Transportation notes"
                                    value={transportationNotes}
                                    onChange={(e) => setTransportationNotes(e.target.value)}
                                    placeholder="e.g. Prefer morning departures"
                                />

                                {mapsApiKey ? (
                                    <APIProvider apiKey={mapsApiKey}>
                                        <Stack spacing={2}>
                                            <Button
                                                variant="outlined"
                                                onClick={buildRoutes}
                                                disabled={routesLoading || destinations.length < 2}
                                            >
                                                {routesLoading ? "Building route options..." : "Build route options (Places + Routes API)"}
                                            </Button>

                                            {destinations.length < 2 && (
                                                <Alert severity="info">Add at least two destinations to build routes.</Alert>
                                            )}

                                            {routesByLeg.length > 0 && (
                                                <>
                                                    <TripRouteMap
                                                        loading={routesLoading}
                                                        places={resolvedPlaces}
                                                        legs={routesByLeg}
                                                        selectedRouteByLeg={selectedRouteByLeg}
                                                        mapId={mapId}
                                                    />

                                                    <Stack spacing={2}>
                                                        {routesByLeg.map((leg, legIndex) => (
                                                            <Paper
                                                                key={`${leg.origin}-${leg.destination}`}
                                                                elevation={0}
                                                                sx={{ p: 2, borderRadius: 2, border: "1px solid rgba(47,65,86,0.12)" }}
                                                            >
                                                                <Typography sx={{ fontWeight: 700, mb: 1 }}>
                                                                    {leg.origin} → {leg.destination}
                                                                </Typography>

                                                                {(routeOptionsByLeg[legIndex] ?? []).length === 0 ? (
                                                                    <Alert severity="warning">
                                                                        No route alternatives returned for this leg. Check API enablement and billing.
                                                                    </Alert>
                                                                ) : (
                                                                    <Stack direction="row" spacing={1} flexWrap="wrap">
                                                                        {(routeOptionsByLeg[legIndex] ?? []).map((r, routeIndex) => {
                                                                            const selected = (selectedRouteByLeg[legIndex] ?? 0) === routeIndex
                                                                            const miles = metersToMiles(r.distanceMeters)

                                                                            return (
                                                                                <Chip
                                                                                    key={`${legIndex}-${routeIndex}`}
                                                                                    label={`Option ${routeIndex + 1} • ${r.label} • ${miles.toFixed(1)} mi • ${r.duration} • ${toCurrency(r.estimatedCost)}`}
                                                                                    color={selected ? "primary" : "default"}
                                                                                    onClick={() =>
                                                                                        setSelectedRouteByLeg((prev) => ({
                                                                                            ...prev,
                                                                                            [legIndex]: routeIndex
                                                                                        }))
                                                                                    }
                                                                                    sx={{ mb: 1 }}
                                                                                />
                                                                            )
                                                                        })}
                                                                    </Stack>
                                                                )}
                                                            </Paper>
                                                        ))}
                                                    </Stack>
                                                </>
                                            )}
                                        </Stack>
                                    </APIProvider>
                                ) : (
                                    <Alert severity="info">Add VITE_GOOGLE_API_KEY to enable Places + Routes + map rendering.</Alert>
                                )}

                                <Button
                                    variant="outlined"
                                    onClick={buildNavigationPlans}
                                    disabled={navigationLoading || destinations.length < 2}
                                >
                                    {navigationLoading ? "Building navigation..." : "Build navigation summary"}
                                </Button>

                                {navigationPlans.length > 0 && (
                                    <Stack spacing={1}>
                                        {navigationPlans.map((plan) => (
                                            <Paper key={`${plan.origin}-${plan.destination}`} elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                                                <Typography sx={{ fontWeight: 700 }}>
                                                    {plan.origin} → {plan.destination}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                                    Method: {plan.method ?? "driving"} • ETA: {plan.estimatedDuration ?? "Unknown"}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                                    Estimated cost: {toCurrency(plan.estimatedCost ?? 0)} • Source: {plan.source === "google_places" ? "Google APIs" : "Mock fallback"}
                                                </Typography>
                                                <Button href={plan.mapsUrl} target="_blank" rel="noreferrer" size="small" variant="text">
                                                    Open navigation in Google Maps
                                                </Button>
                                            </Paper>
                                        ))}
                                    </Stack>
                                )}

                                {transportMode === "flight" && (
                                    <>
                                        <Button
                                            variant="outlined"
                                            onClick={fetchFlights}
                                            disabled={flightLoading || destinations.length === 0}
                                        >
                                            {flightLoading ? "Loading flights..." : "Fetch flights (SerpApi Google Flights)"}
                                        </Button>

                                        {!serpApiKey && (
                                            <Alert severity="info">
                                                VITE_SERPAPI_KEY not set, showing mock flights. Add your SerpApi key to enable real results.
                                            </Alert>
                                        )}

                                        <Stack spacing={1}>
                                            {flights.map((flight) => (
                                                <Paper
                                                    key={`${flight.airline}-${flight.route}-${flight.price}`}
                                                    elevation={0}
                                                    sx={{
                                                        p: 2,
                                                        borderRadius: 2,
                                                        border: selectedFlight?.route === flight.route && selectedFlight.airline === flight.airline
                                                            ? "2px solid"
                                                            : "1px solid rgba(47,65,86,0.15)",
                                                        borderColor:
                                                            selectedFlight?.route === flight.route && selectedFlight.airline === flight.airline
                                                                ? "primary.main"
                                                                : "rgba(47,65,86,0.15)",
                                                        cursor: "pointer"
                                                    }}
                                                    onClick={() => setSelectedFlight(flight)}
                                                >
                                                    <Typography sx={{ fontWeight: 700 }}>{flight.airline}</Typography>
                                                    <Typography color="text.secondary">{flight.route}</Typography>
                                                    <Typography>{toCurrency(flight.price)} ({flight.source})</Typography>
                                                </Paper>
                                            ))}
                                        </Stack>
                                    </>
                                )}
                            </Stack>
                        )}

                        {activeStep === 4 && (
                            <Stack spacing={2}>
                                <Typography color="text.secondary">Select a stay option (fake data for now).</Typography>
                                {accommodations.map((stay) => (
                                    <Paper
                                        key={stay.name}
                                        elevation={0}
                                        sx={{
                                            p: 2,
                                            borderRadius: 2,
                                            border: selectedAccommodation?.name === stay.name ? "2px solid" : "1px solid rgba(47,65,86,0.15)",
                                            borderColor: selectedAccommodation?.name === stay.name ? "primary.main" : "rgba(47,65,86,0.15)",
                                            cursor: "pointer"
                                        }}
                                        onClick={() => setSelectedAccommodation(stay)}
                                    >
                                        <Typography sx={{ fontWeight: 700 }}>{stay.name}</Typography>
                                        <Typography color="text.secondary">{stay.location}</Typography>
                                        <Typography>{toCurrency(stay.nightlyRate)} / night × {nights} nights</Typography>
                                    </Paper>
                                ))}
                            </Stack>
                        )}

                        {activeStep === 5 && (
                            <Stack spacing={2}>
                                <Button
                                    variant="outlined"
                                    onClick={fetchAttractions}
                                    disabled={attractionsLoading || destinations.length === 0}
                                >
                                    {attractionsLoading ? "Loading attractions..." : "Find attractions (Google Places)"}
                                </Button>

                                {!mapsApiKey && (
                                    <Alert severity="info">VITE_GOOGLE_API_KEY not set, showing mock attractions.</Alert>
                                )}

                                {attractions.map((item) => {
                                    const selected = selectedAttractions.some((a) => a.name === item.name)

                                    return (
                                        <Paper
                                            key={item.name}
                                            elevation={0}
                                            sx={{
                                                p: 2,
                                                borderRadius: 2,
                                                border: selected ? "2px solid" : "1px solid rgba(47,65,86,0.15)",
                                                borderColor: selected ? "primary.main" : "rgba(47,65,86,0.15)",
                                                cursor: "pointer"
                                            }}
                                            onClick={() => toggleAttraction(item)}
                                        >
                                            <Typography sx={{ fontWeight: 700 }}>{item.name}</Typography>
                                            <Typography color="text.secondary">{item.location}</Typography>
                                            <Typography>{toCurrency(item.price)} ({item.source})</Typography>

                                            {item.rating != null && (
                                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                                    Rating: {item.rating.toFixed(1)} / 5
                                                </Typography>
                                            )}

                                            {item.reviews && item.reviews.length > 0 && (
                                                <Stack spacing={1} sx={{ mt: 1.5 }}>
                                                    {item.reviews.slice(0, 2).map((review, idx) => (
                                                        <Paper
                                                            key={`${item.name}-review-${idx}`}
                                                            elevation={0}
                                                            sx={{
                                                                p: 1.5,
                                                                borderRadius: 2,
                                                                bgcolor: "rgba(47,65,86,0.04)"
                                                            }}
                                                        >
                                                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                                                {review.authorName} • {review.rating}/5
                                                            </Typography>
                                                            <Typography variant="body2" color="text.secondary">
                                                                {review.text || "No review text available."}
                                                            </Typography>
                                                        </Paper>
                                                    ))}
                                                </Stack>
                                            )}
                                        </Paper>
                                    )
                                })}

                                {mapsApiKey && attractionPlaces.length > 0 && (
                                    <APIProvider apiKey={mapsApiKey}>
                                        <TripRouteMap
                                            loading={false}
                                            places={attractionPlaces}
                                            legs={[]}
                                            selectedRouteByLeg={{}}
                                            mapId={mapId}
                                        />
                                    </APIProvider>
                                )}
                            </Stack>
                        )}
                    </Paper>

                    <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3 }}>
                        <Typography sx={{ fontWeight: 700, mb: 1 }}>Budget Summary</Typography>
                        <Typography variant="body2">
                            Budget target: {budget > 0 ? toCurrency(budget) : "Not set yet"}
                        </Typography>
                        <Typography variant="body2">Estimated spend (from selections): {toCurrency(estimatedTotal)}</Typography>

                        {budget > 0 && (
                            <Typography variant="body2" sx={{ mb: 1.5 }}>
                                Remaining: {toCurrency(Math.abs(budgetDifference))} {overBudget ? "over" : "left"}
                            </Typography>
                        )}

                        {budget <= 0 && (
                            <Alert severity="info">Set your total budget in Step 2 to enable budget tracking warnings.</Alert>
                        )}

                        {budget > 0 && overBudget && (
                            <Alert severity="warning">
                                You are currently over budget by {toCurrency(Math.abs(budgetDifference))}. This is only a warning (no hard lock).
                            </Alert>
                        )}

                        {budget > 0 && !overBudget && estimatedTotal > 0 && (
                            <Alert severity="success">Selections are currently within budget.</Alert>
                        )}
                    </Paper>

                    <Divider />

                    <Stack direction="row" spacing={1} justifyContent="space-between">
                        <Button variant="outlined" onClick={goBack} disabled={activeStep === 0 || saving}>Back</Button>

                        <Stack direction="row" spacing={1}>
                            <Button variant="text" onClick={() => navigate("/dashboard")} disabled={saving}>Cancel</Button>

                            {activeStep < stepTitles.length - 1 ? (
                                <Button variant="contained" onClick={goNext} disabled={!canContinue || saving}>Next</Button>
                            ) : (
                                <Button
                                    variant="contained"
                                    onClick={saveTrip}
                                    disabled={saving || !tripName || destinations.length === 0}
                                >
                                    {saving ? "Saving..." : "Save Trip"}
                                </Button>
                            )}
                        </Stack>
                    </Stack>
                </Box>
            </Page>
        </AppLayout>
    )
}