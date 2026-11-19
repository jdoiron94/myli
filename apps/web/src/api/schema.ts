// Generated from apps/api/openapi.json by `pnpm openapi:generate`. Do not edit it by hand.

export interface paths {
    "/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Whether first-run setup is needed
         * @description Public. True until the first admin exists, so the web app knows to show setup.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Whether setup is needed. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SetupStatus"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Create the first admin
         * @description Public, and only works while no user exists. The new admin then signs in with the same email and password.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["SetupRequest"];
                };
            };
            responses: {
                /** @description The first admin was created. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SetupResult"];
                    };
                };
                /** @description Setup is already complete, or another setup is in progress. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List audit events
         * @description Admins only. Newest first, a page at a time.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Only events older than this ID: the `nextBefore` of the previous page. */
                    before?: number;
                    limit?: number;
                    /** @description Only events of this kind. */
                    action?: "setup.completed" | "invitation.created" | "invitation.resent" | "invitation.revoked" | "invitation.accepted" | "user.role_changed" | "user.deactivated" | "user.reactivated" | "sign_in.succeeded" | "sign_in.failed" | "sign_out.succeeded" | "recipe.deleted" | "recipe.restored" | "recipe.purged" | "revision.restored" | "public_link.created" | "public_link.revoked" | "tag.renamed" | "tag.merged" | "tag.deleted" | "instance.exported";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description A page of audit events. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AuditEventList"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List users
         * @description Admins only. Every user, deactivated ones included, oldest first.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Every user. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserAccountList"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Change a user's role
         * @description Admins only. Applies from the user's next request. Admins can't change their own role, so an active admin always remains. Setting the role the user already has changes nothing.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ChangeRoleRequest"];
                };
            };
            responses: {
                /** @description The user, with their role now. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserAccountResult"];
                    };
                };
                /** @description No user has this ID. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The user is you. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Deactivate a user
         * @description Admins only. Ends the user's sessions and refuses their sign-ins until they're reactivated. Their recipes stay as they are: private ones stay private. Admins can't deactivate themselves, so an active admin always remains. Send `Content-Type: application/json` even though there is no body.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The user, deactivated. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserAccountResult"];
                    };
                };
                /** @description No user has this ID. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The user is you. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reactivate a user
         * @description Admins only. The user can sign in again. Send `Content-Type: application/json` even though there is no body.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The user, active again. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["UserAccountResult"];
                    };
                };
                /** @description No user has this ID. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List recipes
         * @description The recipes the caller may see: shared ones, and their own private ones. Newest first, one page at a time. Unlike search, it reads the database, so it works while search is unavailable.
         */
        get: {
            parameters: {
                query?: {
                    page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One page of them. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeList"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Create a recipe
         * @description Editors and admins. The caller owns the new recipe. Ingredient lines are stored as sent: parse them with `parseIngredient` from `@myli/shared` and let the user confirm. A tag that no longer exists fails validation like any other field.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateRecipeRequest"];
                };
            };
            responses: {
                /** @description The new recipe. */
                201: {
                    headers: {
                        /** @description The recipe's version, for the `If-Match` of a change to it. */
                        ETag?: string;
                        /** @description Where it lives. */
                        Location?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeResult"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a recipe
         * @description Any signed-in user, for shared recipes and their own private ones. Someone else's private recipe answers 404, exactly as one that never existed or was deleted.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The recipe. */
                200: {
                    headers: {
                        /** @description The recipe's version, for the `If-Match` of a change to it. */
                        ETag?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeResult"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        /**
         * Publish a recipe
         * @description Editors and admins, for shared recipes and their own private ones: editors can edit any shared recipe, whoever created it. Replaces all of the recipe's content, lines, steps and tags included, and records it as the next revision, with the message if there is one. Its owner and visibility stay, and its draft is discarded. Send the version the edit started from in `If-Match`: if someone changed the recipe or its draft meanwhile, the save is refused with 412.
         */
        put: {
            parameters: {
                query?: never;
                header?: {
                    /** @description The `ETag` of the version the change is based on, such as `"3"`. Required: without it the answer is 428. A version that is no longer current gets 412. */
                    "if-match"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateRecipeRequest"];
                };
            };
            responses: {
                /** @description The recipe as saved. */
                200: {
                    headers: {
                        /** @description The recipe's version, for the `If-Match` of a change to it. */
                        ETag?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeResult"];
                    };
                };
                /** @description The caller may see the recipe but not edit it. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The recipe changed since the version in `If-Match`. The body holds it as it is now. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["StaleRecipeProblem"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description The request has no `If-Match`. */
                428: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        post?: never;
        /**
         * Delete a recipe
         * @description Its owner, or an admin for any recipe they can see. The recipe is hidden everywhere at once, and the deletion is recorded in the audit log. (Restoring it from the trash comes with Phase 2.) Send its version in `If-Match`, and `Content-Type: application/json` even though there is no body.
         */
        delete: {
            parameters: {
                query?: never;
                header?: {
                    /** @description The `ETag` of the version the change is based on, such as `"3"`. Required: without it the answer is 428. A version that is no longer current gets 412. */
                    "if-match"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description The caller may see the recipe but not delete it. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The recipe changed since the version in `If-Match`. The body holds it as it is now. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["StaleRecipeProblem"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description The request has no `If-Match`. */
                428: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes/{id}/visibility": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Change a recipe's visibility
         * @description The recipe's owner only, admins included: a private recipe is seen by its owner alone, a shared one by everyone signed in. Setting the visibility it already has changes nothing. Send its version in `If-Match`.
         */
        put: {
            parameters: {
                query?: never;
                header?: {
                    /** @description The `ETag` of the version the change is based on, such as `"3"`. Required: without it the answer is 428. A version that is no longer current gets 412. */
                    "if-match"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ChangeVisibilityRequest"];
                };
            };
            responses: {
                /** @description The recipe, with its visibility now. */
                200: {
                    headers: {
                        /** @description The recipe's version, for the `If-Match` of a change to it. */
                        ETag?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeResult"];
                    };
                };
                /** @description The caller may see the recipe but isn't its owner. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The recipe changed since the version in `If-Match`. The body holds it as it is now. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["StaleRecipeProblem"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description The request has no `If-Match`. */
                428: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes/{id}/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a recipe's draft
         * @description Whoever may edit the recipe: editors and admins, for shared recipes and their own private ones. The draft, or `null` when the recipe has none.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The draft, or `null`. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeDraftResult"];
                    };
                };
                /** @description The caller may see the recipe but not edit it. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        /**
         * Save a recipe's draft
         * @description Whoever may edit the recipe: editors and admins, for shared recipes and their own private ones. Saves the content as the recipe's one draft, replacing any it had, while the published recipe stays as it is. Its photos and tags are checked as publishing them would be. It moves the recipe on to its next version: send the one it was based on in `If-Match`.
         */
        put: {
            parameters: {
                query?: never;
                header?: {
                    /** @description The `ETag` of the version the change is based on, such as `"3"`. Required: without it the answer is 428. A version that is no longer current gets 412. */
                    "if-match"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["RecipeContent"];
                };
            };
            responses: {
                /** @description The draft as saved, with the version the recipe is at now. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeDraftResult"];
                    };
                };
                /** @description The caller may see the recipe but not edit it. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The recipe changed since the version in `If-Match`. The body holds it as it is now. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["StaleRecipeProblem"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description The request has no `If-Match`. */
                428: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        post?: never;
        /**
         * Discard a recipe's draft
         * @description Whoever may edit the recipe: editors and admins, for shared recipes and their own private ones. The published recipe stays as it is. Discarding a draft moves the recipe on to its next version: send the one it was based on in `If-Match`, and `Content-Type: application/json` even though there is no body. Without a draft, nothing changes.
         */
        delete: {
            parameters: {
                query?: never;
                header?: {
                    /** @description The `ETag` of the version the change is based on, such as `"3"`. Required: without it the answer is 428. A version that is no longer current gets 412. */
                    "if-match"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Discarded, or there was none. */
                204: {
                    headers: {
                        /** @description The recipe's version now. */
                        ETag?: string;
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description The caller may see the recipe but not edit it. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The recipe changed since the version in `If-Match`. The body holds it as it is now. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["StaleRecipeProblem"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description The request has no `If-Match`. */
                428: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes/{id}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List a recipe's revisions
         * @description Anyone who may see the recipe: any signed-in user, for shared recipes and their own private ones. Someone else's private recipe answers 404. Every revision, newest first, without its content.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Its history. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeRevisionList"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes/{id}/revisions/{number}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a revision of a recipe
         * @description Anyone who may see the recipe: any signed-in user, for shared recipes and their own private ones. Someone else's private recipe answers 404. The recipe as that revision recorded it, its tags with the names they had then.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    number: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The revision. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeRevisionResult"];
                    };
                };
                /** @description No recipe has this ID, the caller may not see it, or it has no such revision. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes/{id}/revisions/{number}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Restore a revision of a recipe
         * @description Whoever may edit the recipe: editors and admins, for shared recipes and their own private ones. Publishes the revision’s content as the next revision, with the message “Restored from revision #n”, and records it in the audit log. History is never rewritten, and the draft stays. Tags deleted since are left out. Send the version it’s based on in `If-Match`, and `Content-Type: application/json` even though there is no body.
         */
        post: {
            parameters: {
                query?: never;
                header?: {
                    /** @description The `ETag` of the version the change is based on, such as `"3"`. Required: without it the answer is 428. A version that is no longer current gets 412. */
                    "if-match"?: string;
                };
                path: {
                    id: string;
                    number: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The recipe as restored. */
                200: {
                    headers: {
                        /** @description The recipe's version, for the `If-Match` of a change to it. */
                        ETag?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeResult"];
                    };
                };
                /** @description The caller may see the recipe but not edit it. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, the caller may not see it, or it has no such revision. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The revision can no longer be restored. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The recipe changed since the version in `If-Match`. The body holds it as it is now. */
                412: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["StaleRecipeProblem"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description The request has no `If-Match`. */
                428: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload a photo
         * @description Editors and admins. The body is the file itself, with its type as `Content-Type`: a JPEG, PNG or WebP image of up to 10 MB, checked by its first bytes. It is turned upright, stripped of its metadata and resized. Until a recipe is saved with it, only its uploader can see it or use it, and it is deleted after a day.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "image/jpeg": Blob;
                    "image/png": Blob;
                    "image/webp": Blob;
                };
            };
            responses: {
                /** @description The photo, at each size it is served at. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImageResult"];
                    };
                };
                /** @description The file is larger than 10 MB. */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The file is not a JPEG, PNG or WebP image. */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/images/{id}/{width}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a photo at one of its sizes
         * @description Any signed-in user who may see the recipe it belongs to; until a recipe is saved with it, only its uploader. Anyone else gets 404, as for a photo that doesn’t exist. `width` is one of the widths in its `variants`. What an address serves never changes, so it can be cached for good.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    width: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The photo at that size, as WebP. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "image/webp": Blob;
                    };
                };
                /** @description No photo has this ID or size, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tags
         * @description Any signed-in user. Every tag, the allergens included, or every tag of one type.
         */
        get: {
            parameters: {
                query?: {
                    /** @description Only tags of this type. */
                    type?: "cuisine" | "meal_type" | "diet" | "allergen" | "custom";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tags. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TagList"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Create a tag
         * @description Editors and admins. If the type already has a tag with this name, ignoring case and spacing, that tag is returned instead of a new one, with status 200.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateTagRequest"];
                };
            };
            responses: {
                /** @description The tag that already had this name. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TagResult"];
                    };
                };
                /** @description The new tag. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TagResult"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tags/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Count the recipes with each tag
         * @description Admins. Counts only the recipes the caller may see, so recipes kept private by others are left out.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The count for each tag that some recipe the caller may see has. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TagUsage"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tags/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Rename a tag
         * @description Admins. Allergen tags are a fixed list and are refused with status 409. Every recipe with the tag is indexed again, and an audit event records the change. A name another tag of the same type has, ignoring case and spacing, is refused at `name`: merge the two instead.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["RenameTagRequest"];
                };
            };
            responses: {
                /** @description The renamed tag. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TagResult"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        post?: never;
        /**
         * Delete a tag
         * @description Admins. Allergen tags are a fixed list and are refused with status 409. Every recipe with the tag is indexed again, and an audit event records the change. The tag comes off every recipe that had it.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tag is deleted. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tags/{id}/merge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Merge a tag into another
         * @description Admins. Allergen tags are a fixed list and are refused with status 409. Every recipe with the tag is indexed again, and an audit event records the change. Every recipe with the tag gets the other one instead, and the tag is deleted. The other tag must be of the same type.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["MergeTagRequest"];
                };
            };
            responses: {
                /** @description The tag it was merged into. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TagResult"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get your preferences
         * @description Any signed-in user's own display preferences, or the defaults until they choose.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Your preferences. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PreferencesResult"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        /**
         * Save your preferences
         * @description Any signed-in user, viewers included: preferences change only what they see. Replaces all of them.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UserPreferences"];
                };
            };
            responses: {
                /** @description Your preferences, as saved. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PreferencesResult"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recipes/{id}/favorite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get whether a recipe is a favorite
         * @description Editors and admins, for any recipe they can see. Whether it's one of theirs.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Whether it is. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Favorite"];
                    };
                };
                /** @description The caller may see the recipe but keeps no favorites: viewers are read-only. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        /**
         * Make a recipe a favorite, or not
         * @description Editors and admins, for any recipe they can see. Favorites are personal: no one else sees them. Setting what it already is changes nothing.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["Favorite"];
                };
            };
            responses: {
                /** @description Whether it is now. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Favorite"];
                    };
                };
                /** @description The caller may see the recipe but keeps no favorites: viewers are read-only. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description No recipe has this ID, or the caller may not see it. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/favorites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List your favorites
         * @description Editors and admins. Their favorite recipes, most recently chosen first, one page at a time. One they may no longer see, because it was deleted or made private, is left out until it comes back.
         */
        get: {
            parameters: {
                query?: {
                    page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One page of them. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeList"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/search/recipes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search recipes
         * @description Any signed-in user. Finds only recipes the caller may see: shared ones, and their own private ones. Filters on different things all hold; within one, cuisines, meals and difficulties take any of their values, and diets and other tags all of them. Repeat a parameter for more than one value.
         */
        get: {
            parameters: {
                query?: {
                    /** @description What to look for. Typos are forgiven. */
                    q?: string;
                    /** @description Where to look for it: everywhere, or only in ingredient names. */
                    in?: "all" | "ingredients";
                    /** @description Recipes with all of these ingredients, or a name that means the same (scallion, green onion). Names are read as recipes’ are: "Scallions" is "scallion". */
                    ingredient?: string[];
                    /** @description Recipes of any of these cuisines. */
                    cuisine?: string[];
                    /** @description Recipes for any of these meals. */
                    mealType?: string[];
                    /** @description Recipes that fit all of these diets. */
                    diet?: string[];
                    /** @description Recipes with all of these other tags. */
                    tag?: string[];
                    /** @description No recipes of these cuisines. */
                    excludeCuisine?: string[];
                    /** @description No recipes for these meals. */
                    excludeMealType?: string[];
                    /** @description No recipes that fit these diets. */
                    excludeDiet?: string[];
                    /** @description No recipes with these other tags. */
                    excludeTag?: string[];
                    /** @description No recipes that contain any of these. */
                    excludeAllergen?: ("milk" | "eggs" | "fish" | "shellfish" | "tree nuts" | "peanuts" | "wheat" | "soy" | "sesame")[];
                    /** @description Recipes of any of these difficulties. */
                    difficulty?: ("easy" | "medium" | "hard")[];
                    /** @description Recipes that take at least this long in all. */
                    minMinutes?: number | null;
                    /** @description Recipes that take at most this long in all. */
                    maxMinutes?: number | null;
                    /** @description How to order them. Relevance with a query, newest without one. */
                    sort?: "relevance" | "rating" | "newest" | "quickest" | "slowest";
                    page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One page of matching recipes, with the count of each filter value. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RecipeSearchResult"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Search is unavailable. Everything else works. */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/search/ingredients": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Suggest ingredients
         * @description Any signed-in user. Ingredient names that recipes the caller may see use, starting like the query, the most used first: for the `ingredient` filter of recipe search.
         */
        get: {
            parameters: {
                query?: {
                    /** @description The start of an ingredient name. Typos are forgiven. Empty for the most used. */
                    q?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Up to ten ingredient names. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["IngredientSuggestions"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Search is unavailable. Everything else works. */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/search/index": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Show the search index
         * @description Admins only. Whether search works, and how the latest rebuild of its index went.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The search index. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SearchIndexStatus"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/search/index/rebuild": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rebuild the search index
         * @description Admins only. Rebuilds the index from the database in the background, then swaps it in; search keeps working meanwhile. If a rebuild is already waiting or under way, that one stands. While search is unavailable, the rebuild waits for it.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The search index, with the rebuild asked for. */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SearchIndexStatus"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List open invitations
         * @description Admins only. Every invitation that is neither accepted nor revoked, newest first, including expired ones, which an admin resends or revokes.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The open invitations. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["InvitationList"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        put?: never;
        /**
         * Invite someone
         * @description Admins only. Creates an invitation with the role the invitee will get.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateInvitationRequest"];
                };
            };
            responses: {
                /** @description The invitation was created. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["InvitationWithLink"];
                    };
                };
                /** @description A user, or an open invitation, already has this email. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/{id}/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resend an invitation
         * @description Admins only. Issues a new link that works for the full invitation lifetime again, and stops the old link working. Works on expired invitations too. Send `Content-Type: application/json` even though there is no body.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The invitation has a new link. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["InvitationWithLink"];
                    };
                };
                /** @description No open invitation has this ID. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description A user with this email exists now. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revoke an invitation
         * @description Admins only. The link stops working, and the email can be invited again. Send `Content-Type: application/json` even though there is no body.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The invitation was revoked. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description No open invitation has this ID. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check an invitation link
         * @description Public. Returns what the invitation is for, if the link still works. The token is sent in the body, never the URL, so it stays out of logs.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["InvitationLookupRequest"];
                };
            };
            responses: {
                /** @description The link works. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["InvitationDetails"];
                    };
                };
                /** @description The link is invalid, expired, revoked or already used. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invitations/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept an invitation
         * @description Public. Creates the account, with the invited email and role. It does not sign in: the new user then signs in with the same email and password.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["AcceptInvitationRequest"];
                };
            };
            responses: {
                /** @description The account was created. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AcceptInvitationResult"];
                    };
                };
                /** @description The link is invalid, expired, revoked or already used. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description A user with this email already exists. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
                /** @description The request failed validation. */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ValidationProblem"];
                    };
                };
                /** @description Any other error, as RFC 9457 problem details. */
                default: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["ProblemDetails"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        SetupStatus: {
            /** @description True until the first admin exists. */
            needed: boolean;
        };
        /** @description A request that failed schema validation. */
        ValidationProblem: {
            /** @enum {string} */
            type: "/problems/validation-error";
            /** @description Short summary of the problem type. */
            title: string;
            /** @enum {number} */
            status: 422;
            /** @description Explanation of this occurrence, written for the client. Never contains internals. */
            detail?: string;
            /** @description Matches the `X-Request-Id` response header and the server log lines for this request. */
            requestId?: string;
            /** @description One entry per invalid field. */
            errors: {
                /**
                 * @description Which part of the request the field is in.
                 * @enum {string}
                 */
                in: "body" | "query" | "path" | "header" | "cookie";
                /** @description RFC 6901 JSON Pointer to the field within that part, e.g. `#/tags/0`. */
                pointer: string;
                /** @description What is wrong with the field. */
                detail: string;
            }[];
        };
        /** @description RFC 9457 problem details. */
        ProblemDetails: {
            /** @description Identifies the problem type. `about:blank` means the status code says everything, and `title` is then the standard status text. */
            type: string;
            /** @description Short summary of the problem type. */
            title: string;
            /** @description The HTTP status code. */
            status: number;
            /** @description Explanation of this occurrence, written for the client. Never contains internals. */
            detail?: string;
            /** @description Matches the `X-Request-Id` response header and the server log lines for this request. */
            requestId?: string;
        };
        SetupResult: {
            user: components["schemas"]["User"];
        };
        User: {
            id: string;
            name: string;
            /** Format: email */
            email: string;
            role: components["schemas"]["Role"];
        };
        /** @enum {string} */
        Role: "admin" | "editor" | "viewer";
        SetupRequest: {
            name: string;
            /** Format: email */
            email: string;
            password: components["schemas"]["Password"];
        };
        /** @description 15 to 128 characters, with a lowercase letter, an uppercase letter, a number and a special character (anything but a letter or a number, a space included). */
        Password: string;
        AuditEventList: {
            /** @description Newest first. */
            events: components["schemas"]["AuditEvent"][];
            /** @description Pass as `before` to get the next page. `null` on the last page. */
            nextBefore: number | null;
        };
        AuditEvent: {
            id: number;
            /** @enum {string} */
            action: "setup.completed" | "invitation.created" | "invitation.resent" | "invitation.revoked" | "invitation.accepted" | "user.role_changed" | "user.deactivated" | "user.reactivated" | "sign_in.succeeded" | "sign_in.failed" | "sign_out.succeeded" | "recipe.deleted" | "recipe.restored" | "recipe.purged" | "revision.restored" | "public_link.created" | "public_link.revoked" | "tag.renamed" | "tag.merged" | "tag.deleted" | "instance.exported";
            /** @description Who did it. `null` when nobody was signed in, as for a failed sign-in. */
            actor: {
                id: string;
                name: string;
            } | null;
            /** @description What it was done to, if anything. */
            target: {
                /** @enum {string} */
                type: "invitation" | "user" | "recipe" | "tag";
                id: string;
            } | null;
            /** @description Details that depend on the action, such as the email a failed sign-in tried. */
            metadata: {
                [key: string]: unknown;
            };
            ip: string | null;
            userAgent: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        UserAccountList: {
            /** @description Every user, oldest first. */
            users: components["schemas"]["UserAccount"][];
        };
        UserAccount: {
            id: string;
            name: string;
            /** Format: email */
            email: string;
            role: components["schemas"]["Role"];
            /** @description Deactivated users can't sign in. Deactivating them ended their sessions. */
            deactivated: boolean;
            /** Format: date-time */
            createdAt: string;
        };
        UserAccountResult: {
            user: components["schemas"]["UserAccount"];
        };
        ChangeRoleRequest: {
            role: components["schemas"]["Role"];
        };
        RecipeResult: {
            recipe: components["schemas"]["Recipe"];
        };
        Recipe: {
            id: string;
            owner: {
                id: string;
                name: string;
            };
            visibility: components["schemas"]["Visibility"];
            title: string;
            description: string;
            source: {
                url: string | null;
                title: string | null;
                author: string | null;
            };
            equipment: string[];
            yield: {
                qty: number;
                unit: string | null;
            } | null;
            servings: number;
            prepMinutes: number | null;
            cookMinutes: number | null;
            /** @description Set only when it differs from prep plus cook. See `recipeTotalMinutes`. */
            totalMinutes: number | null;
            difficulty: components["schemas"]["Difficulty"];
            nutrition: {
                calories: number | null;
                proteinGrams: number | null;
                carbsGrams: number | null;
                fatGrams: number | null;
                fiberGrams: number | null;
                sugarGrams: number | null;
                sodiumMilligrams: number | null;
            };
            ingredientGroups: {
                label: string | null;
                ingredients: components["schemas"]["IngredientLine"][];
            }[];
            steps: {
                body: string;
                image: components["schemas"]["Image"] | null;
            }[];
            /** @description By type, then name. */
            tags: components["schemas"]["Tag"][];
            /** @description Its photos, in order. */
            images: components["schemas"]["Image"][];
            /** @description One of `images`, or `null` when there are none. */
            coverImageId: string | null;
            /** @description Goes up with every change to the recipe. The `ETag` header carries it too, and every write sends it back in `If-Match`. */
            version: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        /** @enum {string} */
        Visibility: "private" | "shared";
        /** @enum {string|null} */
        Difficulty: "easy" | "medium" | "hard" | null;
        IngredientLine: {
            rawText: string;
            qty: number | null;
            qtyMax: number | null;
            unit: string | null;
            name: string;
            /** @description The name lowercase and singular, without accents or punctuation. */
            normalizedName: string;
            note: string | null;
            scalable: boolean;
        };
        Image: {
            id: string;
            /** @description What it shows, for people who can’t see it. Empty when it isn’t described. */
            alt: string;
            /** @description Of the upload, in pixels, turned upright. */
            width: number;
            height: number;
            /** @description The sizes it’s served at, narrowest first, each from /images/{id}/{width}. */
            variants: {
                width: number;
                height: number;
            }[];
        };
        Tag: {
            id: number;
            type: components["schemas"]["TagType"];
            /** @description As its creator wrote it. Allergens are lowercase: "tree nuts". */
            name: string;
        };
        /** @enum {string} */
        TagType: "cuisine" | "meal_type" | "diet" | "allergen" | "custom";
        CreateRecipeRequest: {
            title: string;
            /** @description Markdown. */
            description: string;
            source: components["schemas"]["RecipeSource"];
            equipment: string[];
            /** @description "24 cookies", separate from the servings. */
            yield: {
                qty: number;
                unit: string | null;
            } | null;
            /** @description The baseline scaling starts from. */
            servings: number;
            prepMinutes: number | null;
            cookMinutes: number | null;
            /** @description Only when it differs from prep plus cook: `null` means their sum. */
            totalMinutes: number | null;
            difficulty: components["schemas"]["Difficulty"];
            nutrition: components["schemas"]["Nutrition"];
            ingredientGroups: components["schemas"]["IngredientGroupInput"][];
            /** @description In order. Each body is markdown. */
            steps: {
                body: string;
                /** @description Its photo, if it has one. */
                image: {
                    id: string;
                    /** @description Its alt text: empty when the recipe’s text already says what it shows. */
                    alt: string;
                } | null;
            }[];
            /** @description Its photos, in order: its own, or uploads of the caller’s no recipe was saved with. Those left out stay its own, for its older revisions, and a later save can use them again. */
            images: {
                id: string;
                /** @description Its alt text: empty when the recipe’s text already says what it shows. */
                alt: string;
            }[];
            /** @description The photo shown for it in lists: one of `images`, or `null` when there are none. */
            coverImageId: string | null;
            tagIds: number[];
            visibility: components["schemas"]["Visibility"];
        };
        RecipeSource: {
            /** Format: uri */
            url: string | null;
            /** @description A book or site title. */
            title: string | null;
            author: string | null;
        };
        /** @description Per serving, entered by hand. `null` for each value nobody entered. */
        Nutrition: {
            calories: number | null;
            proteinGrams: number | null;
            carbsGrams: number | null;
            fatGrams: number | null;
            fiberGrams: number | null;
            sugarGrams: number | null;
            sodiumMilligrams: number | null;
        };
        IngredientGroupInput: {
            /** @description "For the dough". A lone group needs none. */
            label: string | null;
            ingredients: components["schemas"]["IngredientLineInput"][];
        };
        IngredientLineInput: {
            rawText: string;
            /** @description `null` when the line has no quantity. */
            qty: number | null;
            /** @description The top of a range ("2–3 cloves"): more than `qty`. Otherwise `null`. */
            qtyMax: number | null;
            /** @description A unit from the unit table, by any of its names, or one typed by hand. */
            unit: string | null;
            name: string;
            note: string | null;
            /** @description False for lines like "salt to taste", which never scale. */
            scalable: boolean;
        };
        RecipeList: {
            recipes: components["schemas"]["RecipeSummary"][];
            /** @description How many recipes the list holds, across every page: only ones the caller may see. */
            total: number;
            page: number;
            totalPages: number;
        };
        RecipeSummary: {
            id: string;
            title: string;
            /** @enum {string|null} */
            difficulty: "easy" | "medium" | "hard" | null;
            totalMinutes: number | null;
            cuisine: string[];
            mealType: string[];
            diet: string[];
            /** @description Its other tags. */
            tags: string[];
            allergens: ("milk" | "eggs" | "fish" | "shellfish" | "tree nuts" | "peanuts" | "wheat" | "soy" | "sesame")[];
            /** @enum {string} */
            visibility: "private" | "shared";
            /** @description Its cover photo, if it has photos. */
            cover: components["schemas"]["Image"] | null;
        };
        /** @description The recipe changed since it was loaded. */
        StaleRecipeProblem: {
            /** @enum {string} */
            type: "/problems/stale-recipe";
            /** @description Short summary of the problem type. */
            title: string;
            /** @enum {number} */
            status: 412;
            /** @description Explanation of this occurrence, written for the client. Never contains internals. */
            detail?: string;
            /** @description Matches the `X-Request-Id` response header and the server log lines for this request. */
            requestId?: string;
            /** @description The recipe as it is now, with its current `version`. */
            recipe: {
                id: string;
                owner: {
                    id: string;
                    name: string;
                };
                visibility: components["schemas"]["Visibility"];
                title: string;
                description: string;
                source: {
                    url: string | null;
                    title: string | null;
                    author: string | null;
                };
                equipment: string[];
                yield: {
                    qty: number;
                    unit: string | null;
                } | null;
                servings: number;
                prepMinutes: number | null;
                cookMinutes: number | null;
                /** @description Set only when it differs from prep plus cook. See `recipeTotalMinutes`. */
                totalMinutes: number | null;
                difficulty: components["schemas"]["Difficulty"];
                nutrition: {
                    calories: number | null;
                    proteinGrams: number | null;
                    carbsGrams: number | null;
                    fatGrams: number | null;
                    fiberGrams: number | null;
                    sugarGrams: number | null;
                    sodiumMilligrams: number | null;
                };
                ingredientGroups: {
                    label: string | null;
                    ingredients: components["schemas"]["IngredientLine"][];
                }[];
                steps: {
                    body: string;
                    image: components["schemas"]["Image"] | null;
                }[];
                /** @description By type, then name. */
                tags: components["schemas"]["Tag"][];
                /** @description Its photos, in order. */
                images: components["schemas"]["Image"][];
                /** @description One of `images`, or `null` when there are none. */
                coverImageId: string | null;
                /** @description Goes up with every change to the recipe. The `ETag` header carries it too, and every write sends it back in `If-Match`. */
                version: number;
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                updatedAt: string;
            };
        };
        UpdateRecipeRequest: {
            title: string;
            /** @description Markdown. */
            description: string;
            source: components["schemas"]["RecipeSource"];
            equipment: string[];
            /** @description "24 cookies", separate from the servings. */
            yield: {
                qty: number;
                unit: string | null;
            } | null;
            /** @description The baseline scaling starts from. */
            servings: number;
            prepMinutes: number | null;
            cookMinutes: number | null;
            /** @description Only when it differs from prep plus cook: `null` means their sum. */
            totalMinutes: number | null;
            difficulty: components["schemas"]["Difficulty"];
            nutrition: components["schemas"]["Nutrition"];
            ingredientGroups: components["schemas"]["IngredientGroupInput"][];
            /** @description In order. Each body is markdown. */
            steps: {
                body: string;
                /** @description Its photo, if it has one. */
                image: {
                    id: string;
                    /** @description Its alt text: empty when the recipe’s text already says what it shows. */
                    alt: string;
                } | null;
            }[];
            /** @description Its photos, in order: its own, or uploads of the caller’s no recipe was saved with. Those left out stay its own, for its older revisions, and a later save can use them again. */
            images: {
                id: string;
                /** @description Its alt text: empty when the recipe’s text already says what it shows. */
                alt: string;
            }[];
            /** @description The photo shown for it in lists: one of `images`, or `null` when there are none. */
            coverImageId: string | null;
            tagIds: number[];
            /** @description What changed, for the history. Optional. */
            message?: string;
        };
        ChangeVisibilityRequest: {
            visibility: components["schemas"]["Visibility"];
        };
        RecipeDraftResult: {
            /** @description `null` when there is none. */
            draft: components["schemas"]["RecipeDraft"] | null;
        };
        RecipeDraft: {
            content: components["schemas"]["RecipeContent"];
            /** @description Each photo `content` names, for showing it. Their alt text is in `content`. */
            photos: components["schemas"]["Image"][];
            /** @description Who saved it last. */
            author: {
                id: string;
                name: string;
            };
            /** Format: date-time */
            updatedAt: string;
            /** @description The revision it started from: the latest one when it was first saved. A newer one means the recipe was published since, by a restore. */
            revision: number;
            /** @description The recipe's version now, which a change to the draft or the recipe sends in `If-Match`. */
            version: number;
        };
        RecipeContent: {
            title: string;
            /** @description Markdown. */
            description: string;
            source: components["schemas"]["RecipeSource"];
            equipment: string[];
            /** @description "24 cookies", separate from the servings. */
            yield: {
                qty: number;
                unit: string | null;
            } | null;
            /** @description The baseline scaling starts from. */
            servings: number;
            prepMinutes: number | null;
            cookMinutes: number | null;
            /** @description Only when it differs from prep plus cook: `null` means their sum. */
            totalMinutes: number | null;
            difficulty: components["schemas"]["Difficulty"];
            nutrition: components["schemas"]["Nutrition"];
            ingredientGroups: components["schemas"]["IngredientGroupInput"][];
            /** @description In order. Each body is markdown. */
            steps: {
                body: string;
                /** @description Its photo, if it has one. */
                image: {
                    id: string;
                    /** @description Its alt text: empty when the recipe’s text already says what it shows. */
                    alt: string;
                } | null;
            }[];
            /** @description Its photos, in order: its own, or uploads of the caller’s no recipe was saved with. Those left out stay its own, for its older revisions, and a later save can use them again. */
            images: {
                id: string;
                /** @description Its alt text: empty when the recipe’s text already says what it shows. */
                alt: string;
            }[];
            /** @description The photo shown for it in lists: one of `images`, or `null` when there are none. */
            coverImageId: string | null;
            tagIds: number[];
        };
        RecipeRevisionList: {
            /** @description Newest first. The first is the one published. */
            revisions: components["schemas"]["RecipeRevisionSummary"][];
        };
        RecipeRevisionSummary: {
            /** @description Its place in the history, from 1. */
            number: number;
            author: {
                id: string;
                name: string;
            };
            message: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        RecipeRevisionResult: {
            revision: components["schemas"]["RecipeRevision"];
        };
        RecipeRevision: {
            /** @description Its place in the history, from 1. */
            number: number;
            author: {
                id: string;
                name: string;
            };
            message: string | null;
            /** Format: date-time */
            createdAt: string;
            content: components["schemas"]["RecipeRevisionContent"];
        };
        RecipeRevisionContent: {
            title: string;
            description: string;
            source: {
                url: string | null;
                title: string | null;
                author: string | null;
            };
            equipment: string[];
            yield: {
                qty: number;
                unit: string | null;
            } | null;
            servings: number;
            prepMinutes: number | null;
            cookMinutes: number | null;
            /** @description Set only when it differs from prep plus cook. See `recipeTotalMinutes`. */
            totalMinutes: number | null;
            difficulty: components["schemas"]["Difficulty"];
            nutrition: {
                calories: number | null;
                proteinGrams: number | null;
                carbsGrams: number | null;
                fatGrams: number | null;
                fiberGrams: number | null;
                sugarGrams: number | null;
                sodiumMilligrams: number | null;
            };
            ingredientGroups: {
                label: string | null;
                ingredients: components["schemas"]["IngredientLine"][];
            }[];
            steps: {
                body: string;
                image: components["schemas"]["Image"] | null;
            }[];
            /** @description By type, then name. */
            tags: components["schemas"]["Tag"][];
            /** @description Its photos, in order. */
            images: components["schemas"]["Image"][];
            /** @description One of `images`, or `null` when there are none. */
            coverImageId: string | null;
        };
        ImageResult: {
            image: components["schemas"]["Image"];
        };
        TagList: {
            /** @description By type, then name. */
            tags: components["schemas"]["Tag"][];
        };
        TagResult: {
            tag: components["schemas"]["Tag"];
        };
        CreateTagRequest: {
            /**
             * @description Any type but `allergen`: the allergens are a fixed list.
             * @enum {string}
             */
            type: "cuisine" | "meal_type" | "diet" | "custom";
            name: string;
        };
        TagUsage: {
            /** @description How many recipes the caller may see have each tag. A tag no recipe has is left out. */
            usage: {
                tagId: number;
                recipes: number;
            }[];
        };
        RenameTagRequest: {
            name: string;
        };
        MergeTagRequest: {
            /** @description Another tag of the same type, which takes its place. */
            intoId: number;
        };
        PreferencesResult: {
            preferences: components["schemas"]["UserPreferences"];
        };
        UserPreferences: {
            /**
             * @description How recipes show quantities. `imperial` is the US customary measures.
             * @enum {string}
             */
            unitSystem: "imperial" | "metric";
        };
        Favorite: {
            favorite: boolean;
        };
        RecipeSearchResult: {
            hits: components["schemas"]["RecipeSummary"][];
            /** @description How many recipes match, across every page. */
            totalHits: number;
            page: number;
            totalPages: number;
            /** @description How many recipes each filter value would give. A filter that takes any of its values (cuisine, meal, difficulty) is counted without its own choices, so its other values' counts say what adding them would give. */
            facets: {
                cuisine: {
                    [key: string]: number;
                };
                mealType: {
                    [key: string]: number;
                };
                diet: {
                    [key: string]: number;
                };
                tag: {
                    [key: string]: number;
                };
                allergen: {
                    [key: string]: number;
                };
                difficulty: {
                    [key: string]: number;
                };
            };
        };
        IngredientSuggestions: {
            ingredients: {
                /** @description As recipes’ ingredient names are read, for the `ingredient` filter. */
                name: string;
                /** @description How many recipes the caller may see use it. */
                recipes: number;
            }[];
        };
        SearchIndexStatus: {
            /** @description Whether search works right now. */
            available: boolean;
            /** @description The latest rebuild, or null if there has been none. */
            rebuild: {
                /** @enum {string} */
                state: "queued" | "running" | "retrying" | "succeeded" | "failed";
                /**
                 * Format: date-time
                 * @description When the rebuild was asked for.
                 */
                queuedAt: string;
            } | null;
        };
        InvitationList: {
            /** @description Open invitations, newest first. */
            invitations: components["schemas"]["Invitation"][];
        };
        Invitation: {
            id: string;
            /** Format: email */
            email: string;
            /**
             * @description The role the invitee gets on accepting.
             * @enum {string}
             */
            role: "admin" | "editor" | "viewer";
            /**
             * @description `pending`: the link works. `expired`: it no longer does; resend or revoke it.
             * @enum {string}
             */
            status: "pending" | "expired";
            /**
             * Format: date-time
             * @description When the link stops working.
             */
            expiresAt: string;
            /** Format: date-time */
            createdAt: string;
        };
        InvitationWithLink: {
            invitation: components["schemas"]["Invitation"];
            /**
             * Format: uri
             * @description The link to share with the invitee. Present when myli does not email it itself. It is shown only once: myli stores only a hash of the token in it.
             */
            link?: string;
        };
        CreateInvitationRequest: {
            /** Format: email */
            email: string;
            role: components["schemas"]["Role"];
        };
        InvitationDetails: {
            /**
             * Format: email
             * @description The new account gets this email address.
             */
            email: string;
            role: components["schemas"]["Role"];
            /** Format: date-time */
            expiresAt: string;
        };
        InvitationLookupRequest: {
            token: string;
        };
        AcceptInvitationResult: {
            user: components["schemas"]["User"];
        };
        AcceptInvitationRequest: {
            token: string;
            name: string;
            password: components["schemas"]["Password"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
