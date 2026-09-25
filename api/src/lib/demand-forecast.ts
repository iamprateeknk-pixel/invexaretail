// Blueprint P8 "Forecasting, replenishment and Action Center 2.0". Per
// §8's explicit rule - "use deterministic calculations first, add ML only
// where it improves measurable accuracy, every recommendation must show why
// it was generated" - this is plain statistics over the item's own sales
// history: no model, no training, every number traces back to an input the
// caller can see.

export type DemandStats = {
  averageDailyDemand: number;
  stdDevDailyDemand: number;
  sampleDays: number;
};

/**
 * dailyDemand: units sold per day over the observation window (zeros for
 * no-sale days included, so a slow mover's average is genuinely low, not
 * inflated by only counting days it sold).
 */
export function computeDemandStats(dailyDemand: number[]): DemandStats {
  const sampleDays = dailyDemand.length;
  if (sampleDays === 0) return { averageDailyDemand: 0, stdDevDailyDemand: 0, sampleDays: 0 };
  const averageDailyDemand = dailyDemand.reduce((sum, value) => sum + value, 0) / sampleDays;
  const variance = dailyDemand.reduce((sum, value) => sum + (value - averageDailyDemand) ** 2, 0) / sampleDays;
  return { averageDailyDemand, stdDevDailyDemand: Math.sqrt(variance), sampleDays };
}

export function forecastDemand(averageDailyDemand: number, days: number): number {
  return averageDailyDemand * days;
}

// Standard normal z-scores for common service levels - a fixed lookup
// table, not a fitted/learned value, so a chosen service level always maps
// to the same safety stock for the same demand history.
const SERVICE_LEVEL_Z: Record<number, number> = {
  90: 1.2816,
  95: 1.6449,
  98: 2.0537,
  99: 2.3263,
  99.5: 2.5758,
};

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
function inverseNormalCdf(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * z-score for ANY service level between 50% and 99.99%. The five tabulated values
 * are kept verbatim; anything else is computed. The old version silently fell back
 * to the 95% z-score for every other input, so asking for a 97% or 99.9% service
 * level quietly produced 95% safety stock (audit P1-4).
 */
export function serviceLevelZ(servicePercent: number): number {
  if (!Number.isFinite(servicePercent) || servicePercent < 50 || servicePercent > 99.99) {
    throw new RangeError('servicePercent must be between 50 and 99.99.');
  }
  return SERVICE_LEVEL_Z[servicePercent] ?? inverseNormalCdf(servicePercent / 100);
}

/**
 * King's formula: accounts for variability in both daily demand and lead
 * time. leadTimeStdDevDays defaults to 0 (a fixed lead time), which reduces
 * this to the simpler z * stdDev * sqrt(leadTime) form.
 */
export function computeSafetyStock(input: {
  averageDailyDemand: number;
  stdDevDailyDemand: number;
  averageLeadTimeDays: number;
  leadTimeStdDevDays?: number;
  servicePercent?: number;
}): number {
  const leadTimeStdDevDays = input.leadTimeStdDevDays ?? 0;
  const z = serviceLevelZ(input.servicePercent ?? 95);
  const demandVarianceTerm = input.averageLeadTimeDays * input.stdDevDailyDemand ** 2;
  const leadTimeVarianceTerm = input.averageDailyDemand ** 2 * leadTimeStdDevDays ** 2;
  return z * Math.sqrt(Math.max(0, demandVarianceTerm + leadTimeVarianceTerm));
}

/**
 * null means "won't stock out on current trend" (zero or negative demand),
 * not zero days - those are very different states for a reorder screen.
 */
export function computeDaysCover(onHand: number, averageDailyDemand: number): number | null {
  if (averageDailyDemand <= 0) return null;
  return Math.max(0, onHand / averageDailyDemand);
}

export function projectedStockoutDate(onHand: number, averageDailyDemand: number, from: Date = new Date()): string | null {
  const daysCover = computeDaysCover(onHand, averageDailyDemand);
  if (daysCover === null) return null;
  return new Date(from.getTime() + daysCover * 24 * 60 * 60 * 1000).toISOString();
}

export type ReplenishmentSuggestion = {
  averageDailyDemand: number;
  daysCover: number | null;
  safetyStock: number;
  reorderPoint: number;
  suggestedOrderQty: number;
  stockoutDate: string | null;
};

/**
 * Ties the pieces above into one reorder suggestion: reorder point is
 * safety stock plus expected demand during lead time; suggested quantity
 * tops on-hand + on-order back up to that point plus one lead time's worth
 * of cover, never negative.
 */
export function suggestReplenishment(input: {
  onHand: number;
  onOrder: number;
  demand: DemandStats;
  averageLeadTimeDays: number;
  leadTimeStdDevDays?: number;
  servicePercent?: number;
}): ReplenishmentSuggestion {
  const safetyStock = computeSafetyStock({
    averageDailyDemand: input.demand.averageDailyDemand,
    stdDevDailyDemand: input.demand.stdDevDailyDemand,
    averageLeadTimeDays: input.averageLeadTimeDays,
    leadTimeStdDevDays: input.leadTimeStdDevDays,
    servicePercent: input.servicePercent,
  });
  const demandDuringLeadTime = forecastDemand(input.demand.averageDailyDemand, input.averageLeadTimeDays);
  const reorderPoint = safetyStock + demandDuringLeadTime;
  const target = reorderPoint + demandDuringLeadTime;
  const position = input.onHand + input.onOrder;
  const suggestedOrderQty = Math.max(0, target - position);

  return {
    averageDailyDemand: input.demand.averageDailyDemand,
    daysCover: computeDaysCover(input.onHand, input.demand.averageDailyDemand),
    safetyStock,
    reorderPoint,
    suggestedOrderQty,
    stockoutDate: projectedStockoutDate(input.onHand, input.demand.averageDailyDemand),
  };
}

// ---- demand pattern classification and intermittent-demand forecasting (audit O-2) ----

export type DemandPattern = 'SMOOTH' | 'ERRATIC' | 'INTERMITTENT' | 'LUMPY' | 'NO_DEMAND';
export type VariabilityClass = 'X' | 'Y' | 'Z';

/**
 * Syntetos-Boylan classification. ADI = average number of periods between demands; CV2 = squared
 * coefficient of variation of the NON-ZERO demand sizes. Cut-offs 1.32 and 0.49 are the standard
 * ones. A slow mover that sells 5 units once every ten days is INTERMITTENT: averaging its zeros
 * and applying a normal-distribution safety stock (what suggestReplenishment does) misstates both.
 */
export function classifyDemandPattern(dailyDemand: number[]): { pattern: DemandPattern; adi: number | null; cv2: number | null } {
  const sizes = dailyDemand.filter((value) => value > 0);
  if (sizes.length === 0) return { pattern: 'NO_DEMAND', adi: null, cv2: null };
  const adi = dailyDemand.length / sizes.length;
  const mean = sizes.reduce((sum, value) => sum + value, 0) / sizes.length;
  const variance = sizes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sizes.length;
  const cv2 = mean > 0 ? variance / (mean * mean) : 0;
  const pattern: DemandPattern = adi < 1.32 ? (cv2 < 0.49 ? 'SMOOTH' : 'ERRATIC') : (cv2 < 0.49 ? 'INTERMITTENT' : 'LUMPY');
  return { pattern, adi, cv2 };
}

/** X/Y/Z by coefficient of variation of daily demand (<0.5, <1.0, otherwise); no demand is Z. */
export function xyzClass(dailyDemand: number[]): VariabilityClass {
  const stats = computeDemandStats(dailyDemand);
  if (stats.averageDailyDemand <= 0) return 'Z';
  const cv = stats.stdDevDailyDemand / stats.averageDailyDemand;
  return cv < 0.5 ? 'X' : cv < 1 ? 'Y' : 'Z';
}

/**
 * Croston's method with the Syntetos-Boylan bias correction: smooths demand SIZE and the INTERVAL
 * between demands separately, forecast = size / interval x (1 - alpha/2). Returns units per day.
 */
export function crostonDailyDemand(dailyDemand: number[], alpha = 0.1): number {
  let size: number | null = null;
  let interval: number | null = null;
  let sinceLast = 1;
  for (const value of dailyDemand) {
    if (value > 0) {
      size = size === null ? value : alpha * value + (1 - alpha) * size;
      interval = interval === null ? sinceLast : alpha * sinceLast + (1 - alpha) * interval;
      sinceLast = 1;
    } else {
      sinceLast += 1;
    }
  }
  if (size === null || interval === null || interval <= 0) return 0;
  return (size / interval) * (1 - alpha / 2);
}

/**
 * Opening on-hand balance for each day of the window, reconstructed backwards from today's balance
 * and every stock movement since the window started (signed deltas). Day 0 is the first day.
 */
export function openingBalancesByDay(input: { currentOnHand: number; movements: Array<{ qtyDelta: number; timestamp: Date }>; windowStart: Date; windowDays: number }): number[] {
  const DAY = 86_400_000;
  const startMs = input.windowStart.getTime();
  const deltaByDay = new Array<number>(input.windowDays).fill(0);
  for (const movement of input.movements) {
    const index = Math.floor((movement.timestamp.getTime() - startMs) / DAY);
    if (index >= 0 && index < input.windowDays) deltaByDay[index] += movement.qtyDelta;
  }
  const opening = new Array<number>(input.windowDays).fill(0);
  let closing = input.currentOnHand;
  for (let day = input.windowDays - 1; day >= 0; day -= 1) {
    const open = closing - deltaByDay[day];
    opening[day] = open;
    closing = open;
  }
  return opening;
}

/**
 * Stockout censoring (audit O-2): a day with nothing on the shelf at opening and no sales did not
 * have zero DEMAND, it had no supply - counting it as zero understates the true rate. Those days
 * are dropped from the demand series; days that sold anything are always kept.
 */
export function censorStockoutDays(dailyDemand: number[], openingBalances: number[]): { demand: number[]; censoredDays: number } {
  const demand: number[] = [];
  let censoredDays = 0;
  dailyDemand.forEach((value, day) => {
    if (value <= 0 && (openingBalances[day] ?? 1) <= 0) censoredDays += 1;
    else demand.push(value);
  });
  return { demand, censoredDays };
}
