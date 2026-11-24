import {
  ALLERGENS,
  type CreateRecipeRequest,
  can,
  type Difficulty,
  parseIngredient,
  type TagType,
  tagNameKey,
  type Visibility,
} from '@myli/shared';
import { and, eq } from 'drizzle-orm';
import { addToCollection, createCollection } from '../collections/collections.ts';
import { addComment } from '../comments/comments.ts';
import type { Db } from '../db/database.ts';
import { tag } from '../db/schema.ts';
import { saveNote } from '../notes/notes.ts';
import { setRating } from '../ratings/ratings.ts';
import { createRecipe } from '../recipes/recipes.ts';
import { findOrCreateTag } from '../tags/tags.ts';

type Nutrition = CreateRecipeRequest['nutrition'];

/** Nutrition nobody entered. */
const NO_NUTRITION: Nutrition = {
  calories: null,
  proteinGrams: null,
  carbsGrams: null,
  fatGrams: null,
  fiberGrams: null,
  sugarGrams: null,
  sodiumMilligrams: null,
};

/**
 * The demo instance's recipes (spec §5, Demo data), written for myli. Ingredients are lines as
 * someone would type them, which the shared parser reads, as the editor does.
 */
export interface DemoRecipe {
  title: string;
  /** Which demo account wrote it. */
  owner: 'admin' | 'editor';
  /** Shared unless it says otherwise. */
  visibility?: Visibility;
  /** Markdown. */
  description: string;
  servings: number;
  yield?: { qty: number; unit: string };
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes?: number;
  difficulty: Difficulty;
  equipment?: string[];
  /** Per serving: what's left out is unknown. */
  nutrition?: Partial<Record<keyof Nutrition, number>>;
  /** One list of lines, or groups of them under a label. */
  ingredients: string[] | { label: string; lines: string[] }[];
  /** Markdown, one step each. */
  steps: string[];
  tags: Partial<Record<Exclude<TagType, 'allergen'>, string[]>> & {
    allergen?: (typeof ALLERGENS)[number][];
  };
  /** The stars each demo account gave it. */
  ratings?: Partial<Record<DemoRecipe['owner'], number>>;
  /** Comments from the demo accounts, oldest first, in markdown. */
  comments?: { by: DemoRecipe['owner']; body: string }[];
  /** Each demo account's personal note on it, in markdown. */
  notes?: Partial<Record<DemoRecipe['owner'], string>>;
}

/** The demo accounts' collections, each of recipes its owner can see, by their titles. */
export const DEMO_COLLECTIONS: readonly {
  owner: DemoRecipe['owner'];
  name: string;
  recipes: string[];
}[] = [
  {
    owner: 'editor',
    name: 'Weeknight dinners',
    recipes: [
      'Weeknight Chickpea Curry',
      'Spaghetti Aglio e Olio',
      'Black Bean Tacos',
      'Miso-Glazed Salmon',
    ],
  },
  {
    owner: 'admin',
    name: 'Baking',
    recipes: ['Grandma’s Apple Pie', 'Banana Bread', 'Chocolate Chip Cookies'],
  },
];

export const DEMO_RECIPES: readonly DemoRecipe[] = [
  {
    title: 'Grandma’s Apple Pie',
    owner: 'admin',
    visibility: 'private',
    description:
      'The family pie, kept private until it’s written down *exactly* as she made it. Use a mix of tart and sweet apples.',
    servings: 8,
    yield: { qty: 1, unit: 'pie' },
    prepMinutes: 45,
    cookMinutes: 60,
    totalMinutes: 225,
    difficulty: 'hard',
    equipment: ['9-inch pie dish', 'Rolling pin'],
    ingredients: [
      {
        label: 'Crust',
        lines: [
          '2 1/2 cups all-purpose flour',
          '1 tsp salt',
          '1 tbsp sugar',
          '1 cup cold butter, cubed',
          '6–8 tbsp ice water',
        ],
      },
      {
        label: 'Filling',
        lines: [
          '6 apples, peeled and sliced',
          '3/4 cup sugar',
          '2 tbsp all-purpose flour',
          '1 tsp ground cinnamon',
          '1/4 tsp ground nutmeg',
          '1 tbsp lemon juice',
          '1 egg, beaten',
        ],
      },
    ],
    steps: [
      'Whisk the flour, salt and sugar. Cut in the butter until the pieces are the size of peas.',
      'Stir in ice water a tablespoon at a time until the dough holds together. Divide it in two, wrap and chill for **at least an hour**.',
      'Heat the oven to 425°F. Toss the apples with the sugar, flour, spices and lemon juice.',
      'Roll out one disk and line the dish. Add the filling, cover with the second disk, crimp the edges and cut a few vents.',
      'Brush with the egg and bake for 15 minutes, then lower the oven to 375°F and bake 45 minutes more, until the filling bubbles.',
      'Cool for **at least two hours** before slicing, so the filling sets.',
    ],
    tags: {
      cuisine: ['American'],
      meal_type: ['Dessert'],
      diet: ['Vegetarian'],
      allergen: ['wheat', 'milk', 'eggs'],
      custom: ['Holiday'],
    },
  },
  {
    title: 'Hummus',
    owner: 'admin',
    description:
      'Smoother than store-bought. The trick is **ice water**, added while the processor runs.',
    servings: 6,
    prepMinutes: 10,
    cookMinutes: null,
    difficulty: 'easy',
    equipment: ['Food processor'],
    ingredients: [
      '1 (15 oz) can chickpeas, drained',
      '1/3 cup tahini',
      '3 tbsp lemon juice',
      '1 clove garlic',
      '1/2 tsp ground cumin',
      '3 tbsp ice water',
      '2 tbsp olive oil',
      'salt to taste',
    ],
    steps: [
      'Blend the tahini and lemon juice for a minute, until whipped and pale.',
      'Add the garlic, cumin and a pinch of salt, then the chickpeas, and blend until thick.',
      'With the processor running, pour in the ice water and blend for two minutes more, until very smooth.',
      'Spread in a shallow bowl and pour over the olive oil.',
    ],
    tags: {
      cuisine: ['Middle Eastern'],
      meal_type: ['Snack'],
      diet: ['Vegan', 'Gluten-free'],
      allergen: ['sesame'],
    },
  },
  {
    title: 'Classic Buttermilk Pancakes',
    owner: 'admin',
    description: 'Tall, fluffy pancakes. Don’t overmix: a few lumps are what you want.',
    servings: 4,
    yield: { qty: 12, unit: 'pancakes' },
    prepMinutes: 10,
    cookMinutes: 20,
    difficulty: 'easy',
    equipment: ['Griddle or large skillet'],
    nutrition: {
      calories: 390,
      proteinGrams: 12,
      carbsGrams: 56,
      fatGrams: 13,
      sodiumMilligrams: 820,
    },
    ingredients: [
      '2 cups all-purpose flour',
      '2 tbsp sugar',
      '2 tsp baking powder',
      '1/2 tsp baking soda',
      '1/2 tsp salt',
      '2 cups buttermilk',
      '2 eggs',
      '3 tbsp butter, melted',
    ],
    steps: [
      'Whisk the flour, sugar, baking powder, baking soda and salt in a large bowl.',
      'Whisk the buttermilk, eggs and butter in another, pour them into the dry ingredients and stir until *just* combined.',
      'Heat a lightly buttered griddle over medium heat. Pour 1/4 cup of batter for each pancake.',
      'Flip when bubbles form on top and the edges look set, then cook a minute more.',
    ],
    tags: {
      cuisine: ['American'],
      meal_type: ['Breakfast'],
      diet: ['Vegetarian'],
      allergen: ['milk', 'eggs', 'wheat'],
      custom: ['Kid-friendly'],
    },
    ratings: { admin: 5, editor: 4 },
    comments: [
      { by: 'admin', body: 'Let the batter rest for **10 minutes**: they rise higher.' },
      { by: 'editor', body: 'Made these with half whole-wheat flour. Still fluffy.' },
    ],
  },
  {
    title: 'Weeknight Chickpea Curry',
    owner: 'editor',
    description: 'Pantry staples, one pan, half an hour. Serve over rice or with warm flatbread.',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 25,
    difficulty: 'easy',
    equipment: ['Large skillet'],
    nutrition: { calories: 380, proteinGrams: 11, carbsGrams: 33, fatGrams: 24, fiberGrams: 9 },
    ingredients: [
      '1 tbsp vegetable oil',
      '1 onion, diced',
      '3 cloves garlic, minced',
      '1 tbsp ginger, grated',
      '2 tbsp curry powder',
      '1 tsp ground cumin',
      '1 (15 oz) can chickpeas, drained',
      '1 (14 oz) can diced tomatoes',
      '1 (14 oz) can coconut milk',
      '2 cups spinach',
      'salt to taste',
      '1/4 cup cilantro, chopped',
    ],
    steps: [
      'Heat the oil over medium heat and cook the onion until soft, about 5 minutes.',
      'Add the garlic, ginger, curry powder and cumin, and stir for a minute, until fragrant.',
      'Add the chickpeas, tomatoes and coconut milk. Simmer for 15 minutes, until thickened.',
      'Stir in the spinach until it wilts, season with salt and scatter over the cilantro.',
    ],
    tags: {
      cuisine: ['Indian'],
      meal_type: ['Dinner'],
      diet: ['Vegan', 'Gluten-free'],
      custom: ['Weeknight'],
    },
    ratings: { admin: 4, editor: 5 },
    notes: { editor: 'Double the spinach. Good with **naan** instead of rice.' },
  },
  {
    title: 'Spaghetti Aglio e Olio',
    owner: 'editor',
    description:
      'Garlic, olive oil, chili and pasta. Keep the garlic **golden**, never brown, or it turns bitter.',
    servings: 4,
    prepMinutes: 5,
    cookMinutes: 15,
    difficulty: 'easy',
    ingredients: [
      '400 g spaghetti',
      '1/2 cup olive oil',
      '6 cloves garlic, thinly sliced',
      '1/2 tsp red pepper flakes',
      '1/4 cup parsley, chopped',
      'salt to taste',
      '1/2 cup parmesan, grated',
    ],
    steps: [
      'Cook the spaghetti in well-salted boiling water until al dente. Keep a cup of the pasta water.',
      'Meanwhile, warm the oil and garlic in a large pan over medium-low heat until the garlic is golden, then add the pepper flakes.',
      'Toss the spaghetti in the pan with a splash of pasta water until glossy.',
      'Finish with the parsley, and the parmesan if you like.',
    ],
    tags: {
      cuisine: ['Italian'],
      meal_type: ['Dinner'],
      diet: ['Vegetarian'],
      allergen: ['wheat', 'milk'],
      custom: ['Weeknight'],
    },
    ratings: { admin: 4 },
  },
  {
    title: 'Black Bean Tacos',
    owner: 'admin',
    description: 'Smoky beans, quick toppings. Everyone builds their own.',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 15,
    difficulty: 'easy',
    ingredients: [
      {
        label: 'Beans',
        lines: [
          '1 tbsp olive oil',
          '1 onion, diced',
          '2 cloves garlic, minced',
          '1 tsp ground cumin',
          '1 tsp chili powder',
          '2 (15 oz) cans black beans, drained',
          '1/2 cup water',
        ],
      },
      {
        label: 'To serve',
        lines: [
          '8 corn tortillas',
          '1 avocado, sliced',
          '1/2 cup cotija, crumbled',
          '2 green onions, sliced',
          '1 lime, cut into wedges',
        ],
      },
    ],
    steps: [
      'Cook the onion in the oil over medium heat until soft. Add the garlic and spices for a minute.',
      'Add the beans and water and simmer for 10 minutes, mashing about half of them.',
      'Warm the tortillas in a dry pan, then fill them with the beans and toppings.',
    ],
    tags: {
      cuisine: ['Mexican'],
      meal_type: ['Dinner'],
      diet: ['Vegetarian', 'Gluten-free'],
      allergen: ['milk'],
      custom: ['Weeknight', 'Kid-friendly'],
    },
  },
  {
    title: 'Lemon Herb Roast Chicken',
    owner: 'editor',
    description: 'A Sunday roast with very little work. Dry the skin well and it comes out crisp.',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 75,
    totalMinutes: 105,
    difficulty: 'medium',
    equipment: ['Roasting pan', 'Meat thermometer'],
    ingredients: [
      '1 whole chicken (about 4 lb)',
      '2 tbsp butter, softened',
      '1 lemon, halved',
      '4 cloves garlic, smashed',
      '1 tbsp thyme leaves',
      '1 tsp salt',
      '1/2 tsp black pepper',
    ],
    steps: [
      'Heat the oven to 425°F. Pat the chicken dry inside and out.',
      'Rub it all over with the butter, thyme, salt and pepper, and put the lemon and garlic inside.',
      'Roast until the thickest part of the thigh reaches **165°F**, about 75 minutes.',
      'Rest for 15 minutes before carving.',
    ],
    tags: {
      cuisine: ['American'],
      meal_type: ['Dinner'],
      diet: ['Gluten-free'],
      allergen: ['milk'],
      custom: ['Holiday'],
    },
  },
  {
    title: 'Overnight Oats',
    owner: 'admin',
    description: 'Mix it before bed; breakfast is ready when you are.',
    servings: 2,
    prepMinutes: 5,
    cookMinutes: null,
    totalMinutes: 485,
    difficulty: 'easy',
    ingredients: [
      '1 cup rolled oats',
      '1 cup milk',
      '1/2 cup Greek yogurt',
      '2 tbsp maple syrup',
      '1 tbsp chia seeds',
      '1 cup berries',
    ],
    steps: [
      'Stir everything but the berries together in a jar.',
      'Cover and refrigerate overnight, or for at least 8 hours.',
      'Stir again, loosen with a splash of milk if needed, and top with the berries.',
    ],
    tags: {
      meal_type: ['Breakfast'],
      diet: ['Vegetarian'],
      allergen: ['milk'],
      custom: ['Make-ahead'],
    },
    ratings: { editor: 2 },
    comments: [{ by: 'editor', body: 'Too runny with the milk listed; I use a splash less.' }],
  },
  {
    title: 'Thai Peanut Noodles',
    owner: 'editor',
    description: 'Good warm, better cold the next day. Packs well for lunch.',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 10,
    difficulty: 'easy',
    ingredients: [
      {
        label: 'Sauce',
        lines: [
          '1/3 cup peanut butter',
          '3 tbsp soy sauce',
          '2 tbsp rice vinegar',
          '1 tbsp maple syrup',
          '1 tbsp sesame oil',
          '1 tbsp lime juice',
          '1 clove garlic, grated',
          '2 tbsp warm water',
        ],
      },
      {
        label: 'Noodles',
        lines: [
          '8 oz rice noodles',
          '1 red bell pepper, thinly sliced',
          '1 carrot, cut into matchsticks',
          '3 scallions, sliced',
          '1/4 cup roasted peanuts, chopped',
        ],
      },
    ],
    steps: [
      'Whisk the sauce ingredients until smooth.',
      'Cook the noodles as the package says, then rinse them under cold water and drain well.',
      'Toss the noodles with the sauce and vegetables, and top with the peanuts.',
    ],
    tags: {
      cuisine: ['Thai'],
      meal_type: ['Lunch'],
      diet: ['Vegan'],
      allergen: ['peanuts', 'soy', 'sesame', 'wheat'],
      custom: ['Make-ahead'],
    },
  },
  {
    title: 'Shakshuka',
    owner: 'admin',
    description: 'Eggs poached in a spiced tomato and pepper sauce. Bring bread for the sauce.',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 25,
    difficulty: 'medium',
    equipment: ['12-inch skillet with a lid'],
    ingredients: [
      '2 tbsp olive oil',
      '1 onion, diced',
      '1 red bell pepper, diced',
      '3 cloves garlic, minced',
      '1 tsp ground cumin',
      '1 tsp smoked paprika',
      '1 (28 oz) can crushed tomatoes',
      '6 eggs',
      '1/4 cup feta, crumbled',
      '2 tbsp parsley, chopped',
    ],
    steps: [
      'Cook the onion and pepper in the oil over medium heat until soft, about 8 minutes.',
      'Add the garlic and spices for a minute, then the tomatoes. Simmer for 10 minutes.',
      'Make six wells in the sauce and crack an egg into each. Cover and cook until the whites are set but the yolks are still runny, 6 to 8 minutes.',
      'Scatter over the feta and parsley and serve from the pan.',
    ],
    tags: {
      cuisine: ['Middle Eastern'],
      meal_type: ['Breakfast'],
      diet: ['Vegetarian', 'Gluten-free'],
      allergen: ['eggs', 'milk'],
    },
    ratings: { admin: 3, editor: 4 },
    comments: [{ by: 'admin', body: 'Smoky! Next time I’ll try *half* the paprika for the kids.' }],
  },
  {
    title: 'Miso-Glazed Salmon',
    owner: 'editor',
    visibility: 'private',
    description: 'Still working on the glaze, so it stays private for now.',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 10,
    difficulty: 'easy',
    ingredients: [
      '4 salmon fillets',
      '3 tbsp white miso',
      '2 tbsp mirin',
      '1 tbsp soy sauce',
      '1 tbsp honey',
      '1 tsp sesame oil',
      '2 scallions, sliced',
      '1 tsp sesame seeds',
    ],
    steps: [
      'Heat the broiler. Whisk the miso, mirin, soy sauce, honey and sesame oil.',
      'Brush the salmon with the glaze and broil 6 inches from the heat until it flakes, 8 to 10 minutes.',
      'Top with the scallions and sesame seeds.',
    ],
    tags: {
      cuisine: ['Japanese'],
      meal_type: ['Dinner'],
      allergen: ['fish', 'soy', 'wheat', 'sesame'],
      custom: ['Weeknight'],
    },
  },
  {
    title: 'Chocolate Chip Cookies',
    owner: 'editor',
    description:
      'Crisp edges, soft middles. Chilling the dough is optional, but it makes them **thicker**.',
    servings: 24,
    yield: { qty: 24, unit: 'cookies' },
    prepMinutes: 15,
    cookMinutes: 12,
    totalMinutes: 60,
    difficulty: 'easy',
    equipment: ['Baking sheets', 'Stand mixer'],
    nutrition: { calories: 210, proteinGrams: 2, carbsGrams: 28, fatGrams: 10, sugarGrams: 18 },
    ingredients: [
      '2 1/4 cups all-purpose flour',
      '1 tsp baking soda',
      '1 tsp salt',
      '1 cup butter, softened',
      '3/4 cup granulated sugar',
      '3/4 cup brown sugar',
      '2 eggs',
      '2 tsp vanilla extract',
      '2 cups chocolate chips',
    ],
    steps: [
      'Heat the oven to 375°F. Whisk the flour, baking soda and salt.',
      'Beat the butter and both sugars until fluffy, then beat in the eggs and vanilla.',
      'Mix in the flour on low speed, then the chocolate chips. Chill the dough for 30 minutes if you have time.',
      'Drop rounded tablespoons onto the sheets, 2 inches apart, and bake 10 to 12 minutes, until golden at the edges.',
    ],
    tags: {
      cuisine: ['American'],
      meal_type: ['Dessert'],
      diet: ['Vegetarian'],
      allergen: ['milk', 'eggs', 'wheat'],
      custom: ['Kid-friendly', 'Holiday'],
    },
    ratings: { admin: 5, editor: 5 },
    comments: [
      { by: 'editor', body: 'Chilling the dough overnight makes them chewier.' },
      { by: 'admin', body: 'Agreed. Brown the butter too, if you have time.' },
    ],
  },
  {
    title: 'Minestrone',
    owner: 'admin',
    description:
      'A big pot of vegetable soup. Use whatever vegetables you have; it’s better on day two.',
    servings: 6,
    prepMinutes: 20,
    cookMinutes: 40,
    difficulty: 'easy',
    equipment: ['Large pot'],
    ingredients: [
      '2 tbsp olive oil',
      '1 onion, diced',
      '2 carrots, diced',
      '1 cup celery, diced',
      '2 cloves garlic, minced',
      '1 zucchini, diced',
      '1 (14 oz) can diced tomatoes',
      '6 cups vegetable broth',
      '1 (15 oz) can cannellini beans, drained',
      '1 cup small pasta',
      '2 cups kale, chopped',
      'salt and pepper to taste',
    ],
    steps: [
      'Cook the onion, carrots and celery in the oil over medium heat for 8 minutes.',
      'Add the garlic and zucchini for 2 minutes, then the tomatoes and broth. Simmer for 20 minutes.',
      'Add the beans and pasta and cook until the pasta is tender, about 10 minutes.',
      'Stir in the kale until it wilts, and season to taste.',
    ],
    tags: {
      cuisine: ['Italian'],
      meal_type: ['Dinner'],
      diet: ['Vegan'],
      allergen: ['wheat'],
      custom: ['Make-ahead'],
    },
  },
  {
    title: 'Guacamole',
    owner: 'editor',
    description: 'Ripe avocados are the whole secret. Mash it chunky.',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: null,
    difficulty: 'easy',
    ingredients: [
      '3 avocados',
      '1/4 cup red onion, finely diced',
      '1 jalapeño, minced',
      '1/4 cup cilantro, chopped',
      '2 tbsp lime juice',
      '1/2 tsp salt',
    ],
    steps: [
      'Mash the avocados in a bowl, leaving some chunks.',
      'Stir in everything else, then taste and add more lime or salt as needed.',
    ],
    tags: {
      cuisine: ['Mexican'],
      meal_type: ['Snack'],
      diet: ['Vegan', 'Gluten-free'],
    },
    ratings: { admin: 5 },
  },
  {
    title: 'Banana Bread',
    owner: 'admin',
    description: 'For bananas that are *very* ripe: the browner, the better.',
    servings: 10,
    yield: { qty: 1, unit: 'loaf' },
    prepMinutes: 15,
    cookMinutes: 60,
    difficulty: 'easy',
    equipment: ['9x5-inch loaf pan'],
    ingredients: [
      '3 bananas, very ripe',
      '1/3 cup butter, melted',
      '3/4 cup sugar',
      '1 egg, beaten',
      '1 tsp vanilla extract',
      '1 tsp baking soda',
      'a pinch of salt',
      '1 1/2 cups all-purpose flour',
      '1/2 cup walnuts, chopped',
    ],
    steps: [
      'Heat the oven to 350°F and butter the pan.',
      'Mash the bananas, then stir in the butter, sugar, egg and vanilla.',
      'Sprinkle over the baking soda and salt, then fold in the flour and walnuts.',
      'Bake until a skewer comes out clean, about an hour. Cool before slicing.',
    ],
    tags: {
      cuisine: ['American'],
      meal_type: ['Breakfast', 'Dessert'],
      diet: ['Vegetarian'],
      allergen: ['eggs', 'wheat', 'milk', 'tree nuts'],
      custom: ['Make-ahead'],
    },
    ratings: { admin: 4, editor: 3 },
    notes: { admin: 'Our oven runs hot: check it at 50 minutes.' },
  },
  {
    title: 'Greek Salad',
    owner: 'editor',
    description: 'No lettuce, just summer vegetables, olives and a slab of feta.',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: null,
    difficulty: 'easy',
    nutrition: { calories: 260, proteinGrams: 8, carbsGrams: 11, fatGrams: 21, fiberGrams: 3 },
    ingredients: [
      '2 cucumbers, chopped',
      '4 tomatoes, cut into wedges',
      '1/2 red onion, thinly sliced',
      '1 green bell pepper, sliced',
      '1/2 cup kalamata olives',
      '7 oz feta',
      '3 tbsp olive oil',
      '1 tbsp red wine vinegar',
      '1 tsp dried oregano',
    ],
    steps: [
      'Combine the cucumbers, tomatoes, onion, pepper and olives in a wide bowl.',
      'Lay the feta on top, drizzle with the oil and vinegar, and sprinkle with the oregano.',
    ],
    tags: {
      cuisine: ['Greek'],
      meal_type: ['Lunch'],
      diet: ['Vegetarian', 'Gluten-free'],
      allergen: ['milk'],
    },
  },
  {
    title: 'Beef and Broccoli Stir-Fry',
    owner: 'admin',
    description: 'Faster than takeout. Slice the beef thinly **against the grain**.',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 10,
    difficulty: 'medium',
    equipment: ['Wok or large skillet'],
    ingredients: [
      '1 lb flank steak, thinly sliced',
      '1 tbsp cornstarch',
      '4 cups broccoli florets',
      '1/4 cup soy sauce',
      '2 tbsp oyster sauce',
      '1 tbsp brown sugar',
      '2 cloves garlic, minced',
      '1 tbsp ginger, grated',
      '2 tbsp vegetable oil',
      '1 tsp sesame oil',
    ],
    steps: [
      'Toss the beef with the cornstarch. Stir the soy sauce, oyster sauce and sugar together.',
      'Sear the beef in half the oil over high heat, in batches, then set it aside.',
      'Stir-fry the broccoli in the rest of the oil for 3 minutes, then add the garlic and ginger for 30 seconds.',
      'Return the beef with the sauce and toss until glossy. Finish with the sesame oil and serve over rice.',
    ],
    tags: {
      cuisine: ['Chinese'],
      meal_type: ['Dinner'],
      allergen: ['soy', 'wheat', 'shellfish', 'sesame'],
      custom: ['Weeknight'],
    },
  },
  {
    title: 'Shrimp Fried Rice',
    owner: 'editor',
    description: 'Day-old rice works best: fresh rice turns mushy.',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 15,
    difficulty: 'easy',
    ingredients: [
      '3 cups cooked rice, cold',
      '8 oz shrimp, peeled',
      '2 eggs, beaten',
      '1 cup frozen peas and carrots',
      '3 green onions, sliced',
      '2 cloves garlic, minced',
      '3 tbsp soy sauce',
      '1 tsp sesame oil',
      '2 tbsp vegetable oil',
    ],
    steps: [
      'Cook the shrimp in a tablespoon of oil over high heat until pink, then set them aside.',
      'Scramble the eggs in the same pan, then set them aside too.',
      'Fry the rice, peas and carrots, and garlic in the rest of the oil for 5 minutes, breaking up any clumps.',
      'Stir in the soy sauce, shrimp, eggs and green onions, and finish with the sesame oil.',
    ],
    tags: {
      cuisine: ['Chinese'],
      meal_type: ['Dinner'],
      allergen: ['shellfish', 'eggs', 'soy', 'wheat', 'sesame'],
      custom: ['Weeknight'],
    },
  },
  {
    title: 'French Onion Soup',
    owner: 'admin',
    description:
      'Patience is the main ingredient: the onions take nearly an hour to turn deep brown.',
    servings: 6,
    prepMinutes: 20,
    cookMinutes: 90,
    difficulty: 'medium',
    equipment: ['Dutch oven', 'Oven-safe bowls'],
    ingredients: [
      {
        label: 'Soup',
        lines: [
          '3 tbsp butter',
          '2 lb onions, thinly sliced',
          '1 tsp sugar',
          '2 cloves garlic, minced',
          '1/2 cup dry white wine',
          '6 cups beef broth',
          '1 bay leaf',
          '1 tsp thyme leaves',
        ],
      },
      {
        label: 'Topping',
        lines: ['6 slices baguette, toasted', '1 1/2 cups Gruyère, grated'],
      },
    ],
    steps: [
      'Melt the butter in the pot and add the onions and sugar. Cook over medium-low heat, stirring now and then, until deep brown, 45 to 60 minutes.',
      'Add the garlic for a minute, then the wine, scraping up the browned bits.',
      'Add the broth, bay leaf and thyme and simmer for 20 minutes. Season to taste.',
      'Ladle into the bowls, top each with a slice of baguette and the cheese, and broil until bubbling.',
    ],
    tags: {
      cuisine: ['French'],
      meal_type: ['Dinner'],
      allergen: ['milk', 'wheat'],
      custom: ['Holiday'],
    },
  },
  {
    title: 'Mango Lassi',
    owner: 'editor',
    description: 'A cold, creamy mango drink. Frozen mango works as well as fresh.',
    servings: 2,
    prepMinutes: 5,
    cookMinutes: null,
    difficulty: 'easy',
    equipment: ['Blender'],
    ingredients: [
      '2 cups mango, chopped',
      '1 cup plain yogurt',
      '1/2 cup milk',
      '2 tbsp sugar',
      'a pinch of ground cardamom',
      '4 ice cubes',
    ],
    steps: ['Blend everything until smooth, and serve right away.'],
    tags: {
      cuisine: ['Indian'],
      meal_type: ['Snack'],
      diet: ['Vegetarian', 'Gluten-free'],
      allergen: ['milk'],
    },
  },
];

/** A demo recipe as the API takes it: its lines read by the parser, its tags by their IDs. */
function requestFor(db: Db, recipe: DemoRecipe): CreateRecipeRequest {
  const groups =
    typeof recipe.ingredients[0] === 'string'
      ? [{ label: null, lines: recipe.ingredients as string[] }]
      : (recipe.ingredients as { label: string; lines: string[] }[]);
  const { allergen = [], ...userTags } = recipe.tags;
  const tagIds = [
    ...Object.entries(userTags).flatMap(([type, names]) =>
      names.map((name) => findOrCreateTag(db, type as Exclude<TagType, 'allergen'>, name).tag.id),
    ),
    ...allergen.map((name) => allergenId(db, name)),
  ];
  return {
    title: recipe.title,
    description: recipe.description,
    source: { url: null, title: null, author: null },
    equipment: recipe.equipment ?? [],
    yield: recipe.yield ?? null,
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    totalMinutes: recipe.totalMinutes ?? null,
    difficulty: recipe.difficulty,
    nutrition: { ...NO_NUTRITION, ...recipe.nutrition },
    ingredientGroups: groups.map(({ label, lines }) => ({
      label,
      ingredients: lines.map((rawText) => ({ rawText, ...parseIngredient(rawText) })),
    })),
    steps: recipe.steps.map((body) => ({ body, image: null })),
    tagIds,
    images: [],
    coverImageId: null,
    visibility: recipe.visibility ?? 'shared',
  };
}

/** An allergen's tag, which a migration seeds. */
function allergenId(db: Db, name: (typeof ALLERGENS)[number]): number {
  const row = db
    .select({ id: tag.id })
    .from(tag)
    .where(and(eq(tag.type, 'allergen'), eq(tag.nameKey, tagNameKey(name))))
    .get();
  if (!row) throw new Error(`the ${name} allergen tag is missing`);
  return row.id;
}

/**
 * Saves the demo recipes for their owners, the demo admin and editor, the way the API saves any
 * recipe: each queues its search update, which the API's worker sends. Then their collections.
 * Returns how many recipes it saved.
 */
export function seedDemoRecipes(db: Db, owners: Record<DemoRecipe['owner'], string>): number {
  /** Each saved recipe, by title: the demo account with `role`, who must be allowed to keep it. */
  const keepers = new Map<string, (role: DemoRecipe['owner']) => string>();
  const savedIds = new Map<string, string>();
  for (const recipe of DEMO_RECIPES) {
    const saved = createRecipe(db, owners[recipe.owner], requestFor(db, recipe));
    if (!saved.ok) throw new Error(`could not save the demo recipe “${recipe.title}”`);
    const access = { ownerId: owners[recipe.owner], visibility: recipe.visibility ?? 'shared' };
    /** The demo account with `role`, who must be allowed to rate, comment on and keep the recipe. */
    const reader = (role: DemoRecipe['owner']) => {
      const user = { id: owners[role], role };
      if (!can(user, 'recipe.interact', access)) {
        throw new Error(`the demo ${role} may not rate, comment on or keep “${recipe.title}”`);
      }
      return user.id;
    };
    keepers.set(recipe.title, reader);
    savedIds.set(recipe.title, saved.id);
    for (const [role, stars] of Object.entries(recipe.ratings ?? {}) as [
      DemoRecipe['owner'],
      number,
    ][]) {
      setRating(db, reader(role), saved.id, stars);
    }
    for (const { by, body } of recipe.comments ?? []) {
      addComment(db, saved.id, reader(by), body);
    }
    for (const [role, body] of Object.entries(recipe.notes ?? {}) as [
      DemoRecipe['owner'],
      string,
    ][]) {
      saveNote(db, reader(role), saved.id, body);
    }
  }
  for (const { owner, name, recipes } of DEMO_COLLECTIONS) {
    const created = createCollection(db, owners[owner], name);
    for (const title of recipes) {
      const keeper = keepers.get(title);
      const id = savedIds.get(title);
      if (!keeper || !id) throw new Error(`the demo collection “${name}” names “${title}”`);
      keeper(owner);
      addToCollection(db, created.id, id);
    }
  }
  return DEMO_RECIPES.length;
}
