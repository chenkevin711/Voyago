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
    Typography
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
import {
    getTransportPlan,
    resolveAirport,
    type ResolvedAirport,
    type TransportPlanResponse
} from "../api/transport"

const stepTitles = [
    "Name + Dates",
    "Budget",
    "Destinations",
    "Transportation",
    "Living Accommodations",
    "Attractions"
]

const fakeStays: StayOption[] = [
    { name: "Harbor Light Suites", location: "City Center", nightlyRate: 180 },
    { name: "Maple Boutique Stay", location: "Old Town", nightlyRate: 135 },
    { name: "Voyager Residence", location: "Waterfront", nightlyRate: 220 }
]

type TransportationMode = "flight" | "train" | "road"

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
    return `$${amount.toLocaleString()}`
}

function toDuration(minutes?: number): string {
    if (!minutes) return "Unknown"
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "trip"
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
 * Places API (New) Text Search
 * Resolves a user-entered destination string to a Place + lat/lng
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
            // FieldMask is required and keeps payload small
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

/**
 * Routes API computeRoutes
 * Returns route alternatives with encoded polylines for drawing on the map
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
            // Only request what we actually render
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
 * Draw selected route polylines on top of the map using the underlying Maps JS Polyline.
 * @vis.gl/react-google-maps gives us the map instance via useMap()
 */
function RouteOverlay(props: {
    legs: LegRoutes[]
    selectedRouteByLeg: Record<number, number>
}) {
    const map = useMap()
    const polylinesRef = useRef<Array<{ setMap: (map: object | null) => void }>>([])

    useEffect(() => {
        if (!map) return
        if (!window.google?.maps) return

        // Clear old lines
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

function FitMapToPoints(props: { points: Array<{ lat: number; lng: number }>; singlePointZoom?: number }) {
    const map = useMap()

    useEffect(() => {
        if (!map || !window.google?.maps || props.points.length === 0) return

        if (props.points.length === 1) {
            map.panTo(props.points[0])
            map.setZoom(props.singlePointZoom ?? 8)
            return
        }

        const bounds = new window.google.maps.LatLngBounds()
        props.points.forEach((point) => bounds.extend(point))
        map.fitBounds(bounds, 64)
    }, [map, props.points, props.singlePointZoom])

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
                    {/* Loading overlay while routes compute */}
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

                <FitMapToPoints points={props.places.map((place) => place.location)} />
                <RouteOverlay legs={props.legs} selectedRouteByLeg={props.selectedRouteByLeg} />
            </Map>
        </Box>
    )
}

function AirportPinsMap(props: {
    originAirport: ResolvedAirport | null
    destinationAirport: ResolvedAirport | null
    mapId?: string
}) {
    const points = [props.originAirport?.airport, props.destinationAirport?.airport]
        .flatMap((airport) => (airport ? [{ lat: airport.lat, lng: airport.lng }] : []))

    return (
        <Box sx={{ height: 280, borderRadius: 3, overflow: "hidden", border: "1px solid rgba(47,65,86,0.12)" }}>
            <Map
                defaultCenter={points[0] ?? { lat: 39.5, lng: -98.35 }}
                defaultZoom={4}
                mapId={props.mapId}
                style={{ width: "100%", height: "100%" }}
                mapTypeControl={false}
                streetViewControl={false}
                fullscreenControl={false}
            >
                {props.originAirport && (
                    <AdvancedMarker position={{ lat: props.originAirport.airport.lat, lng: props.originAirport.airport.lng }}>
                        <Pin background="#2E7D32" glyphColor="#fff" borderColor="#1B5E20" />
                    </AdvancedMarker>
                )}
                {props.destinationAirport && (
                    <AdvancedMarker position={{ lat: props.destinationAirport.airport.lat, lng: props.destinationAirport.airport.lng }}>
                        <Pin background="#1565C0" glyphColor="#fff" borderColor="#0D47A1" />
                    </AdvancedMarker>
                )}
                <FitMapToPoints points={points} singlePointZoom={5} />
            </Map>
        </Box>
    )
}

export default function TripAdd() {
    const navigate = useNavigate()

    const mapsApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
    const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined
    const [activeStep, setActiveStep] = useState(0)
    const [tripName, setTripName] = useState("")
    const [startDate, setStartDate] = useState("")
    const [endDate, setEndDate] = useState("")
    const [budgetInput, setBudgetInput] = useState("")
    const [destinationInput, setDestinationInput] = useState("")
    const [destinations, setDestinations] = useState<string[]>([])
    const [transportMode, setTransportMode] = useState<TransportationMode>("flight")
    const [transportationNotes, setTransportationNotes] = useState("")

    const [flights, setFlights] = useState<FlightOption[]>([])
    const [selectedFlight, setSelectedFlight] = useState<FlightOption | undefined>(undefined)
    const [flightLoading, setFlightLoading] = useState(false)
    const [transportOriginInput, setTransportOriginInput] = useState("")
    const [transportDestinationInput, setTransportDestinationInput] = useState("")
    const [originAirport, setOriginAirport] = useState<ResolvedAirport | null>(null)
    const [destinationAirport, setDestinationAirport] = useState<ResolvedAirport | null>(null)
    const [transportPlan, setTransportPlan] = useState<TransportPlanResponse | null>(null)
    const [transportError, setTransportError] = useState<string | null>(null)

    const [accommodations] = useState<StayOption[]>(fakeStays)
    const [selectedAccommodation, setSelectedAccommodation] = useState<StayOption | undefined>(undefined)

    const [attractions, setAttractions] = useState<AttractionOption[]>([])
    const [selectedAttractions, setSelectedAttractions] = useState<AttractionOption[]>([])
    const [attractionsLoading, setAttractionsLoading] = useState(false)

    // Kept for your existing UI, but we now also show route options on the map
    const [navigationPlans, setNavigationPlans] = useState<NavigationPlan[]>([])
    const [routeOptionsByLeg, setRouteOptionsByLeg] = useState<Record<number, RouteOption[]>>({})

    // New: resolved places + route alternatives for the map
    const [resolvedPlaces, setResolvedPlaces] = useState<ResolvedPlace[]>([])
    const [routesByLeg, setRoutesByLeg] = useState<LegRoutes[]>([])
    const [routesLoading, setRoutesLoading] = useState(false)
    const [selectedRouteByLeg, setSelectedRouteByLeg] = useState<Record<number, number>>({})
    const [attractionPlaces, setAttractionPlaces] = useState<ResolvedPlace[]>([])

    const nights = tripNights(startDate, endDate)
    const budget = Number(budgetInput)

    const flightCost = selectedFlight?.price ?? 0
    const stayCost = selectedAccommodation ? selectedAccommodation.nightlyRate * nights : 0
    const attractionCost = selectedAttractions.reduce((sum, a) => sum + a.price, 0)
    const estimatedTotal = flightCost + stayCost + attractionCost
    const budgetDifference = budget - estimatedTotal
    const overBudget = budgetDifference < 0

    const tripDates = formatDateRange(startDate, endDate)

    const canContinue = useMemo(() => {
        if (activeStep === 0) return tripName.trim().length > 1 && Boolean(startDate) && Boolean(endDate)
        if (activeStep === 1) return budgetInput.trim().length > 0 && budget > 0
        if (activeStep === 2) return destinations.length > 0
        return true
    }, [activeStep, budget, budgetInput, destinations.length, endDate, startDate, tripName])

    useEffect(() => {
        if (!mapsApiKey || destinations.length === 0) {
            setResolvedPlaces([])
            return
        }

        let cancelled = false
            ; (async () => {
                const results = await Promise.all(destinations.map((d) => resolvePlaceText({ apiKey: mapsApiKey, query: d })))
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

    useEffect(() => {
        if (destinations.length > 0 && !transportDestinationInput) {
            setTransportDestinationInput(destinations[0])
        }
    }, [destinations, transportDestinationInput])

    useEffect(() => {
        if (activeStep !== 3) return
        if (!mapsApiKey || destinations.length < 2) return

        void buildRoutes()
    }, [activeStep, destinations, mapsApiKey, transportMode])

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
        if (!startDate || !endDate || !transportOriginInput.trim() || !transportDestinationInput.trim()) return

        setFlightLoading(true)
        setTransportError(null)
        try {
            const result = await getTransportPlan({
                origin: transportOriginInput,
                destination: transportDestinationInput,
                outboundDate: startDate,
                returnDate: endDate
            })

            setTransportPlan(result)
            setOriginAirport(result.origin)
            setDestinationAirport(result.destination)

            const results: FlightOption[] = result.recommendations.map((option) => {
                const firstSegment = option.segments[0]
                return {
                    airline: option.title,
                    route: firstSegment?.summary ?? `${result.origin.airport.code} → ${result.destination.airport.code}`,
                    price: option.totalPriceUsd ?? 0,
                    source: "serpapi"
                }
            })

            if (results.length === 0) {
                setFlights([{ airline: "No recommendation found", route: `${transportOriginInput} → ${transportDestinationInput}`, price: 0, source: "mock" }])
                return
            }

            setFlights(results)
        } catch {
            setTransportPlan(null)
            setTransportError("Unable to build transportation plan. Ensure backend is running and SERP_API_KEY is set in backend .env.")
            setFlights([{ airline: "Fallback", route: `${transportOriginInput} → ${transportDestinationInput}`, price: 0, source: "mock" }])
        } finally {
            setFlightLoading(false)
        }
    }

    async function resolveAirportInput(which: "origin" | "destination") {
        const value = which === "origin" ? transportOriginInput : transportDestinationInput
        if (!value.trim()) return

        try {
            setTransportError(null)
            const resolved = await resolveAirport(value)
            if (which === "origin") setOriginAirport(resolved)
            else setDestinationAirport(resolved)
        } catch {
            setTransportError(`Could not resolve ${which} to an airport.`)
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

                    const modeOrder: Array<"driving" | "transit" | "walking"> = [drivingTransitMode, "walking", drivingTransitMode === "driving" ? "transit" : "driving"]
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
                    "X-Goog-FieldMask": "places.displayName,places.formattedAddress"
                },
                body: JSON.stringify({
                    textQuery: `Top attractions in ${destinations[0]}`,
                    pageSize: 5
                })
            })

            const data = (await response.json()) as {
                places?: Array<{ displayName?: { text?: string }; formattedAddress?: string }>
            }

            const options = (data.places ?? []).map((place, index) => ({
                name: place.displayName?.text ?? `Attraction ${index + 1}`,
                location: place.formattedAddress ?? destinations[0],
                price: 20 + index * 12,
                source: "google_places" as const
            }))

            const nextAttractions = options.length > 0
                ? options
                : [{ name: "Historic Landmarks Tour", location: destinations[0], price: 45, source: "mock" as const }]
            setAttractions(nextAttractions)

            const placeResults = await Promise.all(
                nextAttractions.map((item) => resolvePlaceText({ apiKey: mapsApiKey, query: `${item.name} ${item.location}` }))
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

    function saveTrip() {
        const id = `${slugify(tripName)}-${Date.now().toString().slice(-6)}`

        const plannedTrip: PlannedTrip = {
            id,
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

        savePlannedTrip(plannedTrip)
        navigate(`/trips/${id}`)
    }

    return (
        <AppLayout>
            <Page title="Create a Trip" subtitle="Plan step-by-step. For now this saves to local state only for display.">
                <Box sx={{ display: "grid", gap: 3 }}>
                    <Stepper activeStep={activeStep} alternativeLabel>
                        {stepTitles.map((title) => (
                            <Step key={title}>
                                <StepLabel>{title}</StepLabel>
                            </Step>
                        ))}
                    </Stepper>

                    <Paper elevation={0} sx={{ p: 3, borderRadius: 3 }}>
                        {activeStep === 0 && (
                            <Stack spacing={2}>
                                <TextField
                                    label="Trip name"
                                    value={tripName}
                                    onChange={(e) => setTripName(e.target.value)}
                                    fullWidth
                                />
                                <TextField
                                    label="Start date"
                                    type="date"
                                    InputLabelProps={{ shrink: true }}
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                                <TextField
                                    label="End date"
                                    type="date"
                                    InputLabelProps={{ shrink: true }}
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                                <Typography color="text.secondary">Trip window: {tripDates}</Typography>
                            </Stack>
                        )}

                        {activeStep === 1 && (
                            <Stack spacing={2}>
                                <TextField
                                    label="Total budget (USD)"
                                    type="number"
                                    value={budgetInput}
                                    onChange={(e) => setBudgetInput(e.target.value)}
                                    placeholder="Enter your total budget"
                                />
                                <Typography color="text.secondary">
                                    Choose your own budget. We use it to show warning-only guidance while selecting transportation, stays, and attractions.
                                </Typography>
                            </Stack>
                        )}

                        {activeStep === 2 && (
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

                                {/* Routes + Places + Map */}
                                {mapsApiKey ? (
                                    <APIProvider apiKey={mapsApiKey}>
                                        <Stack spacing={2}>
                                            {destinations.length < 2 && (
                                                <Alert severity="info">Add at least two destinations to build routes.</Alert>
                                            )}

                                            {routesLoading && (
                                                <Alert severity="info">Building route options...</Alert>
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

                                {/* Flights */}
                                {transportMode === "flight" && (
                                    <>
                                        <TextField
                                            label="Origin (city or airport code)"
                                            value={transportOriginInput}
                                            onChange={(e) => setTransportOriginInput(e.target.value)}
                                            onBlur={() => void resolveAirportInput("origin")}
                                            placeholder="e.g. Philadelphia or PHL"
                                        />
                                        <TextField
                                            label="Destination (city or airport code)"
                                            value={transportDestinationInput}
                                            onChange={(e) => setTransportDestinationInput(e.target.value)}
                                            onBlur={() => void resolveAirportInput("destination")}
                                            placeholder="e.g. Paris or CDG"
                                        />

                                        <Stack direction="row" spacing={1}>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("origin")}>Resolve origin airport</Button>
                                            <Button variant="outlined" onClick={() => void resolveAirportInput("destination")}>Resolve destination airport</Button>
                                        </Stack>

                                        <Button
                                            variant="outlined"
                                            onClick={fetchFlights}
                                            disabled={flightLoading || !startDate || !endDate || !transportOriginInput || !transportDestinationInput}
                                        >
                                            {flightLoading ? "Loading flight options..." : "Get flight options"}
                                        </Button>

                                        {transportError && <Alert severity="error">{transportError}</Alert>}

                                        {(originAirport || destinationAirport) && (
                                            <Paper elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Resolved Airports</Typography>
                                                <Typography variant="body2">Origin: {originAirport ? `${originAirport.airport.name} (${originAirport.airport.code})` : "Not resolved"}</Typography>
                                                <Typography variant="body2">Destination: {destinationAirport ? `${destinationAirport.airport.name} (${destinationAirport.airport.code})` : "Not resolved"}</Typography>
                                            </Paper>
                                        )}

                                        {mapsApiKey && (originAirport || destinationAirport) && (
                                            <APIProvider apiKey={mapsApiKey}>
                                                <AirportPinsMap
                                                    originAirport={originAirport}
                                                    destinationAirport={destinationAirport}
                                                    mapId={mapId}
                                                />
                                            </APIProvider>
                                        )}

                                        {transportPlan?.recommendations?.length ? (
                                            <Paper elevation={0} sx={{ p: 2, borderRadius: 2 }}>
                                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Best flight options</Typography>
                                                <Stack spacing={1}>
                                                    {transportPlan.recommendations.map((option) => (
                                                        <Typography key={`${option.title}-${option.score}`} variant="body2" color="text.secondary">
                                                            {option.title}: {toDuration(option.totalDurationMinutes)} • ${option.totalPriceUsd ?? "—"}
                                                        </Typography>
                                                    ))}
                                                </Stack>
                                            </Paper>
                                        ) : null}

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
                                                    <Typography>{toCurrency(flight.price)}</Typography>
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
                        <Typography variant="body2">Estimated spend: {toCurrency(estimatedTotal)}</Typography>

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
                        <Button variant="outlined" onClick={goBack} disabled={activeStep === 0}>Back</Button>

                        <Stack direction="row" spacing={1}>
                            <Button variant="text" onClick={() => navigate("/dashboard")}>Cancel</Button>

                            {activeStep < stepTitles.length - 1 ? (
                                <Button variant="contained" onClick={goNext} disabled={!canContinue}>Next</Button>
                            ) : (
                                <Button variant="contained" onClick={saveTrip} disabled={!tripName || destinations.length === 0}>
                                    Save Trip
                                </Button>
                            )}
                        </Stack>
                    </Stack>
                </Box>
            </Page>
        </AppLayout>
    )
}