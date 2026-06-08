import { createTableListingRecipe } from './factory';

// Per-portal recipe for Karmika Spandana, the Karnataka Department of Labour
// documents portal. Listing pages contain tables of labour acts and rules
// formatted roughly as: `<serial> <DD-MM-YYYY> <TITLE> View`, with the
// "View" link being the PDF. Defaults from createTableListingRecipe match
// this format exactly, so the recipe is a one-liner against the factory.
export const karmikaRecipe = createTableListingRecipe({
  name: 'karmika-spandana-ka',
  hostMatcher: (url) =>
    /^https?:\/\/karmikaspandana\.karnataka\.gov\.in/i.test(url),
});
