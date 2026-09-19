-- Blueprint v4 §6 "Operations" field group: canonical count/pick method
-- and lot policy live on the Item master itself instead of being inferred
-- ad hoc per screen. Defaults preserve today's de facto behavior (scan and
-- increment, whole units, lot required) for every existing item.
ALTER TABLE `Item`
  ADD COLUMN `countMethod` VARCHAR(191) NOT NULL DEFAULT 'LOT_SCAN',
  ADD COLUMN `pickMethod` VARCHAR(191) NOT NULL DEFAULT 'LOT_SCAN',
  ADD COLUMN `allocationStrategy` VARCHAR(191) NOT NULL DEFAULT 'FEFO',
  ADD COLUMN `lotRequired` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `expiryRequired` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `decimalQuantity` BOOLEAN NOT NULL DEFAULT false;
