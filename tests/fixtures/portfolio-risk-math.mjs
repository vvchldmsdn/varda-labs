export function makeRiskMathInput({
  series,
  weights,
  inputStatus = "ready",
  annualRiskFreeRate = 0,
}) {
  const keys = series.map((_, index) => `korea|KRW|RISK${index + 1}`);
  const observationCount = series[0]?.length ?? 0;
  return {
    inputStatus,
    annualRiskFreeRate,
    instruments: keys.map((instrumentKey, index) => ({
      instrumentKey,
      ticker: `RISK${index + 1}`,
      names: [`Risk ${index + 1}`],
      market: "korea",
      currency: "KRW",
      accounts: ["brokerage"],
      weight: weights[index],
    })),
    returnRows: Array.from({ length: observationCount }, (_, rowIndex) => ({
      previousServiceDate: serviceDate(rowIndex),
      serviceDate: serviceDate(rowIndex + 1),
      returns: keys.map((instrumentKey, instrumentIndex) => ({
        instrumentKey,
        value: series[instrumentIndex][rowIndex],
      })),
    })),
  };
}

export const parityRiskFixture = {
  // Hold the matrix constant to isolate formula and rounding differences.
  // returnType records each production path's source semantics.
  series: [
    [0.012, -0.007, 0.004, 0.015, -0.009, 0.006],
    [0.003, -0.011, 0.009, 0.005, -0.002, 0.013],
  ],
  weights: [0.6, 0.4],
  legacyExpected: {
    returnType: "log",
    roundedDuringCalculation: true,
    weightedAverageCorrelation: 0.628,
    correlationMatrix: [
      [1, 0.63],
      [0.63, 1],
    ],
    portfolioVolatilityAnnualizedPct: 13.4,
    weightedAverageVolatilityAnnualizedPct: 14.7,
    riskContributionEnb: 1.81,
    portfolioSharpe: 6.09,
    riskContributions: [
      { signedDaily: 0.00557, signedPct: 66.1 },
      { signedDaily: 0.00286, signedPct: 33.9 },
    ],
  },
  canonicalExpected: {
    returnType: "simple",
    roundedDuringCalculation: false,
    weightedAverageCorrelation: 0.6275780053601854,
    portfolioVolatilityAnnualized: 0.13369942408252924,
    weightedAverageVolatilityAnnualized: 0.14702151229088817,
    riskContributionEnb: 1.812226600128988,
    portfolioSharpe: 6.094267088967001,
    riskContributions: [
      {
        signedDaily: 0.005566668906130071,
        signedPct: 66.09462228153606,
      },
      {
        signedDaily: 0.0028556031547016525,
        signedPct: 33.90537771846394,
      },
    ],
  },
};

function serviceDate(offset) {
  const value = new Date(Date.UTC(2026, 0, 1 + offset));
  return value.toISOString().slice(0, 10);
}
