import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  DEFAULT_ROLE,
  DIFFICULTIES,
  IMAGE_UPLOAD_TYPES,
  type RecipeContent,
  ROLES,
  TAG_TYPES,
  UNIT_SYSTEMS,
  VISIBILITIES,
} from '@myli/shared';
import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'dead'] as const;

/** `('a', 'b')`, for CHECK constraints. Only for constants defined in code, never for input. */
function sqlList(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------------------------
// Better Auth (ADR 0005). Table and column names are the ones Better Auth expects, and it checks
// them on first use: a mismatch throws a SchemaMismatchError. After upgrading Better Auth, compare
// with the schema its CLI generates and add a migration for any change.
// ---------------------------------------------------------------------------------------------

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // From the admin plugin. Exactly one role per user: the plugin would also accept a
    // comma-separated list, which the CHECK constraint rejects.
    role: text('role', { enum: ROLES }).notNull().default(DEFAULT_ROLE),
    /** Deactivated users are banned (ADR 0005). Banning revokes their sessions. */
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
  },
  (table) => [check('user_role_check', sql`${table.role} in ${sqlList(ROLES)}`)],
);

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Stored as given: Better Auth signs the cookie, and looks the session up by this token. */
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
);

/** Login methods. myli only has `credential` (email + password), which holds the password hash. */
export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

/** Short-lived tokens for email verification and password reset. */
export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

// ---------------------------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------------------------

/**
 * Held while first-run setup creates the first admin, so two setups can't run at once (ADR 0009).
 * At most one row, and only for the moment the admin is being created.
 */
export const setupClaim = sqliteTable(
  'setup_claim',
  {
    id: integer('id').primaryKey(),
    /** Also identifies the claim, so a setup only ever releases its own. */
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [check('setup_claim_single_row', sql`${table.id} = 1`)],
);

/**
 * Invitations (spec §3.1, ADR 0005). Rows are never deleted: accepting or revoking one sets a
 * timestamp, so the history stays.
 */
export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text('email').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    /** SHA-256 of the token in the link, as hex. The token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    /**
     * Whether the current link went by email: set by the email job as it stores the hash it sends,
     * cleared when an admin is given a link to copy. Accepting an emailed link verifies the address
     * (ADR 0019); a copied one proves nothing about it.
     */
    linkEmailed: integer('link_emailed', { mode: 'boolean' }).notNull().default(false),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id),
    /** Set the moment an acceptance claims it, and cleared again if creating the user fails. */
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('invitation_role_check', sql`${table.role} in ${sqlList(ROLES)}`),
    // At most one open (not accepted, not revoked) invitation per email, expired ones included.
    uniqueIndex('invitation_open_email_idx')
      .on(table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
  ],
);

/**
 * Background jobs and the search outbox (ADR 0003). Rows are inserted in the same transaction as
 * the change they follow from, and the in-process worker picks them up.
 */
export const job = sqliteTable(
  'job',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** Not picked up before this time; pushed back after each failed attempt. */
    runAfter: integer('run_after', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (table) => [
    check('job_status_check', sql`${table.status} in ${sqlList(JOB_STATUSES)}`),
    // The worker's query: the next pending jobs that are due.
    index('job_status_run_after_idx').on(table.status, table.runAfter),
  ],
);

/**
 * The audit log (spec §3.1). Append-only: triggers from migration 0005 refuse every UPDATE and
 * DELETE. A migration that rebuilds this table drops them, so it must create them again;
 * `audit.test.ts` fails if they're missing.
 */
export const USER_TOKEN_PURPOSES = ['verify_email', 'reset_password'] as const;

export type UserTokenPurpose = (typeof USER_TOKEN_PURPOSES)[number];

/**
 * The secrets in verification and reset links (ADR 0019), as hashes. One per user and purpose:
 * making a new one replaces the old, so only the newest link works. Using one deletes it.
 */
export const userToken = sqliteTable(
  'user_token',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: USER_TOKEN_PURPOSES }).notNull(),
    /** SHA-256 of the token in the link, as hex. The token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    /** The address it was made for: a link verifies that address, not whatever the user has now. */
    email: text('email').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** When it was asked for, which spaces out the emails one account gets. */
    createdAt: createdAt(),
  },
  (table) => [
    check('user_token_purpose_check', sql`${table.purpose} in ${sqlList(USER_TOKEN_PURPOSES)}`),
    uniqueIndex('user_token_user_purpose_idx').on(table.userId, table.purpose),
  ],
);

export const auditEvent = sqliteTable(
  'audit_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `null` when nobody was signed in, as for a failed sign-in. Users are never deleted. */
    actorId: text('actor_id').references(() => user.id),
    action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
    targetType: text('target_type', { enum: AUDIT_TARGET_TYPES }),
    targetId: text('target_id'),
    metadata: text('metadata', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    check('audit_event_action_check', sql`${table.action} in ${sqlList(AUDIT_ACTIONS)}`),
    check(
      'audit_event_target_type_check',
      sql`${table.targetType} is null or ${table.targetType} in ${sqlList(AUDIT_TARGET_TYPES)}`,
    ),
    check(
      'audit_event_target_check',
      sql`(${table.targetType} is null) = (${table.targetId} is null)`,
    ),
    index('audit_event_action_idx').on(table.action, table.id),
  ],
);

// ---------------------------------------------------------------------------------------------
// Recipes (spec §3.2). Until Phase 2 adds drafts and revisions, these tables hold the one version
// of each recipe, and saving changes it directly.
// ---------------------------------------------------------------------------------------------

/** Nutrition per serving, entered by hand. Every column is optional and never negative. */
const NUTRITION_COLUMNS = {
  calories: 'nutrition_calories',
  proteinGrams: 'nutrition_protein_g',
  carbsGrams: 'nutrition_carbs_g',
  fatGrams: 'nutrition_fat_g',
  fiberGrams: 'nutrition_fiber_g',
  sugarGrams: 'nutrition_sugar_g',
  sodiumMilligrams: 'nutrition_sodium_mg',
} as const;

export const recipe = sqliteTable(
  'recipe',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Users are never deleted: deactivating one keeps their recipes, private ones private. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    visibility: text('visibility', { enum: VISIBILITIES }).notNull(),
    title: text('title').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    sourceUrl: text('source_url'),
    sourceTitle: text('source_title'),
    sourceAuthor: text('source_author'),
    equipment: text('equipment', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** "24 cookies": a quantity and an optional unit, separate from the servings. */
    yieldQty: real('yield_qty'),
    yieldUnit: text('yield_unit'),
    /** The baseline scaling starts from. */
    servings: integer('servings').notNull(),
    prepMin: integer('prep_min'),
    cookMin: integer('cook_min'),
    /** Set only when someone overrides the total; otherwise it's prep + cook. */
    totalMin: integer('total_min'),
    difficulty: text('difficulty', { enum: DIFFICULTIES }),
    /** The photo lists show it with: one of its photos, or `null` when it has none. */
    coverImageId: text('cover_image_id').references((): AnySQLiteColumn => image.id),
    nutritionCalories: real(NUTRITION_COLUMNS.calories),
    nutritionProteinG: real(NUTRITION_COLUMNS.proteinGrams),
    nutritionCarbsG: real(NUTRITION_COLUMNS.carbsGrams),
    nutritionFatG: real(NUTRITION_COLUMNS.fatGrams),
    nutritionFiberG: real(NUTRITION_COLUMNS.fiberGrams),
    nutritionSugarG: real(NUTRITION_COLUMNS.sugarGrams),
    nutritionSodiumMg: real(NUTRITION_COLUMNS.sodiumMilligrams),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /**
     * Set while the recipe is in the trash, which hides it everywhere but there, until it's restored
     * or purged.
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    /**
     * Goes up by one with every write to the recipe, sent as its `ETag`. A write names the version
     * it was based on in `If-Match`, and only goes ahead while that's still the version (ADR 0007).
     */
    version: integer('version').notNull().default(1),
    /**
     * Its public link's unguessable token, while it has one (`public-links/public-links.ts`). Only
     * a shared recipe has one: making it private clears it.
     */
    publicToken: text('public_token'),
  },
  (table) => [
    uniqueIndex('recipe_public_token_idx').on(table.publicToken),
    check('recipe_visibility_check', sql`${table.visibility} in ${sqlList(VISIBILITIES)}`),
    check(
      'recipe_difficulty_check',
      sql`${table.difficulty} is null or ${table.difficulty} in ${sqlList(DIFFICULTIES)}`,
    ),
    check('recipe_servings_check', sql`${table.servings} >= 1`),
    check(
      'recipe_yield_check',
      // Spelled out: with no quantity, `yield_qty > 0` is NULL, and a NULL check passes.
      sql`(${table.yieldQty} is null and ${table.yieldUnit} is null) or (${table.yieldQty} is not null and ${table.yieldQty} > 0)`,
    ),
    check(
      'recipe_minutes_check',
      sql`coalesce(${table.prepMin}, 0) >= 0 and coalesce(${table.cookMin}, 0) >= 0 and coalesce(${table.totalMin}, 0) >= 0`,
    ),
    check(
      'recipe_nutrition_check',
      sql.raw(
        Object.values(NUTRITION_COLUMNS)
          .map((column) => `coalesce(\`${column}\`, 0) >= 0`)
          .join(' and '),
      ),
    ),
    index('recipe_owner_id_idx').on(table.ownerId),
  ],
);

/**
 * One ingredient line. Lines sit in ordered groups ("For the dough"), stored on each line as the
 * group's position and label. Saving a recipe replaces all of its lines.
 */
export const recipeIngredient = sqliteTable(
  'recipe_ingredient',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    groupPosition: integer('group_position').notNull(),
    /** `null` for a group without a heading, as a recipe with one group usually has. */
    groupLabel: text('group_label'),
    position: integer('position').notNull(),
    /** Exactly what the user typed. */
    rawText: text('raw_text').notNull(),
    qty: real('qty'),
    /** The top of a range ("2–3 cloves"). */
    qtyMax: real('qty_max'),
    /** A unit's name from the unit table, or one typed by hand. */
    unit: text('unit'),
    name: text('name').notNull(),
    /** `normalizeIngredientName(name)`, for search and grocery lists. */
    normalizedName: text('normalized_name').notNull(),
    note: text('note'),
    scalable: integer('scalable', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [
    check('recipe_ingredient_qty_check', sql`${table.qty} is null or ${table.qty} > 0`),
    check(
      'recipe_ingredient_qty_max_check',
      sql`${table.qtyMax} is null or (${table.qty} is not null and ${table.qtyMax} > ${table.qty})`,
    ),
    uniqueIndex('recipe_ingredient_position_idx').on(
      table.recipeId,
      table.groupPosition,
      table.position,
    ),
  ],
);

/** One step, with a markdown body. Saving a recipe replaces all of its steps. */
export const recipeStep = sqliteTable(
  'recipe_step',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    bodyMd: text('body_md').notNull(),
    imageId: text('image_id').references((): AnySQLiteColumn => image.id),
  },
  (table) => [uniqueIndex('recipe_step_position_idx').on(table.recipeId, table.position)],
);

/**
 * Tags of every type. The allergen tags are seeded by migration 0007 and never change; the others
 * are created by editors.
 */
export const tag = sqliteTable(
  'tag',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: TAG_TYPES }).notNull(),
    /** As its creator wrote it: "Italian". */
    name: text('name').notNull(),
    /** `tagNameKey(name)`: names that differ only in case or spacing are one tag. */
    nameKey: text('name_key').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('tag_type_check', sql`${table.type} in ${sqlList(TAG_TYPES)}`),
    uniqueIndex('tag_type_name_key_idx').on(table.type, table.nameKey),
  ],
);

export const recipeTag = sqliteTable(
  'recipe_tag',
  {
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.recipeId, table.tagId] }),
    index('recipe_tag_tag_id_idx').on(table.tagId),
  ],
);

/** A user's display preferences (`@myli/shared`'s `userPreferencesSchema`). No row means the defaults. */
export const userPreference = sqliteTable(
  'user_preference',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    unitSystem: text('unit_system', { enum: UNIT_SYSTEMS }).notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'user_preference_unit_system_check',
      sql`${table.unitSystem} in ${sqlList(UNIT_SYSTEMS)}`,
    ),
  ],
);

/** One size of an image, as stored: its blob's key. */
export interface StoredImageVariant {
  width: number;
  height: number;
  key: string;
}

/**
 * Uploaded photos (spec §3.2 Images), one blob per size. An upload belongs to no recipe until a
 * recipe is saved with it; one never saved is deleted after a day (`discardUnsavedImageJob`).
 */
export const image = sqliteTable(
  'image',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** `null` until a recipe is saved with it. */
    recipeId: text('recipe_id').references(() => recipe.id),
    /** Its place among the recipe's photos, from 0. `null` for a step's photo, or while unsaved. */
    position: integer('position'),
    /** What it shows, for people who can't see it, as the recipe was saved with it. */
    altText: text('alt_text').notNull().default(''),
    /** Until it belongs to a recipe, the only one who may see it or use it. */
    uploaderId: text('uploader_id')
      .notNull()
      .references(() => user.id),
    /**
     * Set while it's this user's profile photo, which every signed-in user may see: only ever their
     * own upload, and never a recipe's photo too (`setAvatar()`). Not a CHECK constraint, which
     * would rebuild the table, and that fails on a database whose recipes refer to their photos.
     */
    avatarOf: text('avatar_of').references(() => user.id),
    /** What was uploaded, by its first bytes. What's served is always WebP. */
    mime: text('mime', { enum: IMAGE_UPLOAD_TYPES }).notNull(),
    /** Of the upload, turned upright. */
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Narrowest first. */
    variants: text('variants', { mode: 'json' }).$type<StoredImageVariant[]>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check('image_mime_check', sql`${table.mime} in ${sqlList(IMAGE_UPLOAD_TYPES)}`),
    index('image_recipe_idx').on(table.recipeId),
    uniqueIndex('image_avatar_of_idx').on(table.avatarOf),
  ],
);

/**
 * Each user's favorite recipes (spec §3.3), newest first by `created_at`. A favorite outlives the
 * reader's access: while its recipe is deleted, or made private by someone else, it's kept but not
 * shown, and it shows again if the recipe comes back.
 */
/**
 * The recipe as each save published it (ADR 0007). Never changed once written: restoring an older
 * one publishes it again, as a new revision.
 */
export const recipeRevision = sqliteTable(
  'recipe_revision',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id),
    /** Its place in the recipe's history, from 1. */
    number: integer('number').notNull(),
    /** A `RecipeSnapshot` (`revisions/snapshot.ts`), which says which version of the format it is. */
    snapshot: text('snapshot', { mode: 'json' }).$type<unknown>().notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    message: text('message'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('recipe_revision_number_idx').on(table.recipeId, table.number)],
);

/**
 * A recipe's draft, its one working copy (spec §3.3), until it's published or discarded. Changing
 * it moves the recipe's `version` on, as any write to the recipe does.
 */
export const recipeDraft = sqliteTable('recipe_draft', {
  recipeId: text('recipe_id')
    .primaryKey()
    .references(() => recipe.id),
  /**
   * As the API took it (`RecipeContent`). Stored drafts are read as they are, so a change to that
   * format needs a migration of them.
   */
  content: text('content', { mode: 'json' }).$type<RecipeContent>().notNull(),
  /** The revision it started from. */
  revision: integer('revision').notNull(),
  /** Who saved it last. */
  authorId: text('author_id')
    .notNull()
    .references(() => user.id),
  updatedAt: updatedAt(),
});

export const favorite = sqliteTable(
  'favorite',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.recipeId] }),
    index('favorite_recipe_id_idx').on(table.recipeId),
  ],
);

/**
 * Comments on a recipe, in markdown. Their authors change or delete them; admins delete anyone's.
 * They go with their recipe when it's purged.
 */
export const comment = sqliteTable(
  'comment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    /** Users are never deleted, so a comment keeps its author. */
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    bodyMd: text('body_md').notNull(),
    createdAt: createdAt(),
    /** When its author last changed it, `null` if never. */
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('comment_recipe_id_created_at_idx').on(table.recipeId, table.createdAt)],
);

/**
 * Each user's collections of recipes (spec §3.3), which no one else ever sees, admins included.
 * Names needn't differ. They're listed by name, compared as tag names are (`nameKey`, from
 * `tagNameKey`).
 */
export const collection = sqliteTable(
  'collection',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('collection_owner_name_key_idx').on(table.ownerId, table.nameKey)],
);

/**
 * The recipes in each collection, in their owner's order. One its owner can no longer see stays,
 * hidden, and keeps its place.
 */
export const collectionItem = sqliteTable(
  'collection_item',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collection.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    addedAt: integer('added_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.recipeId] }),
    index('collection_item_recipe_id_idx').on(table.recipeId),
  ],
);

/**
 * Each user's private note on a recipe (spec §3.3): one each, which no one else ever sees, admins
 * included. It stays while the recipe is out of their sight, and shows again if it comes back.
 */
export const userNote = sqliteTable(
  'user_note',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.recipeId] }),
    index('user_note_recipe_id_idx').on(table.recipeId),
  ],
);

/** Each user's rating of a recipe, from 1 to 5 stars: one each, which they change or remove. */
export const rating = sqliteTable(
  'rating',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipe.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.recipeId] }),
    index('rating_recipe_id_idx').on(table.recipeId),
    check('rating_stars_check', sql`${table.stars} between 1 and 5`),
  ],
);
