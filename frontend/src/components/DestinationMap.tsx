import { Alert, Box, CircularProgress, Typography } from "@mui/material"
import { useMemo, useState } from "react"
import {
    APIProvider,
    AdvancedMarker,
    Map,
    Pin,
    InfoWindow
} from "@vis.gl/react-google-maps"

type Destination = {
    name: string
    position: { lat: number; lng: number }
}

const destinations: Destination[] = [
    { name: "Eiffel Tower", position: { lat: 48.8584, lng: 2.2945 } },
    { name: "Colosseum", position: { lat: 41.8902, lng: 12.4922 } },
    { name: "Sagrada Família", position: { lat: 41.4036, lng: 2.1744 } },
    { name: "Prague Castle", position: { lat: 50.0911, lng: 14.401 } }
]

const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
const mapId = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined

const defaultCenter = { lat: 46.5, lng: 8.4 }

export default function DestinationMap() {
    const [loading, setLoading] = useState(Boolean(apiKey))

    const [selected, setSelected] = useState<Destination | null>(null)

    const error = apiKey
        ? null
        : "Google Maps key is missing. Add VITE_GOOGLE_API_KEY to your .env file."

    const mapOptions = useMemo(
        () => ({
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        }),
        []
    )

    return (
        <Box sx={{ mt: 5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 24, mb: 1.5, color: "primary.main" }}>
                Explore featured destinations
            </Typography>

            {error && <Alert severity="warning">{error}</Alert>}

            <Box
                sx={{
                    position: "relative",
                    borderRadius: 4,
                    overflow: "hidden",
                    border: "1px solid rgba(47,65,86,0.12)",
                    height: { xs: 320, md: 420 }
                }}
            >
                {!apiKey ? null : (
                    <APIProvider apiKey={apiKey}>
                        {loading && (
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
                                <CircularProgress size={28} />
                            </Box>
                        )}

                        <Map
                            defaultCenter={defaultCenter}
                            defaultZoom={4}
                            mapId={mapId}
                            style={{ width: "100%", height: "100%" }}
                            {...mapOptions}
                            onIdle={() => setLoading(false)}
                        >
                            {/* Markers */}
                            {destinations.map((d) => (
                                <AdvancedMarker
                                    key={d.name}
                                    position={d.position}
                                    onClick={() => setSelected(d)} // <-- open tooltip
                                >
                                    <Pin />
                                </AdvancedMarker>
                            ))}

                            {/* Tooltip / Info Window */}
                            {selected && (
                                <InfoWindow
                                    position={selected.position}
                                    onCloseClick={() => setSelected(null)}
                                >
                                    <Box sx={{ minWidth: 160 }}>
                                        <Typography sx={{ fontWeight: 700 }}>
                                            {selected.name}
                                        </Typography>

                                        <Typography sx={{ fontSize: 13, color: "text.secondary", mb: 1 }}>
                                            Featured destination
                                        </Typography>

                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${selected.position.lat},${selected.position.lng}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{
                                                color: "#1a73e8",
                                                textDecoration: "none",
                                                fontSize: 13
                                            }}
                                        >
                                            View on Google Maps
                                        </a>
                                    </Box>
                                </InfoWindow>
                            )}
                        </Map>
                    </APIProvider>
                )}
            </Box>
        </Box>
    )
}