const SERVER = "http://192.168.0.15:3000";
const WALLET = "HNY1_DEV_WALLET";

async function mint() {
  const res = await fetch(`${SERVER}/mint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      wallet: WALLET,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    Alert.alert("Mint blocked", data.error || "Unknown error");
    return;
  }

  Alert.alert("Success", `Minted ${data.amount} HNY`);
}

async function send() {
  const res = await fetch(`${SERVER}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: WALLET,
      to: "HNY1_DEV_WALLET_2",
      amount: 10,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    Alert.alert("Send failed", data.error || "Unknown error");
    return;
  }

  Alert.alert("Success", "HNY sent");
}

