import { Box, Button, Container, Paper, TextField, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import Navbar from "../components/Navbar";

export default function Signup() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Navbar />
      <Container maxWidth="sm" sx={{ pt: 10 }}>
        <Paper elevation={0} sx={{ p: 4, borderRadius: 5 }}>
          <Typography sx={{ fontFamily: "Playfair Display", fontSize: 34, color: "primary.main", mb: 1 }}>
            Create your account
          </Typography>
          <Typography sx={{ color: "text.secondary", mb: 3 }}>
            Start building itineraries in minutes.
          </Typography>

          <Box sx={{ display: "grid", gap: 2 }}>
            <TextField label="Name" fullWidth />
            <TextField label="Email" fullWidth />
            <TextField label="Password" type="password" fullWidth />
            <Button variant="contained" size="large">Sign Up</Button>
          </Box>

          <Typography sx={{ mt: 3, color: "text.secondary" }}>
            Already have an account?{" "}
            <Typography component={RouterLink} to="/login" sx={{ color: "primary.main", textDecoration: "none", fontWeight: 600 }}>
              Log in
            </Typography>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
