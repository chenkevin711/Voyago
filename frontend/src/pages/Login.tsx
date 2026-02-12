import { Box, Button, Container, TextField, Typography, Paper } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import Navbar from "../components/Navbar";

export default function Login() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Navbar />
      <Container maxWidth="sm" sx={{ pt: 10 }}>
        <Paper elevation={0} sx={{ p: 4, borderRadius: 5 }}>
          <Typography sx={{ fontFamily: "Playfair Display", fontSize: 34, color: "primary.main", mb: 1 }}>
            Welcome back
          </Typography>
          <Typography sx={{ color: "text.secondary", mb: 3 }}>
            Log in to continue planning your next trip.
          </Typography>

          <Box sx={{ display: "grid", gap: 2 }}>
            <TextField label="Email" fullWidth />
            <TextField label="Password" type="password" fullWidth />
            <Button variant="contained" size="large">Log In</Button>
          </Box>

          <Typography sx={{ mt: 3, color: "text.secondary" }}>
            Don’t have an account?{" "}
            <Typography component={RouterLink} to="/signup" sx={{ color: "primary.main", textDecoration: "none", fontWeight: 600 }}>
              Sign up
            </Typography>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
