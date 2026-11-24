<script setup lang="ts">
import { can } from '@myli/shared';
import { useQuery } from '@tanstack/vue-query';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { failureMessage } from '@/api/failure.ts';
import { useRetry } from '@/api/retry.ts';
import { sessionQuery } from '@/auth/session.ts';
import MarkdownContent from '@/components/MarkdownContent.vue';
import RetryableFailure from '@/components/RetryableFailure.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import CommentForm from './CommentForm.vue';
import {
  type Comment,
  recipeCommentsQuery,
  useDeleteComment,
  useEditComment,
  usePostComment,
} from './comments.ts';
import type { Recipe } from './recipe.ts';

/**
 * A recipe's comments (spec §3.2), which everyone who sees it reads, and what the policy lets the
 * reader do with them: write one, change their own, delete theirs or, for admins, anyone's. None of
 * it is printed.
 */
const props = defineProps<{ recipe: Pick<Recipe, 'id' | 'owner' | 'visibility'> }>();

const { data: user } = useQuery(sessionQuery);
const policyRecipe = computed(() => ({
  ownerId: props.recipe.owner.id,
  visibility: props.recipe.visibility,
}));
const canComment = computed(() => can(user.value ?? null, 'recipe.interact', policyRecipe.value));
const allowed = (action: 'comment.edit' | 'comment.delete', comment: Comment) =>
  can(user.value ?? null, action, { authorId: comment.author.id, recipe: policyRecipe.value });

const query = useQuery(computed(() => recipeCommentsQuery(props.recipe.id)));
const comments = computed(() => query.data.value);
const { failure: loadFailure, retrying, stillFailing, retry } = useRetry(query);

const writtenFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const written = (comment: Comment) => writtenFormat.format(new Date(comment.createdAt));
const bylineId = (comment: Comment) => `comment-${comment.id}-byline`;

/** What happened, like a comment deleted, and why a change failed. */
const notice = ref<string>();
const failure = ref<string>();
const heading = useTemplateRef('heading');

async function focusById(id: string) {
  await nextTick();
  document.getElementById(id)?.focus();
}

const post = usePostComment();

/** Posted, it's in the list, which has been fetched again by then: focus goes to it. */
async function savePost(body: string) {
  notice.value = undefined;
  failure.value = undefined;
  const { id } = await post.mutateAsync({ recipeId: props.recipe.id, body });
  await focusById(`comment-${id}`);
}

/** The comment being changed, if any. */
const editing = ref<string>();
const edit = useEditComment();

async function saveEdit(id: string, body: string) {
  notice.value = undefined;
  failure.value = undefined;
  await edit.mutateAsync({ id, body });
  stopEditing(id);
}

/** Back to the comment, focus on its Edit button, which the form replaced. */
function stopEditing(id: string) {
  editing.value = undefined;
  void focusById(`comment-${id}-edit`);
}

const remove = useDeleteComment();

/** It's gone from the list, and the button with it: focus goes to the heading. */
async function deleteComment(id: string) {
  if (remove.isPending.value) return;
  notice.value = undefined;
  failure.value = undefined;
  try {
    await remove.mutateAsync(id);
    notice.value = 'Comment deleted.';
  } catch (error) {
    failure.value = failureMessage(error);
  }
  heading.value?.focus();
}
</script>

<template>
  <section
    aria-labelledby="comments-heading"
    class="mt-12 max-w-prose print:hidden"
  >
    <h2
      id="comments-heading"
      ref="heading"
      tabindex="-1"
      class="mb-4 text-xl font-semibold outline-none"
    >
      Comments
    </h2>

    <RetryableFailure
      v-if="loadFailure"
      :error="loadFailure"
      :retrying="retrying"
      :still-failing="stillFailing"
      @retry="retry"
    />
    <p
      v-else-if="!comments"
      class="text-muted-foreground"
    >
      Loading comments…
    </p>
    <ol
      v-else-if="comments.length > 0"
      class="space-y-6"
    >
      <li
        v-for="comment in comments"
        :id="`comment-${comment.id}`"
        :key="comment.id"
        tabindex="-1"
        class="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <p
          :id="bylineId(comment)"
          class="text-sm text-muted-foreground"
        >
          <span class="font-medium text-foreground">{{ comment.author.name }}</span>
          ·
          <time :datetime="comment.createdAt">{{ written(comment) }}</time>
          <template v-if="comment.editedAt">
            · edited
          </template>
        </p>
        <CommentForm
          v-if="editing === comment.id"
          class="mt-2"
          label="Your comment"
          submit-label="Save comment"
          :initial="comment.body"
          :save="(body) => saveEdit(comment.id, body)"
          cancellable
          @cancel="stopEditing(comment.id)"
        />
        <template v-else>
          <MarkdownContent
            class="mt-1"
            :source="comment.body"
          />
          <div
            v-if="allowed('comment.edit', comment) || allowed('comment.delete', comment)"
            class="mt-1 flex gap-1"
          >
            <!-- Every comment has these: the byline says which one each is for. -->
            <Button
              v-if="allowed('comment.edit', comment)"
              :id="`comment-${comment.id}-edit`"
              variant="ghost"
              size="xs"
              :aria-describedby="bylineId(comment)"
              @click="editing = comment.id"
            >
              Edit
            </Button>
            <AlertDialog v-if="allowed('comment.delete', comment)">
              <AlertDialogTrigger as-child>
                <Button
                  variant="ghost"
                  size="xs"
                  :aria-describedby="bylineId(comment)"
                >
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {{ comment.author.name }}’s comment?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It's gone for good: it can't be restored.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    @click="deleteComment(comment.id)"
                  >
                    Delete comment
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </template>
      </li>
    </ol>
    <p
      v-else
      class="text-muted-foreground"
    >
      No comments yet.
    </p>

    <!-- Always there, so screen readers announce what it says as it changes. -->
    <p
      role="status"
      class="text-sm not-empty:mt-4"
    >
      {{ notice }}
    </p>
    <p
      v-if="failure"
      role="alert"
      class="mt-4 text-sm text-destructive"
    >
      {{ failure }}
    </p>

    <CommentForm
      v-if="canComment"
      class="mt-6"
      label="Add a comment"
      submit-label="Post comment"
      :save="savePost"
    />
  </section>
</template>
