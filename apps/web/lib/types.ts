export type NftSummary = {
  id: string;
  name: string;
  description: string;
  ai_description: string;
  media_type: 'audio' | 'video' | 'document' | 'photo';
  creator_wallet: string;
  owner_wallet: string;
  royalty_bps: number;
  listed_price_hny: number | null;
  listed_at: string | null;
  minted_at: string;
  transfer_count: number;
  collection_id: string | null;
  auction_id: string | null;
  file_count: number;
  collection_name?: string;
};

export type NftFile = {
  id: number;
  nft_id: string;
  file_index: number;
  file_name: string;
  mime_type: string;
  file_size: number;
};

export type NftCollection = {
  id: string;
  owner_wallet: string;
  name: string;
  description: string;
  created_at: string;
  nft_count?: number;
};

export type NftAuction = {
  id: string;
  nft_id: string;
  seller_wallet: string;
  start_price_hny: number;
  current_bid_hny: number | null;
  current_bidder: string | null;
  ends_at: string;
  settled: number;
  settled_at: string | null;
  created_at: string;
};

export type NftOffer = {
  id: string;
  nft_id: string;
  buyer_wallet: string;
  offer_hny: number;
  message: string;
  expires_at: string;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  created_at: string;
};

export type WebStats = {
  totalWallets: number;
  totalTransactions: number;
  totalNfts: number;
  listedNfts: number;
  totalLiquidityHny: number;
  blockHeight: number;
  hnyPriceUsd: number;
};

export type MarketplaceFilters = {
  mediaType?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  minPrice?: number;
  maxPrice?: number;
};

export type TokenPrice = {
  symbol: string;
  name?: string;
  price_usd: number;
  updated_at?: string;
};

export type Pool = {
  id: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  totalLpShares: number;
  feeRate: number;
  createdAtMs: number;
};

export type RecentSwap = {
  txid: string;
  wallet: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  price: number;
  ts: number;
};

// ── Phase H3: Perpetual Futures ────────────────────────────

export type FuturesMarket = {
  id: string;
  baseSymbol: string;
  quoteSymbol: string;
  markPriceUsd: number;
  maxLeverage: number;
  minSizeUsd: number;
  makerFeeRate: number;
  takerFeeRate: number;
  maintenanceMarginRate: number;
  openInterestLongUsd: number;
  openInterestShortUsd: number;
  fundingRate8h: number;
};

export type FuturesPosition = {
  id: string;
  marketId: string;
  baseSymbol: string;
  side: 'long' | 'short';
  sizeUsd: number;
  collateralHny: number;
  leverage: number;
  entryPriceUsd: number;
  markPriceUsd: number;
  liquidationPriceUsd: number;
  unrealizedPnlHny: number;
  fundingPaidHny: number;
  status: 'open' | 'closed' | 'liquidated' | 'liquidated_pending';
  openedAt: string;
  closedAt?: string;
  closePriceUsd?: number;
  realizedPnlHny?: number;
};

export type FuturesStats = {
  openPositions: number;
  totalOpenInterestUsd: number;
  totalCollateralHny: number;
  totalVolumeUsd: number;
  totalLiquidations: number;
};

// ── Phase H4: Token Launchpad ───────────────────────────────

export type LaunchpadToken = {
  id: string;
  name: string;
  ticker: string;
  description: string;
  imageEmoji: string;
  creatorWallet: string;
  priceHny: number;
  marketCapHny: number;
  realHnyRaised: number;
  tokensSold: number;
  totalSupply: number;
  graduationThreshold: number;
  graduationPct: number;
  graduated: boolean;
  graduatedAt: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  createdAt: string;
  lastTradeAt: string | null;
};

export type LaunchpadTrade = {
  id: number;
  token_id: string;
  wallet: string;
  type: 'buy' | 'sell';
  hny_amount: number;
  token_amount: number;
  price_hny: number;
  fee_hny: number;
  traded_at: string;
};

export type LaunchpadHolding = {
  tokenId: string;
  name: string;
  ticker: string;
  imageEmoji: string;
  balance: number;
  valueHny: number;
  priceHny: number;
  graduated: boolean;
};

export type LaunchpadStats = {
  totalTokens: number;
  graduatedTokens: number;
  totalHnyRaised: number;
  totalTrades: number;
};

// ── Phase H5: Order Book ────────────────────────────────────

export type LimitOrder = {
  id: string;
  wallet: string;
  pair: string;
  side: 'buy' | 'sell';
  price_hny: number;
  size_hny: number;
  filled_hny: number;
  locked_hny: number;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
  created_at: string;
  updated_at: string;
};

export type OrderbookLevel = {
  price_hny: number;
  total_hny: number;
  count: number;
};

export type OrderbookTrade = {
  id: number;
  pair: string;
  buy_order_id: string;
  sell_order_id: string;
  price_hny: number;
  size_hny: number;
  traded_at: string;
};

export type OrderbookSnapshot = {
  pair: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  lastTrade: OrderbookTrade | null;
};

export type OrderbookStats = {
  openOrders: number;
  totalFills: number;
  volumeHny: number;
  uniqueTraders: number;
};

// ── Phase H5: Trading Bots ──────────────────────────────────

export type BotType = 'dca' | 'grid' | 'momentum' | 'stoptp' | 'futures_grid';

export type TradingBot = {
  id: string;
  wallet: string;
  type: BotType;
  name: string;
  config: string;       // JSON string
  status: 'active' | 'paused' | 'completed' | 'deleted';
  state_json: string;   // JSON string
  total_pnl: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  trade_count?: number;
};

export type BotTrade = {
  id: number;
  bot_id: string;
  action: string;
  amount_hny: number;
  price_hny: number;
  notes: string;
  traded_at: string;
};

export type BotStats = {
  activeBots: number;
  totalBots: number;
  totalTrades: number;
  totalPnlHny: number;
  byType: { type: string; count: number }[];
};

// ── Phase H6a: OHLCV Price Charts ─────────────────────────────────────────

export type CandleTimeframe = '1s' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M' | '1Y';

export type OhlcvCandle = {
  ts: number;   // bucket open timestamp (ms)
  o:  number;   // open price (quote per base)
  h:  number;   // high price
  l:  number;   // low price
  c:  number;   // close price
  v:  number;   // volume (in base token)
};

export type CandlesResponse = {
  pair: string;
  timeframe: CandleTimeframe;
  candles: OhlcvCandle[];
};

// ── Phase H6a: Cross-Chain Bridge ─────────────────────────────────────────

export type BridgeDirection = 'hny_to_evm' | 'evm_to_hny';
export type BridgeStatus    = 'pending' | 'confirmed' | 'completed' | 'failed' | 'refunded';
export type BridgeToken     = 'HNY' | 'USDC' | 'ETH';

export type BridgeTransaction = {
  id:           string;
  direction:    BridgeDirection;
  fromChain:    string;
  toChain:      string;
  token:        BridgeToken;
  amount:       number;
  feeAmount:    number;
  netAmount:    number;
  fromAddress:  string;
  toAddress:    string;
  status:       BridgeStatus;
  evmChainId?:  number;
  evmTxHash?:   string;
  hnyTxId?:     string;
  createdAt:    string;
  confirmedAt?: string;
  completedAt?: string;
  failReason?:  string;
};

export type BridgeQuote = {
  token:            BridgeToken;
  amount:           number;
  fee:              number;
  netAmount:        number;
  feeRate:          number;
  estimatedSeconds: number;
};

export type BridgeSupported = {
  tokens:  BridgeToken[];
  chains:  { id: number; name: string }[];
  feeRate: number;
  limits:  Record<string, { min: number; max: number }>;
};

export type BridgeStats = {
  totalBridges:     number;
  totalVolumeHny:   number;
  completedBridges: number;
  pendingBridges:   number;
};

// ── DAO Governance (Phase H6b) ─────────────────────────────────────────────
export type DaoProposalType   = 'parameter_change' | 'treasury_allocation' | 'protocol_upgrade' | 'emergency';
export type DaoProposalStatus = 'draft' | 'active' | 'timelocked' | 'executed' | 'rejected' | 'cancelled';
export type DaoVoteChoice     = 'yes' | 'no' | 'abstain';

export interface DaoProposal {
  id:               string;
  proposerWallet:   string;
  title:            string;
  description:      string;
  type:             DaoProposalType;
  status:           DaoProposalStatus;
  bondHny:          number;
  yesVp:            number;
  noVp:             number;
  abstainVp:        number;
  totalVpSnapshot:  number;
  metadataJson?:    string;
  draftAtMs:        number;
  submittedAtMs?:   number;
  votingEndsAtMs?:  number;
  timelockEndsAtMs?: number;
  executedAtMs?:    number;
  cancelledAtMs?:   number;
  failReason?:      string;
  // computed by server
  quorumPct:        number;
  passPct:          number;
}

export interface DaoVote {
  id:           string;
  proposalId:   string;
  voterWallet:  string;
  vote:         DaoVoteChoice;
  votingPower:  number;
  votedAtMs:    number;
}

export interface DaoTreasuryTx {
  id:           string;
  proposalId?:  string;
  type:         string;
  wallet:       string;
  amount:       number;
  description?: string;
  createdAtMs:  number;
}

export interface DaoStats {
  totalProposals:    number;
  activeProposals:   number;
  passedProposals:   number;
  rejectedProposals: number;
  executedProposals: number;
  totalVotesCast:    number;
  treasuryBalanceHny: number;
  totalVpLocked:     number;
}

export interface DaoVotingPower {
  wallet:       string;
  stakedHny:    number;
  votingPower:  number;
  vpPct:        number;
}

export interface DaoTreasury {
  balanceHny: number;
  recentTxs:  DaoTreasuryTx[];
}

// ── Copy Trading ───────────────────────────────────────────────────────────────

export interface CopyLeader {
  wallet:              string;
  displayName:         string;
  bio:                 string;
  strategyDescription: string;
  feePct:              number;
  isPublic:            boolean;
  registeredAtMs:      number;
  // computed in leaderboard
  rank?:              number;
  totalPnlHny?:       number;
  tradeCount?:        number;
  activeBots?:        number;
  followerCount?:     number;
  winRatePct?:        number;
  isLeader?:          boolean;
}

export interface CopySubscription {
  id:                 string;
  followerWallet:     string;
  leaderWallet:       string;
  perTradeLimitHny:   number;
  usedHny:            number;
  totalPnlHny:        number;
  status:             'active' | 'paused' | 'cancelled';
  subscribedAtMs:     number;
  lastCopyAtMs?:      number;
}

export interface CopyTrade {
  id:               string;
  subscriptionId:   string;
  followerWallet:   string;
  leaderWallet:     string;
  leaderBotId:      string;
  action:           string;
  copyAmountHny:    number;
  feeHny:           number;
  leaderPrice:      number;
  executedAtMs:     number;
}

export interface CopyStats {
  totalLeaders:         number;
  totalCopiers:         number;
  activeSubs:           number;
  totalCopyVolumeHny:   number;
  totalCopyTrades:      number;
  feeVaultBalanceHny:   number;
}

// ── H7a: Portfolio Analytics ───────────────────────────────────────────────────

export interface TokenBalance {
  symbol: string; balance: number; priceUsd: number; valueUsd: number;
}
export interface PortfolioSummary {
  wallet: string; hnyBalance: number; hnyPriceUsd: number;
  tokenBalances: TokenBalance[];
  stakingPositions: { principal: number; rewardPaid: number; apr: number; unlockAtMs: number; status: string }[];
  lpPositions: { poolId: string; tokenA: string; tokenB: string; valueHny: number; rewardPaidHny: number }[];
  futuresUnrealizedPnlHny: number; futuresRealizedPnlHny: number;
  botsTotalPnlHny: number; copyTradingPnlHny: number;
  launchpadValueHny: number; vaultValueHny: number; lockedHny: number;
  nftCount: number; totalValueHny: number; totalValueUsd: number;
}
export interface IncomeBreakdown {
  source: string; amountHny: number; pct: number;
}
export interface IncomeData {
  stakingRewardsHny: number; lpRewardsHny: number; botPnlHny: number;
  futuresPnlHny: number; copyPnlHny: number; nftSalesHny: number;
  totalIncomeHny: number; breakdown: IncomeBreakdown[];
}
export interface ActivityItem {
  ts: number; type: string; label: string; amountHny: number; detail: string;
}
export interface PortfolioStats {
  memberSinceMs: number | null; totalTxCount: number; totalVolumeHny: number;
  totalFeesPaidHny: number; bestTradeHny: number; worstTradeHny: number;
  botWinRate: number; activeBots: number; openFuturesPositions: number;
  daoVotesCast: number; nftsMinted: number; nftsSold: number;
}
export interface PortfolioSnapshot { snapshotMs: number; netWorthHny: number; }

// ── H7b: Yield Vaults + Time-Lock ────────────────────────────────────────────

export interface VaultInfo {
  id: string; name: string; description: string; baseApr: number;
  receiptToken?: string;
  totalHny: number; totalShares: number; sharePrice: number; tvlHny: number;
  lastCompoundMs: number;
}
export interface VaultPosition {
  vaultId: string; vaultName: string; shares: number;
  depositedHny: number; valueHny: number; gainHny: number; sharePrice: number;
}
export interface LockTier {
  days: number; multiplier: number; label: string; effectiveApr: number;
}
export interface HnyLock {
  id: string; wallet: string; amountHny: number; lockDays: number;
  multiplier: number; lockedAtMs: number; unlockAtMs: number;
  status: 'locked' | 'unlocked' | 'early_unlocked';
  rewardAccruedHny: number; penaltyHny: number;
}

export interface SimpleStakingPosition {
  id: string; wallet: string; principal: number; lockDays: number;
  startMs: number; unlockAtMs: number; status: string;
  rewardAccrued: number; rewardPaid: number; claimable: number;
  canUnlock: boolean; canWithdraw: boolean;
}

// ── H7c: Notifications ────────────────────────────────────────────────────────

export interface Notification {
  id: number; wallet: string; type: string; title: string; body: string;
  linkHref?: string; read: boolean; createdAtMs: number;
}

// ── H7d: Social Identity ──────────────────────────────────────────────────────

export interface UserProfile {
  wallet: string; displayName: string; bio: string; avatarEmoji: string;
  avatarPhoto?: string | null; bannerData?: string | null;
  website: string; twitterHandle: string; isPublic: boolean; createdAtMs?: number;
  followerCount: number; followingCount: number; postCount: number;
}
export interface SocialPost {
  id: string; wallet: string; displayName: string; avatarEmoji: string;
  content: string; encrypted: boolean; cipherJson?: string | null;
  replyToId?: string | null; likeCount: number; createdAtMs: number;
}

// ── Platform Auth (email/phone accounts) ─────────────────────────────────────

export interface AuthUser {
  userId: string;
  wallet: string;
  email?: string | null;
  phone?: string | null;
  displayName: string;
  chrysalisRegistered: boolean;
  token: string; // session token (stored in localStorage)
}
