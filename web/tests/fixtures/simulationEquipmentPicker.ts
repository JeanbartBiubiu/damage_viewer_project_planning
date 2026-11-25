import { expect, type Locator, type Page } from '@playwright/test';

export const equipmentField = (page: Page, label: string) => page.getByRole('group', { name: label, exact: true });
export const equipmentTrigger = (page: Page, label: string) => equipmentField(page, label).getByRole('button', { name: label, exact: true });
export const equipmentSearch = (picker: Locator) => picker.getByRole('searchbox', { name: '搜索装备', exact: true });
export const equipmentTile = (picker: Locator, key: string) => picker.locator(`button[data-equipment-key="${key}"]`);
export const selectedEquipment = (page: Page, label: string) => equipmentField(page, label).getByRole('list', { name: '已选装备', exact: true });

export async function openEquipmentPicker(page: Page, label: string) {
  const trigger = equipmentTrigger(page, label);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const picker = page.getByRole('dialog', { name: label, exact: true });
  await expect(picker).toBeVisible();
  return picker;
}

export async function chooseSimulationEquipment(page: Page, label: string, key: string) {
  const picker = await openEquipmentPicker(page, label);
  await equipmentSearch(picker).fill(key);
  await equipmentTile(picker, key).click();
  await picker.getByRole('button', { name: '完成', exact: true }).click();
  await expect(picker).toBeHidden();
}
