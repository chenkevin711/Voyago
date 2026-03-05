import { Box, Button, Container, TextField, Typography, Paper } from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import axios from "axios";
import { useState } from "react";
import { getAxiosErrorMessages } from "../utils";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

export default function Login() {
  const [messages, setMessages] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setMessages([]);
    setIsSuccess(false);
    setFormData((prev) => ({
      ...prev,
      [event.target.id]: event.target.value,
    }));
  };

  const handleSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setMessages([]);
    setIsSuccess(false);
    setSubmitting(true);

    try {
      const res = await axios.post(
        `${API_BASE}/api/auth/login`,
        formData,
        { withCredentials: true } // ✅ send/receive cookies
      );

      // ✅ store userId (optional, but your UI uses it in a couple places)
      if (res.data?.user?.id) {
        localStorage.setItem("userId", res.data.user.id);
      }

      setIsSuccess(true);
      setMessages(["Login successful!"]);
      setFormData({ email: "", password: "" });

      // ✅ go to dashboard (or "/" if that’s your dashboard)
      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      setMessages(getAxiosErrorMessages(error));
      setIsSuccess(false);
    } finally {
      setSubmitting(false);
    }
  };

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

          <Box component="form" onSubmit={handleSubmit} sx={{ display: "grid", gap: 2 }}>
            <TextField
              label="Email"
              id="email"
              fullWidth
              value={formData.email}
              onChange={handleChange}
              autoComplete="email"
            />
            <TextField
              label="Password"
              id="password"
              type="password"
              fullWidth
              value={formData.password}
              onChange={handleChange}
              autoComplete="current-password"
            />

            <Button type="submit" variant="contained" size="large" disabled={submitting}>
              {submitting ? "Logging in..." : "Log In"}
            </Button>

            {messages.length > 0 && (
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: isSuccess ? "success.light" : "error.light",
                  color: isSuccess ? "success.contrastText" : "error.contrastText",
                }}
              >
                {messages.map((message, index) => (
                  <Typography key={index} variant="body2">
                    {message}
                  </Typography>
                ))}
              </Box>
            )}
          </Box>

          <Typography sx={{ mt: 3, color: "text.secondary" }}>
            Don’t have an account?{" "}
            <Typography
              component={RouterLink}
              to="/signup"
              sx={{ color: "primary.main", textDecoration: "none", fontWeight: 600 }}
            >
              Sign up
            </Typography>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}