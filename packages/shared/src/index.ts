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
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemDetailsSchema,
  VALIDATION_PROBLEM_TYPE,
  type ValidationProblem,
  validationProblemSchema,
} from './problem.ts';
export { DEFAULT_ROLE, ROLES, type Role, roleSchema } from './roles.ts';
export {
  type SetupRequest,
  setupRequestSchema,
  setupResultSchema,
  setupStatusSchema,
} from './setup.ts';
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
