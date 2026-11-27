export async function openProjectTools(page) {
  await page.getByLabel('项目菜单', { exact: true }).click();
  await page.getByRole('button', { name: '项目工具', exact: true }).click();
}
