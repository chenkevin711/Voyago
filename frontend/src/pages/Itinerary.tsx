import { Box, Paper, Typography } from "@mui/material";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

const days = [
  { day: "Day 1", title: "Arrive + Explore", items: ["Check-in", "Lunch spot", "Evening walk"] },
  { day: "Day 2", title: "Museums + Food", items: ["Morning museum", "Market lunch", "Dinner reservation"] },
];

export default function Itinerary() {
  return (
    <AppLayout>
      <Page title="Itinerary" subtitle="Morning • Afternoon • Evening (UI skeleton)">
        <Box sx={{ display: "grid", gap: 2 }}>
          {days.map((d) => (
            <Paper key={d.day} elevation={0} sx={{ p: 2, borderRadius: 3 }}>
              <Typography sx={{ fontWeight: 700 }}>{d.day} — {d.title}</Typography>
              <Box sx={{ mt: 1, display: "grid", gap: 0.5 }}>
                {d.items.map((i) => (
                  <Typography key={i} sx={{ color: "text.secondary" }}>• {i}</Typography>
                ))}
              </Box>
            </Paper>
          ))}
        </Box>
      </Page>
    </AppLayout>
  );
}
