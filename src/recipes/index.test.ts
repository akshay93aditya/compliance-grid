import { describe, expect, it } from 'vitest';
import { findRecipe, listRecipes } from './index';

describe('recipe registry', () => {
  it('lists at least the karmika recipe', () => {
    const recipes = listRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    expect(recipes.map((r) => r.name)).toContain('karmika-spandana-ka');
  });

  it('finds the karmika recipe for karmika URLs', () => {
    const recipe = findRecipe('https://karmikaspandana.karnataka.gov.in/');
    expect(recipe?.name).toBe('karmika-spandana-ka');
  });

  it('returns undefined for unknown URLs', () => {
    expect(findRecipe('https://example.com/')).toBeUndefined();
  });
});
