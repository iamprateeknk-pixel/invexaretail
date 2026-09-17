-- P4: pick-face vs reserve bin designation + min/max for internal replenishment.

ALTER TABLE `Bin`
  ADD COLUMN IF NOT EXISTS `isPickFace` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS `pickFaceMin` DOUBLE NULL,
  ADD COLUMN IF NOT EXISTS `pickFaceMax` DOUBLE NULL;
