// TEMP STUB — Staking logic will be implemented in Phase 2

export async function delegateHoney(
  validator: string,
  amount: number
): Promise<{ success: boolean; txHash?: string }> {
  console.log('[STUB] delegateHoney', { validator, amount });

  return {
    success: true,
    txHash: '0xSTUB_DELEGATION_TX',
  };
}
