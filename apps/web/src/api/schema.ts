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
                    action?: "setup.completed" | "invitation.created" | "invitation.resent" | "invitation.revoked" | "invitation.accepted" | "user.role_changed" | "user.deactivated" | "user.reactivated" | "sign_in.succeeded" | "sign_in.failed" | "sign_out.succeeded" | "recipe.deleted" | "recipe.restored" | "recipe.purged" | "revision.restored" | "public_link.created" | "public_link.revoked" | "instance.exported";
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
            action: "setup.completed" | "invitation.created" | "invitation.resent" | "invitation.revoked" | "invitation.accepted" | "user.role_changed" | "user.deactivated" | "user.reactivated" | "sign_in.succeeded" | "sign_in.failed" | "sign_out.succeeded" | "recipe.deleted" | "recipe.restored" | "recipe.purged" | "revision.restored" | "public_link.created" | "public_link.revoked" | "instance.exported";
            /** @description Who did it. `null` when nobody was signed in, as for a failed sign-in. */
            actor: {
                id: string;
                name: string;
            } | null;
            /** @description What it was done to, if anything. */
            target: {
                /** @enum {string} */
                type: "invitation" | "user" | "recipe";
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
