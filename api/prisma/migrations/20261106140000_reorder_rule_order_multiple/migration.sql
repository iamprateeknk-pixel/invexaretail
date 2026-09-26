-- Audit O-4: case-pack / order multiple on a reorder rule. Nullable, additive.
ALTER TABLE "ReorderRule" ADD COLUMN "orderMultiple" DOUBLE PRECISION;
