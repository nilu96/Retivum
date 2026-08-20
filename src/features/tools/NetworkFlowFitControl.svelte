<script lang="ts">
  import {
    ControlButton,
    useNodesInitialized,
    useSvelteFlow,
    type FitViewOptions,
  } from '@xyflow/svelte';
  import { tick } from 'svelte';
  import type { RetivumFlowEdge, RetivumFlowNode } from './network-flow';

  let {
    label,
    fitViewOptions,
    initialFitReady,
    layoutRevision,
    pathCount,
    onarrange,
  }: {
    label: string;
    fitViewOptions: FitViewOptions<RetivumFlowNode>;
    initialFitReady: boolean;
    layoutRevision: string;
    pathCount: number;
    onarrange: () => void;
  } = $props();

  const { fitView } = useSvelteFlow<RetivumFlowNode, RetivumFlowEdge>();
  const nodesInitialized = useNodesInitialized();
  let emptyFitComplete = $state(false);
  let populatedFitComplete = $state(false);
  let initialFitRun = 0;

  $effect(() => {
    const measured = nodesInitialized.current;
    const populated = pathCount > 0;
    if (!initialFitReady
      || !layoutRevision
      || !measured
      || (populated ? populatedFitComplete : emptyFitComplete)) return;
    const run = ++initialFitRun;
    const timeout = window.setTimeout(() => { void fitInitialArrangement(run, populated); }, 0);
    return () => {
      window.clearTimeout(timeout);
      if (initialFitRun === run) initialFitRun += 1;
    };
  });

  async function fitInitialArrangement(run: number, populated: boolean): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await tick();
      if (run !== initialFitRun) return;
      if (await fitView({ ...fitViewOptions, duration: 0 })) {
        if (populated) populatedFitComplete = true;
        else emptyFitComplete = true;
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
    }
  }

  async function arrangeAndFit(): Promise<void> {
    onarrange();
    await tick();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await fitView({ ...fitViewOptions, duration: 260 });
  }
</script>

<ControlButton
  class="svelte-flow__controls-fitview network-flow-fit"
  title={label}
  aria-label={label}
  onclick={() => { void arrangeAndFit(); }}
>
  <svg viewBox="0 0 32 30" aria-hidden="true">
    <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
  </svg>
</ControlButton>
