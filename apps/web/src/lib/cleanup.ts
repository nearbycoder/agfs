import { collectGarbage } from "./garbage";
import { cleanupTurn } from "./resource-controls-cleanup";

export async function cleanupExpired(startCycle = true) {
  const result = await cleanupTurn(startCycle);
  if (result.active) await collectGarbage();
  return { uploads: result.uploads, recovery: result.recovery };
}
