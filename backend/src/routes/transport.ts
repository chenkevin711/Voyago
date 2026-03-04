import express, { Request, Response } from "express";

const router = express.Router();

const SERP_API_BASE = "https://serpapi.com/search.json";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const OVERPASS_BASE = "https://overpass-api.de/api/interpreter";

type AirportResolution = {
  input: string;
  inputType: "city" | "airport_code";
  cityName?: string;
  airport: {
    code: string;
    name: string;
    lat: number;
    lng: number;
  };
};

type Segment = {
  mode: "flight" | "train" | "car";
  summary: string;
  durationMinutes?: number;
  priceUsd?: number;
};

type PlanOption = {
  title: string;
  totalDurationMinutes?: number;
  totalPriceUsd?: number;
  score: number;
  segments: Segment[];
};

function isAirportCode(input: string): boolean {
  return /^[A-Za-z]{3}$/.test(input.trim());
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "Voyago/1.0",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

async function geocodeCity(city: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", city);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const data = await fetchJson<Array<{ lat: string; lon: string; display_name: string }>>(url.toString());
  const first = data[0];
  if (!first) return null;

  return {
    lat: Number(first.lat),
    lng: Number(first.lon),
    displayName: first.display_name,
  };
}

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function findNearestAirportToPoint(lat: number, lng: number): Promise<AirportResolution["airport"] | null> {
  const query = `
[out:json][timeout:25];
(
  node(around:120000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
  way(around:120000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
  relation(around:120000,${lat},${lng})["aeroway"="aerodrome"]["iata"];
);
out center tags;
`;

  const body = new URLSearchParams({ data: query }).toString();
  const data = await fetchJson<{ elements?: OverpassElement[] }>(OVERPASS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const elements = data.elements ?? [];
  if (elements.length === 0) return null;

  const withDistance = elements
    .map((el) => {
      const pointLat = el.lat ?? el.center?.lat;
      const pointLng = el.lon ?? el.center?.lon;
      const code = el.tags?.iata;
      if (pointLat == null || pointLng == null || !code) return null;
      const dx = pointLat - lat;
      const dy = pointLng - lng;
      const distance = dx * dx + dy * dy;
      return {
        code: code.toUpperCase(),
        name: el.tags?.name ?? `${code.toUpperCase()} Airport`,
        lat: pointLat,
        lng: pointLng,
        distance,
      };
    })
    .filter((x): x is { code: string; name: string; lat: number; lng: number; distance: number } => Boolean(x))
    .sort((a, b) => a.distance - b.distance);

  const first = withDistance[0];
  if (!first) return null;
  return { code: first.code, name: first.name, lat: first.lat, lng: first.lng };
}

async function findAirportByCode(code: string): Promise<AirportResolution["airport"] | null> {
  const c = code.toUpperCase();
  const query = `
[out:json][timeout:25];
(
  node["iata"="${c}"]["aeroway"="aerodrome"];
  way["iata"="${c}"]["aeroway"="aerodrome"];
  relation["iata"="${c}"]["aeroway"="aerodrome"];
);
out center tags;
`;

  const body = new URLSearchParams({ data: query }).toString();
  const data = await fetchJson<{ elements?: OverpassElement[] }>(OVERPASS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const airport = (data.elements ?? []).find((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    return lat != null && lng != null;
  });

  if (!airport) return null;
  const lat = airport.lat ?? airport.center?.lat;
  const lng = airport.lon ?? airport.center?.lon;
  if (lat == null || lng == null) return null;

  return {
    code: c,
    name: airport.tags?.name ?? `${c} Airport`,
    lat,
    lng,
  };
}

async function resolveAirport(input: string): Promise<AirportResolution | null> {
  const trimmed = input.trim();

  if (isAirportCode(trimmed)) {
    const airport = await findAirportByCode(trimmed);
    if (!airport) return null;
    return { input: trimmed, inputType: "airport_code", airport };
  }

  const city = await geocodeCity(trimmed);
  if (!city) return null;

  const airport = await findNearestAirportToPoint(city.lat, city.lng);
  if (!airport) return null;

  return {
    input: trimmed,
    inputType: "city",
    cityName: city.displayName,
    airport,
  };
}

function toMinutes(duration: string): number | undefined {
  const m = /([0-9]+) min/.exec(duration);
  const h = /([0-9]+) hr/.exec(duration);
  if (!m && !h) return undefined;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

router.post("/resolve-airport", async (req: Request, res: Response) => {
  try {
    const input = String(req.body?.input ?? "").trim();
    if (!input) return res.status(400).json({ error: "input is required" });

    const resolved = await resolveAirport(input);
    if (!resolved) return res.status(404).json({ error: "Could not resolve airport" });

    return res.json(resolved);
  } catch (error) {
    return res.status(500).json({ error: "Failed to resolve airport" });
  }
});

router.post("/plan", async (req: Request, res: Response) => {
  try {
    const { origin, destination, outboundDate, returnDate } = req.body as {
      origin?: string;
      destination?: string;
      outboundDate?: string;
      returnDate?: string;
    };

    if (!origin || !destination || !outboundDate || !returnDate) {
      return res.status(400).json({ error: "origin, destination, outboundDate, returnDate are required" });
    }

    const apiKey = process.env.SERP_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "SERP_API_KEY is not configured" });

    const [originResolved, destinationResolved] = await Promise.all([
      resolveAirport(origin),
      resolveAirport(destination),
    ]);

    if (!originResolved || !destinationResolved) {
      return res.status(404).json({ error: "Could not resolve one or both locations to airports" });
    }

    const flightsUrl = new URL(SERP_API_BASE);
    flightsUrl.searchParams.set("engine", "google_flights");
    flightsUrl.searchParams.set("api_key", apiKey);
    flightsUrl.searchParams.set("departure_id", originResolved.airport.code);
    flightsUrl.searchParams.set("arrival_id", destinationResolved.airport.code);
    flightsUrl.searchParams.set("outbound_date", outboundDate);
    flightsUrl.searchParams.set("return_date", returnDate);
    flightsUrl.searchParams.set("currency", "USD");

    const mapsTrainUrl = new URL(SERP_API_BASE);
    mapsTrainUrl.searchParams.set("engine", "google_maps_directions");
    mapsTrainUrl.searchParams.set("api_key", apiKey);
    mapsTrainUrl.searchParams.set("origin", origin);
    mapsTrainUrl.searchParams.set("destination", destination);
    mapsTrainUrl.searchParams.set("mode", "transit");

    const mapsCarUrl = new URL(SERP_API_BASE);
    mapsCarUrl.searchParams.set("engine", "google_maps_directions");
    mapsCarUrl.searchParams.set("api_key", apiKey);
    mapsCarUrl.searchParams.set("origin", origin);
    mapsCarUrl.searchParams.set("destination", destination);
    mapsCarUrl.searchParams.set("mode", "driving");

    const [flightData, trainData, carData] = await Promise.all([
      fetchJson<any>(flightsUrl.toString()),
      fetchJson<any>(mapsTrainUrl.toString()),
      fetchJson<any>(mapsCarUrl.toString()),
    ]);

    const bestFlight = [...(flightData.best_flights ?? []), ...(flightData.other_flights ?? [])][0];
    const flightPrice = bestFlight?.price ? Number(bestFlight.price) : undefined;
    const flightLegDuration = bestFlight?.total_duration ? Number(bestFlight.total_duration) : undefined;

    const trainLeg = trainData.routes?.[0]?.legs?.[0];
    const carLeg = carData.routes?.[0]?.legs?.[0];

    const trainDuration = typeof trainLeg?.duration === "string" ? toMinutes(trainLeg.duration) : undefined;
    const carDuration = typeof carLeg?.duration === "string" ? toMinutes(carLeg.duration) : undefined;

    const options: PlanOption[] = [];

    if (flightLegDuration || flightPrice) {
      const carToCityMinutes = 45;
      const totalFlightMinutes = (flightLegDuration ?? 0) + carToCityMinutes;
      const totalFlightPrice = (flightPrice ?? 0) + 35;
      options.push({
        title: "Flight + airport transfer",
        totalDurationMinutes: totalFlightMinutes,
        totalPriceUsd: totalFlightPrice,
        score: totalFlightMinutes + totalFlightPrice * 0.35,
        segments: [
          {
            mode: "flight",
            summary: `${originResolved.airport.code} → ${destinationResolved.airport.code}`,
            durationMinutes: flightLegDuration,
            priceUsd: flightPrice,
          },
          {
            mode: "car",
            summary: `${destinationResolved.airport.code} → ${destination}`,
            durationMinutes: carToCityMinutes,
            priceUsd: 35,
          },
        ],
      });
    }

    if (trainDuration) {
      options.push({
        title: "Train",
        totalDurationMinutes: trainDuration,
        totalPriceUsd: 40,
        score: trainDuration + 40 * 0.35,
        segments: [{ mode: "train", summary: `${origin} → ${destination}`, durationMinutes: trainDuration, priceUsd: 40 }],
      });
    }

    if (carDuration) {
      const carPrice = Math.max(20, Math.round((carDuration / 60) * 12));
      options.push({
        title: "Drive",
        totalDurationMinutes: carDuration,
        totalPriceUsd: carPrice,
        score: carDuration + carPrice * 0.35,
        segments: [{ mode: "car", summary: `${origin} → ${destination}`, durationMinutes: carDuration, priceUsd: carPrice }],
      });
    }

    const ranked = options.sort((a, b) => a.score - b.score);

    return res.json({
      origin: originResolved,
      destination: destinationResolved,
      recommendations: ranked,
      best: ranked[0] ?? null,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to build transportation plan" });
  }
});

export default router;
