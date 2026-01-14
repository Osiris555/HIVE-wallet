import { createHash } from "crypto";
import {
  FAUCET_PRIVATE_KEY,
  FAUCET_PUBLIC_KEY,
} from "../config/faucetKeys";

export interface FaucetProof {
  wallet: string;
  amount: number;
  timestamp: number;
  signature: string;
}

export function signFaucetProof(
  wallet: string,
  amount: number,
  timestamp: number
): FaucetProof {
  const payload = `${wallet}:${amount}:${timestamp}:${FAUCET_PRIVATE_KEY}`;

  const signature = createHash("sha256")
    .update(payload)
    .digest("hex");

  return {
    wallet,
    amount,
    timestamp,
    signature,
  };
}

export function verifyFaucetProof(proof: FaucetProof): boolean {
  const payload = `${proof.wallet}:${proof.amount}:${proof.timestamp}:${FAUCET_PRIVATE_KEY}`;

  const expected = createHash("sha256")
    .update(payload)
    .digest("hex");

  return expected === proof.signature;
}
