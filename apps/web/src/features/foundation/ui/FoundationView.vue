<script setup lang="ts">
import { foundationReadiness } from '../domain/readiness'
</script>

<template>
  <main
    class="foundation"
    data-testid="foundation"
  >
    <p class="eyebrow">
      PhotoBunker New
    </p>
    <h1>Foundation preview</h1>
    <p>
      Production PWA workspace is running. Product screens belong to R2-02 and are not
      simulated here.
    </p>
    <dl>
      <div>
        <dt>Production build</dt>
        <dd>{{ foundationReadiness.productionBuild ? 'ready' : 'not ready' }}</dd>
      </div>
      <div>
        <dt>Legacy runtime</dt>
        <dd>{{ foundationReadiness.legacyRuntimeIncluded ? 'included' : 'excluded' }}</dd>
      </div>
      <div>
        <dt>Messenger runtime</dt>
        <dd>{{ foundationReadiness.messengerIncluded ? 'included' : 'excluded' }}</dd>
      </div>
    </dl>
  </main>
</template>
