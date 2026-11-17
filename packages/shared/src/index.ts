/** Prefix for every REST endpoint. Shared so the API router and the web client can't drift apart. */
export const API_BASE_PATH = '/api/v1';

/**
 * Where Better Auth's own routes live (sign-in, sign-out, session). They aren't versioned or in the
 * OpenAPI document: the web app calls them through Better Auth's client (ADR 0005).
 */
export const AUTH_BASE_PATH = '/api/auth';

export {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE_MAX,
  AUDIT_TARGET_TYPES,
  type AuditAction,
  type AuditTargetType,
  auditEventListQuerySchema,
  auditEventListSchema,
  auditEventSchema,
} from './audit.ts';
export {
  normalizeIngredientName,
  type ParsedIngredient,
  parseIngredient,
  parseQuantity,
} from './ingredients.ts';
export {
  type AcceptInvitationRequest,
  acceptInvitationRequestSchema,
  acceptInvitationResultSchema,
  createInvitationRequestSchema,
  INVITATION_ACCEPT_PATH,
  INVITATION_STATUSES,
  type InvitationStatus,
  invitationDetailsSchema,
  invitationIdParamsSchema,
  invitationListSchema,
  invitationLookupRequestSchema,
  invitationSchema,
  invitationWithLinkSchema,
} from './invitation.ts';
export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordChecklist,
  passwordProblems,
  passwordSchema,
} from './password.ts';
export {
  type Action,
  COMMENT_ACTIONS,
  type CommentAction,
  can,
  type PolicyComment,
  type PolicyRecipe,
  type PolicyUser,
  RECIPE_ACTIONS,
  type RecipeAction,
  ROLE_ACTIONS,
  type RoleAction,
} from './policy.ts';
export {
  DEFAULT_PREFERENCES,
  preferencesResultSchema,
  type UserPreferences,
  userPreferencesSchema,
} from './preferences.ts';
export {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemDetailsSchema,
  VALIDATION_PROBLEM_TYPE,
  type ValidationProblem,
  validationProblemSchema,
} from './problem.ts';
export {
  type Amount,
  type DisplayedAmount,
  type DisplayOptions,
  displayAmount,
  formatAmount,
  scaleAmount,
  scaleFactor,
} from './quantities.ts';
export {
  type CreateRecipeRequest,
  changeVisibilityRequestSchema,
  createRecipeRequestSchema,
  DIFFICULTIES,
  type Difficulty,
  difficultySchema,
  ingredientGroupInputSchema,
  ingredientLineInputSchema,
  ingredientLineSchema,
  RECIPE_LIMITS,
  type Recipe,
  recipeIdParamsSchema,
  recipeResultSchema,
  recipeSchema,
  recipeTotalMinutes,
  type UpdateRecipeRequest,
  updateRecipeRequestSchema,
} from './recipe.ts';
export { DEFAULT_ROLE, ROLES, type Role, roleSchema } from './roles.ts';
export {
  REBUILD_STATES,
  type RebuildState,
  type RecipeSearchHit,
  type RecipeSearchQuery,
  type RecipeSearchResult,
  recipeSearchHitSchema,
  recipeSearchQuerySchema,
  recipeSearchResultSchema,
  SEARCH_FACETS,
  SEARCH_PAGE_MAX,
  SEARCH_PAGE_SIZE,
  SEARCH_SCOPES,
  SEARCH_SORTS,
  type SearchFacet,
  type SearchIndexStatus,
  type SearchSort,
  searchIndexStatusSchema,
} from './search.ts';
export {
  type SetupRequest,
  setupRequestSchema,
  setupResultSchema,
  setupStatusSchema,
} from './setup.ts';
export {
  ALLERGENS,
  createTagRequestSchema,
  TAG_NAME_MAX_LENGTH,
  TAG_TYPES,
  type Tag,
  type TagType,
  tagListQuerySchema,
  tagListSchema,
  tagNameKey,
  tagNameSchema,
  tagResultSchema,
  tagSchema,
  tagTypeSchema,
  USER_TAG_TYPES,
} from './tags.ts';
export {
  convert,
  DEFAULT_UNIT_SYSTEM,
  type Dimension,
  dimensionOf,
  findUnit,
  resolveUnit,
  UNIT_SYSTEMS,
  UNITS,
  type Unit,
  type UnitSystem,
  unitSystemSchema,
} from './units.ts';
export {
  changeRoleRequestSchema,
  emailSchema,
  type User,
  userAccountListSchema,
  userAccountResultSchema,
  userAccountSchema,
  userIdParamsSchema,
  userNameSchema,
  userSchema,
} from './user.ts';
export { VISIBILITIES, type Visibility, visibilitySchema } from './visibility.ts';
