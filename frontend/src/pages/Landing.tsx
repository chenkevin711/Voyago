import { Box, Button, Container, Paper, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import Navbar from "../components/Navbar";

export default function Landing() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Navbar />
      <Container maxWidth="lg" sx={{ pt: 10, pb: 8 }}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 4, md: 7 },
            borderRadius: 6,
            background:
              "linear-gradient(135deg, rgba(200,217,230,0.75), rgba(247,201,212,0.35))",
            border: "1px solid rgba(47,65,86,0.12)",
          }}
        >
          <Typography
            sx={{
              fontFamily: "Playfair Display",
              fontSize: { xs: 40, md: 60 },
              color: "primary.main",
              lineHeight: 1.05,
              mb: 2,
            }}
          >
            Plan beautifully. <br /> Travel confidently.
          </Typography>

          <Typography sx={{ fontSize: 18, maxWidth: 680, color: "rgba(47,65,86,0.85)", mb: 4 }}>
            Build day-by-day itineraries, compare flights & hotels, track your budget,
            and collaborate with trip members in real time.
          </Typography>

          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <Button component={RouterLink} to="/signup" variant="contained" size="large">
              Get Started
            </Button>
            <Button component={RouterLink} to="/login" variant="outlined" size="large">
              Log In
            </Button>
            <Button component={RouterLink} to="/dashboard" variant="text" size="large">
              Preview Dashboard →
            </Button>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
              gap: 2,
              mt: 5,
            }}
          >
            {[
              ["Personalized Itineraries", "Style + pace controls create a flexible plan."],
              ["Budget Tracking", "Track spend with category breakdowns."],
              ["Live Collaboration", "Edits show up instantly for trip members."],
            ].map(([t, d]) => (
              <Paper key={t} elevation={0} sx={{ p: 3, borderRadius: 4 }}>
                <Typography sx={{ fontWeight: 700, mb: 1 }}>{t}</Typography>
                <Typography sx={{ color: "text.secondary" }}>{d}</Typography>
              </Paper>
            ))}
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
