import { z } from 'zod';

/** How many stars a rating has, from 1 to 5 (spec §3.2). */
export const starsSchema = z.number().int().min(1).max(5);

/** What `PUT /recipes/{id}/rating` sets: the caller's rating of the recipe. */
export const ratingRequestSchema = z.object({ stars: starsSchema }).meta({ id: 'RatingRequest' });

export type RatingRequest = z.infer<typeof ratingRequestSchema>;

const summaryShape = {
  average: z
    .number()
    .nullable()
    .describe('The mean of its ratings, in stars, unrounded. `null` while it has none.'),
  count: z.number().int().describe('How many ratings it has.'),
};

/** A recipe's ratings, as its card shows them. */
export const ratingSummarySchema = z.object(summaryShape).meta({ id: 'RatingSummary' });

export type RatingSummary = z.infer<typeof ratingSummarySchema>;

/** A recipe's ratings, and the caller's own: what its page shows. */
export const recipeRatingSchema = z
  .object({
    ...summaryShape,
    mine: starsSchema
      .nullable()
      .describe("The caller's own rating. `null` if they haven't rated it, as viewers can't."),
  })
  .meta({ id: 'RecipeRating' });

export type RecipeRating = z.infer<typeof recipeRatingSchema>;
