import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, maxUint256, parseUnits } from "viem";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useDisconnect, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { erc20Abi, protocolAbi } from "./abi";
import { apiBaseUrl, b5Address, b5TreasuryAddress, contractsConfigured, explorerUrl, protocolAddress, targetChainId, targetNetworkName, usdtAddress, zeroAddress } from "./config";

const packages = [{ name: "Basic", price: 50, rate: 1.5, days: 134 }, { name: "Standard", price: 100, rate: 1.6, days: 125 }, { name: "Business", price: 500, rate: 1.7, days: 188 }, { name: "VIP", price: 1000, rate: 1.8, days: 112 }, { name: "Luxury", price: 2500, rate: 2, days: 100 }] as const;
const ranks = [5_000, 15_000, 35_000, 80_000, 200_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];
type Page = "dashboard" | "register" | "team" | "genealogy" | "topup" | "withdraw" | "income" | "rank" | "transactions" | "wallet";
type Activity = { event_name: string; amount: string | null; metadata?: { packageId?: number | string; [key: string]: unknown }; transaction_hash: string; block_timestamp: string };
type IncomeCategory = "staking" | "direct" | "level" | "booster" | "rank";
type TeamMember = { user_id: number | string; wallet_address: string; sponsor_address: string | null; package_id: number | null; activated_at: string | null; depth: number };
const money = (v?: bigint) => Number(formatUnits(v ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (a?: string) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const txUrl = (h?: string) => `${explorerUrl}/tx/${h}`;
const incomeCategory = (item: Activity): IncomeCategory | null => {
  if (item.event_name === "YieldClaimed") return "staking";
  if (item.event_name !== "IncomeCredited") return null;
  const type = String(item.metadata?.incomeType ?? "").toLowerCase();
  if (type === "0x5f0a5f78118b6e0b700e0357ae3909aaafe8fa706a075935688657cf4135f9a9") return "direct";
  if (type === "0xaa7ef1d11da7ae8b20914b6a200903893345e4c731dcaa7e093a709901ae1ec9") return "level";
  if (type === "0x1ae9eabba91b8cbaee42b8f1062cf8ceac780e74cce3068bc2adc286d3f37c97") return "booster";
  if (type === "0xc5654be4efc89097db13a087f3077e725ed1287a5ffd506c4522a3eb1ded2674") return "rank";
  return null;
};
const incomeCategories: { key: "all" | IncomeCategory; label: string }[] = [
  { key: "all", label: "All incomes" },
  { key: "staking", label: "Staking ROI" },
  { key: "direct", label: "Direct sponsor" },
  { key: "level", label: "Level commission" },
  { key: "booster", label: "B Plus Booster" },
  { key: "rank", label: "Rank income" }
];
const eventTitle = (item: Activity) => {
  if (item.event_name === "IncomeCredited") {
    const incomeType = String(item.metadata?.incomeType ?? "").toLowerCase();
    return ({
      "0x1ae9eabba91b8cbaee42b8f1062cf8ceac780e74cce3068bc2adc286d3f37c97": "B PLUS BOOSTER Income credited",
      "0x5f0a5f78118b6e0b700e0357ae3909aaafe8fa706a075935688657cf4135f9a9": "Team Direct income credited",
      "0xaa7ef1d11da7ae8b20914b6a200903893345e4c731dcaa7e093a709901ae1ec9": "Level income credited",
      "0xc5654be4efc89097db13a087f3077e725ed1287a5ffd506c4522a3eb1ded2674": "Rank income credited"
    } as Record<string, string>)[incomeType] ?? "Team income credited";
  }
  const name = item.event_name;
  return ({ Registered: "Joined the network", Activated: "Package purchased", YieldClaimed: "Staking ROI credited", EarningsWithdrawn: "USDT withdrawal", PrincipalWithdrawn: "Principal withdrawal", B5Claimed: "B5 claimed", P2PTransferred: "P2P transfer", UserBlockChanged: "Account status changed" }[name] ?? name.replace(/([A-Z])/g, " $1").trim());
};

export default function App() {
  const [page, setPage] = useState<Page>(() => new URLSearchParams(window.location.search).has("ref") ? "register" : "dashboard");
  const [teamOpen, setTeamOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selected, setSelected] = useState(1);
  const [packageAction, setPackageAction] = useState<"approval" | "purchase" | null>(null);
  const [purchasePackageId, setPurchasePackageId] = useState<number | null>(null);
  const [sponsor, setSponsor] = useState(() => new URLSearchParams(window.location.search).get("ref") ?? new URLSearchParams(window.location.search).get("sponsor") ?? "");
  const [copied, setCopied] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("10");
  const [recipient, setRecipient] = useState("");
  const [transferAmount, setTransferAmount] = useState("10");
  const [blockTarget, setBlockTarget] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activityStatus, setActivityStatus] = useState("Loading recent activity…");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamStatus, setTeamStatus] = useState("Loading your team…");

  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();
  const { switchChain } = useSwitchChain();
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const packageTx = useWriteContract();
  const packageReceipt = useWaitForTransactionReceipt({ hash: packageTx.data });
  const enabled = contractsConfigured && !!address;
  const user = address ?? zeroAddress;
  const query = { enabled, refetchInterval: 12000 };

  const registration = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "isRegistered", args: [user], query: { ...query, refetchInterval: page === "register" ? 3000 : 12000 } });
  const rootUser = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "rootUser", query: { ...query, refetchInterval: page === "register" ? 3000 : 12000 } });
  const accountSponsor = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "sponsorOf", args: [user], query });
  const positionCount = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "positionCount", args: [user], query });
  const position = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "positions", args: [user], query });
  const earnings = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "earningsBalance", args: [user], query });
  const pendingYield = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "pendingYield", args: [user], query });
  const directs = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "directCount", args: [user], query });
  const volume = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "teamVolume", args: [user], query });
  const leadership = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "leadershipRank", args: [user], query });
  const allocation = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "b5Allocation", args: [user], query });
  const unlockAt = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "b5UnlockAt", args: [user], query });
  const b5Open = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "b5WithdrawEnabled", query });
  const owner = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "owner", query });
  const canWithdrawPrincipal = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "canWithdrawPrincipal", args: [user], query });
  const usdtBalance = useReadContract({ abi: erc20Abi, address: usdtAddress, functionName: "balanceOf", args: [user], query: { enabled } });
  const allowance = useReadContract({ abi: erc20Abi, address: usdtAddress, functionName: "allowance", args: [user, protocolAddress], query: { enabled } });
  const b5TreasuryAllowance = useReadContract({ abi: erc20Abi, address: b5Address, functionName: "allowance", args: [b5TreasuryAddress, protocolAddress], query: { enabled } });

  useEffect(() => {
    if (packageReceipt.data?.status !== "success") return;
    if (packageAction === "approval") void allowance.refetch();
    if (packageAction === "purchase") void positionCount.refetch();
  }, [packageAction, packageReceipt.data?.status, packageReceipt.data?.transactionHash]);

  const registered = registration.data === true;
  const active = Number(positionCount.data ?? 0n) > 0 || (!!position.data && position.data[1] > 0n);
  const chosen = packages[selected];
  const hasAllowance = (allowance.data ?? 0n) >= parseUnits(String(chosen.price), 18);
  const sponsorAddress = useMemo(() => isAddress(sponsor) ? sponsor : zeroAddress, [sponsor]);
  const rootEstablished = !!rootUser.data && rootUser.data.toLowerCase() !== zeroAddress;
  const registrationAllowed = !rootUser.isLoading && rootUser.data !== undefined && (rootEstablished
    ? isAddress(sponsor) && sponsorAddress !== zeroAddress
    : !sponsor.trim());

  // Refresh registration as soon as its transaction is mined instead of waiting
  // for the regular dashboard polling interval before leaving the registration page.
  useEffect(() => {
    if (!address || !receipt.isSuccess || receipt.data?.status !== "success") return;
    void registration.refetch();
    void accountSponsor.refetch();
    void rootUser.refetch();
  }, [address, receipt.isSuccess, receipt.data?.status, receipt.data?.transactionHash]);
  const effectiveSponsor = registered ? accountSponsor.data ?? zeroAddress : sponsorAddress;
  const isOwner = !!address && address.toLowerCase() === owner.data?.toLowerCase();
  const principalWindowOpen = active && !!canWithdrawPrincipal.data;
  const withdrawBase = useMemo(() => {
    try { return parseUnits(withdrawAmount || "0", 18); } catch { return 0n; }
  }, [withdrawAmount]);
  const b5FeeForWithdrawal = withdrawBase * 500n / 10_000n;
  const enoughB5FeeAllowance = (b5TreasuryAllowance.data ?? 0n) >= b5FeeForWithdrawal;
  const blockTargetValid = isAddress(blockTarget);
  const targetBlocked = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "blocked", args: [blockTargetValid ? blockTarget : zeroAddress], query: { enabled: isOwner && blockTargetValid, refetchInterval: 12000 } });
  const status = (error as any)?.shortMessage ?? error?.message ?? (receipt.isSuccess ? "Transaction confirmed." : hash ? "Transaction submitted…" : "");
  const startUsdtApproval = () => {
    setPackageAction("approval");
    setPurchasePackageId(null);
    packageTx.reset();
    packageTx.writeContract({ abi: erc20Abi, address: usdtAddress, functionName: "approve", args: [protocolAddress, maxUint256] });
  };
  const startPackagePurchase = () => {
    setPackageAction("purchase");
    setPurchasePackageId(selected);
    packageTx.reset();
    packageTx.writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "activate", args: [selected, isAddress(effectiveSponsor) ? effectiveSponsor : zeroAddress] });
  };
  const resetPackageFlow = () => {
    packageTx.reset();
    setPackageAction(null);
    setPurchasePackageId(null);
  };

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/api/v1/users/${address}/dashboard`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setActivity(d.activity ?? []); setActivityStatus(d.activity?.length ? "Latest on-chain events indexed from BSC Mainnet." : "No transactions yet."); })
      .catch(() => !controller.signal.aborted && setActivityStatus("The activity indexer is syncing."));
    fetch(`${apiBaseUrl}/api/v1/users/${address}/team`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setTeam(d.members ?? []); setTeamStatus(`${d.directCount ?? 0} direct members · ${d.teamCount ?? 0} total team members`); })
      .catch(() => !controller.signal.aborted && setTeamStatus("Team data is syncing from the chain."));
    return () => controller.abort();
  }, [address, receipt.isSuccess, packageReceipt.data?.transactionHash]);

  useEffect(() => {
    if (isConnected && registration.data === false) setPage("register");
    if (isConnected && registered && page === "register") setPage("dashboard");
  }, [isConnected, registration.data, registered, page]);

  const connect = () => open({ view: "Connect", namespace: "eip155" });
  const go = (next: Page) => {
    setPage(!registered && next !== "register" ? "register" : next);
    setMobileOpen(false);
  };
  const claim = (name: "claimYield" | "withdrawPrincipal" | "claimB5") => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: name });
  const admin = () => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "setB5WithdrawEnabled", args: [!b5Open.data] });
  const toggleBlocked = () => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "setBlocked", args: [blockTarget as `0x${string}`, !targetBlocked.data] });

  if (!isConnected) return <Login connect={connect} />;

  const pageTitles: Record<Page, string> = { dashboard: "Dashboard", register: "Create Account", team: "Team List", genealogy: "Genealogy Tree", topup: "Top-up / Packages", withdraw: "Withdrawal", income: "Income Report", rank: "My Rank", transactions: "Transaction", wallet: "P2P Wallet Transfer" };
  const navItems: { key: Page; icon: string; label: string }[] = [
    { key: "dashboard", icon: "▦", label: "Dashboard" },
    { key: "topup", icon: "＋", label: "Top-up" },
    { key: "withdraw", icon: "↗", label: "Withdrawal" },
    { key: "income", icon: "▤", label: "Income Report" },
    { key: "rank", icon: "◇", label: "My Rank" },
    { key: "transactions", icon: "◷", label: "Transaction" },
    { key: "wallet", icon: "⇄", label: "P2P Wallet Transfer" },
  ];

  return <div className="member-layout">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
    <aside className={`member-sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <button className="member-brand" onClick={() => go("dashboard")}><img src="/brand.jpeg" alt="" /><span><b>BIT FIVE</b><small>MEMBER PANEL</small></span><i className="sidebar-close" onClick={e => { e.stopPropagation(); setMobileOpen(false); }}>×</i></button>
      <small className="menu-caption">MAIN MENU</small>
      {!registered && <button className={`member-nav ${page === "register" ? "selected" : ""}`} onClick={() => go("register")}><i>＋</i><span>Register</span></button>}
      {registered && <>
        {navItems.slice(0, 3).map(item => <button key={item.key} className={`member-nav ${page === item.key ? "selected" : ""}`} onClick={() => go(item.key)}><i>{item.icon}</i><span>{item.label}</span></button>)}
        <button className={`member-nav ${page === "team" || page === "genealogy" ? "selected" : ""}`} onClick={() => setTeamOpen(v => !v)}><i>♧</i><span>Team</span><b className={teamOpen ? "turn" : ""}>⌄</b></button>
        {teamOpen && <div className="member-subnav"><button className={page === "team" ? "selected" : ""} onClick={() => go("team")}>Team List</button><button className={page === "genealogy" ? "selected" : ""} onClick={() => go("genealogy")}>Genealogy Tree</button></div>}
        {navItems.slice(3).map(item => <button key={item.key} className={`member-nav ${page === item.key ? "selected" : ""}`} onClick={() => go(item.key)}><i>{item.icon}</i><span>{item.label}</span></button>)}
      </>}
      <div className="sidebar-bottom"><small>BSC MAINNET · CHAIN 56</small><a href={`${explorerUrl}/address/${protocolAddress}`} target="_blank" rel="noreferrer">View protocol on BscScan ↗</a></div>
    </aside>

    <div className="member-workspace">
      <header className="member-topbar"><div className="topbar-left"><button className="menu-trigger" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button><div><small>BIT FIVE / MEMBER AREA</small><h1>{pageTitles[page]}</h1></div></div><div className="topbar-right"><span className="chain-chip">● BNB Smart Chain</span><button className="address-pill" onClick={() => disconnect()} title="Disconnect wallet">{short(address)} <small>Disconnect</small></button></div></header>
      {chainId !== targetChainId && <div className="chain-warning">Wrong network. <button onClick={() => switchChain({ chainId: targetChainId })}>Switch to BNB Smart Chain</button></div>}
      <main className="member-content">
        {!contractsConfigured && <Notice tone="amber" text="Mainnet contract settings are missing from this build." />}
        {page === "register" && <RegisterPage address={address} sponsor={sponsor} rootEstablished={rootEstablished} rootLoading={rootUser.isLoading || rootUser.data === undefined} registrationAllowed={registrationAllowed} isPending={isPending} status={status} hash={hash} write={() => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "register", args: [sponsorAddress] })} />}
        {registered && page === "dashboard" && <Dashboard address={address} active={active} count={Number(positionCount.data ?? 0n)} earnings={earnings.data} pendingYield={pendingYield.data} allocation={allocation.data} directs={directs.data} volume={volume.data} leadership={leadership.data} b5Open={!!b5Open.data} unlockAt={unlockAt.data} activity={activity} go={go} copied={copied} onCopy={() => { void navigator.clipboard.writeText(`${window.location.origin}/?ref=${address}`).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }); }} claim={claim} isPending={isPending} isOwner={isOwner} admin={admin} blockTarget={blockTarget} setBlockTarget={setBlockTarget} blockTargetValid={blockTargetValid} targetBlocked={!!targetBlocked.data} onBlock={toggleBlocked} />}
        {registered && page === "team" && <TeamPage title="Team List" subtitle={teamStatus} members={team.filter(m => Number(m.depth) === 0)} rootAddress={address} />}
        {registered && page === "genealogy" && <TeamPage title="Your Genealogy" subtitle={teamStatus} members={team} rootAddress={address} genealogy />}
        {registered && page === "topup" && <TopupPage packages={packages} selected={selected} setSelected={setSelected} chosen={chosen} count={Number(positionCount.data ?? 0n)} balance={usdtBalance.data} hasAllowance={hasAllowance} isPending={packageTx.isPending} receiptPending={packageReceipt.isLoading} action={packageAction} receiptStatus={packageReceipt.data?.status} receiptError={packageReceipt.isError ? (packageReceipt.error as any)?.shortMessage ?? packageReceipt.error?.message : ""} walletError={packageTx.error ? (packageTx.error as any)?.shortMessage ?? packageTx.error.message : ""} hash={packageTx.data} purchasePackageId={purchasePackageId} approve={startUsdtApproval} purchase={startPackagePurchase} resetFlow={resetPackageFlow} goDashboard={() => go("dashboard")} />}
        {registered && page === "withdraw" && <WithdrawPage earnings={earnings.data} amount={withdrawAmount} setAmount={setWithdrawAmount} allowance={b5TreasuryAllowance.data} enoughAllowance={enoughB5FeeAllowance} active={active} isPending={isPending} withdraw={() => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "withdrawEarnings", args: [withdrawBase] })} allocation={allocation.data} unlockAt={unlockAt.data} b5Open={!!b5Open.data} claimB5={() => claim("claimB5")} canWithdrawPrincipal={!!canWithdrawPrincipal.data} withdrawPrincipal={() => claim("withdrawPrincipal")} status={status} hash={hash} isOwner={isOwner} admin={admin} />}
        {registered && page === "income" && <IncomePage earnings={earnings.data} pendingYield={pendingYield.data} activity={activity} activityStatus={activityStatus} />}
        {registered && page === "rank" && <RankPage rank={Number(leadership.data ?? 0)} volume={volume.data} directs={directs.data} />}
        {registered && page === "transactions" && <TransactionsPage activity={activity} activityStatus={activityStatus} />}
        {registered && page === "wallet" && <WalletPage recipient={recipient} setRecipient={setRecipient} amount={transferAmount} setAmount={setTransferAmount} isPending={isPending} send={() => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "p2pTransfer", args: [recipient as `0x${string}`, parseUnits(transferAmount || "0", 18)] })} status={status} hash={hash} />}
      </main>
    </div>
  </div>;
}

function Login({ connect }: { connect: () => void }) {
  return <div className="auth-shell"><header className="auth-brand"><img src="/brand.jpeg" alt="Bit Five" /><span><b>BIT FIVE</b><small>BNB SMART CHAIN MAINNET</small></span></header><section className="auth-card"><div className="auth-mark">B<sup>5</sup></div><small className="auth-eyebrow">MEMBER ACCESS</small><h1>Connect your wallet</h1><p>Sign in to your Bit Five member panel using your BNB Smart Chain wallet.</p><button className="btn primary auth-connect" onClick={connect}>◈ &nbsp; Connect Wallet</button><div className="auth-points"><span>Wallet-signed transactions</span><span>Referral registration on-chain</span><span>BNB Smart Chain · Chain 56</span></div></section><p className="auth-footer">BIT FIVE · Member portal</p></div>;
}

function RegisterPage({ address, sponsor, rootEstablished, rootLoading, registrationAllowed, isPending, status, hash, write }: { address?: `0x${string}`; sponsor: string; rootEstablished: boolean; rootLoading: boolean; registrationAllowed: boolean; isPending: boolean; status: string; hash?: `0x${string}`; write: () => void }) {
  const sponsorValid = isAddress(sponsor) && sponsor.toLowerCase() !== zeroAddress;
  return <section className="content-card narrow-card"><PageHeading title="Create your account" subtitle="Register on-chain under your sponsor's wallet. No email or password required." /><div className="join-steps"><span className="step-current">01 <b>Connect wallet</b></span><i>→</i><span>02 <b>Register</b></span><i>→</i><span>03 <b>Choose package</b></span></div><div className="wallet-confirm"><span className="status-dot" /> Wallet connected <b>{short(address)}</b></div>{rootEstablished ? <label className="field-label">Sponsor wallet address <small>Open your sponsor's referral link. Registration without a registered sponsor is blocked by the contract.</small><input readOnly value={sponsor} placeholder="Open a referral link to continue" /></label> : <div className="notice notice-green">{rootLoading ? "Checking whether the network root is set…" : "First account: this wallet will become the network root. No sponsor is required."}</div>}{rootEstablished && !sponsorValid && !rootLoading && <Notice tone="amber" text="A valid sponsor referral link is required before registration." />}<p className="helper-copy">Your sponsor is recorded permanently in the BNB Smart Chain transaction.</p><button className="btn primary action-wide" disabled={isPending || !registrationAllowed || rootLoading} onClick={write}>{isPending ? "Confirm in wallet…" : "Create account on-chain →"}</button>{status && <TxStatus status={status} hash={hash} />}</section>;
}

function Dashboard({ address, active, count, earnings, pendingYield, allocation, directs, volume, leadership, b5Open, unlockAt, activity, go, copied, onCopy, claim, isPending, isOwner, admin, blockTarget, setBlockTarget, blockTargetValid, targetBlocked, onBlock }: any) {
  return <div className="page-stack dashboard-page"><section className="dashboard-welcome"><div><small>MEMBER DASHBOARD</small><h2>Welcome back, {short(address)}</h2><p>{active ? `${count} package position${count === 1 ? "" : "s"} active on-chain` : "Your profile is ready. Choose a package to get started."}</p></div><button className="btn primary" onClick={() => go("topup")}>{active ? "Buy another package" : "Topup now"} →</button></section>
    <section className="content-card referral-panel"><div><span className="mini-icon">↗</span><div><h3>Your referral link</h3><p>Share it to invite a new member. Their registration and sponsor are recorded on-chain.</p></div></div><div className="copy-row"><input readOnly value={`${window.location.origin}/?ref=${address}`} /><button className="btn outline" onClick={onCopy}>{copied ? "Copied ✓" : "Copy link"}</button></div></section>
    <section className="stat-grid"><Stat label="Total team" value={String(Number(directs ?? 0))} note={`Team volume $${money(volume)}`} icon="♧" /><Stat label="Available income" value={`$${money(earnings)}`} note="Internal USDT balance" icon="$" /><Stat label="Pending daily return" value={`$${money(pendingYield)}`} note="Daily close at 5:30 AM IST" icon="◷" /><Stat label="B5 allocation" value={`${money(allocation)} B5`} note={b5Open ? "Wallet claims enabled" : "Unlock at day 180 · currently off"} icon="B⁵" /></section>
    <div className="dashboard-columns"><section className="content-card"><PageHeading title="Account overview" subtitle="Your package and network snapshot" /><div className="overview-list"><Overview label="Account status" value={active ? "Active" : "Registered"} tone="green" /><Overview label="Package positions" value={String(count)} /><Overview label="Leadership rank" value={Number(leadership ?? 0) ? `Bit-${leadership}` : "Not ranked yet"} /><Overview label="Team volume" value={`$${money(volume)}`} /><Overview label="Direct members" value={String(Number(directs ?? 0))} /></div><button className="text-link" onClick={() => go("rank")}>View rank details →</button></section><section className="content-card"><PageHeading title="Quick actions" subtitle="Common member actions" /><div className="quick-actions"><QuickAction icon="＋" label="Buy a package" onClick={() => go("topup")} /><QuickAction icon="↗" label="Withdraw income" onClick={() => go("withdraw")} /><QuickAction icon="▤" label="Income report" onClick={() => go("income")} /><QuickAction icon="♧" label="View my team" onClick={() => go("team")} /></div></section></div>
    <section className="content-card"><div className="section-heading-row"><PageHeading title="Recent transactions" subtitle="Latest activity recorded by the contract" /><button className="text-link" onClick={() => go("transactions")}>View all →</button></div><ActivityList activity={activity.slice(0, 5)} /></section>
    {isOwner && <AdminPanel on={b5Open} pending={isPending} toggle={admin} blockTarget={blockTarget} setBlockTarget={setBlockTarget} blockTargetValid={blockTargetValid} targetBlocked={targetBlocked} onBlock={onBlock} />}
    {unlockAt && <span className="sr-only">B5 unlock timestamp {String(unlockAt)}</span>}
  </div>;
}

function TopupPage({ packages: list, selected, setSelected, chosen, count, balance, hasAllowance, isPending, receiptPending, action, receiptStatus, receiptError, walletError, hash, purchasePackageId, approve, purchase, resetFlow, goDashboard }: any) {
  const purchaseConfirmed = action === "purchase" && receiptStatus === "success";
  const approvalConfirmed = action === "approval" && receiptStatus === "success";
  const purchaseReverted = action === "purchase" && receiptStatus === "reverted";
  const waiting = isPending || receiptPending;
  const purchaseSubmitted = action === "purchase" && !!hash;
  const purchasedPackage = purchasePackageId == null ? chosen : list[purchasePackageId];
  const steps = [
    { label: "Choose package", done: true, current: false },
    { label: "Approve USDT", done: hasAllowance || approvalConfirmed, current: !hasAllowance && !approvalConfirmed },
    { label: "Confirm purchase", done: purchaseConfirmed || purchaseSubmitted, current: hasAllowance && !purchaseConfirmed && !purchaseSubmitted },
    { label: "On-chain confirmation", done: purchaseConfirmed, current: purchaseSubmitted && receiptPending },
  ];
  return <div className="page-stack"><section className="content-card topup-card">
    <PageHeading title={count ? "Purchase another package" : "Choose your package"} subtitle="Follow each step. Your package is active only after the BNB Smart Chain transaction is confirmed." />
    <div className="topup-steps">{steps.map((step, i) => <div className={`topup-step ${step.done ? "step-done" : ""} ${step.current ? "step-current" : ""}`} key={step.label}><span>{step.done ? "✓" : `0${i + 1}`}</span><b>{step.label}</b></div>)}</div>
    <div className="topup-summary"><span>Existing positions <b>{count}</b></span><span>Wallet USDT <b>${money(balance)}</b></span></div>
    {purchaseConfirmed ? <div className="purchase-success"><div className="purchase-success-mark">✓</div><small>ON-CHAIN CONFIRMATION RECEIVED</small><h2>Package purchase complete</h2><p><b>{purchasedPackage.name}</b> package · <b>${purchasedPackage.price.toLocaleString()} USDT</b></p><p className="purchase-success-copy">Your new package position is active. You can see the confirmed transaction on BscScan.</p>{hash && <a className="btn outline" href={txUrl(hash)} target="_blank" rel="noreferrer">View confirmed transaction ↗</a>}<div className="purchase-success-actions"><button className="btn primary" onClick={goDashboard}>Go to Dashboard</button><button className="text-link" onClick={resetFlow}>Buy another package</button></div></div> : <>
      <div className="plan-grid">{list.map((p: any, i: number) => <button key={p.name} className={`plan-card ${selected === i ? "plan-selected" : ""}`} disabled={waiting} onClick={() => setSelected(i)}><span>{selected === i ? "SELECTED" : `PACKAGE 0${i + 1}`}</span><h3>{p.name}</h3><b>${p.price.toLocaleString()}</b><small>USDT deposit</small><div className="plan-facts"><span>{p.rate}% daily rate</span><span>{p.days} days duration</span></div></button>)}</div>
      <div className="purchase-footer"><div><small>Selected package</small><b>{chosen.name} · ${chosen.price.toLocaleString()}</b><span>{chosen.rate}% daily · {chosen.days} days</span></div>{!hasAllowance ? <button className="btn primary" disabled={waiting} onClick={approve}>{isPending ? "Confirm approval in wallet…" : "Approve USDT"}</button> : <button className="btn primary" disabled={waiting} onClick={purchase}>{isPending ? "Confirm purchase in wallet…" : `Confirm package · $${chosen.price.toLocaleString()}`}</button>}</div>
      <p className="helper-copy">USDT approval is a separate wallet step and does not buy a package. After approval, confirm the package purchase and wait for its on-chain confirmation.</p>
      {approvalConfirmed && <div className="notice notice-green">USDT approval confirmed. No package has been bought yet—confirm the selected package to continue.</div>}
      {waiting && <div className="notice notice-amber">{isPending ? "Confirm this request in your wallet." : action === "approval" ? "USDT approval submitted. Waiting for network confirmation…" : "Package purchase submitted. Waiting for BNB Smart Chain confirmation…"}{hash && <a className="inline-explorer" href={txUrl(hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>}
      {purchaseReverted && <div className="notice notice-amber">The package transaction reverted. The package was not purchased. {hash && <a className="inline-explorer" href={txUrl(hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>}
      {walletError && <div className="notice notice-amber">{/reject|denied|cancel/i.test(walletError) ? "Wallet confirmation was cancelled or rejected. No package was purchased." : walletError}</div>}
      {receiptError && !purchaseReverted && <div className="notice notice-amber">Could not confirm the transaction yet: {receiptError} {hash && <a className="inline-explorer" href={txUrl(hash)} target="_blank" rel="noreferrer">Check BscScan ↗</a>}</div>}
    </>}
  </section></div>;
}

function WithdrawPage({ earnings, amount, setAmount, allowance, enoughAllowance, active, isPending, withdraw, allocation, unlockAt, b5Open, claimB5, canWithdrawPrincipal, withdrawPrincipal, status, hash, isOwner, admin }: any) {
  return <div className="page-stack"><div className="dashboard-columns"><section className="content-card"><PageHeading title="Withdraw USDT" subtitle="Withdraw from your internal earnings balance" /><div className="withdraw-balance"><small>AVAILABLE BALANCE</small><b>${money(earnings)}</b><span>Minimum $10 · Maximum $1,000 per day</span></div><label className="field-label">Withdrawal amount<input type="number" min="10" max="1000" value={amount} onChange={e => setAmount(e.target.value)} /></label><div className="fee-breakdown"><span>USDT fee <b>5%</b></span><span>B5 fee <b>5% from treasury</b></span><span>V6 treasury allowance <b>{money(allowance)} B5</b></span></div>{!enoughAllowance && <Notice tone="amber" text="Withdrawal is paused: the B5 token treasury wallet must approve this V6 contract to spend the B5 fee. Approval must be sent from the treasury wallet; it does not transfer B5. After approval confirms, refresh this page." />}<button className="btn primary action-wide" disabled={!active || isPending || !enoughAllowance || Number(amount) < 10 || Number(amount) > 1000} onClick={withdraw}>{isPending ? "Confirm in wallet…" : "Withdraw USDT"}</button></section><section className="content-card"><PageHeading title="B5 package allocation" subtitle="Package allocations unlock 180 days after purchase" /><div className="withdraw-balance"><small>TOTAL ALLOCATION</small><b>{money(allocation)} B5</b><span>Unlock date {unlockAt ? new Date(Number(unlockAt) * 1000).toLocaleDateString() : "—"}</span></div><p className="helper-copy">B5 wallet claims are {b5Open ? "enabled" : "currently disabled by the protocol owner"}.</p><button className="btn outline action-wide" disabled={!b5Open || isPending || !unlockAt || Date.now() / 1000 < Number(unlockAt)} onClick={claimB5}>{b5Open ? "Claim unlocked B5" : "B5 claims are off"}</button></section></div><section className="content-card principal-card"><div><PageHeading title="Principal withdrawal" subtitle="Available during the 15-day window when contract conditions are met" /><p className="helper-copy">A 20% fee applies. The contract processes every eligible package position in one transaction.</p></div><button className="btn outline" disabled={!canWithdrawPrincipal || isPending} onClick={withdrawPrincipal}>Withdraw eligible principal</button></section>{isOwner && <AdminPanel on={b5Open} pending={isPending} toggle={admin} />}{status && <TxStatus status={status} hash={hash} />}</div>;
}

function IncomePage({ earnings, pendingYield, activity, activityStatus }: any) {
  const [selectedCategory, setSelectedCategory] = useState<"all" | IncomeCategory>("all");
  const incomeEvents = activity.filter((item: Activity) => incomeCategory(item) !== null);
  const visibleEvents = selectedCategory === "all" ? incomeEvents : incomeEvents.filter((item: Activity) => incomeCategory(item) === selectedCategory);
  return <div className="page-stack"><section className="stat-grid"><Stat label="Available USDT income" value={`$${money(earnings)}`} note="Withdrawable internal balance" icon="$" /><Stat label="Pending return" value={`$${money(pendingYield)}`} note="Daily close at 5:30 AM IST" icon="◷" /><Stat label="Income entries" value={String(incomeEvents.length)} note="Recent indexed entries" icon="▤" /><Stat label="Network" value="BSC" note="On-chain records" icon="◇" /></section><section className="content-card"><PageHeading title="Income report" subtitle={activityStatus} /><div className="income-filters" role="group" aria-label="Filter income by category">{incomeCategories.map(category => <button key={category.key} type="button" className={`income-filter ${selectedCategory === category.key ? "active" : ""}`} aria-pressed={selectedCategory === category.key} onClick={() => setSelectedCategory(category.key)}>{category.label}</button>)}</div>{visibleEvents.length ? <ActivityList activity={visibleEvents} /> : <p className="empty-state">No {selectedCategory === "all" ? "income" : incomeCategories.find(category => category.key === selectedCategory)?.label.toLowerCase()} entries yet.</p>}</section></div>;
}

function RankPage({ rank, volume, directs }: any) {
  const next = ranks[rank] ?? ranks[ranks.length - 1];
  const percent = Math.min(100, Number(formatUnits(volume ?? 0n, 18)) / next * 100);
  return <div className="page-stack rank-page"><section className="rank-hero"><div><small>CURRENT LEADERSHIP RANK</small><h2>{rank ? `Bit-${rank}` : "Unranked"}</h2><p>Leadership status from your on-chain team volume and qualification.</p></div><span className="rank-emblem">◇</span></section><div className="stat-grid"><Stat label="Team volume" value={`$${money(volume)}`} note="On-chain qualifying volume" icon="$" /><Stat label="Direct members" value={String(Number(directs ?? 0))} note="Package-active directs" icon="♧" /><Stat label="Next rank" value={rank >= 10 ? "Maximum" : `Bit-${rank + 1}`} note={rank >= 10 ? "Top rank reached" : `$${next.toLocaleString()} team volume`} icon="◇" /><Stat label="Volume progress" value={`${percent.toFixed(1)}%`} note="Towards next volume threshold" icon="↗" /></div><section className="content-card"><PageHeading title="Leadership ladder" subtitle="Team volume thresholds from the Bit Five plan" /><div className="rank-list">{ranks.map((threshold, i) => <div className={`rank-row ${rank >= i + 1 ? "rank-done" : ""}`} key={threshold}><span>{rank >= i + 1 ? "✓" : `0${i + 1}`}</span><b>Bit-{i + 1}</b><small>${threshold.toLocaleString()} team volume</small><strong>{rank >= i + 1 ? "Achieved" : "In progress"}</strong></div>)}</div></section></div>;
}

function TeamPage({ title, subtitle, members, rootAddress, genealogy = false }: { title: string; subtitle: string; members: TeamMember[]; rootAddress?: string; genealogy?: boolean }) {
  const nodes = new Map(members.map(member => [member.wallet_address.toLowerCase(), { ...member, children: [] as any[] }]));
  const roots: any[] = [];
  for (const node of nodes.values()) {
    const parent = node.sponsor_address ? nodes.get(node.sponsor_address.toLowerCase()) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const visibleNodes = genealogy ? roots.slice(0, 100) : members;
  return <div className="page-stack"><section className="stat-grid"><Stat label="Direct referrals" value={String(members.filter(m => Number(m.depth) === 0).length)} note="Your first-level team" icon="♧" /><Stat label="Network members" value={String(members.length)} note="Indexed on-chain registrations" icon="◇" /><Stat label="Active packages" value={String(members.filter(m => m.package_id !== null).length)} note="Members with a package purchase" icon="＋" /><Stat label="Team activity" value={members.length ? "Active" : "Waiting"} note="Updates as registrations index" icon="◷" /></section><section className="content-card"><PageHeading title={title} subtitle={subtitle} />{!members.length ? <p className="empty-state">No team registrations are indexed yet. Member IDs and wallet addresses will appear here after the indexer syncs their on-chain registrations.</p> : genealogy ? <><div className="level-summary">{Array.from({ length: Math.min(10, Math.max(...members.map(m => Number(m.depth) + 1), 1)) }, (_, level) => <span key={level}>Level {level + 1}<b>{members.filter(m => Number(m.depth) === level).length}</b></span>)}</div><div className="genealogy-viewport"><div className="genealogy-chart"><div className="genealogy-root"><TeamNodeCard address={rootAddress ?? ""} isRoot /></div><div className="genealogy-branches">{visibleNodes.map(node => <TeamNode key={node.wallet_address} node={node} />)}</div></div></div>{roots.length > 100 && <p className="helper-copy">Showing the first 100 direct branches in the chart. Team List includes all direct referrals.</p>}</> : <div className="team-table-wrap"><table className="member-table"><thead><tr><th>User ID</th><th>Member wallet</th><th>Status</th><th>Package</th><th>Joined / activated</th><th>Explore</th></tr></thead><tbody>{members.map(member => <tr key={member.wallet_address}><td>#{member.user_id}</td><td>{short(member.wallet_address)}</td><td><span className={`table-badge ${member.package_id == null ? "badge-pending" : "badge-active"}`}>{member.package_id == null ? "Registered" : "Active"}</span></td><td>{member.package_id == null ? "—" : packages[member.package_id]?.name ?? "Package"}</td><td>{member.activated_at ? new Date(member.activated_at).toLocaleDateString() : "Awaiting package"}</td><td><a href={`${explorerUrl}/address/${member.wallet_address}`} target="_blank" rel="noreferrer">BscScan ↗</a></td></tr>)}</tbody></table></div>}</section></div>;
}

function TeamNode({ node }: { node: TeamMember & { children: (TeamMember & { children: any[] })[] } }) { return <div className="genealogy-node"><TeamNodeCard address={node.wallet_address} member={node} />{node.children.length > 0 && <div className="genealogy-children">{node.children.map(child => <TeamNode key={child.wallet_address} node={child} />)}</div>}</div>; }
function TeamNodeCard({ address, member, isRoot = false }: { address: string; member?: TeamMember; isRoot?: boolean }) { return <a className={`genealogy-card ${isRoot ? "root-card" : ""}`} href={isRoot ? undefined : `${explorerUrl}/address/${address}`} target={isRoot ? undefined : "_blank"} rel={isRoot ? undefined : "noreferrer"}><span className="genealogy-avatar">{isRoot ? "B5" : address.slice(2, 4).toUpperCase()}</span><b>{isRoot ? "You" : `ID #${member?.user_id ?? "—"}`}</b><small>{short(address)} · {isRoot ? "Root account" : member?.package_id == null ? "Registered" : packages[member.package_id]?.name ?? "Package member"}</small><i className={member?.package_id == null && !isRoot ? "inactive-node" : "active-node"}>{isRoot || member?.package_id !== null ? "● Active" : "● Registered"}</i></a>; }

function TransactionsPage({ activity, activityStatus }: { activity: Activity[]; activityStatus: string }) {
  return <div className="page-stack"><section className="content-card"><PageHeading title="Transactions" subtitle={activityStatus} /><ActivityList activity={activity} /></section></div>;
}

function WalletPage({ recipient, setRecipient, amount, setAmount, isPending, send, status, hash }: any) {
  return <div className="page-stack"><section className="content-card narrow-card"><PageHeading title="P2P Wallet Transfer" subtitle="Send internal earnings to another Bit Five member" /><label className="field-label">Recipient wallet<input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x…" /></label><label className="field-label">Amount in USDT<input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></label><p className="helper-copy">P2P transfers apply the plan's 1% fee.</p><button className="btn primary action-wide" disabled={isPending || !isAddress(recipient) || !Number(amount)} onClick={send}>{isPending ? "Confirm in wallet…" : "Send balance"}</button>{status && <TxStatus status={status} hash={hash} />}</section></div>;
}

function ActivityList({ activity }: { activity: Activity[] }) {
  if (!activity.length) return <p className="empty-state">No transactions to show yet.</p>;
  return <div className="activity-list">{activity.map((item, i) => <a key={`${item.transaction_hash}-${i}`} href={txUrl(item.transaction_hash)} target="_blank" rel="noreferrer" className="activity-row"><span className="activity-mark">{item.event_name === "Registered" ? "＋" : item.event_name === "Activated" ? "▣" : "↗"}</span><span className="activity-info"><b>{eventTitle(item)}</b><small>{new Date(item.block_timestamp).toLocaleString()} · ${short(item.transaction_hash)}</small></span><strong>{item.amount ? `$${Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "View tx"} ↗</strong></a>)}</div>;
}

function AdminPanel({ on, pending, toggle, blockTarget, setBlockTarget, blockTargetValid, targetBlocked, onBlock }: any) {
  return <section className="admin-panel"><div><small>PROTOCOL ADMIN</small><b>B5 claims: <em className={on ? "green" : "amber"}>{on ? "ON" : "OFF"}</em></b></div><button className="btn outline" disabled={pending} onClick={toggle}>Turn {on ? "OFF" : "ON"}</button>{setBlockTarget && <><label>Block or unblock wallet<input value={blockTarget} onChange={e => setBlockTarget(e.target.value)} placeholder="0x…" /></label><button className="btn outline" disabled={pending || !blockTargetValid} onClick={onBlock}>{targetBlocked ? "Unblock wallet" : "Block wallet"}</button></>}</section>;
}

function Stat({ label, value, note, icon }: { label: string; value: string; note: string; icon: string }) { return <section className="stat-card"><span className="stat-icon">{icon}</span><small>{label}</small><b>{value}</b><span className="stat-note">{note}</span></section>; }
function Overview({ label, value, tone }: { label: string; value: string; tone?: string }) { return <div className="overview-row"><span>{label}</span><b className={tone ?? ""}>{value}</b></div>; }
function PageHeading({ title, subtitle }: { title: string; subtitle: string }) { return <div className="page-heading"><h2>{title}</h2><p>{subtitle}</p></div>; }
function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) { return <button className="quick-action" onClick={onClick}><span>{icon}</span><b>{label}</b><i>→</i></button>; }
function Notice({ tone, text }: { tone: "amber" | "green"; text: string }) { return <p className={`notice notice-${tone}`}>{text}</p>; }
function TxStatus({ status, hash }: { status: string; hash?: `0x${string}` }) { return <p className="tx-status">{status} {hash && <a href={txUrl(hash)} target="_blank" rel="noreferrer">View on BscScan ↗</a>}</p>; }
