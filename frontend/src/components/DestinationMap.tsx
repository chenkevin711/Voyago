import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";

type Destination = {
  name: string;
  position: { lat: number; lng: number };
};

type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
  Marker: new (options: Record<string, unknown>) => unknown;
};

declare global {
  interface Window {
    google?: {
      maps?: GoogleMapsApi;
    };
  }
}

const destinations: Destination[] = [
  { name: "Eiffel Tower", position: { lat: 48.8584, lng: 2.2945 } },
  { name: "Colosseum", position: { lat: 41.8902, lng: 12.4922 } },
  { name: "Sagrada Família", position: { lat: 41.4036, lng: 2.1744 } },
  { name: "Prague Castle", position: { lat: 50.0911, lng: 14.401 } },
];

const SCRIPT_ID = "voyago-google-maps-script";
const apiKey = import.meta.env.GOOGLE_API_KEY as string | undefined;

export default function DestinationMap() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(
    apiKey ? null : "Google Maps key is missing. Add GOOGLE_API_KEY to your .env file.",
  );
  const [isLoading, setIsLoading] = useState(Boolean(apiKey));

  useEffect(() => {
    if (!apiKey) {
      return;
    }

    let isUnmounted = false;

    const initializeMap = () => {
      const googleMaps = window.google?.maps;
      if (!mapRef.current || !googleMaps) {
        return;
      }

      const map = new googleMaps.Map(mapRef.current, {
        center: { lat: 46.5, lng: 8.4 },
        zoom: 4,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      destinations.forEach((destination) => {
        new googleMaps.Marker({
          map,
          position: destination.position,
          title: destination.name,
        });
      });

      if (!isUnmounted) {
        setIsLoading(false);
      }
    };

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    if (existingScript) {
      if (window.google?.maps) {
        initializeMap();
      } else {
        existingScript.addEventListener("load", initializeMap, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;

    script.onload = initializeMap;
    script.onerror = () => {
      if (!isUnmounted) {
        setError("Unable to load Google Maps. Check your API key and billing setup.");
        setIsLoading(false);
      }
    };

    document.head.appendChild(script);

    return () => {
      isUnmounted = true;
    };
  }, []);

  return (
    <Box sx={{ mt: 5 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 24, mb: 1.5, color: "primary.main" }}>
        Explore featured destinations
      </Typography>
      <Typography sx={{ color: "text.secondary", mb: 2 }}>
        Demo map with pinned destinations using the Google Maps JavaScript API.
      </Typography>

      {error && <Alert severity="warning">{error}</Alert>}

      <Box
        sx={{
          position: "relative",
          borderRadius: 4,
          overflow: "hidden",
          border: "1px solid rgba(47,65,86,0.12)",
          height: { xs: 320, md: 420 },
          bgcolor: "rgba(255,255,255,0.5)",
          mt: error ? 2 : 0,
        }}
      >
        {isLoading && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(255,255,255,0.75)",
              zIndex: 1,
            }}
          >
            <CircularProgress size={28} />
          </Box>
        )}
        <Box ref={mapRef} sx={{ width: "100%", height: "100%" }} />
      </Box>
    </Box>
  );
}
