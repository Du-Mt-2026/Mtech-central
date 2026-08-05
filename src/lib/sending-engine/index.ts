// Sending Engine — public barrel.
//
// Re-exports the public API of the sending engine so existing imports of the
// form `import { startCampaign, processNextMessage } from '@/lib/sending-engine'`
// continue to resolve after the file was split into the sending-engine/ folder.
//
// Originally `src/lib/sending-engine.ts` exposed 7 async functions. This barrel
// preserves that exact public surface — no new exports, no removed exports.

export { startCampaign } from './startCampaign'
export { processNextMessage, processCampaign } from './processNextMessage'
export {
  recoverStuckMessages,
  releaseStaleCampaignSlots,
  getRunningCampaigns,
} from './recovery'
export { performBreakWindowReadingPresence } from './humanBehavior'
