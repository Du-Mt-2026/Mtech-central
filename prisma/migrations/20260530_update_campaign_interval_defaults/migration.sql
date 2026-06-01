-- AlterTable: Update Campaign interval defaults to match AntiBan safety floor
-- Campaigns created with old defaults (30-90s) were sending FASTER than the
-- AntiBan UI setting (59-148s), effectively bypassing the user's antiban config.
-- New defaults: 59s min, 148s max (same as AntiBanSettings.messageIntervalMin/Max)

-- Update existing campaigns that still have the old 30-90s defaults
-- (only if they haven't been explicitly modified by the user)
UPDATE "Campaign"
SET "sendIntervalMin" = 59
WHERE "sendIntervalMin" = 30;

UPDATE "Campaign"
SET "sendIntervalMax" = 148
WHERE "sendIntervalMax" = 90;

-- Also update the AntiBanSettings defaultSendInterval* to match
UPDATE "AntiBanSettings"
SET "defaultSendIntervalMin" = 59
WHERE "defaultSendIntervalMin" = 30;

UPDATE "AntiBanSettings"
SET "defaultSendIntervalMax" = 148
WHERE "defaultSendIntervalMax" = 90;
