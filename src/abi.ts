export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export const protocolAbi = [
  { type: "function", name: "rootUser", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "sponsorOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isRegistered", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "proposedSponsor", type: "address" }], outputs: [] },
  { type: "function", name: "positionCount", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "packages", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ name: "price", type: "uint256" }, { name: "dailyRateBps", type: "uint16" }, { name: "durationDays", type: "uint16" }] },
  { type: "function", name: "positions", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ name: "packageId", type: "uint8" }, { name: "activatedAt", type: "uint40" }, { name: "lastYieldAt", type: "uint40" }, { name: "yieldEndsAt", type: "uint40" }, { name: "principal", type: "uint256" }, { name: "roiCredited", type: "uint256" }, { name: "principalWithdrawn", type: "bool" }, { name: "boosterPaid", type: "bool" }, { name: "b5Claimed", type: "bool" }] },
  { type: "function", name: "earningsBalance", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingYield", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "directCount", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "teamVolume", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "leadershipRank", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint32" }] },
  { type: "function", name: "b5Allocation", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "b5UnlockAt", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "b5WithdrawEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "blocked", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "setBlocked", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "status", type: "bool" }], outputs: [] },
  { type: "function", name: "principalDeadline", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "canWithdrawPrincipal", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "activate", stateMutability: "nonpayable", inputs: [{ name: "packageId", type: "uint8" }, { name: "proposedSponsor", type: "address" }], outputs: [] },
  { type: "function", name: "claimYield", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdrawEarnings", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawPrincipal", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "p2pTransfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "claimB5", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setB5WithdrawEnabled", stateMutability: "nonpayable", inputs: [{ name: "enabled", type: "bool" }], outputs: [] }
] as const;

