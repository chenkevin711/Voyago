import { Box, Paper, TextField, Typography, Button } from "@mui/material";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

export default function Profile() {
  return (
    <AppLayout>
      <Page title="Profile" subtitle="Account settings (UI skeleton)">
        <Box sx={{ display: "grid", gap: 2, maxWidth: 520 }}>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>Your info</Typography>
            <Box sx={{ display: "grid", gap: 2 }}>
              <TextField label="Name" defaultValue="Hitanshi" />
              <TextField label="Email" defaultValue="hitanshi@example.com" />
              <Button variant="contained" sx={{ width: "fit-content" }}>
                Save Changes
              </Button>
            </Box>
          </Paper>
        </Box>
      </Page>
    </AppLayout>
  );
}
