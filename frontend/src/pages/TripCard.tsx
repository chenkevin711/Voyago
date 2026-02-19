import {
  Button,
  Paper,
  Typography,
  Box,
  Chip,
  Stack,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

export default function TripCard({
  trip,
}: {
  trip: { id: string; name: string; dates: string; members: number };
}) {
  return (
    <Paper
      component={RouterLink}
      to={`/trips/${trip.id}`}
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 4,
        border: "1px solid rgba(47,65,86,0.12)",
        background: "rgba(255,255,255,0.75)",
        backdropFilter: "blur(6px)",
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.2s ease",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: 170,

        "&:hover": {
          transform: "translateY(-4px)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          borderColor: "primary.main",
        },
      }}
    >
      {/* Top Section */}
      <Box>
        <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
          {trip.name}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap">
          <Chip
            label={trip.dates}
            size="small"
            variant="outlined"
          />
          <Chip
            label={`${trip.members} member${
              trip.members === 1 ? "" : "s"
            }`}
            size="small"
            variant="outlined"
          />
        </Stack>
      </Box>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button
          variant="contained"
          size="small"
          onClick={(e) => e.stopPropagation()}
        >
          Open
        </Button>

        <Button
          component={RouterLink}
          to={`/trips/${trip.id}/itinerary`}
          variant="text"
          size="small"
          onClick={(e) => e.stopPropagation()}
        >
          Itinerary →
        </Button>
      </Box>
    </Paper>
  );
}
