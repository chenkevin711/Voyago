import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";

import TripAdd from "./pages/TripAdd";
import TripOverview from "./pages/TripOverview";
import Itinerary from "./pages/Itinerary";
import Flights from "./pages/Flights";
import Budget from "./pages/Budget";
import Chat from "./pages/Chat";
import Profile from "./pages/Profile";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/trips/new" element={<TripAdd />} />
        <Route path="/trips/:tripId" element={<TripOverview />} />
        <Route path="/trips/:tripId/itinerary" element={<Itinerary />} />
        <Route path="/trips/:tripId/flights" element={<Flights />} />
        <Route path="/trips/:tripId/budget" element={<Budget />} />
        <Route path="/trips/:tripId/chat" element={<Chat />} />

        <Route path="/profile" element={<Profile />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
