-- RemoveEvolutionApiVersion: Drop the evolutionApiVersion column since v2 support has been removed.
-- All instances now use Evolution Go (v3) exclusively.
ALTER TABLE "Chip" DROP COLUMN "evolutionApiVersion";
