import { createAppKit } from "@reown/appkit/react";
import { defineChain } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

export const protocolAddress = (import.meta.env.VITE_PROTOCOL_ADDRESS ?? "0x29546538f0d35ded297a6fAb86FAbd3c7fe16367") as `0x${string}`;
export const usdtAddress = (import.meta.env.VITE_USDT_ADDRESS ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const b5Address = (import.meta.env.VITE_B5_ADDRESS ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const b5TreasuryAddress = "0x95Cf6ed3660F2284a1236636502e57f5921d5154" as `0x${string}`;
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "https://bit5-api.testingsoftwares.online";
export const zeroAddress = "0x0000000000000000000000000000000000000000";
export const contractsConfigured = protocolAddress !== zeroAddress && usdtAddress !== zeroAddress && b5Address !== zeroAddress;
export const reownProjectId = import.meta.env.VITE_REOWN_PROJECT_ID ?? "a768ccf02fd5aebe0f1174790b69cbf7";

export const targetChainId = 56;
export const targetNetworkName = "BNB Smart Chain";
export const explorerUrl = "https://bscscan.com";
const bscMainnetNetwork = defineChain({
  id: targetChainId,
  caipNetworkId: "eip155:56",
  chainNamespace: "eip155",
  name: targetNetworkName,
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.bnbchain.org"] } },
  blockExplorers: { default: { name: "BscScan", url: explorerUrl } }
});
const networks = [bscMainnetNetwork] as [typeof bscMainnetNetwork, ...typeof bscMainnetNetwork[]];
const metadata = {
  name: "Bit Five",
  description: "Bit Five on BNB Smart Chain",
  url: window.location.origin,
  icons: [`${window.location.origin}/brand.jpeg`]
};

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: reownProjectId,
  ssr: false
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: bscMainnetNetwork,
  projectId: reownProjectId,
  metadata,
  enableWallets: true,
  enableNetworkSwitch: true,
  features: { analytics: false }
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

