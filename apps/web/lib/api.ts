import type { NftSummary, NftCollection, NftAuction, NftOffer, WebStats, MarketplaceFilters, Pool, TokenPrice, RecentSwap, FuturesMarket, FuturesPosition, FuturesStats, LaunchpadToken, LaunchpadTrade, LaunchpadHolding, LaunchpadStats, LimitOrder, OrderbookSnapshot, OrderbookTrade, OrderbookStats, TradingBot, BotTrade, BotStats, CandlesResponse, BridgeQuote, BridgeSupported, BridgeStats, BridgeTransaction, DaoProposal, DaoVote, DaoStats, DaoVotingPower, DaoTreasury, CopyLeader, CopySubscription, CopyTrade, CopyStats, PortfolioSummary, IncomeData, ActivityItem, PortfolioStats, PortfolioSnapshot, VaultInfo, VaultPosition, LockTier, HnyLock, Notification, UserProfile, SocialPost, SimpleStakingPosition, AuthUser } from './types';

// In the browser, use the Next.js rewrite proxy (/api/* → localhost:3000/*)
// to avoid CORS issues. On the server (SSR), hit the HIVE server directly.
const API =
  typeof window !== 'undefined'
    ? '/api'
    : (process.env.NEXT_PUBLIC_HIVE_API || 'http://localhost:3000');

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
  const json = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `API error ${res.status}`);
  return json;
}

// ── Web stats ──────────────────────────────────────────────
export async function getWebStats(): Promise<WebStats> {
  return fetchJson<WebStats>('/web/stats');
}

// ── NFT marketplace ────────────────────────────────────────
export async function getMarketplace(filters: MarketplaceFilters = {}): Promise<{ nfts: NftSummary[] }> {
  const params = new URLSearchParams();
  if (filters.mediaType) params.set('mediaType', filters.mediaType);
  if (filters.sort)      params.set('sort', filters.sort);
  if (filters.minPrice != null) params.set('minPrice', String(filters.minPrice));
  if (filters.maxPrice != null) params.set('maxPrice', String(filters.maxPrice));
  const qs = params.toString();
  return fetchJson(`/nft/marketplace${qs ? `?${qs}` : ''}`);
}

export async function getNft(id: string): Promise<{ nft: NftSummary; files: { file_index: number; file_name: string; mime_type: string; file_size: number }[] }> {
  return fetchJson(`/nft/${id}`);
}

export async function getWalletNfts(wallet: string): Promise<{ nfts: NftSummary[] }> {
  return fetchJson(`/nft/wallet/${wallet}`);
}

// ── Collections ────────────────────────────────────────────
export async function getCollection(id: string): Promise<{ collection: NftCollection; nfts: NftSummary[] }> {
  return fetchJson(`/nft/collection/${id}`);
}

export async function getWalletCollections(wallet: string): Promise<{ collections: NftCollection[] }> {
  return fetchJson(`/nft/collections/${wallet}`);
}

// ── Auctions ───────────────────────────────────────────────
export async function getActiveAuctions(): Promise<{ auctions: NftAuction[] }> {
  return fetchJson('/nft/auction/active');
}

export async function getAuction(id: string): Promise<{ auction: NftAuction }> {
  return fetchJson(`/nft/auction/${id}`);
}

// ── Offers ─────────────────────────────────────────────────
export async function getNftOffers(nftId: string): Promise<{ offers: NftOffer[] }> {
  return fetchJson(`/nft/offers/${nftId}`);
}

export async function getMyOffers(wallet: string): Promise<{ offers: NftOffer[] }> {
  return fetchJson(`/nft/my-offers/${wallet}`);
}

// ── Tokens & Prices ────────────────────────────────────────
export async function getPrices(): Promise<{ prices: Record<string, TokenPrice> }> {
  return fetchJson('/tokens/prices');
}

export async function getTokens(): Promise<{ tokens: { symbol: string; name: string; total_supply: number }[] }> {
  return fetchJson('/tokens');
}

// ── Pools ──────────────────────────────────────────────────
export async function getPools(): Promise<{ pools: Pool[] }> {
  return fetchJson('/pools');
}

// ── Trade ──────────────────────────────────────────────────
export async function getRecentSwaps(): Promise<{ swaps: RecentSwap[] }> {
  return fetchJson('/trade/recent');
}

// ── Futures ────────────────────────────────────────────────
export async function getFuturesMarkets(): Promise<{ markets: FuturesMarket[] }> {
  return fetchJson('/futures/markets');
}

export async function getFuturesPositions(wallet: string): Promise<{ positions: FuturesPosition[] }> {
  return fetchJson(`/futures/positions/${wallet}`);
}

export async function getFuturesHistory(wallet: string): Promise<{ history: FuturesPosition[] }> {
  return fetchJson(`/futures/history/${wallet}`);
}

export async function getFuturesStats(): Promise<FuturesStats> {
  return fetchJson('/futures/stats');
}

// ── Launchpad ──────────────────────────────────────────────
export async function getLaunchpadTokens(sort = 'newest', graduated = false): Promise<{ tokens: LaunchpadToken[] }> {
  return fetchJson(`/launchpad/tokens?sort=${sort}&graduated=${graduated}`);
}

export async function getLaunchpadToken(id: string): Promise<{ token: LaunchpadToken; trades: LaunchpadTrade[] }> {
  return fetchJson(`/launchpad/token/${id}`);
}

export async function getLaunchpadPortfolio(wallet: string): Promise<{ holdings: LaunchpadHolding[] }> {
  return fetchJson(`/launchpad/portfolio/${wallet}`);
}

export async function getLaunchpadStats(): Promise<LaunchpadStats> {
  return fetchJson('/launchpad/stats');
}

// ── Order Book ─────────────────────────────────────────────
export async function getOrderbookPairs(): Promise<{ pairs: string[] }> {
  return fetchJson('/orderbook/pairs');
}

export async function getOrderbook(pair: string): Promise<OrderbookSnapshot> {
  return fetchJson(`/orderbook/book/${encodeURIComponent(pair)}`);
}

export async function getOrderbookTrades(pair: string): Promise<{ trades: OrderbookTrade[] }> {
  return fetchJson(`/orderbook/trades/${encodeURIComponent(pair)}`);
}

export async function getMyOrders(wallet: string, pair?: string): Promise<{ orders: LimitOrder[] }> {
  const qs = pair ? `?pair=${encodeURIComponent(pair)}` : '';
  return fetchJson(`/orderbook/orders/${wallet}${qs}`);
}

export async function getMyOrderHistory(wallet: string): Promise<{ orders: LimitOrder[] }> {
  return fetchJson(`/orderbook/history/${wallet}`);
}

export async function getOrderbookStats(): Promise<OrderbookStats> {
  return fetchJson('/orderbook/stats');
}

// ── Trading Bots ────────────────────────────────────────────
export async function getMyBots(wallet: string): Promise<{ bots: TradingBot[] }> {
  return fetchJson(`/bots/list/${wallet}`);
}

export async function getBotTrades(botId: string): Promise<{ trades: BotTrade[] }> {
  return fetchJson(`/bots/trades/${botId}`);
}

export async function getBotStats(): Promise<BotStats> {
  return fetchJson('/bots/stats');
}

// ── Media URL helper ───────────────────────────────────────
export function mediaUrl(nftId: string, fileIndex: number): string {
  // Always use the proxy path for media URLs (used in <img src> etc.)
  return `/api/nft/media/${nftId}/${fileIndex}`;
}

// ── OHLCV Candles (Phase H6a) ───────────────────────────────
export async function getCandles(
  pair: string,
  timeframe: string,
  limit = 200
): Promise<CandlesResponse> {
  const params = new URLSearchParams({ pair, timeframe, limit: String(limit) });
  return fetchJson<CandlesResponse>(`/trade/candles?${params}`);
}

// ── Bridge (Phase H6a) ──────────────────────────────────────
export async function getBridgeSupported(): Promise<BridgeSupported> {
  return fetchJson<BridgeSupported>('/bridge/supported');
}

export async function getBridgeQuote(
  fromChain: string,
  toChain: string,
  token: string,
  amount: number
): Promise<BridgeQuote> {
  const params = new URLSearchParams({ fromChain, toChain, token, amount: String(amount) });
  return fetchJson<BridgeQuote>(`/bridge/quote?${params}`);
}

export async function getBridgeHistory(wallet: string): Promise<{ transactions: BridgeTransaction[] }> {
  return fetchJson<{ transactions: BridgeTransaction[] }>(`/bridge/history/${wallet}`);
}

export async function getBridgeStats(): Promise<BridgeStats> {
  return fetchJson<BridgeStats>('/bridge/stats');
}

// ── DAO Governance (Phase H6b) ──────────────────────────────────────────────
export async function getDaoProposals(status?: string): Promise<{ proposals: DaoProposal[] }> {
  const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  return fetchJson<{ proposals: DaoProposal[] }>(`/governance/proposals${qs}`);
}

export async function getDaoProposal(id: string): Promise<{ proposal: DaoProposal; votes: DaoVote[] }> {
  return fetchJson<{ proposal: DaoProposal; votes: DaoVote[] }>(`/governance/proposal/${encodeURIComponent(id)}`);
}

export async function getDaoMyVotes(wallet: string): Promise<{ votes: DaoVote[] }> {
  return fetchJson<{ votes: DaoVote[] }>(`/governance/my-votes/${wallet}`);
}

export async function getDaoVotingPower(wallet: string): Promise<DaoVotingPower> {
  return fetchJson<DaoVotingPower>(`/governance/voting-power/${wallet}`);
}

export async function getDaoStats(): Promise<DaoStats> {
  return fetchJson<DaoStats>('/governance/stats');
}

export async function getDaoTreasury(): Promise<DaoTreasury> {
  return fetchJson<DaoTreasury>('/governance/treasury');
}

// ── Copy Trading ───────────────────────────────────────────────────────────────

export async function getCopyLeaderboard(limit = 50): Promise<{ leaders: CopyLeader[] }> {
  return fetchJson<{ leaders: CopyLeader[] }>(`/copy/leaderboard?limit=${limit}`);
}

export async function getCopyLeader(wallet: string): Promise<{ leader: CopyLeader }> {
  return fetchJson<{ leader: CopyLeader }>(`/copy/leader/${wallet}`);
}

export async function getMyCopySubscriptions(wallet: string): Promise<{ subscriptions: CopySubscription[] }> {
  return fetchJson<{ subscriptions: CopySubscription[] }>(`/copy/subscriptions/${wallet}`);
}

export async function getMyCopyTrades(wallet: string): Promise<{ trades: CopyTrade[] }> {
  return fetchJson<{ trades: CopyTrade[] }>(`/copy/trades/${wallet}`);
}

export async function getCopyStats(): Promise<CopyStats> {
  return fetchJson<CopyStats>('/copy/stats');
}

// ── H7a: Portfolio Analytics ───────────────────────────────────────────────────

export async function getPortfolio(wallet: string): Promise<PortfolioSummary> {
  return fetchJson<PortfolioSummary>(`/analytics/portfolio/${wallet}`);
}

export async function getIncomeBreakdown(wallet: string): Promise<IncomeData> {
  return fetchJson<IncomeData>(`/analytics/income/${wallet}`);
}

export async function getActivityFeed(wallet: string, limit = 50): Promise<{ activity: ActivityItem[] }> {
  return fetchJson<{ activity: ActivityItem[] }>(`/analytics/activity/${wallet}?limit=${limit}`);
}

export async function getPortfolioStats(wallet: string): Promise<PortfolioStats> {
  return fetchJson<PortfolioStats>(`/analytics/stats/${wallet}`);
}

export async function getPortfolioHistory(wallet: string, days = 30): Promise<{ history: PortfolioSnapshot[] }> {
  return fetchJson<{ history: PortfolioSnapshot[] }>(`/analytics/history/${wallet}?days=${days}`);
}

// ── H7b: Yield Vaults + Time-Lock ────────────────────────────────────────────

export async function getVaultList(): Promise<{ vaults: VaultInfo[] }> {
  return fetchJson<{ vaults: VaultInfo[] }>('/vaults/list');
}

export async function getVaultPositions(wallet: string): Promise<{ positions: VaultPosition[] }> {
  return fetchJson<{ positions: VaultPosition[] }>(`/vaults/position/${wallet}`);
}

export async function getHnyLocks(wallet: string): Promise<{ locks: HnyLock[] }> {
  return fetchJson<{ locks: HnyLock[] }>(`/vaults/locks/${wallet}`);
}

export async function getLockTiers(): Promise<{ tiers: LockTier[] }> {
  return fetchJson<{ tiers: LockTier[] }>('/vaults/lock-tiers');
}

export async function getStakingPositions(wallet: string): Promise<{ positions: SimpleStakingPosition[]; apr: number }> {
  return fetchJson<{ positions: SimpleStakingPosition[]; apr: number }>(`/staking/positions?wallet=${wallet}`);
}

// ── H7c: Notifications ────────────────────────────────────────────────────────

export async function getNotifications(wallet: string, limit = 20): Promise<{ notifications: Notification[] }> {
  return fetchJson<{ notifications: Notification[] }>(`/notifications/${wallet}?limit=${limit}`);
}

export async function getNotificationCount(wallet: string): Promise<{ count: number }> {
  return fetchJson<{ count: number }>(`/notifications/count/${wallet}`);
}

// ── H7d: Social ───────────────────────────────────────────────────────────────

export async function getSocialFeed(limit = 30, offset = 0): Promise<{ posts: SocialPost[] }> {
  return fetchJson<{ posts: SocialPost[] }>(`/social/feed?limit=${limit}&offset=${offset}`);
}

export async function getFollowingFeed(wallet: string, limit = 30): Promise<{ posts: SocialPost[] }> {
  return fetchJson<{ posts: SocialPost[] }>(`/social/feed/${wallet}?limit=${limit}`);
}

export async function getSocialProfile(wallet: string): Promise<{ profile: UserProfile }> {
  return fetchJson<{ profile: UserProfile }>(`/social/profile/${wallet}`);
}

export async function getSocialPosts(wallet: string): Promise<{ posts: SocialPost[] }> {
  return fetchJson<{ posts: SocialPost[] }>(`/social/posts/${wallet}`);
}

// ── Platform Auth (email/phone accounts) ─────────────────────────────────────

export async function authRegister(email: string | null, phone: string | null, password: string, displayName?: string): Promise<AuthUser> {
  const res = await postJson<{ ok: boolean; token: string; wallet: string; userId: string; displayName: string }>(
    '/auth/register', { email, phone, password, displayName }
  );
  return { userId: res.userId, wallet: res.wallet, email: email ?? null, phone: phone ?? null, displayName: res.displayName, chrysalisRegistered: false, token: res.token };
}

export async function authLogin(email: string | null, phone: string | null, password: string): Promise<AuthUser> {
  const res = await postJson<{ ok: boolean; token: string; wallet: string; userId: string; displayName: string; chrysalisRegistered: boolean }>(
    '/auth/login', { email, phone, password }
  );
  return { userId: res.userId, wallet: res.wallet, email: email ?? null, phone: phone ?? null, displayName: res.displayName, chrysalisRegistered: res.chrysalisRegistered, token: res.token };
}

export async function authMe(token: string): Promise<AuthUser> {
  const headers = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${API}/auth/me`, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error('Not authenticated');
  const data = await res.json() as { ok: boolean; wallet: string; userId: string; email?: string; phone?: string; displayName: string; chrysalisRegistered: boolean };
  return { userId: data.userId, wallet: data.wallet, email: data.email ?? null, phone: data.phone ?? null, displayName: data.displayName, chrysalisRegistered: data.chrysalisRegistered, token };
}

export async function authLogout(token: string): Promise<void> {
  await postJson('/auth/logout', {}, token);
}
