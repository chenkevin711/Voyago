import { Box, Button, Paper, TextField, Typography } from "@mui/material";
import AppLayout from "../components/AppLayout";
import Page from "../components/Page";

const messages = [
  { who: "Aisha", text: "Should we do the museum on Day 2?" },
  { who: "You", text: "Yes! And dinner near the river after." },
];

export default function Chat() {
  return (
    <AppLayout>
      <Page title="Trip Chat" subtitle="Live collaboration (UI skeleton)">
        <Box sx={{ display: "grid", gap: 2 }}>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, height: 320, overflow: "auto" }}>
            {messages.map((m, idx) => (
              <Box key={idx} sx={{ mb: 1.5 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{m.who}</Typography>
                <Typography sx={{ color: "text.secondary" }}>{m.text}</Typography>
              </Box>
            ))}
          </Paper>

          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField placeholder="Type a message…" fullWidth />
            <Button variant="contained">Send</Button>
          </Box>
        </Box>
      </Page>
    </AppLayout>
  );
}
