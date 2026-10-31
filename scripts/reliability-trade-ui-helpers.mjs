/** Select the optional cash-settlement path explicitly; the default is execution-only. */
export async function fillSettledTrade(scope, quantity, grossTotal) {
  await scope.getByLabel('체결 수량', { exact: true }).fill(quantity);
  const total = scope.getByLabel('체결 총액', { exact: true });
  if (!await total.isVisible()) {
    const summary = scope.locator('summary').filter({ hasText: /^수수료·정산/ });
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
    await scope.getByRole('button', { name: '체결 총액 수수료·세금 제외', exact: true }).click();
  }
  await total.fill(grossTotal);
}
