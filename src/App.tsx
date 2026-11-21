import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, isAddress, maxUint256, parseUnits } from "viem";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useDisconnect, useReadContract, useReadContracts, useSignMessage, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { erc20Abi, protocolAbi } from "./abi";
import { apiBaseUrl, appKit, b5Address, b5TreasuryAddress, contractsConfigured, explorerUrl, protocolAddress, principalWithdrawalMode, targetChainId, targetNetworkName, usdtAddress, zeroAddress } from "./config";

const packages = [{ name: "Basic", price: 50, rate: 1.5, days: 134 }, { name: "Standard", price: 100, rate: 1.6, days: 125 }, { name: "Business", price: 500, rate: 1.7, days: 188 }, { name: "VIP", price: 1000, rate: 1.8, days: 112 }, { name: "Luxury", price: 2500, rate: 2, days: 100 }] as const;
const ranks = [5_000, 15_000, 35_000, 80_000, 200_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];
type Page = "dashboard" | "register" | "team" | "genealogy" | "topup" | "withdraw" | "referral" | "income" | "rank" | "transactions" | "tokenHistory" | "reports" | "notifications" | "support" | "settings";
type Activity = { event_name: string; amount: string | null; metadata?: { packageId?: number | string;[key: string]: unknown }; transaction_hash: string; block_timestamp: string };
type IncomeCategory = "staking" | "direct" | "level" | "booster" | "rank";
type TeamMember = { member_code: string; full_name?: string | null; wallet_address: string; sponsor_address: string | null; package_id: number | null; activated_at: string | null; depth: number };
const money = (v?: bigint) => Number(formatUnits(v ?? 0n, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (a?: string) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const txUrl = (h?: string) => `${explorerUrl}/tx/${h}`;
const memberIdKey = (value: string) => value.trim().toLowerCase().replace(/^bit\s*five/i, "b5").replace(/[^a-z0-9]/g, "");
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
  { key: "direct", label: "Sponsor income" },
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
  return ({ Registered: "Joined the network", Activated: "Package purchased", YieldClaimed: "Staking ROI credited", EarningsWithdrawn: "USDT withdrawal", PrincipalWithdrawn: "Principal withdrawal", PrincipalPositionWithdrawn: "Principal withdrawal", B5Claimed: "B5 claimed", UserBlockChanged: "Account status changed" }[name] ?? name.replace(/([A-Z])/g, " $1").trim());
};

export default function App() {
  const [page, setPage] = useState<Page>(() => new URLSearchParams(window.location.search).has("ref") ? "register" : "dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selected, setSelected] = useState(1);
  const [packageAction, setPackageAction] = useState<"approval" | "purchase" | null>(null);
  const [purchasePackageId, setPurchasePackageId] = useState<number | null>(null);
  const [registrationTxHash, setRegistrationTxHash] = useState<`0x${string}`>();
  const [registrationConfirmed, setRegistrationConfirmed] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [contactConsent, setContactConsent] = useState(false);
  const [contactSaveStatus, setContactSaveStatus] = useState<"idle" | "signing" | "saving" | "saved" | "error">("idle");
  const [contactSaveMessage, setContactSaveMessage] = useState("");
  const [memberCode, setMemberCode] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileNameLoadStatus, setProfileNameLoadStatus] = useState<"idle" | "signing" | "loading" | "error">("idle");
  const [profileNameLoadMessage, setProfileNameLoadMessage] = useState("");
  const contactSaveAttempt = useRef<string>("");
  const [sponsor, setSponsor] = useState(() => new URLSearchParams(window.location.search).get("ref") ?? new URLSearchParams(window.location.search).get("sponsor") ?? "");
  const [copied, setCopied] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState("");
  const [logoutPending, setLogoutPending] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("10");
  const [blockTarget, setBlockTarget] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activityStatus, setActivityStatus] = useState("Loading recent activity…");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamStatus, setTeamStatus] = useState("Loading your team…");
  const [teamNamesLoaded, setTeamNamesLoaded] = useState(false);
  const [teamNamesLoading, setTeamNamesLoading] = useState(false);
  const [teamNamesError, setTeamNamesError] = useState("");
  const activeWalletRef = useRef("");

  const { address, isConnected, chainId } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { open } = useAppKit();
  const { switchChain } = useSwitchChain();
  const { data: hash, writeContract, writeContractAsync, isPending, error } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
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
  const b5PositionReads = useReadContracts({ contracts: Array.from({ length: Math.min(Number(positionCount.data ?? 0n), 20) }, (_, index) => ({ abi: protocolAbi, address: protocolAddress, functionName: "positionAt" as const, args: [user, BigInt(index)] as const })), query: { enabled: enabled && (positionCount.data ?? 0n) > 0n, refetchInterval: 12000 } });
  const b5Positions = useMemo(() => (b5PositionReads.data ?? []).flatMap((entry, index) => {
    if (entry.status !== "success") return [];
    const value = entry.result as any;
    const field = (name: string, slot: number) => value?.[name] ?? value?.[slot];
    const activatedAt = BigInt(field("activatedAt", 1) ?? 0n);
    return [{ index, packageId: Number(field("packageId", 0) ?? 0), principal: BigInt(field("principal", 4) ?? 0n), principalWithdrawn: Boolean(field("principalWithdrawn", 6)), boosterPaid: Boolean(field("boosterPaid", 7)), b5Claimed: Boolean(field("b5Claimed", 8)), activatedAt, principalDeadline: activatedAt + 15n * 24n * 60n * 60n, unlockAt: activatedAt + 180n * 24n * 60n * 60n }];
  }), [b5PositionReads.data]);
  const b5Outstanding = b5Positions.reduce((sum, item) => sum + (!item.principalWithdrawn && !item.b5Claimed ? item.principal : 0n), 0n);
  const b5Claimable = b5Positions.reduce((sum, item) => sum + (!item.principalWithdrawn && !item.b5Claimed && BigInt(Math.floor(Date.now() / 1000)) >= item.unlockAt ? item.principal : 0n), 0n);
  const nextB5UnlockAt = b5Positions.filter(item => !item.principalWithdrawn && !item.b5Claimed).reduce<bigint | undefined>((earliest, item) => earliest === undefined || item.unlockAt < earliest ? item.unlockAt : earliest, undefined);
  const position = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "positions", args: [user], query });
  const earnings = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "earningsBalance", args: [user], query });
  const pendingYield = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "pendingYield", args: [user], query });
  const directs = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "directCount", args: [user], query });
  const volume = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "teamVolume", args: [user], query });
  const businessVolume = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "teamBusinessVolume", args: [user], query });
  const strongestBranch = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "strongestBranch", args: [user], query });
  const strongBusinessVolume = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "branchBusinessVolume", args: [user, strongestBranch.data ?? zeroAddress], query: { ...query, enabled: enabled && !!strongestBranch.data && strongestBranch.data !== zeroAddress } });
  const weakBusinessVolume = (businessVolume.data ?? 0n) > (strongBusinessVolume.data ?? 0n) ? (businessVolume.data ?? 0n) - (strongBusinessVolume.data ?? 0n) : 0n;
  const workingIncome = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "workingIncomeCredited", args: [user], query });
  const totalRoiCredited = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "totalRoiCredited", args: [user], query });
  const totalPrincipal = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "totalPrincipal", args: [user], query });
  const totalIncome = (workingIncome.data ?? 0n) + (totalRoiCredited.data ?? 0n);
  const leadership = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "leadershipRank", args: [user], query });
  const b5Open = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "b5WithdrawEnabled", query });
  const owner = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "owner", query });
  const userBlocked = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "blocked", args: [user], query: { ...query, refetchInterval: 5000 } });
  const canWithdrawPrincipal = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "canWithdrawPrincipal", args: [user], query });
  const principalEligibilityReads = useReadContracts({ contracts: principalWithdrawalMode === "individual" ? b5Positions.map(position => ({ abi: protocolAbi, address: protocolAddress, functionName: "canWithdrawPrincipalAt" as const, args: [user, BigInt(position.index)] as const })) : [], query: { enabled: enabled && page === "withdraw" && principalWithdrawalMode === "individual" && b5Positions.length > 0, refetchInterval: 12000 } });
  const individualPrincipalEligibility = (principalEligibilityReads.data ?? []).map(result => result.status === "success" ? Boolean(result.result) : null);
  const usdtBalance = useReadContract({ abi: erc20Abi, address: usdtAddress, functionName: "balanceOf", args: [user], query: { enabled } });
  const allowance = useReadContract({ abi: erc20Abi, address: usdtAddress, functionName: "allowance", args: [user, protocolAddress], query: { enabled } });
  const b5TreasuryAllowance = useReadContract({ abi: erc20Abi, address: b5Address, functionName: "allowance", args: [b5TreasuryAddress, protocolAddress], query: { enabled } });

  useEffect(() => {
    if (packageReceipt.data?.status !== "success") return;
    if (packageAction === "approval") void allowance.refetch();
    if (packageAction === "purchase") void positionCount.refetch();
  }, [packageAction, packageReceipt.data?.status, packageReceipt.data?.transactionHash]);

  const registrationMined = !!registrationTxHash && hash?.toLowerCase() === registrationTxHash.toLowerCase() && receipt.isSuccess && receipt.data?.status === "success";
  const registered = registration.data === true || registrationConfirmed || registrationMined;
  const active = Number(positionCount.data ?? 0n) > 0 || (!!position.data && position.data[1] > 0n);
  const chosen = packages[selected];
  const hasAllowance = (allowance.data ?? 0n) >= parseUnits(String(chosen.price), 18);
  const sponsorAddress = useMemo(() => isAddress(sponsor) ? sponsor : zeroAddress, [sponsor]);
  const rootEstablished = !!rootUser.data && rootUser.data.toLowerCase() !== zeroAddress;
  const registrationAllowed = !rootUser.isLoading && rootUser.data !== undefined && (rootEstablished
    ? isAddress(sponsor) && sponsorAddress !== zeroAddress
    : !sponsor.trim());
  const normalizedPhoneDigits = phoneNumber.replace(/\D/g, "");
  const registrationFormValid = fullName.trim().length >= 2 && fullName.trim().length <= 100
    && /^\+?[0-9().\s-]{7,24}$/.test(phoneNumber.trim()) && normalizedPhoneDigits.length >= 7 && normalizedPhoneDigits.length <= 15
    && contactConsent;

  const saveContactDetails = async (txHash: `0x${string}`, retry = false) => {
    if (!address || !registrationFormValid || (!retry && contactSaveAttempt.current.toLowerCase() === txHash.toLowerCase())) return;
    contactSaveAttempt.current = txHash;
    setContactSaveStatus("signing");
    setContactSaveMessage("");
    try {
      const normalizedName = fullName.trim().replace(/\s+/g, " ");
      const normalizedPhone = phoneNumber.trim();
      const signedMessage = `Bit Five member profile\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${address.toLowerCase()}\nFull name: ${normalizedName}\nPhone: ${normalizedPhone}\nRegistration transaction: ${txHash.toLowerCase()}`;
      const signature = await signMessageAsync({ message: signedMessage });
      setContactSaveStatus("saving");
      const response = await fetch(`${apiBaseUrl}/api/v1/profile/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, fullName: normalizedName, phoneNumber: normalizedPhone, transactionHash: txHash, consent: true, signature })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save your contact details.");
      if (typeof payload.memberCode === "string") setMemberCode(payload.memberCode);
      setProfileDisplayName(normalizedName);
      try { localStorage.setItem(`bit5-profile-name:${targetChainId}:${protocolAddress.toLowerCase()}:${address.toLowerCase()}`, normalizedName); } catch { /* The saved API profile remains the source of truth. */ }
      setContactSaveStatus("saved");
      setContactSaveMessage("Your name and phone number were saved to your member profile.");
    } catch (error) {
      contactSaveAttempt.current = "";
      setContactSaveStatus("error");
      setContactSaveMessage(error instanceof Error ? error.message : "Could not save your contact details. Please retry.");
    }
  };
  useEffect(() => {
    if (registered && registrationTxHash && contactSaveStatus === "idle" && registrationFormValid) void saveContactDetails(registrationTxHash);
  }, [registered, registrationTxHash, contactSaveStatus, registrationFormValid]);
  const loadProfileName = async () => {
    if (!address) return;
    setProfileNameLoadStatus("signing");
    setProfileNameLoadMessage("");
    try {
      const signedMessage = `Bit Five profile name lookup\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${address.toLowerCase()}`;
      const signature = await signMessageAsync({ message: signedMessage });
      setProfileNameLoadStatus("loading");
      const response = await fetch(`${apiBaseUrl}/api/v1/profile/name`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, signature }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load your profile name.");
      if (typeof payload.memberCode === "string") setMemberCode(payload.memberCode);
      if (typeof payload.fullName !== "string" || !payload.fullName.trim()) throw new Error("No saved name is available for this wallet yet.");
      setProfileDisplayName(payload.fullName);
      setFullName(payload.fullName);
      setPhoneNumber(typeof payload.phoneNumber === "string" ? payload.phoneNumber : "");
      try { localStorage.setItem(`bit5-profile-name:${targetChainId}:${protocolAddress.toLowerCase()}:${address.toLowerCase()}`, payload.fullName); } catch { /* The authenticated API lookup still succeeded. */ }
      setProfileNameLoadStatus("idle");
    } catch (error) {
      setProfileNameLoadStatus("error");
      setProfileNameLoadMessage(error instanceof Error ? error.message : "Could not load your profile name.");
    }
  };

  useEffect(() => {
    if (!address || profileDisplayName) return;
    try {
      const cached = localStorage.getItem(`bit5-profile-name:${targetChainId}:${protocolAddress.toLowerCase()}:${address.toLowerCase()}`);
      if (cached) setProfileDisplayName(cached);
    } catch { /* Name is loaded from the API instead. */ }
  }, [address, profileDisplayName]);

  // Refresh registration as soon as its transaction is mined instead of waiting
  // for the regular dashboard polling interval before leaving the registration page.
  useEffect(() => {
    if (!address || !receipt.isSuccess || receipt.data?.status !== "success") return;
    if (!registrationTxHash || hash?.toLowerCase() !== registrationTxHash.toLowerCase()) return;
    setRegistrationConfirmed(true);
    setPage("dashboard");
    setMobileOpen(false);
    void registration.refetch();
    void accountSponsor.refetch();
    void rootUser.refetch();
  }, [address, hash, registrationTxHash, receipt.isSuccess, receipt.data?.status, receipt.data?.transactionHash]);
  useEffect(() => {
    if (registration.data === true && registrationConfirmed) setRegistrationConfirmed(false);
  }, [registration.data, registrationConfirmed]);
  useEffect(() => {
    if (!receipt.isSuccess || receipt.data?.status !== "success") return;
    void pendingYield.refetch();
    void earnings.refetch();
  }, [receipt.isSuccess, receipt.data?.status, receipt.data?.transactionHash]);
  const effectiveSponsor = registered ? accountSponsor.data ?? zeroAddress : sponsorAddress;
  const isOwner = !!address && address.toLowerCase() === owner.data?.toLowerCase();
  const principalWindowOpen = active && !!canWithdrawPrincipal.data;
  const withdrawBase = useMemo(() => {
    try { return parseUnits(withdrawAmount || "0", 18); } catch { return 0n; }
  }, [withdrawAmount]);
  const b5FeeForWithdrawal = withdrawBase * 500n / 10_000n;
  const enoughB5FeeAllowance = (b5TreasuryAllowance.data ?? 0n) >= b5FeeForWithdrawal;
  const normalizedBlockId = memberIdKey(blockTarget);
  const rawBlockIdNumber = /^\d{3,}$/.test(blockTarget.trim()) ? blockTarget.trim() : "";
  const blockTargetMember = team.find(member => memberIdKey(member.member_code) === normalizedBlockId || (rawBlockIdNumber && member.member_code.match(/(\d+)$/)?.[1] === rawBlockIdNumber));
  const blockTargetAddress = isAddress(blockTarget) ? blockTarget : blockTargetMember?.wallet_address ?? "";
  const blockTargetValid = isAddress(blockTargetAddress);
  const blockTargetLookupReady = !teamStatus.toLowerCase().includes("loading") && !teamStatus.toLowerCase().includes("syncing");
  const targetBlocked = useReadContract({ abi: protocolAbi, address: protocolAddress, functionName: "blocked", args: [blockTargetValid ? blockTargetAddress as `0x${string}` : zeroAddress], query: { enabled: isOwner && blockTargetValid, refetchInterval: 12000 } });
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
    activeWalletRef.current = address?.toLowerCase() ?? "";
    setTeam([]); setTeamStatus("Loading your team…");
    setTeamNamesLoaded(false); setTeamNamesLoading(false); setTeamNamesError("");
  }, [address]);

  useEffect(() => {
    if (!address) return;
    setMemberCode("");
    let rememberedName = "";
    try { rememberedName = localStorage.getItem(`bit5-profile-name:${targetChainId}:${protocolAddress.toLowerCase()}:${address.toLowerCase()}`) ?? ""; } catch { /* Ignore unavailable browser storage. */ }
    setProfileDisplayName(rememberedName ?? "");
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/api/v1/users/${address}/dashboard`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setActivity(d.activity ?? []); setMemberCode(d.profile?.member_code ?? ""); setActivityStatus(d.activity?.length ? "Latest on-chain events indexed from BSC Mainnet." : "No transactions yet."); })
      .catch(() => !controller.signal.aborted && setActivityStatus("The activity indexer is syncing."));
    fetch(`${apiBaseUrl}/api/v1/users/${address}/team`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setTeam(d.members ?? []); setTeamStatus(`${d.directCount ?? 0} direct members · ${d.teamCount ?? 0} total team members`); })
      .catch(() => !controller.signal.aborted && setTeamStatus("Team data is syncing from the chain."));
    return () => controller.abort();
  }, [address, receipt.isSuccess, packageReceipt.data?.transactionHash]);

  useEffect(() => {
    if (isConnected && registration.data === false && !registered) setPage("register");
    if (isConnected && registered && page === "register") setPage("dashboard");
  }, [isConnected, registration.data, registrationConfirmed, registered, page]);

  const loadTeamNames = async () => {
    if (!address || teamNamesLoading || teamNamesLoaded) return;
    setTeamNamesLoading(true); setTeamNamesError("");
    try {
      const issuedAt = Math.floor(Date.now() / 1000);
      const wallet = address.toLowerCase();
      const message = `Bit Five team names\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${wallet}\nIssued at: ${issuedAt}`;
      const signature = await signMessageAsync({ message });
      const response = await fetch(`${apiBaseUrl}/api/v1/team/names`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: wallet, signature, issuedAt }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load member names.");
      if (activeWalletRef.current !== wallet) return;
      const nameByWallet = new Map<string, string | null>((payload.members ?? []).map((member: TeamMember) => [member.wallet_address.toLowerCase(), member.full_name ?? null]));
      setTeam(current => current.map(member => ({ ...member, full_name: nameByWallet.get(member.wallet_address.toLowerCase()) ?? null })));
      setTeamNamesLoaded(true);
    } catch (cause) {
      setTeamNamesError(cause instanceof Error ? cause.message : "Could not load member names.");
    } finally { if (activeWalletRef.current === address.toLowerCase()) setTeamNamesLoading(false); }
  };
  useEffect(() => {
    if (!registered || page !== "team" || !team.length || teamNamesLoaded || teamNamesLoading || teamNamesError) return;
    void loadTeamNames();
  }, [registered, page, team.length, teamNamesLoaded, teamNamesLoading, teamNamesError]);
  const connect = () => { setLogoutMessage(""); setLogoutPending(false); open({ view: "Connect", namespace: "eip155" }); };
  const logoutWallet = async () => {
    setMobileOpen(false);
    setLogoutPending(true);
    setLogoutMessage("");
    let disconnected = false;
    try { await appKit.disconnect("eip155"); disconnected = true; } catch { /* The session may already be disconnected. */ }
    try { await disconnectAsync(); disconnected = true; } catch { /* Clear the Wagmi connector even if AppKit has already cleared it. */ }
    setLogoutPending(false);
    setLogoutMessage(disconnected || !isConnected
      ? "Wallet disconnected. You are logged out of the Bit Five portal."
      : "Wallet could not be disconnected. Please disconnect Bit Five from your wallet app, then reconnect here.");
  };
  const go = (next: Page) => {
    setPage(!registered && next !== "register" ? "register" : next);
    setMobileOpen(false);
  };
  const claim = (name: "claimYield" | "withdrawPrincipal" | "claimB5") => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: name });
  const admin = () => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "setB5WithdrawEnabled", args: [!b5Open.data] });
  const toggleBlocked = () => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "setBlocked", args: [blockTargetAddress as `0x${string}`, !targetBlocked.data] });

  if (!isConnected) return <Login connect={connect} logout={logoutWallet} logoutPending={logoutPending} logoutMessage={logoutMessage} />;
  if (userBlocked.data === true && owner.data !== undefined && !isOwner) return <BlockedAccount address={address} disconnect={logoutWallet} />;

  const pageTitles: Record<Page, string> = { dashboard: "Dashboard", register: "Create Account", team: "Team List", genealogy: "10-Level Team", topup: "Deposit USDT", withdraw: "Withdrawal", referral: "Referral Center", income: "Income Ledger", rank: "My Rank", transactions: "Transaction History", tokenHistory: "Token History", reports: "Reports & Statements", notifications: "Notifications", support: "Support Desk", settings: "Account Settings" };
  const navItems: { key: Page; icon: string; label: string; badge?: string }[] = [
    { key: "dashboard", icon: "▦", label: "Dashboard" },
    { key: "topup", icon: "⊕", label: "Deposit USDT", badge: "1.5–2% ROI" },
    { key: "withdraw", icon: "↗", label: "Withdrawal" },
    { key: "referral", icon: "♧", label: "Referral Center", badge: "5%" },
    { key: "team", icon: "♙", label: "Team List" },
    { key: "genealogy", icon: "♧", label: "10-Level Team" },
    { key: "income", icon: "$", label: "Income Ledger" },
    { key: "tokenHistory", icon: "◈", label: "Token History" },
    { key: "reports", icon: "▤", label: "Reports & Statements" },
    { key: "notifications", icon: "♧", label: "Notifications" },
    { key: "support", icon: "?", label: "Support Desk" },
    { key: "settings", icon: "⚙", label: "Account Settings" },
    { key: "rank", icon: "◇", label: "My Rank" },
    { key: "transactions", icon: "◷", label: "Transaction History" },
  ];

  return <div className="member-layout">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
    <aside className={`member-sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <button className="member-brand" onClick={() => go("dashboard")}><img src="/brand.jpeg" alt="" /><span><b>BIT FIVE</b><small>MEMBER PANEL</small></span><i className="sidebar-close" onClick={e => { e.stopPropagation(); setMobileOpen(false); }}>×</i></button>
      <small className="menu-caption">MAIN MENU</small>
      {!registered && <button className={`member-nav ${page === "register" ? "selected" : ""}`} onClick={() => go("register")}><i>＋</i><span>Register</span></button>}
      {registered && navItems.map(item => <button key={item.key} className={`member-nav ${page === item.key ? "selected" : ""}`} onClick={() => go(item.key)}><i>{item.icon}</i><span>{item.label}</span>{item.badge && <b className="nav-badge">{item.badge}</b>}</button>)}
      <div className="sidebar-bottom"><small>BSC MAINNET · CHAIN 56</small><a href={`${explorerUrl}/address/${protocolAddress}`} target="_blank" rel="noreferrer">View protocol on BscScan ↗</a><button className="sidebar-logout" onClick={() => void logoutWallet()} disabled={logoutPending}><i>↪</i><span>{logoutPending ? "Logging out…" : "Log out"}</span></button></div>
    </aside>

    <div className="member-workspace">
      <header className="member-topbar"><div className="topbar-left"><button className="menu-trigger" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button><div><small>BIT FIVE / MEMBER AREA</small><h1>{pageTitles[page]}</h1></div></div><div className="topbar-right"><span className="chain-chip">● BNB Smart Chain</span><button className="address-pill" onClick={() => void logoutWallet()} title="Disconnect wallet">{short(address)} <small>Disconnect</small></button></div></header>
      {chainId !== targetChainId && <div className="chain-warning">Wrong network. <button onClick={() => switchChain({ chainId: targetChainId })}>Switch to BNB Smart Chain</button></div>}
      <main className="member-content">
        {!contractsConfigured && <Notice tone="amber" text="Mainnet contract settings are missing from this build." />}
        {page === "register" && <RegisterPage address={address} sponsor={sponsor} rootEstablished={rootEstablished} rootLoading={rootUser.isLoading || rootUser.data === undefined} registrationAllowed={registrationAllowed} fullName={fullName} setFullName={setFullName} phoneNumber={phoneNumber} setPhoneNumber={setPhoneNumber} contactConsent={contactConsent} setContactConsent={setContactConsent} formValid={registrationFormValid} isPending={isPending} isWaitingForConfirmation={!!registrationTxHash && hash?.toLowerCase() === registrationTxHash.toLowerCase() && !receipt.isSuccess} status={status} hash={hash} write={() => { setRegistrationConfirmed(false); setRegistrationTxHash(undefined); setContactSaveStatus("idle"); contactSaveAttempt.current = ""; void writeContractAsync({ abi: protocolAbi, address: protocolAddress, functionName: "register", args: [sponsorAddress] }).then(setRegistrationTxHash).catch(() => undefined); }} />}
        {registered && page === "dashboard" && <Dashboard address={address} memberCode={memberCode} profileDisplayName={profileDisplayName} profileNameLoadStatus={profileNameLoadStatus} profileNameLoadMessage={profileNameLoadMessage} loadProfileName={loadProfileName} signMessageAsync={signMessageAsync} active={active} count={Number(positionCount.data ?? 0n)} earnings={earnings.data} pendingYield={pendingYield.data} allocation={b5Outstanding} b5Positions={b5Positions} b5Claimable={b5Claimable} b5Allowance={b5TreasuryAllowance.data} directs={directs.data} volume={volume.data} businessVolume={businessVolume.data} strongBusinessVolume={strongBusinessVolume.data} weakBusinessVolume={weakBusinessVolume} totalIncome={totalIncome} totalPrincipal={totalPrincipal.data ?? 0n} workingIncomeCredited={workingIncome.data ?? 0n} roiCredited={totalRoiCredited.data ?? 0n} leadership={leadership.data} b5Open={!!b5Open.data} unlockAt={nextB5UnlockAt} activity={activity} go={go} copied={copied} onCopy={() => { void navigator.clipboard.writeText(`${window.location.origin}/?ref=${address}`).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }); }} claim={() => claim("claimYield")} claimB5={() => claim("claimB5")} isPending={isPending} receiptPending={receipt.isLoading} status={status} hash={hash} isOwner={isOwner} admin={admin} blockTarget={blockTarget} setBlockTarget={setBlockTarget} blockTargetValid={blockTargetValid} blockTargetAddress={blockTargetAddress} blockTargetMember={blockTargetMember} blockTargetNotFound={!!blockTarget.trim() && !isAddress(blockTarget) && !blockTargetMember && blockTargetLookupReady} targetBlocked={!!targetBlocked.data} onBlock={toggleBlocked} contactSaveStatus={contactSaveStatus} contactSaveMessage={contactSaveMessage} hasPendingContactSave={!!registrationTxHash && contactSaveStatus === "idle"} saveContactDetails={() => registrationTxHash && void saveContactDetails(registrationTxHash, true)} retryContactSave={() => registrationTxHash && void saveContactDetails(registrationTxHash, true)} />}
        {registered && page === "team" && <TeamPage title="Team List" subtitle={teamStatus} members={team.filter(m => Number(m.depth) === 0)} rootAddress={address} namesLoaded={teamNamesLoaded} namesLoading={teamNamesLoading} namesError={teamNamesError} loadNames={loadTeamNames} />}
        {registered && page === "genealogy" && <TeamPage title="Your Genealogy" subtitle={teamStatus} members={team} rootAddress={address} genealogy />}
        {registered && page === "referral" && <ReferralCenter address={address} memberCode={memberCode} sponsor={effectiveSponsor} team={team} active={active} copied={copied} onCopy={() => { if (!active) return; void navigator.clipboard.writeText(`${window.location.origin}/?ref=${address}`).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }); }} />}
        {registered && page === "topup" && <TopupPage packages={packages} selected={selected} setSelected={setSelected} chosen={chosen} count={Number(positionCount.data ?? 0n)} balance={usdtBalance.data} hasAllowance={hasAllowance} isPending={packageTx.isPending} receiptPending={packageReceipt.isLoading} action={packageAction} receiptStatus={packageReceipt.data?.status} receiptError={packageReceipt.isError ? (packageReceipt.error as any)?.shortMessage ?? packageReceipt.error?.message : ""} walletError={packageTx.error ? (packageTx.error as any)?.shortMessage ?? packageTx.error.message : ""} hash={packageTx.data} purchasePackageId={purchasePackageId} approve={startUsdtApproval} purchase={startPackagePurchase} resetFlow={resetPackageFlow} goDashboard={() => go("dashboard")} />}
        {registered && page === "withdraw" && <WithdrawPage earnings={earnings.data} pendingYield={pendingYield.data} amount={withdrawAmount} setAmount={setWithdrawAmount} allowance={b5TreasuryAllowance.data} enoughAllowance={enoughB5FeeAllowance} active={active} isPending={isPending} withdraw={() => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "withdrawEarnings", args: [withdrawBase] })} allocation={b5Outstanding} b5Positions={b5Positions} b5Claimable={b5Claimable} b5Allowance={b5TreasuryAllowance.data} unlockAt={nextB5UnlockAt} b5Open={!!b5Open.data} claimB5={() => claim("claimB5")} canWithdrawPrincipal={!!canWithdrawPrincipal.data} individualWithdrawals={principalWithdrawalMode === "individual"} individualEligibility={individualPrincipalEligibility} withdrawPrincipalAt={(index: number) => writeContract({ abi: protocolAbi, address: protocolAddress, functionName: "withdrawPrincipalAt", args: [BigInt(index)] })} withdrawPrincipal={() => claim("withdrawPrincipal")} status={status} hash={hash} isOwner={isOwner} admin={admin} />}
        {registered && page === "income" && <IncomePage address={address!} earnings={earnings.data} pendingYield={pendingYield.data} activityStatus={activityStatus} />}
        {registered && page === "rank" && <RankPage rank={Number(leadership.data ?? 0)} volume={volume.data} directs={directs.data} />}
        {registered && page === "transactions" && <TransactionsPage activity={activity} activityStatus={activityStatus} />}
        {registered && page === "tokenHistory" && <TokenHistoryPage activity={activity} activityStatus={activityStatus} />}
        {registered && page === "reports" && <ReportsStatementsPage activity={activity} activityStatus={activityStatus} />}
        {registered && page === "notifications" && <NotificationsPage address={address!} activity={activity} activityStatus={activityStatus} />}
        {registered && page === "support" && <SupportDeskPage address={address!} isOwner={isOwner} />}
        {registered && page === "settings" && <AccountSettingsPage address={address!} memberCode={memberCode} fullName={profileDisplayName || fullName} phoneNumber={phoneNumber} setFullName={setFullName} setPhoneNumber={setPhoneNumber} loadProfileName={loadProfileName} onSaved={(name: string) => { setProfileDisplayName(name); try { localStorage.setItem(`bit5-profile-name:${targetChainId}:${protocolAddress.toLowerCase()}:${address!.toLowerCase()}`, name); } catch { /* Keep the API as source of truth. */ } }} />}
      </main>
    </div>
    {registered && <nav className="mobile-tabbar" aria-label="Main navigation"><button className={page === "dashboard" ? "active" : ""} onClick={() => go("dashboard")}><i>⌂</i><span>Home</span></button><button className={page === "topup" || page === "withdraw" ? "active" : ""} onClick={() => go("topup")}><i>↓</i><span>Invest</span></button><button className={page === "team" || page === "genealogy" || page === "referral" ? "active" : ""} onClick={() => go("genealogy")}><i>♧</i><span>Team</span></button><button className={page === "income" ? "active" : ""} onClick={() => go("income")}><i>$</i><span>Income</span></button><button className={mobileOpen ? "active" : ""} onClick={() => setMobileOpen(value => !value)}><i>•••</i><span>More</span></button></nav>}
  </div>;
}

function Login({ connect, logout, logoutPending, logoutMessage }: { connect: () => void; logout: () => void; logoutPending: boolean; logoutMessage: string }) {
  const logoutSuccess = logoutMessage.startsWith("Wallet disconnected.");
  return <div className="auth-shell"><header className="auth-brand"><img src="/brand.jpeg" alt="Bit Five" /><span><b>BIT FIVE</b><small>BNB SMART CHAIN MAINNET</small></span></header><section className="auth-card"><div className="auth-mark auth-logo"><img src="/Logo.jpeg" alt="Bit Five logo" /></div><small className="auth-eyebrow">MEMBER ACCESS</small><h1>{logoutSuccess ? "Wallet disconnected" : "Connect your wallet"}</h1><p>{logoutSuccess ? "You are signed out of the Bit Five member portal." : "Sign in to your Bit Five member panel using your BNB Smart Chain wallet."}</p><div className="auth-actions"><button className="btn primary auth-connect" onClick={connect}>◈ &nbsp; Connect Wallet</button>{!logoutSuccess && <button className="btn outline auth-connect" onClick={logout} disabled={logoutPending}>{logoutPending ? "Disconnecting wallet…" : "↪  Logout Wallet"}</button>}</div>{logoutMessage && <p className={logoutSuccess ? "logout-confirmation" : "logout-failure"} role="status">{logoutSuccess && <b>✓ Logout complete</b>}<span>{logoutMessage}</span></p>}<div className="auth-points"><span>Wallet-signed transactions</span><span>Referral registration on-chain</span><span>BNB Smart Chain · Chain 56</span></div></section><p className="auth-footer">BIT FIVE · Member portal</p></div>;
}

function BlockedAccount({ address, disconnect }: { address?: `0x${string}`; disconnect: () => void }) {
  return <div className="auth-shell"><header className="auth-brand"><img src="/brand.jpeg" alt="Bit Five" /><span><b>BIT FIVE</b><small>BNB SMART CHAIN MAINNET</small></span></header><section className="auth-card"><div className="auth-mark">!</div><small className="auth-eyebrow">ACCOUNT RESTRICTED</small><h1>This account is blocked</h1><p>This wallet is blocked by the Bit Five protocol. Member pages and actions are unavailable for this account.</p><div className="auth-points"><span>Connected wallet: {short(address)}</span><span>Contact the protocol administrator if you believe this is an error.</span><span>On-chain data remains publicly viewable.</span></div><a className="btn outline auth-connect" href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer">View wallet on BscScan ↗</a><button className="btn primary auth-connect" onClick={disconnect}>Disconnect wallet</button></section><p className="auth-footer">BIT FIVE · Member portal</p></div>;
}

function RegisterPage({ address, sponsor, rootEstablished, rootLoading, registrationAllowed, fullName, setFullName, phoneNumber, setPhoneNumber, contactConsent, setContactConsent, formValid, isPending, isWaitingForConfirmation, status, hash, write }: { address?: `0x${string}`; sponsor: string; rootEstablished: boolean; rootLoading: boolean; registrationAllowed: boolean; fullName: string; setFullName: (value: string) => void; phoneNumber: string; setPhoneNumber: (value: string) => void; contactConsent: boolean; setContactConsent: (value: boolean) => void; formValid: boolean; isPending: boolean; isWaitingForConfirmation: boolean; status: string; hash?: `0x${string}`; write: () => void }) {
  const sponsorValid = isAddress(sponsor) && sponsor.toLowerCase() !== zeroAddress;
  return <section className="content-card narrow-card"><PageHeading title="Join Bit Five" subtitle="Create your member profile and register on BNB Smart Chain." /><div className="join-steps"><span className="step-current">01 <b>Connect wallet</b></span><i>→</i><span>02 <b>Register</b></span><i>→</i><span>03 <b>Choose package</b></span></div><div className="wallet-confirm"><span className="status-dot" /> Wallet connected <b>{short(address)}</b></div><label className="field-label">Full name<input autoComplete="name" maxLength={100} value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Enter your name" /></label><label className="field-label">Phone number<input type="tel" autoComplete="tel" inputMode="tel" maxLength={24} value={phoneNumber} onChange={event => setPhoneNumber(event.target.value)} placeholder="e.g. +1 234 567 890" /></label>{rootEstablished ? <label className="field-label">Sponsor / referral ID <small>Open your sponsor’s referral link. Registration without a registered sponsor is blocked by the contract.</small><input readOnly value={sponsor} placeholder="Open a referral link to continue" /></label> : <div className="notice notice-green">{rootLoading ? "Checking whether the network root is set…" : "First account: this wallet will become the network root. No sponsor is required."}</div>}{rootEstablished && !sponsorValid && !rootLoading && <Notice tone="amber" text="A valid sponsor referral link is required before registration." />}<div className="profile-consent"><label><input type="checkbox" checked={contactConsent} onChange={event => setContactConsent(event.target.checked)} /><span>I agree that Bit Five stores my name and phone number in its member database for account support. These details are not written to the blockchain.</span></label></div><p className="helper-copy">Your wallet and sponsor are recorded on-chain. Name and phone are stored privately in the project database after this registration is confirmed.</p><button className="btn primary action-wide" disabled={isPending || isWaitingForConfirmation || !registrationAllowed || rootLoading || !formValid} onClick={write}>{isPending ? "Confirm in wallet…" : isWaitingForConfirmation ? "Waiting for BSC confirmation…" : "Create account on-chain →"}</button>{status && <TxStatus status={isWaitingForConfirmation ? "Transaction submitted · waiting for BSC confirmation…" : status} hash={hash} />}</section>;
}

function IncomeCapsCard({ principal = 0n, working = 0n, roi = 0n }: { principal?: bigint; working?: bigint; roi?: bigint }) {
  const totalCap = principal * 3n, roiCap = principal * 2n, used = working + roi;
  const limitsActive = principal > 0n;
  const pct = (v: bigint, cap: bigint) => cap === 0n ? 0 : Math.min(100, Number((v * 10000n) / cap) / 100);
  const remaining = totalCap > used ? totalCap - used : 0n;
  const usedPct = pct(used, totalCap), roiPct = pct(roi, roiCap), full = totalCap > 0n && used >= totalCap;
  const rows = [
    { label: "Total income", value: used, cap: totalCap, p: usedPct, cls: "working-cap-bar" },
    { label: "Non-working ROI", value: roi, cap: roiCap, p: roiPct, cls: "roi-cap-bar" },
  ];
  return <section className="content-card income-caps-card"><PageHeading title="Income limits" subtitle={limitsActive ? "Your live progress against the V11 contract limits" : "Available after your first package is confirmed on-chain"} />
    {!limitsActive ? <div className="income-caps-locked"><span>◌</span><div><b>Income limits are not active yet</b><p>Activate a package from Invest. Working and non-working income limits will appear after its BSC confirmation.</p></div></div> : <>
    <div className="income-cap-chart" role="img" aria-label={`Income used ${money(used)} of ${money(totalCap)} USDT cap`}>
      <div className="income-cap-chart-title"><b>{`${usedPct.toFixed(1)}% of cap used`}</b><span>Principal ${money(principal)}</span></div>
      {rows.map(r => <div className="income-cap-bar-row live" key={r.label}><span>{r.label}</span><div className="income-cap-track"><i className={r.cls} style={{ width: `${r.p}%` }} /></div><b>{`${r.p.toFixed(0)}%`}</b></div>)}
    </div>
    <div className="income-cap-grid">
      <div><small>TOTAL CAP (3×)</small><b>${money(totalCap)}</b><span>Used ${money(used)}</span></div>
      <div><small>REMAINING</small><b>${money(remaining)}</b><span>{full ? "Cap reached — new package needed to earn more" : "Still earnable"}</span></div>
      <div><small>ROI CREDITED (2× cap)</small><b>${money(roi)}</b><span>of ${money(roiCap)}</span></div>
      <div><small>WORKING INCOME</small><b>${money(working)}</b><span>Level, rank &amp; booster</span></div>
    </div>
    <p className="income-cap-note">ROI and working income are not additive: together they are capped at 3× total package principal.</p></>}</section>;
}
function Dashboard({ address, memberCode, profileDisplayName, profileNameLoadStatus, profileNameLoadMessage, loadProfileName, signMessageAsync, active, count, earnings, pendingYield, allocation, b5Positions, b5Claimable, b5Allowance, directs, volume, businessVolume, strongBusinessVolume, weakBusinessVolume, totalIncome, totalPrincipal, workingIncomeCredited, roiCredited, leadership, b5Open, unlockAt, activity, go, copied, onCopy, claim, claimB5, isPending, receiptPending, status, hash, isOwner, admin, blockTarget, setBlockTarget, blockTargetValid, blockTargetAddress, blockTargetMember, blockTargetNotFound, targetBlocked, onBlock, contactSaveStatus, contactSaveMessage, hasPendingContactSave, saveContactDetails, retryContactSave }: any) {
  const activePool = (b5Positions ?? []).reduce((sum: bigint, position: any) => sum + BigInt(position.principal ?? 0n), 0n);
  return <div className="page-stack dashboard-page">
    <section className="balance-actions-card"><div className="balance-actions-heading"><div><div className="balance-member-identity"><small>LIVE ACCOUNT LEDGER</small><span>ID: {memberCode || "Assigning ID…"}</span>{profileDisplayName ? <b>{profileDisplayName}</b> : <button className="profile-name-action" onClick={() => go("settings")}>＋ Add your name</button>}</div>{profileNameLoadMessage && <small className="profile-name-error">{profileNameLoadMessage}</small>}<div className="home-balance-main"><small>Available withdrawable balance</small><h2>${money(earnings)} <span>USDT</span></h2></div><div className="home-active-pool"><span>Active pool</span><b>${money(activePool)} USDT</b></div></div><span className="balance-ledger-status">BSC · LIVE</span></div><div className="balance-actions-metrics home-top-metrics"><div><small>Total earnings</small><b>${money(totalIncome)} USDT</b></div><i>•</i><div><small>Pending daily ROI</small><b>${money(pendingYield)} USDT</b></div></div><div className="balance-action-buttons"><button className="btn primary" onClick={() => go("topup")}>＋ &nbsp; Deposit USDT</button><button className="btn outline" onClick={() => go("withdraw")}>↗ &nbsp; Withdraw</button></div></section>
    <section className="content-card referral-panel"><div><span className="mini-icon">↗</span><div><h3>Your referral link</h3><p>{active ? "Share to invite a new member. Their registration and sponsor are recorded on-chain." : "Activate your first package to enable your referral link."}</p></div></div><div className="copy-row"><input readOnly value={active ? `${window.location.origin}/?ref=${address}` : "Referral link inactive until ID activation"} /><button className="btn outline" disabled={!active} onClick={onCopy}>{active ? (copied ? "Copied ✓" : "Copy referral link") : "Activate ID to unlock"}</button></div></section>
    <div className="dashboard-top-token"><B5AllocationPanel positions={b5Positions} total={allocation} claimable={b5Claimable} treasuryAllowance={b5Allowance} claimsEnabled={b5Open} pending={isPending || receiptPending} claim={claimB5} /></div>
    {contactSaveStatus === "idle" && hasPendingContactSave && <div className="notice notice-amber">Registration is confirmed. Sign once with your wallet to save your name and phone number to the member database. This signature does not send a transaction or cost gas. <button className="inline-action" onClick={saveContactDetails}>Sign &amp; save details</button></div>}{contactSaveStatus === "signing" && <div className="notice notice-amber">Confirm the profile signature in your wallet. It does not send a transaction or cost gas.</div>}{contactSaveStatus === "saving" && <div className="notice notice-amber">Saving your member name and phone number…</div>}{contactSaveStatus === "saved" && <div className="notice notice-green">{contactSaveMessage}</div>}{contactSaveStatus === "error" && <div className="notice notice-amber">{contactSaveMessage} <button className="inline-action" onClick={retryContactSave}>Retry save</button></div>}<section className="stat-grid dashboard-client-stats"><Stat label="Total business" value={`$${money(businessVolume)}`} note="Team business package volume" icon="▤" /><Stat label="Strong & weaker leg business" dualValues={[{ label: "Strong", value: `$${money(strongBusinessVolume)}` }, { label: "Weaker", value: `$${money(weakBusinessVolume)}` }]} note="On-chain branch totals" icon="↔" /><Stat tone="rank" label="Current rank" value={Number(leadership ?? 0) ? `Bit-${leadership}` : "Unranked"} note="Leadership qualification" icon="◇" /><Stat label="Total income" value={`$${money(totalIncome)}`} note="Lifetime credited income" icon="$" /></section>
    <IncomeCapsCard principal={totalPrincipal} working={workingIncomeCredited} roi={roiCredited} />
    <section className="content-card"><div className="section-heading-row"><PageHeading title="Daily ROI claim" subtitle="Claim after the daily close at 5:30 AM IST. This also credits eligible Level and Rank income to your sponsors." /><b>${money(pendingYield)}</b></div><button className="btn primary action-wide" disabled={isPending || receiptPending || (pendingYield ?? 0n) === 0n} onClick={claim}>{isPending ? "Confirm in wallet…" : receiptPending ? "Waiting for confirmation…" : (pendingYield ?? 0n) === 0n ? (totalPrincipal > 0n && workingIncomeCredited + roiCredited >= totalPrincipal * 3n ? "3× income cap reached — ROI stopped" : "No daily ROI ready") : "Claim daily ROI"}</button>{status && <TxStatus status={status} hash={hash} />}</section>
    <div className="dashboard-columns"><section className="content-card"><PageHeading title="Account overview" subtitle="Your package and network snapshot" /><div className="overview-list"><Overview label="Account status" value={active ? "Active" : "Registered"} tone="green" /><Overview label="Package positions" value={String(count)} /><Overview label="Available income" value={`$${money(earnings)}`} /><Overview label="Pending daily return" value={`$${money(pendingYield)}`} /><Overview label="B5 allocation" value={`${money(allocation)} B5`} note={`Unlock date: ${unlockAt ? new Date(Number(unlockAt) * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Not scheduled"} · ${b5Open ? "claims enabled" : "claims currently off"}`} /><Overview label="Leadership rank" value={Number(leadership ?? 0) ? `Bit-${leadership}` : "Not ranked yet"} /><Overview label="Team volume" value={`$${money(volume)}`} /><Overview label="Direct members" value={String(Number(directs ?? 0))} /></div><button className="text-link" onClick={() => go("rank")}>View rank details →</button></section><section className="content-card"><PageHeading title="Quick actions" subtitle="Common member actions" /><div className="quick-actions"><QuickAction icon="＋" label="Buy a package" onClick={() => go("topup")} /><QuickAction icon="↗" label="Withdraw income" onClick={() => go("withdraw")} /><QuickAction icon="▤" label="Income report" onClick={() => go("income")} /><QuickAction icon="♧" label="View my team" onClick={() => go("team")} /></div></section></div>
    <section className="content-card"><div className="section-heading-row"><PageHeading title="Recent transactions" subtitle="Latest activity recorded by the contract" /><button className="text-link" onClick={() => go("transactions")}>View all →</button></div><ActivityList activity={activity.slice(0, 5)} /></section>
    {isOwner && <AdminPanel on={b5Open} pending={isPending} toggle={admin} ownerAddress={address} signMessageAsync={signMessageAsync} blockTarget={blockTarget} setBlockTarget={setBlockTarget} blockTargetValid={blockTargetValid} blockTargetAddress={blockTargetAddress} blockTargetMember={blockTargetMember} blockTargetNotFound={blockTargetNotFound} targetBlocked={targetBlocked} onBlock={onBlock} />}
    {unlockAt && <span className="sr-only">B5 unlock timestamp {String(unlockAt)}</span>}
  </div>;
}

function B5AllocationPanel({ positions = [], total = 0n, claimable = 0n, treasuryAllowance = 0n, claimsEnabled, pending, claim }: any) {
  const claimableAmount = BigInt(claimable ?? 0n);
  const allowance = BigInt(treasuryAllowance ?? 0n);
  const allowanceReady = allowance >= claimableAmount;
  const canClaim = claimsEnabled && claimableAmount > 0n && allowanceReady && !pending;
  const unlockDate = (value: bigint) => new Date(Number(value) * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const positionStatus = (item: any) => {
    if (item.principalWithdrawn) return "Forfeited after principal withdrawal";
    if (item.b5Claimed) return "Claimed";
    if (item.unlockAt <= BigInt(Math.floor(Date.now() / 1000))) {
      if (!claimsEnabled) return "Unlocked · claims paused";
      if (!allowanceReady) return "Unlocked · treasury approval needed";
      return "Ready to claim";
    }
    return `Unlocks ${unlockDate(item.unlockAt)}`;
  };
  return <section className="content-card b5-allocation-card"><div className="b5-allocation-heading"><div><small>B5 TOKEN</small><h3>Package allocation</h3><p>Each package receives a B5 allocation with its own 180-day unlock.</p></div><span className="b5-allocation-total">{money(total)} B5</span></div><div className="b5-allocation-state">Contract claims: <b className={claimsEnabled ? "b5-on" : "b5-off"}>{claimsEnabled ? "ON" : "OFF"}</b>{claimableAmount > 0n && <span> · Ready: {money(claimableAmount)} B5</span>}</div>{positions.length ? <div className="b5-position-list">{positions.map((item: any) => <div className="b5-position-row" key={item.index}><div><b>{packages[item.packageId]?.name ?? `Package ${item.packageId + 1}`} · {money(item.principal)} B5</b><small>Unlock date: {unlockDate(item.unlockAt)}</small></div><span className={positionStatus(item) === "Ready to claim" ? "b5-on" : ""}>{positionStatus(item)}</span></div>)}</div> : <p className="empty-state">Buy a package to receive a B5 allocation.</p>}{claimableAmount > 0n && !allowanceReady && <div className="notice notice-amber">B5 treasury allowance is {money(allowance)} B5; {money(claimableAmount)} B5 is ready. The treasury wallet needs to approve the V11 contract.</div>}<button className="btn primary action-wide" disabled={!canClaim} onClick={claim}>{pending ? "Confirm in wallet…" : !claimsEnabled ? "B5 claims are off" : claimableAmount === 0n ? "No B5 unlocked yet" : !allowanceReady ? "Treasury approval required" : `Claim ${money(claimableAmount)} B5`}</button></section>;
}

function TopupPage({ packages: list, selected, setSelected, chosen, count, balance, hasAllowance, isPending, receiptPending, action, receiptStatus, receiptError, walletError, hash, purchasePackageId, approve, purchase, resetFlow, goDashboard }: any) {
  const purchaseConfirmed = action === "purchase" && receiptStatus === "success";
  const approvalConfirmed = action === "approval" && receiptStatus === "success";
  const purchaseReverted = action === "purchase" && receiptStatus === "reverted";
  const waiting = isPending || receiptPending;
  const purchaseSubmitted = action === "purchase" && !!hash;
  const approvalReady = hasAllowance || approvalConfirmed;
  const purchasedPackage = purchasePackageId == null ? chosen : list[purchasePackageId];
  const steps = [
    { label: "Step 1 · Approve USDT", done: approvalReady, current: !approvalReady },
    { label: "Step 2 · Confirm & Activate", done: purchaseConfirmed, current: approvalReady && !purchaseConfirmed },
  ];
  return <div className="page-stack"><section className="content-card topup-card">
    <PageHeading title={count ? "Purchase another package" : "Choose your package"} subtitle="Select a package, then complete two wallet steps: approve USDT, and confirm & activate your package." />
    <div className="topup-steps">{steps.map((step, i) => <div className={`topup-step ${step.done ? "step-done" : ""} ${step.current ? "step-current" : ""}`} key={step.label}><span>{step.done ? "✓" : `0${i + 1}`}</span><b>{step.label}</b></div>)}</div>
    <div className="topup-summary"><span>Existing positions <b>{count}</b></span><span>Wallet USDT <b>${money(balance)}</b></span></div>
    {purchaseConfirmed ? <div className="purchase-success"><div className="purchase-success-mark">✓</div><small>ON-CHAIN CONFIRMATION RECEIVED</small><h2>Package purchase complete</h2><p><b>{purchasedPackage.name}</b> package · <b>${purchasedPackage.price.toLocaleString()} USDT</b></p><p className="purchase-success-copy">Your new package position is active. You can see the confirmed transaction on BscScan.</p>{hash && <a className="btn outline" href={txUrl(hash)} target="_blank" rel="noreferrer">View confirmed transaction ↗</a>}<div className="purchase-success-actions"><button className="btn primary" onClick={goDashboard}>Go to Dashboard</button><button className="text-link" onClick={resetFlow}>Buy another package</button></div></div> : <>
      <div className="plan-grid">{list.map((p: any, i: number) => <button key={p.name} className={`plan-card ${selected === i ? "plan-selected" : ""}`} disabled={waiting} onClick={() => setSelected(i)}><span>{selected === i ? "SELECTED" : `PACKAGE 0${i + 1}`}</span><h3>{p.name}</h3><b>${p.price.toLocaleString()}</b><small>USDT deposit</small><div className="plan-facts"><span>{p.rate}% daily rate</span><span>{p.days} days duration</span></div></button>)}</div>
      <div className="purchase-footer"><div><small>Selected package</small><b>{chosen.name} · ${chosen.price.toLocaleString()}</b><span>{chosen.rate}% daily · {chosen.days} days</span></div>{!hasAllowance ? <button className="btn primary" disabled={waiting || approvalConfirmed} onClick={approve}>{isPending ? "Confirm Step 1 in wallet…" : approvalConfirmed ? "Checking USDT approval…" : "Step 1 · Approve USDT"}</button> : <button className="btn primary" disabled={waiting} onClick={purchase}>{isPending ? "Confirm Step 2 in wallet…" : `Step 2 · Confirm & Activate · $${chosen.price.toLocaleString()}`}</button>}</div>
      <p className="helper-copy">Step 1 grants the contract permission to use your USDT; it does not purchase a package. Step 2 submits the package purchase and activates it after BNB Smart Chain confirms the transaction.</p>
      {approvalConfirmed && <div className="notice notice-green">USDT approval confirmed. No package has been bought yet—confirm the selected package to continue.</div>}
      {waiting && <div className="notice notice-amber">{isPending ? "Confirm this request in your wallet." : action === "approval" ? "USDT approval submitted. Waiting for network confirmation…" : "Package purchase submitted. Waiting for BNB Smart Chain confirmation…"}{hash && <a className="inline-explorer" href={txUrl(hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>}
      {purchaseReverted && <div className="notice notice-amber">The package transaction reverted. The package was not purchased. {hash && <a className="inline-explorer" href={txUrl(hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>}
      {walletError && <div className="notice notice-amber">{/reject|denied|cancel/i.test(walletError) ? "Wallet confirmation was cancelled or rejected. No package was purchased." : walletError}</div>}
      {receiptError && !purchaseReverted && <div className="notice notice-amber">Could not confirm the transaction yet: {receiptError} {hash && <a className="inline-explorer" href={txUrl(hash)} target="_blank" rel="noreferrer">Check BscScan ↗</a>}</div>}
    </>}
  </section></div>;
}

function WithdrawPage({ earnings, pendingYield, amount, setAmount, allowance, enoughAllowance, active, isPending, withdraw, allocation, b5Positions, b5Claimable, b5Allowance, unlockAt, b5Open, claimB5, canWithdrawPrincipal, individualWithdrawals, individualEligibility, withdrawPrincipalAt, withdrawPrincipal, status, hash, isOwner, admin }: any) {
  let grossWei = 0n;
  try { grossWei = parseUnits(String(amount || "0"), 18); } catch { grossWei = 0n; }
  const usdtFeeWei = grossWei * 500n / 10_000n;
  const netPayoutWei = grossWei - usdtFeeWei;
  const b5FeeWei = grossWei * 500n / 10_000n;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const eligiblePrincipalPositions = b5Positions.filter((position: any, index: number) => individualWithdrawals ? individualEligibility[index] === true : !position.principalWithdrawn && !position.boosterPaid && position.activatedAt > 0n && now <= position.principalDeadline);
  const principalPositionStatus = (position: any, index: number) => {
    if (position.principalWithdrawn) return "Withdrawn";
    if (position.boosterPaid) return "Not eligible · booster paid";
    if (now > position.principalDeadline) return "Window closed";
    if (individualWithdrawals && individualEligibility[index] === null) return "V11 contract required";
    if (individualWithdrawals && individualEligibility[index] !== true) return "Checking eligibility…";
    return "Eligible now";
  };
  return <div className="page-stack"><div className="dashboard-columns"><section className="content-card"><PageHeading title="Withdraw USDT" subtitle="Withdraw from your internal earnings balance" /><div className="withdraw-balance"><small>AVAILABLE BALANCE</small><b className="amount-positive">${money(earnings)} USDT</b><span>Minimum $10 · Maximum $1,000 per day</span></div><label className="field-label">Withdrawal amount<input type="number" min="10" max="1000" value={amount} onChange={e => setAmount(e.target.value)} /></label><div className="withdraw-breakdown"><h3>Withdrawal Breakdown</h3><div><span>Gross requested amount</span><b className="amount-neutral">${money(grossWei)} USDT</b></div><div><span>USDT service charge (5%)</span><b className="amount-pending">−${money(usdtFeeWei)} USDT</b></div><div><span>B5 treasury fee (5%)</span><b className="amount-pending">${money(b5FeeWei)} B5</b></div><div className="withdraw-net-row"><span>Net payout to receive</span><b className="amount-positive">${money(netPayoutWei)} USDT</b></div></div><div className="withdraw-rules"><h3>Withdrawal Rules &amp; Limits</h3><div><span>Available balance</span><b className="amount-positive">${money(earnings)}</b></div><div><span>Pending daily ROI</span><b className="amount-pending">${money(pendingYield)}</b></div><div><span>B5 fee allowance</span><b className={enoughAllowance ? "amount-positive" : "amount-pending"}>{money(allowance)} B5</b></div><div><span>Daily withdrawal limit</span><b className="amount-neutral">$1,000</b></div></div>{!enoughAllowance && <Notice tone="amber" text="Withdrawal is paused: the B5 token treasury wallet must approve this V11 contract to spend the B5 fee. Approval must be sent from the treasury wallet; it does not transfer B5. After approval confirms, refresh this page." />}<button className="btn primary action-wide" disabled={!active || isPending || !enoughAllowance || Number(amount) < 10 || Number(amount) > 1000} onClick={withdraw}>{isPending ? "Confirm in wallet…" : `Submit withdrawal request · $${money(netPayoutWei)}`}</button></section><B5AllocationPanel positions={b5Positions} total={allocation} claimable={b5Claimable} treasuryAllowance={b5Allowance} claimsEnabled={b5Open} pending={isPending} claim={claimB5} /></div><section className="content-card principal-card"><div><PageHeading title="Principal withdrawal" subtitle={individualWithdrawals ? "Withdraw each eligible package separately" : "Package-wise eligibility during each position’s 15-day window"} /><p className="helper-copy">A 20% fee applies. {individualWithdrawals ? "Each package withdrawal is a separate transaction and leaves other positions unchanged." : "Review eligible packages below. V11 lets you withdraw each eligible package separately."}</p></div><div className="principal-position-list">{b5Positions.length ? b5Positions.map((position: any, index: number) => <div className="principal-position-row" key={position.index}><div><b>{packages[position.packageId]?.name ?? `Package ${position.packageId + 1}`}</b><span>Principal · ${money(position.principal)} USDT</span></div><div className="principal-position-meta"><b className={!position.principalWithdrawn && !position.boosterPaid && now <= position.principalDeadline ? "principal-eligible" : ""}>{principalPositionStatus(position, index)}</b><span>{position.principalWithdrawn ? "" : `Window ends ${new Date(Number(position.principalDeadline) * 1000).toLocaleDateString()}`}</span></div>{individualWithdrawals && <button className="btn outline principal-position-action" disabled={individualEligibility[index] !== true || isPending} onClick={() => withdrawPrincipalAt(index)}>{isPending ? "Confirm…" : "Withdraw package"}</button>}</div>) : <p className="helper-copy">No package positions found.</p>}</div><div className="principal-position-footer"><span>{eligiblePrincipalPositions.length} eligible · ${money(eligiblePrincipalPositions.reduce((sum: bigint, position: any) => sum + position.principal, 0n))} gross principal</span>{!individualWithdrawals && <button className="btn outline" disabled={!canWithdrawPrincipal || isPending} onClick={withdrawPrincipal}>{isPending ? "Confirm in wallet…" : "Withdraw all eligible principal"}</button>}</div></section>{isOwner && <AdminPanel on={b5Open} pending={isPending} toggle={admin} />}{status && <TxStatus status={status} hash={hash} />}</div>;
}

function IncomePage({ address, earnings, pendingYield, activityStatus }: any) {
  const [selectedCategory, setSelectedCategory] = useState<"all" | IncomeCategory>("all");
  const [entries, setEntries] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 25;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`${apiBaseUrl}/api/v1/users/${address}/income?category=${selectedCategory}&page=${page}&pageSize=${pageSize}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Could not load income history.")))
      .then(payload => { setEntries(payload.entries ?? []); setTotal(Number(payload.total ?? 0)); setLoading(false); })
      .catch(() => { if (!controller.signal.aborted) { setEntries([]); setTotal(0); setLoading(false); } });
    return () => controller.abort();
  }, [address, selectedCategory, page]);
  const chooseCategory = (category: "all" | IncomeCategory) => { setSelectedCategory(category); setPage(1); };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const title = selectedCategory === "all" ? "income" : incomeCategories.find(category => category.key === selectedCategory)?.label.toLowerCase();
  return <div className="page-stack"><section className="stat-grid"><Stat label="Available USDT income" value={`$${money(earnings)}`} note="Withdrawable internal balance" icon="$" /><Stat label="Pending return" value={`$${money(pendingYield)}`} note="Daily close at 5:30 AM IST" icon="◷" /><Stat label="Income history entries" value={String(total)} note="All indexed records for this filter" icon="▤" /><Stat label="Network" value="BSC" note="On-chain records" icon="◇" /></section><section className="content-card"><PageHeading title="Income report" subtitle={`${activityStatus} · Showing ${selectedCategory === "all" ? "all income types" : title}`} /><div className="income-filters" role="group" aria-label="Filter income by category">{incomeCategories.map(category => <button key={category.key} type="button" className={`income-filter ${selectedCategory === category.key ? "active" : ""}`} aria-pressed={selectedCategory === category.key} onClick={() => chooseCategory(category.key)}>{category.label}</button>)}</div>{loading ? <p className="empty-state">Loading {title} history…</p> : entries.length ? <><ActivityList activity={entries} /><div className="income-history-pagination"><span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span><div><button className="btn outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn outline" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>Next</button></div></div></> : <p className="empty-state">No {title} entries indexed yet. Credits appear here after the corresponding on-chain transaction.</p>}</section></div>;
}

function RankPage({ rank, volume, directs }: any) {
  const next = ranks[rank] ?? ranks[ranks.length - 1];
  const percent = Math.min(100, Number(formatUnits(volume ?? 0n, 18)) / next * 100);
  return <div className="page-stack rank-page"><section className="rank-hero"><div><small>CURRENT LEADERSHIP RANK</small><h2>{rank ? `Bit-${rank}` : "Unranked"}</h2><p>Leadership status from your on-chain team volume and qualification.</p></div><span className="rank-emblem">◇</span></section><div className="stat-grid"><Stat label="Team volume" value={`$${money(volume)}`} note="On-chain qualifying volume" icon="$" /><Stat label="Direct members" value={String(Number(directs ?? 0))} note="Package-active directs" icon="♧" /><Stat label="Next rank" value={rank >= 10 ? "Maximum" : `Bit-${rank + 1}`} note={rank >= 10 ? "Top rank reached" : `$${next.toLocaleString()} team volume`} icon="◇" /><Stat label="Volume progress" value={`${percent.toFixed(1)}%`} note="Towards next volume threshold" icon="↗" /></div><section className="content-card"><PageHeading title="Leadership ladder" subtitle="Team volume thresholds from the Bit Five plan" /><div className="rank-list">{ranks.map((threshold, i) => <div className={`rank-row ${rank >= i + 1 ? "rank-done" : ""}`} key={threshold}><span>{rank >= i + 1 ? "✓" : `0${i + 1}`}</span><b>Bit-{i + 1}</b><small>${threshold.toLocaleString()} team volume</small><strong>{rank >= i + 1 ? "Achieved" : "In progress"}</strong></div>)}</div></section></div>;
}

function TeamPage({ title, subtitle, members, rootAddress, genealogy = false, namesLoaded = false, namesLoading = false, namesError = "", loadNames }: { title: string; subtitle: string; members: TeamMember[]; rootAddress?: string; genealogy?: boolean; namesLoaded?: boolean; namesLoading?: boolean; namesError?: string; loadNames?: () => void }) {
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const nodes = new Map(members.map(member => [member.wallet_address.toLowerCase(), { ...member, children: [] as any[] }]));
  const roots: any[] = [];
  for (const node of nodes.values()) {
    const parent = node.sponsor_address ? nodes.get(node.sponsor_address.toLowerCase()) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const visibleNodes = genealogy ? roots.slice(0, 100) : members;
  const levelMembers = selectedLevel === null ? [] : members.filter(member => Number(member.depth) + 1 === selectedLevel);
  const levelCount = (level: number) => members.filter(member => Number(member.depth) + 1 === level).length;
  return <div className="page-stack">
    <section className="stat-grid"><Stat label="Direct referrals" value={String(members.filter(m => Number(m.depth) === 0).length)} note="Your first-level team" icon="♧" /><Stat label="Network members" value={String(members.length)} note="Indexed on-chain registrations" icon="◇" /><Stat label="Active packages" value={String(members.filter(m => m.package_id !== null).length)} note="Members with a package purchase" icon="＋" /><Stat label="Team activity" value={members.length ? "Active" : "Waiting"} note="Updates as registrations index" icon="◷" /></section>
    <section className="content-card"><div className="team-page-heading"><PageHeading title={title} subtitle={subtitle} />{!genealogy && !!members.length && <button className="btn outline" disabled={namesLoading || namesLoaded} onClick={loadNames}>{namesLoading ? "Confirm name lookup…" : namesLoaded ? "Names loaded ✓" : namesError ? "Retry name lookup" : "Load names now"}</button>}</div>{!genealogy && namesError && <p className="notice notice-amber">{namesError}</p>}{!genealogy && namesLoaded && <p className="team-name-privacy-note">A free wallet signature loads names members saved to their profiles. Names are visible to their sponsor; phone numbers stay private.</p>}
      {!members.length ? <p className="empty-state">No team registrations are indexed yet. Member IDs and wallet addresses will appear here after the indexer syncs their on-chain registrations.</p>
        : genealogy ? <>
          <div className="level-summary" role="group" aria-label="Filter genealogy by level">
            <button type="button" className={`level-option ${selectedLevel === null ? "selected" : ""}`} aria-pressed={selectedLevel === null} onClick={() => setSelectedLevel(null)}><span>All levels</span><b>{members.length}</b></button>
            {Array.from({ length: 15 }, (_, index) => index + 1).map(level => <button type="button" key={level} className={`level-option ${selectedLevel === level ? "selected" : ""}`} aria-pressed={selectedLevel === level} onClick={() => setSelectedLevel(level)}><span>Level {level}</span><b>{levelCount(level)}</b></button>)}
          </div>
          {selectedLevel === null
            ? <div className="genealogy-viewport"><div className="genealogy-chart"><div className="genealogy-root"><TeamNodeCard address={rootAddress ?? ""} isRoot /></div><div className="genealogy-branches">{visibleNodes.map(node => <TeamNode key={node.wallet_address} node={node} />)}</div></div></div>
            : levelMembers.length ? <div className="genealogy-level-members">{levelMembers.map(member => <TeamNodeCard key={member.wallet_address} address={member.wallet_address} member={member} />)}</div> : <p className="level-empty">No members at Level {selectedLevel} yet.</p>}
          {selectedLevel === null && roots.length > 100 && <p className="helper-copy">Showing the first 100 direct branches in the chart. Team List includes all direct referrals.</p>}
        </>
          : <div className="team-table-wrap"><table className="member-table"><thead><tr><th>Name</th><th>Member ID</th><th>Member wallet</th><th>Status</th><th>Package</th><th>Joined / activated</th><th>Explore</th></tr></thead><tbody>{members.map(member => <tr key={member.wallet_address}><td className="team-member-name">{member.full_name || (namesLoading ? "Loading name…" : namesLoaded ? "Name not provided" : namesError ? "Name lookup failed" : "Waiting for name lookup…")}</td><td><b>{member.member_code ?? "Assigning ID…"}</b></td><td>{short(member.wallet_address)}</td><td><span className={`table-badge ${member.package_id == null ? "badge-pending" : "badge-active"}`}>{member.package_id == null ? "Registered" : "Active"}</span></td><td>{member.package_id == null ? "—" : packages[member.package_id]?.name ?? "Package"}</td><td>{member.activated_at ? new Date(member.activated_at).toLocaleDateString() : "Awaiting package"}</td><td><a href={`${explorerUrl}/address/${member.wallet_address}`} target="_blank" rel="noreferrer">BscScan ↗</a></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}

function TeamNode({ node }: { node: TeamMember & { children: (TeamMember & { children: any[] })[] } }) { return <div className="genealogy-node"><TeamNodeCard address={node.wallet_address} member={node} />{node.children.length > 0 && <div className="genealogy-children">{node.children.map(child => <TeamNode key={child.wallet_address} node={child} />)}</div>}</div>; }
function TeamNodeCard({ address, member, isRoot = false }: { address: string; member?: TeamMember; isRoot?: boolean }) { return <a className={`genealogy-card ${isRoot ? "root-card" : ""}`} href={isRoot ? undefined : `${explorerUrl}/address/${address}`} target={isRoot ? undefined : "_blank"} rel={isRoot ? undefined : "noreferrer"}><span className="genealogy-avatar">{isRoot ? "B5" : address.slice(2, 4).toUpperCase()}</span><b>{isRoot ? "You" : member?.member_code ?? "Assigning ID…"}</b><small>{short(address)} · {isRoot ? "Root account" : member?.package_id == null ? "Registered" : packages[member.package_id]?.name ?? "Package member"}</small><i className={member?.package_id == null && !isRoot ? "inactive-node" : "active-node"}>{isRoot || member?.package_id !== null ? "● Active" : "● Registered"}</i></a>; }

function TransactionsPage({ activity, activityStatus }: { activity: Activity[]; activityStatus: string }) {
  return <div className="page-stack"><section className="content-card"><PageHeading title="Transactions" subtitle={activityStatus} /><ActivityList activity={activity} /></section></div>;
}

function ReferralCenter({ address, memberCode, sponsor, team, active, copied, onCopy }: any) {
  const directCount = team.filter((member: TeamMember) => Number(member.depth) === 0).length;
  return <div className="page-stack"><section className="content-card"><PageHeading title="Your direct sponsor link" subtitle={active ? "Invite a new member; sponsor attribution is confirmed on-chain." : "Your referral link unlocks after your first package activation."} /><div className="referral-id-grid"><div><small>YOUR MEMBER ID</small><b>{memberCode || "Assigning ID…"}</b></div><div><small>DIRECT REFERRALS</small><b>{directCount}</b></div><div><small>SPONSOR WALLET</small><b>{short(sponsor) || "Network root"}</b></div></div><label className="field-label">Your referral link<input readOnly value={active ? `${window.location.origin}/?ref=${address}` : "Referral link inactive until ID activation"} /></label>{!active && <Notice tone="amber" text="Activate a package from Invest to enable and share your referral link." />}<button className="btn primary action-wide" disabled={!active} onClick={onCopy}>{active ? (copied ? "Copied ✓" : "Copy referral link") : "Activate ID to unlock referral"}</button></section></div>;
}

function TokenHistoryPage({ activity, activityStatus }: { activity: Activity[]; activityStatus: string }) {
  const [tab, setTab] = useState<"allocations" | "claims">("allocations");
  const rows = activity.filter(item => tab === "claims" ? item.event_name === "B5Claimed" : item.event_name === "Activated");
  const shown = rows.map(item => item.event_name === "Activated" ? { ...item, displayTitle: "B5 package allocation created" } : { ...item, displayTitle: "B5 tokens claimed" });
  return <div className="page-stack"><section className="content-card"><PageHeading title="B5 Token History" subtitle={`${activityStatus} · Package allocations are created at activation; claimed tokens appear after the B5 transfer transaction.`} /><div className="income-filters"><button className={`income-filter ${tab === "allocations" ? "active" : ""}`} onClick={() => setTab("allocations")}>Package allocations</button><button className={`income-filter ${tab === "claims" ? "active" : ""}`} onClick={() => setTab("claims")}>B5 claims</button></div>{shown.length ? <div className="activity-list">{shown.map((item, index) => <a key={`${item.transaction_hash}-${index}`} href={txUrl(item.transaction_hash)} target="_blank" rel="noreferrer" className="activity-row"><span className="activity-mark">◈</span><span className="activity-info"><b>{item.displayTitle}</b><small>{new Date(item.block_timestamp).toLocaleString()} · {short(item.transaction_hash)}</small></span><strong>{item.amount ? `${Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} B5` : "View tx"} ↗</strong></a>)}</div> : <p className="empty-state">No {tab === "claims" ? "B5 claim" : "package allocation"} records yet.</p>}</section></div>;
}

function ReportsStatementsPage({ activity, activityStatus }: { activity: Activity[]; activityStatus: string }) {
  const [tab, setTab] = useState<"deposits" | "withdrawals" | "roi">("deposits");
  const records = activity.filter(item => tab === "deposits" ? item.event_name === "Activated" : tab === "withdrawals" ? ["EarningsWithdrawn", "PrincipalWithdrawn"].includes(item.event_name) : item.event_name === "YieldClaimed");
  const labels = { deposits: "Deposits Statement", withdrawals: "Withdrawals Statement", roi: "ROI Accruals Statement" };
  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [["Date", "Type", "Amount", "Transaction Hash"], ...records.map(item => [new Date(item.block_timestamp).toISOString(), eventTitle(item), item.amount ?? "", item.transaction_hash])];
    const blob = new Blob([lines.map(row => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `bit-five-${tab}-statement.csv`; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="page-stack"><section className="content-card"><PageHeading title="Financial Reports & Statements" subtitle={`${activityStatus} · Export your indexed on-chain statement.`} /><button className="btn outline" disabled={!records.length} onClick={exportCsv}>⇩ &nbsp; Export Excel / CSV</button><div className="income-filters report-tabs">{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <button key={key} className={`income-filter ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{labels[key]}</button>)}</div>{records.length ? <ActivityList activity={records} /> : <p className="empty-state">No statement records found for this category.</p>}</section></div>;
}

function NotificationsPage({ address, activity, activityStatus }: { address: string; activity: Activity[]; activityStatus: string }) {
  const storageKey = `bit5-read-notifications:${address.toLowerCase()}`;
  const [readIds, setReadIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? "[]"); } catch { return []; } });
  useEffect(() => { try { setReadIds(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); } catch { setReadIds([]); } }, [storageKey]);
  const idFor = (item: Activity, index: number) => `${item.transaction_hash}:${item.event_name}:${index}`;
  const unread = activity.filter((item, index) => !readIds.includes(idFor(item, index))).length;
  const markRead = (id: string) => { const next = [...new Set([...readIds, id])]; setReadIds(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Notifications remain usable for this session. */ } };
  const markAll = () => { const next = activity.map(idFor); setReadIds(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Notifications remain usable for this session. */ } };
  return <div className="page-stack"><section className="content-card"><div className="section-heading-row"><PageHeading title="Notifications" subtitle={`On-chain account updates · ${activityStatus}`} /><button className="btn outline" disabled={!unread} onClick={markAll}>✓ &nbsp; Mark all as read</button></div><div className="notification-list">{activity.map((item, index) => { const id = idFor(item, index); const isRead = readIds.includes(id); return <article key={id} className={`notification-row ${isRead ? "read" : "unread"}`}><span className="activity-mark">{isRead ? "✓" : "●"}</span><div className="activity-info"><b>{eventTitle(item)}</b><small>{new Date(item.block_timestamp).toLocaleString()} · {short(item.transaction_hash)}</small></div>{item.amount && <strong>${Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>}<button className="text-link" onClick={() => markRead(id)}>{isRead ? "Read" : "Mark read"}</button></article>; })}{!activity.length && <p className="empty-state">No notifications yet.</p>}</div></section></div>;
}

function AccountSettingsPage({ address, memberCode, fullName, phoneNumber, setFullName, setPhoneNumber, loadProfileName, onSaved }: any) {
  const { signMessageAsync } = useSignMessage();
  const [name, setName] = useState(fullName ?? ""); const [phone, setPhone] = useState(phoneNumber ?? "");
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { setName(fullName ?? ""); setPhone(phoneNumber ?? ""); }, [fullName, phoneNumber]);
  const save = async () => {
    const normalizedName = name.trim().replace(/\s+/g, " "); const normalizedPhone = phone.trim();
    if (normalizedName.length < 2 || !/^\+?[0-9().\s-]{7,24}$/.test(normalizedPhone) || normalizedPhone.replace(/\D/g, "").length < 7) { setMessage("Enter a valid full name and phone number."); return; }
    setSaving(true); setMessage("Approve the profile signature in your wallet; it does not cost gas.");
    try {
      const signedMessage = `Bit Five profile settings\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${address.toLowerCase()}\nFull name: ${normalizedName}\nPhone: ${normalizedPhone}`;
      const signature = await signMessageAsync({ message: signedMessage });
      const response = await fetch(`${apiBaseUrl}/api/v1/profile/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, fullName: normalizedName, phoneNumber: normalizedPhone, signature }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "Could not save account settings.");
      setFullName(normalizedName); setPhoneNumber(normalizedPhone); onSaved(normalizedName); setMessage("Account details saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save account settings."); }
    finally { setSaving(false); }
  };
  return <div className="page-stack"><section className="content-card narrow-card"><PageHeading title="Account Settings" subtitle="Your display name and phone number are stored privately off-chain." /><div className="wallet-confirm"><span className="status-dot" /> Connected wallet <b>{short(address)}</b></div><div className="settings-member-id"><small>MEMBER ID</small><b>{memberCode || "Assigning ID…"}</b></div>{!name && <button className="text-link" onClick={loadProfileName}>Load my saved profile details ↗</button>}<label className="field-label">Full name<input autoComplete="name" maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Enter your full name" /></label><label className="field-label">Phone number<input type="tel" autoComplete="tel" inputMode="tel" maxLength={24} value={phone} onChange={event => setPhone(event.target.value)} placeholder="e.g. +1 234 567 890" /></label><p className="helper-copy">Saving requires a free wallet signature. Your name and phone number are not written to the blockchain.</p><button className="btn primary action-wide" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save account details"}</button>{message && <p className="tx-status">{message}</p>}</section></div>;
}

function SupportDeskPage({ address, isOwner }: { address: `0x${string}`; isOwner: boolean }) {
  const { signMessageAsync } = useSignMessage();
  const [tickets, setTickets] = useState<any[]>([]); const [selectedId, setSelectedId] = useState<string>("");
  const [loaded, setLoaded] = useState(false); const [compose, setCompose] = useState(false);
  const [subject, setSubject] = useState(""); const [message, setMessage] = useState(""); const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState("");
  const selected = tickets.find(ticket => String(ticket.ticket_id) === selectedId);
  const signedRequest = async (text: string) => signMessageAsync({ message: text });
  const loadTickets = async () => {
    setBusy(true); setStatus("Sign a read request to load your private support tickets.");
    try {
      const signature = await signedRequest(`Bit Five support tickets\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${address.toLowerCase()}`);
      const response = await fetch(`${apiBaseUrl}/api/v1/support/list`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, signature }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not load support tickets.");
      setTickets(result.tickets ?? []); setLoaded(true); setSelectedId(result.tickets?.[0] ? String(result.tickets[0].ticket_id) : ""); setStatus(result.isAdmin ? "Protocol owner view · all member inquiries" : "Your support history is private to your wallet.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not load support tickets."); }
    finally { setBusy(false); }
  };
  const createTicket = async () => {
    const cleanSubject = subject.trim(); const cleanMessage = message.trim();
    if (cleanSubject.length < 4 || cleanMessage.length < 10) { setStatus("Add a subject and a message with at least 10 characters."); return; }
    setBusy(true); setStatus("Confirm the support request signature in your wallet.");
    try {
      const signed = `Bit Five support ticket\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${address.toLowerCase()}\nSubject: ${cleanSubject}\nMessage: ${cleanMessage}`;
      const signature = await signedRequest(signed);
      const response = await fetch(`${apiBaseUrl}/api/v1/support/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, subject: cleanSubject, message: cleanMessage, signature }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not create the ticket.");
      const ticket = { ...result.ticket, wallet_address: address.toLowerCase(), subject: cleanSubject, status: "open", messages: [{ senderAddress: address.toLowerCase(), senderRole: "member", message: cleanMessage, createdAt: new Date().toISOString() }] };
      setTickets(previous => [ticket, ...previous]); setSelectedId(String(ticket.ticket_id)); setLoaded(true); setCompose(false); setSubject(""); setMessage(""); setStatus("Support ticket submitted.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not create the ticket."); }
    finally { setBusy(false); }
  };
  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setBusy(true); setStatus("Confirm your reply signature in your wallet.");
    try {
      const clean = reply.trim(); const ticketId = String(selected.ticket_id);
      const signed = `Bit Five support reply\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${address.toLowerCase()}\nTicket: ${ticketId}\nMessage: ${clean}`;
      const signature = await signedRequest(signed);
      const response = await fetch(`${apiBaseUrl}/api/v1/support/message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address, ticketId, message: clean, signature }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not send the reply.");
      setTickets(previous => previous.map(ticket => String(ticket.ticket_id) === ticketId ? { ...ticket, status: isOwner ? "answered" : "open", messages: [...(ticket.messages ?? []), { senderAddress: address.toLowerCase(), senderRole: isOwner ? "admin" : "member", message: clean, createdAt: new Date().toISOString() }] } : ticket));
      setReply(""); setStatus("Reply sent.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not send the reply."); }
    finally { setBusy(false); }
  };
  return <div className="page-stack"><section className="content-card"><div className="section-heading-row"><PageHeading title="Support Desk" subtitle="Submit an inquiry or open your existing support conversation." /><button className="btn primary" onClick={() => setCompose(value => !value)}>＋ &nbsp; {compose ? "Close form" : "New Support Ticket"}</button></div>{compose && <div className="support-compose"><label className="field-label">Subject<input maxLength={120} value={subject} onChange={event => setSubject(event.target.value)} placeholder="Briefly describe the issue" /></label><label className="field-label">Message<textarea maxLength={3000} value={message} onChange={event => setMessage(event.target.value)} placeholder="Tell the support team what happened" /></label><button className="btn primary" disabled={busy} onClick={createTicket}>{busy ? "Submitting…" : "Submit support ticket"}</button></div>}<div className="section-heading-row support-inquiries"><h3>{isOwner ? "MEMBER INQUIRIES" : "YOUR INQUIRIES"}</h3><button className="text-link" disabled={busy} onClick={loadTickets}>{loaded ? "Refresh" : "Load tickets"}</button></div>{!loaded ? <p className="empty-state">Sign a read request to securely load your support conversations.</p> : !tickets.length ? <p className="empty-state">No support tickets submitted yet.</p> : <div className="support-layout"><div className="support-ticket-list">{tickets.map(ticket => <button key={ticket.ticket_id} className={`support-ticket-item ${String(ticket.ticket_id) === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(String(ticket.ticket_id))}><b>#{ticket.ticket_id} · {ticket.subject}</b><small>{isOwner ? short(ticket.wallet_address) : "Your ticket"} · {new Date(ticket.updated_at ?? ticket.created_at).toLocaleString()}</small><span className={`ticket-status ticket-${ticket.status}`}>{ticket.status}</span></button>)}</div><div className="support-thread">{selected ? <><h3>{selected.subject}</h3><div className="support-messages">{(selected.messages ?? []).map((item: any) => <article className={`support-message ${item.senderRole === "admin" ? "from-admin" : "from-member"}`} key={item.messageId ?? `${item.createdAt}-${item.message}`}><small>{item.senderRole === "admin" ? "Bit Five Support" : short(item.senderAddress)} · {new Date(item.createdAt).toLocaleString()}</small><p>{item.message}</p></article>)}</div><label className="field-label">{isOwner ? "Reply to member" : "Reply"}<textarea maxLength={3000} value={reply} onChange={event => setReply(event.target.value)} placeholder="Write a reply" /></label><button className="btn primary" disabled={busy || !reply.trim()} onClick={sendReply}>{busy ? "Sending…" : "Send reply"}</button></> : <p className="empty-state">Select a ticket to view its conversation.</p>}</div></div>}{status && <p className="helper-copy">{status}</p>}</section></div>;
}

function ActivityList({ activity }: { activity: Activity[] }) {
  if (!activity.length) return <p className="empty-state">No transactions to show yet.</p>;
  return <div className="activity-list">{activity.map((item, i) => <a key={`${item.transaction_hash}-${i}`} href={txUrl(item.transaction_hash)} target="_blank" rel="noreferrer" className="activity-row"><span className="activity-mark">{item.event_name === "Registered" ? "＋" : item.event_name === "Activated" ? "▣" : "↗"}</span><span className="activity-info"><b>{eventTitle(item)}</b><small>{new Date(item.block_timestamp).toLocaleString()} · ${short(item.transaction_hash)}</small></span><strong>{item.amount ? `$${Number(item.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "View tx"} ↗</strong></a>)}</div>;
}

function AdminPanel({ on, pending, toggle, ownerAddress, signMessageAsync, blockTarget, setBlockTarget, blockTargetValid, blockTargetAddress, blockTargetMember, blockTargetNotFound, targetBlocked, onBlock }: any) {
  return <section className="admin-panel"><div><small>PROTOCOL ADMIN</small><b>B5 claims: <em className={on ? "green" : "amber"}>{on ? "ON" : "OFF"}</em></b></div><button className="btn outline" disabled={pending} onClick={toggle}>Turn {on ? "OFF" : "ON"}</button>{setBlockTarget && <><label>Block or unblock by wallet or ID<input value={blockTarget} onChange={e => setBlockTarget(e.target.value)} placeholder="Wallet address or ID (B5-1265)" />{blockTargetMember && <small>Resolved: {blockTargetMember.member_code} · {short(blockTargetAddress)}</small>}{blockTargetNotFound && <small className="block-target-error">Member ID not found in indexed team.</small>}</label><button className="btn outline" disabled={pending || !blockTargetValid} onClick={onBlock}>{targetBlocked ? "Unblock wallet" : "Block wallet"}</button></>} {ownerAddress && signMessageAsync && <AdminMemberDirectory ownerAddress={ownerAddress} signMessageAsync={signMessageAsync} />}</section>;
}

function AdminMemberDirectory({ ownerAddress, signMessageAsync }: { ownerAddress: `0x${string}`; signMessageAsync: (args: { message: string }) => Promise<`0x${string}`> }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const authorization = useRef<{ signature: `0x${string}`; issuedAt: number } | null>(null);

  const load = async (nextPage = 1, nextSearch = search) => {
    setLoading(true); setError("");
    try {
      const now = Math.floor(Date.now() / 1000);
      let auth = authorization.current;
      if (!auth || now - auth.issuedAt > 240 || now < auth.issuedAt) {
        const issuedAt = now;
        const message = `Bit Five admin member directory\nChain ID: ${targetChainId}\nProtocol: ${protocolAddress.toLowerCase()}\nWallet: ${ownerAddress.toLowerCase()}\nIssued at: ${issuedAt}`;
        auth = { issuedAt, signature: await signMessageAsync({ message }) };
        authorization.current = auth;
      }
      const response = await fetch(`${apiBaseUrl}/api/v1/admin/members`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: ownerAddress, signature: auth.signature, issuedAt: auth.issuedAt, page: nextPage, pageSize: 25, search: nextSearch })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load the member directory.");
      setMembers(payload.members ?? []); setTotal(Number(payload.total ?? 0)); setPage(Number(payload.page ?? nextPage)); setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the member directory.");
    } finally { setLoading(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / 25));
  return <div className="admin-directory">
    <div className="admin-directory-heading"><div><b>Member names &amp; contacts</b><small>Owner-only access · member consent details stored off-chain</small></div><button className="btn outline" disabled={loading} onClick={() => open ? void load(1) : void load(1)}>{loading ? "Loading…" : open ? "Refresh list" : "View all members"}</button></div>
    {open && <>
      <div className="admin-directory-search"><input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void load(1, search); }} placeholder="Search ID, name, phone or wallet" /><button className="btn outline" disabled={loading} onClick={() => void load(1, search)}>Search</button></div>
      <div className="admin-directory-list">{members.map(member => <article className="admin-directory-row" key={member.wallet_address}><div><b>{member.member_code || "ID pending"} · {member.full_name || "Name not provided"}</b><small>{member.wallet_address}</small></div><span>{member.phone_number || "Phone not provided"}</span></article>)}{!members.length && !loading && <p className="empty-state">No member contact records match this search.</p>}</div>
      <div className="admin-directory-footer"><small>{total} member{total === 1 ? "" : "s"} · Page {page} of {totalPages}</small><div><button className="btn outline" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>Previous</button><button className="btn outline" disabled={loading || page >= totalPages} onClick={() => void load(page + 1)}>Next</button></div></div>
    </>}
    {error && <p className="admin-directory-error">{error}</p>}
  </div>;
}

function Stat({ label, value, note, icon, dualValues, tone }: { tone?: string; label: string; value?: string; note: string; icon: string; dualValues?: { label: string; value: string }[] }) { return <section className="stat-card"><span className="stat-icon">{icon}</span><small>{label}</small>{dualValues ? <div className="stat-dual-values">{dualValues.map(item => <span key={item.label} className={`dual-${item.label.toLowerCase()}`}>{item.label}<b>{item.value}</b></span>)}</div> : <b className={tone ? `stat-value-${tone}` : undefined}>{value}</b>}<span className="stat-note">{note}</span></section>; }
function Overview({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) { return <div className={`overview-row ${label === "B5 allocation" ? "allocation-overview-row" : ""}`}><span>{label}</span><div className="overview-value"><b className={tone ?? ""}>{value}</b>{note && <small>{note}</small>}</div></div>; }
function PageHeading({ title, subtitle }: { title: string; subtitle: string }) { return <div className="page-heading"><h2>{title}</h2><p>{subtitle}</p></div>; }
function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) { return <button className="quick-action" onClick={onClick}><span>{icon}</span><b>{label}</b><i>→</i></button>; }
function Notice({ tone, text }: { tone: "amber" | "green"; text: string }) { return <p className={`notice notice-${tone}`}>{text}</p>; }
function TxStatus({ status, hash }: { status: string; hash?: `0x${string}` }) { return <p className="tx-status">{status} {hash && <a href={txUrl(hash)} target="_blank" rel="noreferrer">View on BscScan ↗</a>}</p>; }






