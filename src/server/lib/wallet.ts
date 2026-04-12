/**
 * Agent wallet generation — creates HD wallets for pay agents.
 *
 * Each pay agent can have a unique deposit address. The private key is
 * AES-256-GCM encrypted using the "agent-private-key" domain tag.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { log } from "@/server/lib/logger";
import { payAgentRepo, userRepo } from "@/server/repos";

import { encrypt } from "./crypto";

const DOMAIN_TAG = "agent-private-key";

interface GeneratedWallet {
  address: `0x${string}`;
  encryptedPrivateKey: string;
}

/** Generate a new random wallet and encrypt the private key. */
export function generateAgentWallet(): GeneratedWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const encryptedPrivateKey = encrypt(privateKey, DOMAIN_TAG);
  return { address: account.address, encryptedPrivateKey };
}

/**
 * Ensure an agent has a wallet address. If the agent already has one,
 * returns it. Otherwise generates a new wallet and updates the agent.
 *
 * This is the "lazy generation" path — called on key creation or first
 * wallet page access.
 */
export async function ensureAgentWallet(agentId: number): Promise<string> {
  const agent = await payAgentRepo.findById(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Already has an address — return it
  if (agent.address) return agent.address;

  // Generate new wallet
  const { address, encryptedPrivateKey } = generateAgentWallet();
  await payAgentRepo.update(agentId, {
    address,
    privateKey: encryptedPrivateKey,
  });

  log.blockchain.info({ agentId, address }, "Generated deposit wallet for agent");
  return address;
}

/**
 * Get the deposit address for an agent. Returns null if the agent has
 * no wallet yet (caller should call ensureAgentWallet first).
 */
export async function getAgentAddress(agentId: number): Promise<string | null> {
  const agent = await payAgentRepo.findById(agentId);
  return agent?.address ?? null;
}

/**
 * Get or create the user's single pay agent (wallet).
 * If the user already has an agentId, return it.
 * If not, create a new ledger agent, assign it to the user, generate a wallet address.
 */
export async function ensureUserAgent(userId: number): Promise<number> {
  // 1. Check if user already has an agent
  const user = await userRepo.findById(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  if (user.agentId) return user.agentId;

  // 2. Create new ledger agent (wallet) for this user — no API key needed
  const agent = await payAgentRepo.create({
    name: `[Wallet] ${user.name || user.email || `User #${userId}`}`,
    description: null,
    address: null,
    privateKey: null,
    type: "ledger",
    balance: "0",
    status: "active",
  });

  // 3. Link agent to user
  await userRepo.setAgentId(userId, agent.id);

  // 4. Generate deposit wallet (non-blocking)
  ensureAgentWallet(agent.id).catch((err) =>
    log.gateway.warn({ err, agentId: agent.id }, "Failed to generate wallet"),
  );

  return agent.id;
}
