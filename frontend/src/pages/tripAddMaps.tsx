import { useEffect, useState } from "react"
import { Box, Typography } from "@mui/material"
import {
    AdvancedMarker,
    InfoWindow,
    Map,
    Pin,
    useMap
} from "@vis.gl/react-google-maps"
import type { ResolvedAirport } from "../api/transport"
import type { LegRoutes, ResolvedPlace } from "./tripAddUtils"
import { decodePolyline } from "./tripAddUtils"

function RouteOverlay(props: {
    legs: LegRoutes[]
    selectedRouteByLeg: Record<number, number>
}) {
    const map = useMap()

    useEffect(() => {
        if (!map || typeof window === "undefined" || !("google" in window)) return

        const googleRef = window.google
        const polylines: Array<{ setMap: (map: null) => void }> = []

        props.legs.forEach((leg, idx) => {
            const selectedRouteIndex = props.selectedRouteByLeg[idx] ?? 0
            const selectedRoute = leg.routes[selectedRouteIndex]
            if (!selectedRoute?.encodedPolyline) return

            const path = decodePolyline(selectedRoute.encodedPolyline).map(([lat, lng]) => ({ lat, lng }))
            if (!path.length) return

            const polyline = new googleRef.maps.Polyline({
                path,
                strokeColor: "#1A73E8",
                strokeOpacity: 0.95,
                strokeWeight: 5,
                map
            })
            polylines.push(polyline)
        })

        return () => {
            polylines.forEach((polyline) => polyline.setMap(null))
        }
    }, [map, props.legs, props.selectedRouteByLeg])

    return null
}

function FitMapToPoints(props: { points: Array<{ lat: number; lng: number }>; singlePointZoom?: number }) {
    const map = useMap()

    useEffect(() => {
        if (!map || props.points.length === 0 || typeof window === "undefined" || !("google" in window)) return

        const googleRef = window.google

        if (props.points.length === 1) {
            map.panTo(props.points[0])
            map.setZoom(props.singlePointZoom ?? 11)
            return
        }

        const bounds = new googleRef.maps.LatLngBounds()
        props.points.forEach((p) => bounds.extend(p))
        map.fitBounds(bounds, 80)
    }, [map, props.points, props.singlePointZoom])

    return null
}

export function TripRouteMap(props: {
    loading: boolean
    places: ResolvedPlace[]
    legs: LegRoutes[]
    selectedRouteByLeg: Record<number, number>
    mapId?: string
}) {
    const [activePlace, setActivePlace] = useState<ResolvedPlace | null>(null)

    if (props.loading) {
        return (
            <Box sx={{ p: 2, border: "1px solid rgba(47,65,86,0.12)", borderRadius: 2 }}>
                <Typography color="text.secondary">Loading map…</Typography>
            </Box>
        )
    }

    if (props.places.length === 0) {
        return (
            <Box sx={{ p: 2, border: "1px dashed rgba(47,65,86,0.22)", borderRadius: 2 }}>
                <Typography color="text.secondary">Add destinations to preview them on the map.</Typography>
            </Box>
        )
    }

    return (
        <Box sx={{ height: 400, borderRadius: 3, overflow: "hidden", border: "1px solid rgba(47,65,86,0.12)" }}>
            <Map
                defaultCenter={props.places[0]?.location ?? { lat: 48.8566, lng: 2.3522 }}
                defaultZoom={5}
                mapId={props.mapId}
                style={{ width: "100%", height: "100%" }}
                mapTypeControl={false}
                streetViewControl={false}
                fullscreenControl={false}
            >
                {props.places.map((place) => (
                    <AdvancedMarker
                        key={place.placeId ?? `${place.name}-${place.location.lat}-${place.location.lng}`}
                        position={place.location}
                        onClick={() => setActivePlace(place)}
                    >
                        <Pin background="#4A74C9" glyphColor="#fff" borderColor="#2E4A8A" />
                    </AdvancedMarker>
                ))}

                {activePlace && (
                    <InfoWindow position={activePlace.location} onCloseClick={() => setActivePlace(null)}>
                        <Typography sx={{ fontWeight: 700 }}>{activePlace.name}</Typography>
                        <Typography variant="body2" color="text.secondary">{activePlace.formattedAddress ?? ""}</Typography>
                    </InfoWindow>
                )}

                <FitMapToPoints points={props.places.map((place) => place.location)} />
                <RouteOverlay legs={props.legs} selectedRouteByLeg={props.selectedRouteByLeg} />
            </Map>
        </Box>
    )
}

export function AirportPinsMap(props: {
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
