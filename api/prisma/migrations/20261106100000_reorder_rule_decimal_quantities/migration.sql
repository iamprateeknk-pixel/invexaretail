-- Audit O-4: reorder minimum/target become fractional so loose/KG items can have e.g. a 2.5 kg minimum.
-- Widening INTEGER -> DOUBLE PRECISION is lossless for every existing row.
-- Rollback: only possible while no rule holds a fractional value (ALTER ... TYPE INTEGER USING ROUND(...)).
ALTER TABLE "ReorderRule" ALTER COLUMN "minQty" SET DATA TYPE DOUBLE PRECISION;
ALTER TABLE "ReorderRule" ALTER COLUMN "targetQty" SET DATA TYPE DOUBLE PRECISION;
