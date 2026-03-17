import { useState } from "react";
import axios from "axios";
import { Box, Button, Container, Paper, TextField, Typography } from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getAxiosErrorMessages } from "../utils";

const API_BASE = "https://voyago.hitanshichhabria.com";

export default function Signup() {
  const navigate = useNavigate();

  const [messages, setMessages] = useState<string[]>([]);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
  });

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
      const res = await axios.post(`${API_BASE}/api/auth/register`, {
      username: formData.username,
      email: formData.email,
      password: formData.password
    }, {
  withCredentials: true
});
      // ✅ keep if you still use userId anywhere in the UI
      if (res.data?.user?.id) {
        localStorage.setItem("userId", res.data.user.id);
      }

      setIsSuccess(true);
      setMessages([res.data?.message ?? "Account created!"]);
      setFormData({ username: "", email: "", password: "" });

      // If register also logs them in (it does in your backend), go straight to dashboard
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
            Create your account
          </Typography>
          <Typography sx={{ color: "text.secondary", mb: 3 }}>
            Start building itineraries in minutes.
          </Typography>

          <Box component="form" onSubmit={handleSubmit} sx={{ display: "grid", gap: 2 }}>
            <TextField label="Name" id="username" fullWidth onChange={handleChange} value={formData.username} />
            <TextField label="Email" id="email" fullWidth onChange={handleChange} value={formData.email} />
            <TextField label="Password" id="password" type="password" fullWidth onChange={handleChange} value={formData.password} />

            <Button type="submit" variant="contained" size="large" disabled={submitting}>
              {submitting ? "Signing up..." : "Sign Up"}
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
            Already have an account?{" "}
            <Typography
              component={RouterLink}
              to="/login"
              sx={{ color: "primary.main", textDecoration: "none", fontWeight: 600 }}
            >
              Log in
            </Typography>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
