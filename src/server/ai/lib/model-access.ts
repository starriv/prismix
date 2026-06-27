import type { AiModel } from "@/server/db";
import { aiModelGrayUserRepo } from "@/server/repos";

import type { ConsumerSession } from "../middleware/consumer-key-auth";

export type ModelAccessDenyReason = "key_acl" | "gray_release";

export interface ModelAccessDecision {
  allowed: boolean;
  reason?: ModelAccessDenyReason;
}

export function modelIdMatchesPattern(modelId: string, pattern: string): boolean {
  return pattern.endsWith("*") ? modelId.startsWith(pattern.slice(0, -1)) : modelId === pattern;
}

export function isModelAllowedByConsumerKey(modelId: string, allowedModels: string[]): boolean {
  if (allowedModels.length === 0) return true;
  return allowedModels.some((pattern) => modelIdMatchesPattern(modelId, pattern));
}

export function isGrayModelVisibleToUser(
  model: Pick<AiModel, "id" | "grayReleaseEnabled">,
  userId: number | null,
  grayModelIdsForUser: ReadonlySet<number>,
): boolean {
  if (!model.grayReleaseEnabled) return true;
  if (!userId) return false;
  return grayModelIdsForUser.has(model.id);
}

export async function canConsumerAccessModel(
  consumer: Pick<ConsumerSession, "allowedModels" | "userId">,
  model: Pick<AiModel, "id" | "modelId" | "grayReleaseEnabled">,
): Promise<ModelAccessDecision> {
  if (!isModelAllowedByConsumerKey(model.modelId, consumer.allowedModels)) {
    return { allowed: false, reason: "key_acl" };
  }

  if (!model.grayReleaseEnabled) return { allowed: true };
  if (!consumer.userId) return { allowed: false, reason: "gray_release" };

  const allowed = await aiModelGrayUserRepo.isUserAllowedForModel(model.id, consumer.userId);
  return allowed ? { allowed: true } : { allowed: false, reason: "gray_release" };
}

export async function filterModelsForConsumer<T extends { model: AiModel }>(
  rows: T[],
  consumer: Pick<ConsumerSession, "allowedModels" | "userId">,
): Promise<T[]> {
  const grayModelIds = rows
    .filter((row) => row.model.grayReleaseEnabled)
    .map((row) => row.model.id);
  const grayModelIdsForUser =
    consumer.userId && grayModelIds.length > 0
      ? await aiModelGrayUserRepo.findUserModelIds(consumer.userId, grayModelIds)
      : new Set<number>();

  return rows.filter(
    (row) =>
      isModelAllowedByConsumerKey(row.model.modelId, consumer.allowedModels) &&
      isGrayModelVisibleToUser(row.model, consumer.userId, grayModelIdsForUser),
  );
}
