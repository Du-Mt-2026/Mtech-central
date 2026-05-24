import { fetchOctupusZapInstances, INSTANCE_PREFIX } from '@/lib/evolution-api';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // Fetch only OctupusZap instances from Evolution Go (real-time)
    const instances = await fetchOctupusZapInstances();

    // Get all chips that have an evolution instance linked
    const chips = await db.chip.findMany({
      where: { evolutionInstance: { not: null } },
    });

    // Build a set of instance names linked to chips
    const chipInstanceNames = new Set(
      chips.map((chip) => chip.evolutionInstance!)
    );

    let synced = 0;
    const unlinked: string[] = [];

    // Process each OctupusZap Evolution Go instance
    for (const instance of instances) {
      if (chipInstanceNames.has(instance.name)) {
        // This instance is linked to a chip — sync its status
        const newStatus = instance.connected ? 'connected' : 'disconnected';

        const chip = chips.find((c) => c.evolutionInstance === instance.name);
        if (chip && chip.status !== newStatus) {
          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: newStatus,
              lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
              profileName: instance.profileName || chip.profileName,
              profilePicUrl: instance.profilePicUrl || chip.profilePicUrl,
              disconnectionReasonCode: instance.disconnectionReasonCode ?? null,
            },
          });
          synced++;
        } else if (chip) {
          // Status is already in sync, but update profile info if available
          if (instance.profileName || instance.profilePicUrl) {
            await db.chip.update({
              where: { id: chip.id },
              data: {
                profileName: instance.profileName || chip.profileName,
                profilePicUrl: instance.profilePicUrl || chip.profilePicUrl,
                disconnectionReasonCode: instance.disconnectionReasonCode ?? null,
              },
            });
          }
          synced++;
        }
      } else {
        // This OctupusZap instance is not linked to any chip yet
        unlinked.push(instance.name);
      }
    }

    // Also check for chips whose evolution instances no longer exist in Evolution Go
    const instanceNames = new Set(instances.map((inst) => inst.name));
    for (const chip of chips) {
      // Only care about chips with OctupusZap prefix
      if (chip.evolutionInstance && !chip.evolutionInstance.startsWith(INSTANCE_PREFIX)) {
        continue;
      }
      if (chip.evolutionInstance && !instanceNames.has(chip.evolutionInstance)) {
        await db.chip.update({
          where: { id: chip.id },
          data: { status: 'disconnected', isQrPaired: false },
        });
        synced++;
      }
    }

    return NextResponse.json({
      synced,
      unlinked,
      totalInstances: instances.length,
      totalChips: chips.filter(c => c.evolutionInstance?.startsWith(INSTANCE_PREFIX)).length,
      prefix: INSTANCE_PREFIX,
    });
  } catch (error) {
    console.error('Error syncing WhatsApp instances:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync WhatsApp instances' },
      { status: 500 }
    );
  }
}
