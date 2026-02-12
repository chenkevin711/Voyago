import { Box, Button, TextField } from "@mui/material";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

export default function TripAdd() {
  return (
    <AppLayout>
      <Page title="Create a Trip" subtitle="Start with a name and dates. You can edit later.">
        <Box sx={{ display: "grid", gap: 2, maxWidth: 520 }}>
          <TextField label="Trip name" fullWidth />
          <TextField label="Start date" type="date" InputLabelProps={{ shrink: true }} />
          <TextField label="End date" type="date" InputLabelProps={{ shrink: true }} />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button variant="contained">Create</Button>
            <Button variant="outlined">Cancel</Button>
          </Box>
        </Box>
      </Page>
    </AppLayout>
  );
}
