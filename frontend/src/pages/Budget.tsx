import { Box, Paper, Typography } from "@mui/material";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

const items = [
  { label: "Flights", amount: 620 },
  { label: "Hotels", amount: 900 },
  { label: "Food", amount: 350 },
  { label: "Activities", amount: 210 },
];

export default function Budget() {
  const total = items.reduce((sum, i) => sum + i.amount, 0);

  return (
    <AppLayout>
      <Page title="Budget" subtitle="Track spend by category (UI skeleton)">
        <Paper elevation={0} sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Typography sx={{ fontWeight: 700 }}>Estimated Total</Typography>
          <Typography sx={{ fontSize: 28, color: "primary.main", fontWeight: 800 }}>
            ${total}
          </Typography>
        </Paper>

        <Box sx={{ display: "grid", gap: 1 }}>
          {items.map((i) => (
            <Paper key={i.label} elevation={0} sx={{ p: 2, borderRadius: 3, display: "flex", justifyContent: "space-between" }}>
              <Typography sx={{ fontWeight: 600 }}>{i.label}</Typography>
              <Typography sx={{ color: "text.secondary" }}>${i.amount}</Typography>
            </Paper>
          ))}
        </Box>
      </Page>
    </AppLayout>
  );
}
