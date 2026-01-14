export const SERVER = "http://192.168.0.11:3000";
export const WALLET = "HNY1_DEV_WALLET";

/**
 * Mint HNY with cooldown handling
 */
export async function mint(setCooldownText, refreshBalance) {
  try {
    const res = await fetch(`${SERVER}/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: WALLET }),
    });

    const data = await res.json();

    // ✅ Handle cooldown properly
    if (!res.ok) {
      if (res.status === 429 && data.retryAfterMs) {
        const seconds = Math.ceil(data.retryAfterMs / 1000);
        setCooldownText(`Cooldown active: ${seconds}s remaining`);
        return;
      }

      setCooldownText("Mint failed");
      return;
    }

    // ✅ Success
    setCooldownText("");
    refreshBalance();

    alert(`Minted ${data.tx.amount} HNY`);
  } catch (err) {
    console.error(err);
    setCooldownText("Mint error");
  }
}

/**
 * Get wallet balance
 */
export async function getBalance(setBalance) {
  const res = await fetch(`${SERVER}/balance/${WALLET}`);
  const data = await res.json();
  setBalance(data.balance);
}
