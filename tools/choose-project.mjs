// Choosing a project used to mean expanding its row in a tree. The bar holds one project at a time
// now, so it means opening the switcher and picking from its list. Every browser tool that drives
// the sidebar goes through here, so the next change to that gesture is one edit rather than six.
export async function chooseProject(page, name, { settle = 140 } = {}) {
  const trigger = page.locator('.margin-switch-trigger');
  if (await trigger.count() === 0) {                       // a bar that predates the switcher
    const row = page.locator(`[data-project-id="${name}"]`);
    if (await row.getAttribute('aria-expanded') !== 'true') await row.click();
    return;
  }
  if (await trigger.getAttribute('data-current-project') === name) {
    await closeSwitcher(page);
    return;
  }
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.locator(`.margin-switch-menu [data-project-id="${name}"]`).click();
  await page.waitForTimeout(settle);
}
export async function closeSwitcher(page) {
  const trigger = page.locator('.margin-switch-trigger');
  if (await trigger.count() && await trigger.getAttribute('aria-expanded') === 'true') await trigger.click();
}
/** The project's settings card, which now lives behind the gear in the switcher's list. */
export async function openProjectCard(page, name) {
  const trigger = page.locator('.margin-switch-trigger');
  if (await trigger.count() && await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.getByRole('button', { name: `Project settings for ${name}`, exact: true }).click();
  await page.locator('.margin-card:not([hidden])').waitFor();
}
