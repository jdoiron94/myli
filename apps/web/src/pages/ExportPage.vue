<script setup lang="ts">
import { DownloadIcon } from '@lucide/vue';
import { API_BASE_PATH } from '@myli/shared';
import { Button } from '@/components/ui/button';
</script>

<template>
  <h1 class="text-2xl font-semibold">
    Export
  </h1>
  <div class="mt-2 max-w-prose space-y-2 text-muted-foreground">
    <p>
      Download a zip archive of every recipe you can see, as published, with all its revisions,
      its tags and its photos: a copy to keep, or to take somewhere else. Each export is recorded in
      the audit log.
    </p>
    <p>
      Other people’s private recipes and recipes in the trash aren’t in it, and nor are ratings,
      comments, notes, favorites or collections. To keep everything, back up myli’s data instead.
    </p>
  </div>
  <!-- The browser downloads it itself, as the API makes it. -->
  <Button
    class="mt-6"
    as-child
  >
    <a
      :href="`${API_BASE_PATH}/export`"
      download
    >
      <DownloadIcon aria-hidden="true" />
      Download the export
    </a>
  </Button>
</template>
