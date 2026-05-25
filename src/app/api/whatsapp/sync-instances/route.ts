import { fetchAllInstances } from '@/lib/evolution-router';
import { INSTANCE_PREFIX } from '@/lib/evolution-api';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // Fetch instances from Evolution Go (v3) API
    const instances = await fetchAllInstances();

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

    // Process each instance
    for (const instance of instances) {
      if (chipInstanceNames.has(instance.name)) {
        // This instance is linked to a chip — sync its status
        const isConnected = instance.connected || instance.connectionStatus === 'open'
        const newStatus = isConnected ? 'connected' : 'disconnected';

        const chip = chips.find((c) => c.evolutionInstance === instance.name);
        if (chip && chip.status !== newStatus) {
          await db.chip.update({
            where: { id: chip.id },
            data: {
              status: newStatus,
              lastSeen: newStatus === 'connected' ? new Date() : chip.lastSeen,
              profileName: instance.profileName || chip.profileName,
              profilePicUrl: instance.profilePicUrl || chip.profilePicUrl,
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
              },
            });
          }
          synced++;
        }
      } else {
        // This instance is not linked to any chip yet
        unlinked.push(instance.name);
      }
    }

    // Also check for chips whose evolution instances no longer exist
    const instanceNames = new Set(instances.map((inst) => inst.name));
    for (const chip of chips) {
      if (chip.evolutionInstance && chip.evolutionInstance.startsWith(INSTANCE_PREFIX) && !instanceNames.has(chip.evolutionInstance)) {
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
      totalChips: chips.length,
    });
  } catch (error) {
    console.error('Error syncing WhatsApp instances:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync WhatsApp instances' },
      { status: 500 }
    );
  }
}
