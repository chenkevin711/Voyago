import { Button, Paper, Typography, Box } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

export default function TripCard({
  trip,
}: {
  trip: { id: string; name: string; dates: string; members: number };
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 4,
        border: "1px solid rgba(47,65,86,0.12)",
        background: "rgba(255,255,255,0.65)"
      }}
    >
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {trip.name}
      </Typography>
      <Typography sx={{ color: "text.secondary", mb: 2 }}>
        {trip.dates} • {trip.members} members
      </Typography>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Button component={RouterLink} to={`/trips/${trip.id}`} variant="contained" size="small">
          Open
        </Button>
        <Button component={RouterLink} to={`/trips/${trip.id}/itinerary`} variant="text" size="small">
          Itinerary →
        </Button>
      </Box>
    </Paper>
  );
}
