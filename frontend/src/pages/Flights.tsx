import { Box, Paper, Typography, TextField, Button } from "@mui/material";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

export default function Flights() {
  return (
    <AppLayout>
      <Page title="Flights & Hotels" subtitle="Search + compare (UI skeleton)">
        <Box sx={{ display: "grid", gap: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
            <TextField label="From" placeholder="PHL" />
            <TextField label="To" placeholder="CDG" />
            <TextField label="Depart" type="date" InputLabelProps={{ shrink: true }} />
            <TextField label="Return" type="date" InputLabelProps={{ shrink: true }} />
          </Box>

          <Button variant="contained" sx={{ width: "fit-content" }}>
            Search
          </Button>

          <Paper elevation={0} sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 700 }}>Results (placeholder)</Typography>
            <Typography sx={{ color: "text.secondary" }}>
              API results will render here next week.
            </Typography>
          </Paper>
        </Box>
      </Page>
    </AppLayout>
  );
}
