import { Box, Button, Container, TextField, Typography, Paper } from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import axios from "axios";
import { useState, useEffect } from "react";
import { getAxiosErrorMessages } from "../utils";
import { useCookies } from "react-cookie";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:5001";

export default function Login() {
  const [messages, setMessages] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const navigate = useNavigate();
  const [cookies] = useCookies(["loggedIn"]);

  // Return user to homepage if they are logged in.
  useEffect(() => {
    if (cookies.loggedIn) {
      setTimeout(() => navigate("/"), 0);
    }
  }, [cookies.loggedIn, navigate]);

  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setMessages([]);
    setIsSuccess(false);
    setFormData({
      ...formData,
      [event.target.id]: event.target.value,
    });
  };

  const handleSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setIsSuccess(false);

    try {
      const { status, data } = await axios({
        method: "post",
        url: `${API_BASE}/api/auth/login`,
        data: formData,
        withCredentials: true, // ✅ allow cookies
      });

      if (status !== 200) {
        setMessages([data?.message ?? "Request failed"]);
        return;
      }

      // ✅ save userId so itinerary/trips can use it
      if (data?.user?.id) {
        localStorage.setItem("userId", data.user.id);
      }

      setIsSuccess(true);
      setMessages(["Login successful!"]);
      setFormData({ email: "", password: "" });

      // ✅ navigate after login
      setTimeout(() => navigate("/"), 500);
    } catch (error) {
      console.error(error);
      setMessages(getAxiosErrorMessages(error));
      setIsSuccess(false);
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
            <TextField label="Email" id="email" fullWidth value={formData.email} onChange={handleChange} />
            <TextField label="Password" id="password" type="password" fullWidth value={formData.password} onChange={handleChange} />
            <Button type="submit" variant="contained" size="large">Log In</Button>

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
                  <Typography key={index} variant="body2">{message}</Typography>
                ))}
              </Box>
            )}
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