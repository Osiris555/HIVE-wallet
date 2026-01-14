import { BrowserRouter, Routes, Route } from "react-router-dom";
import Wallet from "./Wallet";
import TransactionHistory from "./screens/TransactionHistory";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Wallet />} />
        <Route path="/history" element={<TransactionHistory />} />
      </Routes>
    </BrowserRouter>
  );
}
