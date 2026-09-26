-- Audit S-1: manufacturing date on a lot, so remaining shelf life can be computed and a minimum RSL enforced. Nullable, additive.
ALTER TABLE "Lot" ADD COLUMN "manufacturedAt" TIMESTAMP(3);
